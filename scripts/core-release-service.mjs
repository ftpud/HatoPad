import { writeFileSync } from "node:fs";
import { compatibleCoreTags, protocolCompatibility } from "../packages/protocol/dist/index.js";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/comm", "hatopad-release");
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}

// Supervises a Gateway-deployed cloud Core. Releases are immutable clones under
// <root>/releases (or Gateway's local release cache); an update stages a new release beside the running one and
// switches only after it is built and smoke-tested, then rolls back if it never
// reports ready. Non-cloud installations keep using core-service.mjs.
const exec = promisify(execFile);
const home = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const releasePattern = /^[0-9a-f]{40,64}-node[0-9]+(?:-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$/;
const sha = /^[a-f0-9]{40}$/;
const restartDelayMs = Number(process.env.HATOPAD_CORE_RESTART_DELAY_MS) || 1000;
const maxCrashes = Number(process.env.HATOPAD_CORE_MAX_CRASHES) || 5;
const crashWindowMs = 10 * 60_000;
const readyTimeoutMs = Number(process.env.HATOPAD_CORE_READY_TIMEOUT_MS) || 180_000;
const root = process.env.HATOPAD_CORE_RELEASE_ROOT;
const selection = process.env.HATOPAD_CORE_RELEASE_SELECTION;
// SSH hosts keep releases in <root>/releases; Gateway's local cache keeps them directly in its release directory.
const releases = process.env.HATOPAD_CORE_RELEASES_DIR || (root ? path.join(root, "releases") : undefined);
const workspaceId = (process.argv.join(" ").match(/--gateway-workspace-id ([A-Za-z0-9_-]{1,200})(?: |$)/) ?? [])[1];
const valid = (value) =>
  value &&
  value.type === "hatopad-core-update" &&
  ["dev", "main"].includes(value.branch) &&
  sha.test(value.expectedCurrent) &&
  sha.test(value.expectedLatest) &&
  (!value.compatibility ||
    (Number.isSafeInteger(value.compatibility.minimum) &&
      Number.isSafeInteger(value.compatibility.maximum) &&
      value.compatibility.minimum > 0 &&
      value.compatibility.maximum >= value.compatibility.minimum));
const exists = (target) =>
  access(target).then(
    () => true,
    () => false,
  );
const git = async (cwd, ...args) =>
  (await exec("git", args, { cwd, env, timeout: 120_000, maxBuffer: 1_000_000 })).stdout.trim();
let core;
let active;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    active?.kill(signal);
    core?.kill(signal);
  });

/** The release directory's own runtime keeps a portable Node and its ABI together. */
async function runtime(directory) {
  const node = path.join(directory, "bin/node");
  return (await exists(node))
    ? { node, path: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ""}` }
    : { node: process.execPath, path: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
}
async function npmCli(node) {
  for (const candidate of [
    process.env.npm_execpath,
    path.join(path.dirname(node), "../lib/node_modules/npm/bin/npm-cli.js"),
  ])
    if (candidate && (await exists(candidate))) return candidate;
  throw new Error("npm was not found beside Node");
}
async function command(file, args, cwd, runtimePath) {
  if (stopping) throw new Error("Stopped");
  await new Promise((resolve, reject) => {
    active = spawn(file, args, { cwd, env: { ...env, PATH: runtimePath }, stdio: "ignore" });
    active.once("error", reject);
    active.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Installation step failed"))));
  });
  active = undefined;
}
async function acquire(lock, owner) {
  try {
    await mkdir(lock);
  } catch {
    throw new Error("Another deployment operation is running");
  }
  await writeFile(path.join(lock, owner.file), owner.content);
}
async function atomicWrite(file, content) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, file);
}

async function validBuild(directory, marker) {
  // Remote releases carry `.hatopad-build`; Gateway's local cache carries `.complete` holding the commit.
  const recorded =
    (await readFile(path.join(directory, ".hatopad-build"), "utf8").catch(() => "")).trim() === marker ||
    (await readFile(path.join(directory, ".complete"), "utf8").catch(() => "")).trim() === marker.split(":")[0];
  return (
    recorded &&
    (
      await Promise.all(
        [
          "packages/core/dist/index.js",
          "packages/desktop/dist-electron/main.js",
          "packages/desktop/dist-renderer/index.html",
        ].map((file) => exists(path.join(directory, file))),
      )
    ).every(Boolean)
  );
}

/** Builds the requested tag in a staging clone, then publishes it as an immutable release. */
async function stage(current, request) {
  const tagsOutput = async () =>
    (
      await git(
        current.directory,
        "tag",
        "--merged",
        `refs/remotes/origin/${request.branch}`,
        "--list",
        "core-protocol-*-v*",
      )
    ).split("\n");
  if ((await git(current.directory, "rev-parse", "HEAD")) !== request.expectedCurrent)
    throw new Error("Installation changed");
  await git(
    current.directory,
    "fetch",
    "--no-tags",
    "origin",
    `+${request.branch}:refs/remotes/origin/${request.branch}`,
    "refs/tags/core-protocol-*:refs/tags/core-protocol-*",
  );
  const tag = compatibleCoreTags(await tagsOutput(), request.compatibility ?? protocolCompatibility)[0];
  if (!tag || (await git(current.directory, "rev-parse", `refs/tags/${tag}^{commit}`)) !== request.expectedLatest)
    throw new Error("Update changed");
  // Immutable releases are replaced, never merged. The compatible tag and branch above authorize the target.
  const toolchain = await runtime(current.directory);
  const npm = await npmCli(toolchain.node);
  const abi = (
    await exec(toolchain.node, ["-p", "process.versions.modules"], { env: { ...env, PATH: toolchain.path } })
  ).stdout.trim();
  const marker = `${request.expectedLatest}:node${abi}:${process.platform}:${process.arch}`;
  const name = `${request.expectedLatest}-node${abi}`;
  const target = path.join(releases, name);
  if (await exists(target)) {
    if (!(await validBuild(target, marker))) throw new Error("Existing release failed validation");
    return { name, directory: target, revision: request.expectedLatest };
  }
  const staging = await mkdtemp(path.join(releases, `.staging-${name}.`));
  try {
    const origin = await git(current.directory, "remote", "get-url", "origin");
    await exec("git", ["clone", "--no-checkout", current.directory, staging], { env, timeout: 300_000 });
    await git(staging, "remote", "set-url", "origin", origin);
    await git(staging, "checkout", "--detach", request.expectedLatest);
    for (const folder of ["bin", "lib"])
      if (
        (await exists(path.join(current.directory, folder))) &&
        (await exists(path.join(current.directory, "bin/node")))
      )
        await cp(path.join(current.directory, folder), path.join(staging, folder), {
          recursive: true,
          verbatimSymlinks: true,
        });
    const staged = await runtime(staging);
    await command(staged.node, [npm, "ci", "--no-audit", "--no-fund"], staging, staged.path);
    if (
      await command(staged.node, ["-e", "require('node-pty')"], staging, staged.path).then(
        () => false,
        () => true,
      )
    )
      await command(staged.node, [npm, "rebuild", "node-pty"], staging, staged.path);
    await command(staged.node, ["-e", "require('node-pty')"], staging, staged.path);
    for (const workspace of ["acp", "protocol", "client", "relay", "connector", "test-fixtures", "core", "desktop"])
      await command(staged.node, [npm, "run", "build", "-w", `@hatopad/${workspace}`], staging, staged.path);
    const range = request.compatibility ?? protocolCompatibility;
    await command(
      staged.node,
      [
        "--input-type=module",
        "-e",
        `const p=await import('./packages/protocol/dist/index.js'); const wire=p.serverProtocolVersion; const range=p.protocolCompatibility; if(wire ? wire<${range.minimum}||wire>${range.maximum} : !range||range.minimum>${range.maximum}||range.maximum<${range.minimum}) throw Error('Incompatible built Core protocol'); await import('./packages/core/dist/server.js');`,
      ],
      staging,
      staged.path,
    );
    await writeFile(path.join(staging, ".hatopad-build"), `${marker}\n`);
    await writeFile(path.join(staging, ".complete"), request.expectedLatest);
    if (!(await validBuild(staging, marker))) throw new Error("Staged release failed validation");
    if ((await git(current.directory, "rev-parse", "HEAD")) !== request.expectedCurrent)
      throw new Error("Installation changed");
    await rename(staging, target);
    return { name, directory: target, revision: request.expectedLatest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Starts one Core. `exited` resolves with its exit code; `ready` resolves true once it reports serving. */
function start(release, revision, failed, onUpdate) {
  const instance = { request: undefined, staged: undefined };
  instance.exited = runtime(release.directory).then(
    (toolchain) =>
      new Promise((resolve) => {
        const child = spawn(
          toolchain.node,
          [path.join(release.directory, "packages/core/dist/index.js"), ...process.argv.slice(2)],
          {
            cwd: release.directory,
            stdio: ["inherit", "inherit", "inherit", "ipc"],
            env: {
              ...env,
              PATH: toolchain.path,
              HATOPAD_CORE_UPDATE_MANAGED: "1",
              HATOPAD_CORE_RELEASE_MODE: "1",
              HATOPAD_CORE_UPDATE_REPOSITORY: release.directory,
              HATOPAD_CORE_RUNNING_COMMIT: revision,
              HATOPAD_CORE_UPDATE_FAILED: failed ? "1" : "0",
            },
          },
        );
        core = child;
        instance.child = child;
        child.on("message", (value) => {
          if (value?.type === "hatopad-core-ready") instance.markReady(true);
          else if (valid(value) && !instance.request) {
            instance.request = value;
            // Core keeps serving while the release is built; it stops only once the build is ready.
            instance.staged = onUpdate(release, value).then(
              (next) => {
                child.send({ type: "hatopad-core-update-go" });
                return next;
              },
              () => {
                instance.request = undefined;
                child.send({ type: "hatopad-core-update-abort" });
                return undefined;
              },
            );
          }
        });
        child.once("error", () => resolve(1));
        child.once("exit", (code) => {
          if (core === child) core = undefined;
          instance.markReady(false);
          resolve(code ?? 1);
        });
      }),
  );
  instance.ready = new Promise((resolve) => {
    instance.markReady = resolve;
  });
  return instance;
}

async function main() {
  const name = path.basename(home);
  const managed =
    root &&
    selection &&
    path.isAbsolute(root) &&
    path.isAbsolute(selection) &&
    releasePattern.test(name) &&
    path.dirname(home) === releases;
  const revision = await git(home, "rev-parse", "HEAD").catch(() => "");
  if (!managed || !sha.test(revision)) {
    // A layout this supervisor cannot update still runs normally, reporting itself as unmanaged.
    const toolchain = await runtime(home);
    core = spawn(toolchain.node, [path.join(home, "packages/core/dist/index.js"), ...process.argv.slice(2)], {
      cwd: home,
      stdio: "inherit",
      env: { ...env, PATH: toolchain.path, HATOPAD_CORE_UPDATE_MANAGED: "0" },
    });
    process.exitCode = await new Promise((resolve) => {
      core.once("exit", (code) => resolve(code ?? 1));
      core.once("error", () => resolve(1));
    });
    return;
  }
  let current = { name, directory: home, revision };
  let instance = start(current, revision, false, stageRequest);
  const crashes = [];
  while (true) {
    const code = await instance.exited;
    const next = instance.request && code === 75 && !stopping ? await instance.staged : undefined;
    if (next) {
      const candidate = await activate(current, next);
      if (candidate) {
        current = next;
        instance = candidate;
      } else {
        console.error("[core] Update failed; restarted the previous Core.");
        instance = start(current, current.revision, true, stageRequest);
      }
      continue;
    }
    // Exit 0 is a deliberate stop. Anything else is a crash: restart with backoff, and give up on a crash loop.
    if (stopping || code === 0 || code === 75) {
      process.exitCode = code;
      return;
    }
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > crashWindowMs) crashes.shift();
    if (crashes.length >= maxCrashes) {
      console.error(
        `[core] Core crashed ${crashes.length} times in ${crashWindowMs / 60_000} minutes; not restarting it again.`,
      );
      process.exitCode = code;
      return;
    }
    const delay = Math.min(30_000, restartDelayMs * 2 ** (crashes.length - 1));
    console.error(`[core] Core exited with ${code}; restarting in ${Math.round(delay / 100) / 10}s.`);
    for (const until = Date.now() + delay; Date.now() < until && !stopping;)
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, until - Date.now())));
    if (stopping) {
      process.exitCode = code;
      return;
    }
    instance = start(current, current.revision, false, stageRequest);
  }
}

async function stageRequest(current, request) {
  const provision = path.join(root, "provision.lock");
  const activation = workspaceId ? path.join(root, `activate-${workspaceId}.lock`) : undefined;
  const held = [];
  try {
    await acquire(provision, {
      file: "owner",
      content: `${process.pid}|${os.hostname()}|${randomBytes(16).toString("hex")}\n`,
    });
    held.push(provision);
    if (activation) {
      await acquire(activation, { file: "pid", content: String(process.pid) });
      held.push(activation);
    }
    return await stage(current, request);
  } catch (error) {
    console.error("[core] Update staging failed; the running Core was kept.");
    throw error;
  } finally {
    for (const lock of held.reverse()) await rm(lock, { recursive: true, force: true });
  }
}

/** Switches the selection and starts `next`; returns its instance only if it reports ready, otherwise restores the selection. */
async function activate(current, next) {
  const previous = await readFile(selection, "utf8").then(
    (value) => value.trim(),
    () => "",
  );
  const restore = async () => {
    if (releasePattern.test(previous)) await atomicWrite(selection, previous);
    else await rm(selection, { force: true });
  };
  try {
    if (releasePattern.test(previous)) await atomicWrite(`${selection}.previous`, previous);
    await atomicWrite(selection, next.name);
  } catch {
    await restore().catch(() => {});
    return undefined;
  }
  const candidate = start(next, next.revision, false, stageRequest);
  const timer = setTimeout(() => candidate.markReady(false), readyTimeoutMs);
  timer.unref();
  const ok = await candidate.ready;
  clearTimeout(timer);
  if (ok && !stopping) return candidate;
  candidate.child?.kill("SIGTERM");
  const killer = setTimeout(() => candidate.child?.kill("SIGKILL"), 15_000);
  await candidate.exited;
  clearTimeout(killer);
  await restore().catch(() => {});
  return undefined;
}

try {
  await main();
} catch {
  console.error("[core] Release launcher failed.");
  process.exitCode = 1;
}
