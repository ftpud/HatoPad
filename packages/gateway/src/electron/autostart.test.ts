import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  autostartExplanation,
  autostartInstallCommand,
  autostartRemoveCommand,
  autostartScript,
  autostartStatusCommand,
  parseAutostart,
} from "./autostart.js";

const exec = promisify(execFile);
const release = `${"a".repeat(40)}-node137`;
const token = "t".repeat(40);
async function fakeHost() {
  const home = await mkdtemp(path.join(os.tmpdir(), "hatopad-autostart-"));
  const bin = path.join(home, "stubs");
  await mkdir(bin);
  const stub = (name: string, body: string) =>
    writeFile(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  await stub(
    "systemctl",
    `echo "$@" >> "$HOME/systemctl.log"; if [ "$1 $2" = "--user show-environment" ] && [ -n "\${FAIL_SYSTEMD:-}" ]; then exit 1; fi; if [ "$2" = "is-enabled" ]; then [ -f "$HOME/enabled" ]; exit $?; fi; if [ "$2" = "enable" ]; then touch "$HOME/enabled"; fi; if [ "$2" = "disable" ]; then rm -f "$HOME/enabled"; fi; exit 0`,
  );
  await stub("loginctl", `[ -z "\${NO_LINGER:-}" ]`);
  await stub("crontab", `if [ "$1" = "-l" ]; then cat "$HOME/crontab" 2>/dev/null; else cat > "$HOME/crontab"; fi`);
  return {
    home,
    bin,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      XDG_RUNTIME_DIR: "/tmp",
    } as NodeJS.ProcessEnv,
  };
}

test("boot script starts the currently selected supervised release and records the PID", async () => {
  const host = await fakeHost();
  try {
    const releaseDirectory = path.join(host.home, ".hatopad-deploy/releases", release);
    await mkdir(path.join(releaseDirectory, "scripts"), { recursive: true });
    await writeFile(path.join(releaseDirectory, "scripts/core-release-service.mjs"), "");
    await writeFile(path.join(host.home, ".hatopad-server-ws1.release"), release);
    await writeFile(path.join(host.home, ".hatopad-server-ws1.token"), token);
    await mkdir(path.join(host.home, ".hatopad/cloud-pairings"), { recursive: true });
    await writeFile(path.join(host.home, ".hatopad/cloud-pairings/ws1.json"), "{}");
    await writeFile(
      path.join(host.bin, "node"),
      `#!/bin/bash\nprintf '%s\\n' "$PWD|$*|$HATOPAD_SESSION_TOKEN|$HATOPAD_CORE_RELEASE_ROOT|$HATOPAD_CORE_RELEASE_SELECTION" > "$HOME/started"`,
      { mode: 0o755 },
    );
    const script = path.join(host.home, "boot.sh");
    await writeFile(
      script,
      autostartScript({ kind: "ssh", workspaceId: "ws1", workspace: "/work/it's here", port: 7400 }),
    );
    await chmod(script, 0o700);
    await exec("bash", [script], { env: host.env });
    const started = (await readFile(path.join(host.home, "started"), "utf8")).trim();
    assert.equal(
      started,
      `${releaseDirectory}|scripts/core-release-service.mjs --hub-connect --host 127.0.0.1 --port 7400 --gateway-workspace-id ws1 --workspace /work/it's here|${token}|${host.home}/.hatopad-deploy|${host.home}/.hatopad-server-ws1.release`,
    );
    assert.match(await readFile(path.join(host.home, ".hatopad-server-ws1.pid"), "utf8"), /^\d+\n?$/);
    // A release that cannot self-update, or a missing selection, must not be started silently.
    await rm(path.join(releaseDirectory, "scripts/core-release-service.mjs"));
    await assert.rejects(exec("bash", [script], { env: host.env }), /not supervised/);
    await writeFile(path.join(host.home, ".hatopad-server-ws1.release"), "not-a-release");
    await assert.rejects(exec("bash", [script], { env: host.env }), /No selected Core release/);
  } finally {
    await rm(host.home, { recursive: true, force: true });
  }
});

test("local boot script uses Gateway's cache, token file and recorded Node", async () => {
  const host = await fakeHost();
  try {
    const userData = path.join(host.home, "Library/Application Support/Vibe Gateway");
    const releases = path.join(userData, "core-releases", release);
    await mkdir(path.join(releases, "scripts"), { recursive: true });
    await writeFile(path.join(releases, "scripts/core-release-service.mjs"), "");
    await writeFile(path.join(userData, "core-releases", "selected-ws2"), release);
    await writeFile(
      path.join(host.bin, "recorded-node"),
      `#!/bin/bash\nprintf '%s\\n' "$*|$HATOPAD_SESSION_TOKEN_FILE|$HATOPAD_CORE_RELEASES_DIR" > "$HOME/started"`,
      { mode: 0o755 },
    );
    const script = path.join(host.home, "boot.sh");
    await writeFile(
      script,
      autostartScript({
        kind: "local",
        workspaceId: "ws2",
        workspace: "/Users/me/Trip Timeline",
        port: 7325,
        userData,
        node: path.join(host.bin, "recorded-node"),
      }),
    );
    await exec("bash", [script], { env: { ...host.env, PATH: "/usr/bin:/bin" } });
    assert.equal(
      (await readFile(path.join(host.home, "started"), "utf8")).trim(),
      `scripts/core-release-service.mjs --host 127.0.0.1 --port 7325 --workspace /Users/me/Trip Timeline|${userData}/core-tokens/ws2.token|${userData}/core-releases`,
    );
  } finally {
    await rm(host.home, { recursive: true, force: true });
  }
});

test("install, status and remove through systemd, with cron as the fallback", async () => {
  if (process.platform !== "linux") return;
  const host = await fakeHost();
  const target = { kind: "ssh" as const, workspaceId: "ws1", workspace: "/work", port: 7400 };
  const run = async (command: string, extra: NodeJS.ProcessEnv = {}) =>
    (await exec("bash", ["-c", command], { env: { ...host.env, ...extra } })).stdout;
  try {
    await assert.rejects(run(autostartInstallCommand(target)), /managed release/);
    const releaseDirectory = path.join(host.home, ".hatopad-deploy/releases", release);
    await mkdir(path.join(releaseDirectory, "scripts"), { recursive: true });
    await writeFile(path.join(releaseDirectory, "scripts/core-release-service.mjs"), "");
    await writeFile(path.join(host.home, ".hatopad-server-ws1.release"), release);
    await writeFile(path.join(host.home, ".hatopad-server-ws1.token"), token);
    await assert.rejects(access(path.join(host.home, ".hatopad-deploy/autostart-ws1.sh")));
    assert.deepEqual(parseAutostart(await run(autostartStatusCommand("ws1"))), { state: "off" });
    assert.deepEqual(parseAutostart(await run(autostartInstallCommand(target))), { state: "on", mode: "systemd-boot" });
    const unit = await readFile(path.join(host.home, ".config/systemd/user/hatopad-core-ws1.service"), "utf8");
    assert.match(unit, /ExecStart=\/bin\/bash %h\/\.hatopad-deploy\/autostart-ws1\.sh/);
    assert.match(unit, /WantedBy=default\.target/);
    assert.match(
      await readFile(path.join(host.home, ".hatopad-deploy/autostart-ws1.sh"), "utf8"),
      /core-release-service\.mjs/,
    );
    assert.match(
      await readFile(path.join(host.home, "systemctl.log"), "utf8"),
      /--user enable hatopad-core-ws1\.service/,
    );
    assert.equal(parseAutostart(await run(autostartStatusCommand("ws1"))).state, "on");
    assert.deepEqual(parseAutostart(await run(autostartRemoveCommand("ws1"))), { state: "off" });
    await assert.rejects(access(path.join(host.home, ".config/systemd/user/hatopad-core-ws1.service")));
    await assert.rejects(access(path.join(host.home, ".hatopad-deploy/autostart-ws1.sh")));
    assert.equal(parseAutostart(await run(autostartStatusCommand("ws1"))).state, "off");
    // No lingering: login-only, and the answer must say so.
    assert.equal(parseAutostart(await run(autostartInstallCommand(target), { NO_LINGER: "1" })).mode, "systemd-login");
    await run(autostartRemoveCommand("ws1"));
    // No usable systemd user session: fall back to cron @reboot.
    assert.deepEqual(parseAutostart(await run(autostartInstallCommand(target), { FAIL_SYSTEMD: "1" })), {
      state: "on",
      mode: "cron-boot",
    });
    assert.match(
      await readFile(path.join(host.home, "crontab"), "utf8"),
      /^@reboot \/bin\/bash .*autostart-ws1\.sh # hatopad-autostart-ws1$/m,
    );
    assert.equal(parseAutostart(await run(autostartStatusCommand("ws1"), { FAIL_SYSTEMD: "1" })).state, "on");
    await run(autostartRemoveCommand("ws1"), { FAIL_SYSTEMD: "1" });
    assert.equal((await readFile(path.join(host.home, "crontab"), "utf8")).trim(), "");
  } finally {
    await rm(host.home, { recursive: true, force: true });
  }
});

test("autostart input is validated and explanations do not overstate", () => {
  assert.throws(() => autostartScript({ kind: "ssh", workspaceId: "../x", workspace: "/w", port: 1 }));
  assert.throws(() => autostartScript({ kind: "ssh", workspaceId: "ws", workspace: "/w", port: 70000 }));
  assert.throws(() => autostartRemoveCommand("a b"));
  assert.throws(() =>
    autostartScript({
      kind: "local",
      workspaceId: "ws",
      workspace: "/w",
      port: 7000,
      userData: "relative",
      node: "/n",
    }),
  );
  assert.throws(() => parseAutostart("nothing"));
  assert.match(autostartExplanation("systemd-login"), /loginctl enable-linger/);
  assert.match(autostartExplanation("launchd-login"), /logs in/);
});
