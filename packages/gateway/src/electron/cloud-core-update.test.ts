import assert from "node:assert/strict";
import test from "node:test";
import type { BundleManifest } from "./bundled-runtime.js";
import { CloudCoreUpdates, type ManagedCloudCore } from "./cloud-core-update.js";

const release = "b".repeat(40) + "-node137-bundle-test";
const bundle: BundleManifest = { schema: 1, channel: "early-access", version: "0.2.0", commit: "b".repeat(40), desktopApp: "desktop", cores: {
  "linux-x64": { target: "linux-x64", commit: "b".repeat(40), release, archive: "core-linux-x64.tar.gz", sha256: "c".repeat(64) }
} };
function fixture(initial: ManagedCloudCore | undefined = { workspaceId: "saved-server", target: "linux-x64", release: "old-release" }) {
  let current = initial;
  const deployed: string[] = [];
  const locks: string[] = [];
  const service = new CloudCoreUpdates({ bundle,
    resolve: async (origin, id) => { assert.equal(origin, "https://hub.example"); assert.equal(id, "core-1"); return current; },
    deploy: async id => { deployed.push(id); current = { workspaceId: id, target: "linux-x64", release }; },
    run: async (id, action) => { locks.push(id); return action(); }
  });
  return { service, deployed, locks };
}
test("deploys the exact bundled release to the matching managed workspace and verifies it", async () => {
  const f = fixture();
  const before = await f.service.info("https://hub.example", "core-1");
  assert.equal(before.bundledVersion, "0.2.0"); assert.equal(before.bundledRelease, release); assert.equal(before.currentRelease, "old-release");
  const after = await f.service.update("https://hub.example", "core-1", release);
  assert.equal(after.updateNeeded, false); assert.equal(after.currentRelease, release);
  assert.deepEqual(f.deployed, ["saved-server"]); assert.deepEqual(f.locks, ["saved-server"]);
});
test("does not restart a Core already using the bundled release", async () => {
  const f = fixture({ workspaceId: "saved-server", target: "linux-x64", release });
  assert.equal((await f.service.info("https://hub.example", "core-1")).updateNeeded, false);
  await f.service.update("https://hub.example", "core-1", release);
  assert.deepEqual(f.deployed, []);
});
test("source Gateways do not claim to have a deployable bundled Core", async () => {
  const service = new CloudCoreUpdates({ resolve: async () => { throw Error("Must not probe servers"); }, deploy: async () => { throw Error("Must not deploy"); }, run: async (_id, action) => action() });
  assert.equal((await service.info("https://hub.example", "core-1")).available, false);
  await assert.rejects(service.update("https://hub.example", "core-1", release), /packaged Gateway/);
});
test("updates require a matching management connection and a bundle for that platform", async () => {
  for (const selected of [undefined, { workspaceId: "saved-server", target: "linux-arm64" }]) {
    let deployed = false;
    const service = new CloudCoreUpdates({ bundle, resolve: async () => selected, deploy: async () => { deployed = true; }, run: async (_id, action) => action() });
    assert.equal((await service.info("https://hub.example", "core-1")).available, false);
    await assert.rejects(service.update("https://hub.example", "core-1", release)); assert.equal(deployed, false);
  }
});
test("a changed pairing or release is rejected before deployment", async () => {
  let selected: ManagedCloudCore = { workspaceId: "original", target: "linux-x64" };
  let deployed = false;
  const service = new CloudCoreUpdates({ bundle, resolve: async () => selected, deploy: async () => { deployed = true; }, run: async (_id, action) => { selected = { ...selected, workspaceId: "different" }; return action(); } });
  await assert.rejects(service.update("https://hub.example", "core-1", release), /pairing changed/); assert.equal(deployed, false);
  const f = fixture(); await assert.rejects(f.service.update("https://hub.example", "core-1", "stale-release"), /bundled release changed/); assert.deepEqual(f.deployed, []);
});
test("failed or unverifiable deployments are not automatically replayed", async () => {
  for (const fail of [true, false]) {
    let attempts = 0;
    const service = new CloudCoreUpdates({ bundle, resolve: async () => ({ workspaceId: "saved-server", target: "linux-x64", release: "old-release" }), deploy: async () => { attempts++; if (fail) throw Error("Activation rolled back"); }, run: async (_id, action) => action() });
    await assert.rejects(service.update("https://hub.example", "core-1", release), fail ? /rolled back/ : /could not be verified/);
    assert.equal(attempts, 1);
  }
});
