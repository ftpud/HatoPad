import assert from "node:assert/strict";
import test from "node:test";
import { stopOrphanedLocalCore, type ProcessTools } from "./local-core-process.js";

function tools(listeners: string, commands: Record<string, string>) {
  const killed: number[] = []; let alive = new Set(Object.keys(commands).map(Number));
  const value: ProcessTools = {
    output: async (command, args) => command === "lsof" ? listeners : commands[args[1]!] ?? "",
    kill: (pid) => { killed.push(pid); alive.delete(pid); }, alive: (pid) => alive.has(pid), sleep: async () => undefined
  };
  return { value, killed };
}
const workspace = "/Users/me/Trip Timeline/Trip Timeline";
const core = `/node /Users/me/Library/Application Support/G/core-releases/${"a".repeat(40)}-node137/packages/core/dist/index.js --hub-connect --host 127.0.0.1 --port 7325 --workspace ${workspace}`;

test("stops this workspace's orphaned Core, whether bare or supervised", async () => {
  for (const command of [core, core.replace("packages/core/dist/index.js", "scripts/core-release-service.mjs")]) {
    const fixture = tools("4242\n", { "4242": command });
    assert.equal(await stopOrphanedLocalCore(7325, workspace, fixture.value, 1000), true);
    assert.deepEqual(fixture.killed, [4242]);
  }
});
test("does nothing when the port is free", async () => {
  const fixture = tools("", {});
  assert.equal(await stopOrphanedLocalCore(7325, workspace, fixture.value), false); assert.deepEqual(fixture.killed, []);
});
test("never kills a foreign process, another workspace's Core, or a different port", async () => {
  for (const command of ["/usr/bin/python server.py --port 7325", core.replace(workspace, "/other"), core.replace("--port 7325", "--port 7326")]) {
    const fixture = tools("77\n", { "77": command });
    await assert.rejects(stopOrphanedLocalCore(7325, workspace, fixture.value), /in use by another process/);
    assert.deepEqual(fixture.killed, []);
  }
});
test("reports a Core that will not stop and rejects invalid ports", async () => {
  const stubborn: ProcessTools = { output: async (command) => command === "lsof" ? "9" : core, kill: () => undefined, alive: () => true, sleep: async () => undefined };
  await assert.rejects(stopOrphanedLocalCore(7325, workspace, stubborn, 5), /still stopping/);
  await assert.rejects(stopOrphanedLocalCore(0, workspace, stubborn), /Invalid/);
});
