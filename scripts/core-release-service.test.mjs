import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { protocolCompatibility } from "../packages/protocol/dist/index.js";

const abi = process.versions.modules;
const first_core = `if(process.env.HATOPAD_CORE_UPDATE_FAILED==='1'){console.log('PREVIOUS_RESTARTED');process.exit(0);}
console.log('MODE:'+process.env.HATOPAD_CORE_RELEASE_MODE+':'+process.env.HATOPAD_CORE_UPDATE_MANAGED);
process.send({type:'hatopad-core-ready'});
process.send({type:'hatopad-core-update',branch:'main',expectedCurrent:process.env.HATOPAD_CORE_RUNNING_COMMIT,expectedLatest:process.env.FIXTURE_LATEST});
process.on('message',m=>{if(m.type==='hatopad-core-update-go'){console.log('STOPPING_FOR_SWITCH');process.exit(75);}if(m.type==='hatopad-core-update-abort'){console.log('ABORTED_KEEPING_CORE');process.exit(0);}});`;
const scenarios = {
  "local release cache layout": {
    local: true,
    npm: 0,
    second:
      "console.log('UPDATED_CORE:'+process.env.HATOPAD_CORE_RUNNING_COMMIT);process.send({type:'hatopad-core-ready'});setTimeout(()=>process.exit(0),50);",
    expect: /STOPPING_FOR_SWITCH[\s\S]*UPDATED_CORE/,
    switched: true,
  },
  success: {
    npm: 0,
    second:
      "console.log('UPDATED_CORE:'+process.env.HATOPAD_CORE_RUNNING_COMMIT);process.send({type:'hatopad-core-ready'});setTimeout(()=>process.exit(0),50);",
    expect: /STOPPING_FOR_SWITCH[\s\S]*UPDATED_CORE/,
    switched: true,
  },
  "build failure keeps the running Core": {
    npm: 23,
    second: "console.log('UPDATED_CORE');process.exit(0);",
    expect: /ABORTED_KEEPING_CORE/,
    reject: /STOPPING_FOR_SWITCH|UPDATED_CORE/,
    switched: false,
  },
  "unready release rolls back": {
    npm: 0,
    second: "console.log('BROKEN_CORE');process.exit(1);",
    expect: /STOPPING_FOR_SWITCH[\s\S]*BROKEN_CORE[\s\S]*PREVIOUS_RESTARTED/,
    switched: false,
  },
};
for (const [name, scenario] of Object.entries(scenarios))
  test(`cloud release launcher: ${name}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "core-release-test-"));
    const git = (cwd, ...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const origin = path.join(root, "origin");
      git(root, "init", "-b", "main", origin);
      git(origin, "config", "user.email", "fixture@example.com");
      git(origin, "config", "user.name", "Fixture");
      for (const dir of [
        "scripts",
        "packages/core/dist",
        "packages/protocol/dist",
        "packages/desktop/dist-electron",
        "packages/desktop/dist-renderer",
        "node_modules/node-pty",
      ])
        await mkdir(path.join(origin, dir), { recursive: true });
      await writeFile(path.join(origin, "package.json"), '{"type":"module"}');
      await writeFile(path.join(origin, ".gitignore"), ".hatopad-build\n");
      await writeFile(path.join(origin, "node_modules/node-pty/index.js"), "module.exports={};");
      await writeFile(path.join(origin, "packages/core/dist/server.js"), "export const ready=true;");
      await writeFile(path.join(origin, "packages/desktop/dist-electron/main.js"), "");
      await writeFile(path.join(origin, "packages/desktop/dist-renderer/index.html"), "");
      await cp(
        new URL("./core-release-service.mjs", import.meta.url),
        path.join(origin, "scripts/core-release-service.mjs"),
      );
      await cp(new URL("../packages/protocol/dist/", import.meta.url), path.join(origin, "packages/protocol/dist"), {
        recursive: true,
      });
      await writeFile(path.join(origin, "packages/core/dist/index.js"), first_core);
      git(origin, "add", "-f", ".");
      git(origin, "commit", "-m", "initial");
      const first = git(origin, "rev-parse", "HEAD");
      const deploy = path.join(root, "deploy"),
        releases = scenario.local ? deploy : path.join(deploy, "releases");
      await mkdir(releases, { recursive: true });
      const firstName = `${first}-node${abi}`,
        release = path.join(releases, firstName);
      git(root, "clone", origin, release);
      git(release, "checkout", "--detach", first);
      if (scenario.local) await writeFile(path.join(release, ".complete"), first);
      else
        await writeFile(
          path.join(release, ".hatopad-build"),
          `${first}:node${abi}:${process.platform}:${process.arch}\n`,
        );
      const selection = path.join(root, "server.release");
      await writeFile(selection, firstName);
      await writeFile(path.join(origin, "packages/core/dist/index.js"), scenario.second);
      git(origin, "commit", "-am", "update");
      git(origin, "tag", `core-protocol-${protocolCompatibility.maximum}-v0.1.2`);
      const latest = git(origin, "rev-parse", "HEAD");
      const npm = path.join(root, "npm.mjs");
      await writeFile(npm, `process.exit(${scenario.npm});`);
      const result = spawnSync(
        process.execPath,
        [
          path.join(release, "scripts/core-release-service.mjs"),
          "--gateway-workspace-id",
          "ws1",
          "--workspace",
          "/tmp/x",
        ],
        {
          cwd: release,
          encoding: "utf8",
          timeout: 30000,
          env: {
            ...process.env,
            npm_execpath: npm,
            FIXTURE_LATEST: latest,
            HATOPAD_CORE_RELEASE_ROOT: deploy,
            ...(scenario.local ? { HATOPAD_CORE_RELEASES_DIR: deploy } : {}),
            HATOPAD_CORE_RELEASE_SELECTION: selection,
            HATOPAD_CORE_READY_TIMEOUT_MS: "5000",
          },
        },
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, scenario.expect);
      assert.match(result.stdout, /MODE:1:1/);
      if (scenario.reject) assert.doesNotMatch(result.stdout, scenario.reject);
      const chosen = (await readFile(selection, "utf8")).trim();
      assert.equal(chosen, scenario.switched ? `${latest}-node${abi}` : firstName);
      if (scenario.switched) assert.equal((await readFile(`${selection}.previous`, "utf8")).trim(), firstName);
      assert.equal(git(release, "rev-parse", "HEAD"), first, "running release stays immutable");
      const left = (await readdir(releases)).filter((item) => item.startsWith(".staging"));
      assert.deepEqual(left, []);
      assert.deepEqual(
        (await readdir(deploy)).filter((item) => item.endsWith(".lock")),
        [],
      );
      if (scenario.local && scenario.switched)
        assert.equal((await readFile(path.join(releases, chosen, ".complete"), "utf8")).trim(), latest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("a release directory outside the deployment layout runs unmanaged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "core-release-unmanaged-"));
  try {
    for (const directory of ["scripts", "packages/core/dist", "packages/protocol/dist"])
      await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await cp(new URL("../packages/protocol/dist/", import.meta.url), path.join(root, "packages/protocol/dist"), {
      recursive: true,
    });
    await cp(
      new URL("./core-release-service.mjs", import.meta.url),
      path.join(root, "scripts/core-release-service.mjs"),
    );
    await writeFile(
      path.join(root, "packages/core/dist/index.js"),
      "console.log(process.env.HATOPAD_CORE_UPDATE_MANAGED === '0' ? 'UNMANAGED_CORE' : 'INCORRECT');",
    );
    const result = spawnSync(process.execPath, ["scripts/core-release-service.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        HATOPAD_CORE_RELEASE_ROOT: path.join(root, "deploy"),
        HATOPAD_CORE_RELEASE_SELECTION: path.join(root, "sel"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /UNMANAGED_CORE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const loop of [false, true])
  test(`cloud release launcher restarts a crashed Core ${loop ? "but stops a crash loop" : "once and exits cleanly"}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "core-crash-test-"));
    const git = (cwd, ...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const deploy = path.join(root, "deploy"),
        releases = path.join(deploy, "releases"),
        counter = path.join(root, "runs");
      const origin = path.join(root, "origin");
      git(root, "init", "-b", "main", origin);
      git(origin, "config", "user.email", "f@example.com");
      git(origin, "config", "user.name", "F");
      for (const dir of ["scripts", "packages/core/dist", "packages/protocol/dist"])
        await mkdir(path.join(origin, dir), { recursive: true });
      await writeFile(path.join(origin, "package.json"), '{"type":"module"}');
      await cp(
        new URL("./core-release-service.mjs", import.meta.url),
        path.join(origin, "scripts/core-release-service.mjs"),
      );
      await cp(new URL("../packages/protocol/dist/", import.meta.url), path.join(origin, "packages/protocol/dist"), {
        recursive: true,
      });
      await writeFile(
        path.join(origin, "packages/core/dist/index.js"),
        `import {appendFileSync,readFileSync} from 'node:fs';appendFileSync(${JSON.stringify(counter)},'x');const runs=readFileSync(${JSON.stringify(counter)},'utf8').length;console.log('RUN:'+runs);process.exit(${loop ? "3" : "runs<2?3:0"});`,
      );
      git(origin, "add", ".");
      git(origin, "commit", "-m", "i");
      const first = git(origin, "rev-parse", "HEAD");
      await mkdir(releases, { recursive: true });
      const name = `${first}-node${abi}`,
        release = path.join(releases, name);
      git(root, "clone", origin, release);
      const result = spawnSync(process.execPath, [path.join(release, "scripts/core-release-service.mjs")], {
        cwd: release,
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          HATOPAD_CORE_RELEASE_ROOT: deploy,
          HATOPAD_CORE_RELEASE_SELECTION: path.join(root, "sel"),
          HATOPAD_CORE_RESTART_DELAY_MS: "10",
          HATOPAD_CORE_MAX_CRASHES: "3",
        },
      });
      const runs = (await readFile(counter, "utf8")).length;
      if (loop) {
        assert.equal(runs, 3);
        assert.equal(result.status, 3);
        assert.match(result.stderr, /not restarting it again/);
      } else {
        assert.equal(runs, 2);
        assert.equal(result.status, 0);
        assert.match(result.stderr, /restarting in/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
