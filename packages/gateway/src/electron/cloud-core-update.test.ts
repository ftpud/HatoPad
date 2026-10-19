import assert from "node:assert/strict";
import test from "node:test";
import type { BundleManifest } from "./bundled-runtime.js";
import { CloudCoreUpdates, CoreUpdateCheckError, coreUpdateCheckReason, type ManagedCloudCore } from "./cloud-core-update.js";

const release = "b".repeat(40) + "-node137-bundle-test";
const bundle: BundleManifest = { schema: 1, channel: "early-access", version: "0.2.0", commit: "b".repeat(40), desktopApp: "desktop", cores: {
  "linux-x64": { target: "linux-x64", protocol: 19, commit: "b".repeat(40), release, archive: "core-linux-x64.tar.gz", sha256: "c".repeat(64) }
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
  await assert.rejects(service.update("https://hub.example", "core-1", release), /compatible Core release/);
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

test('unknown and incompatible bundles are never proposed', async () => {
  for (const protocol of [undefined, 20, 18]) {
    const incompatible = structuredClone(bundle); incompatible.cores['linux-x64']!.protocol = protocol;
    const service = new CloudCoreUpdates({bundle:incompatible,resolve:async()=>({workspaceId:'ssh',target:'linux-x64'}),deploy:async()=>{throw Error('must not deploy');},run:async(_id,action)=>action()});
    assert.equal((await service.info('origin','core')).available,false);
    await assert.rejects(service.update('origin','core',release),/protocol/);
  }
});
test('downloads the latest compatible Git release once and refuses a changed selection', async () => {
  let commit='d'.repeat(40), current='old', calls=0;
  const service = new CloudCoreUpdates({bundle,resolve:async()=>({workspaceId:'ssh',target:'linux-x64',release:current}),deploy:async()=>{throw Error('must not use bundle');},run:async(_id,action)=>action(),git:{check:async()=>({commit,tag:'core-protocol-19-v0.1.42',branch:'main'}),deploy:async(_id,expected)=>{calls++;current=`${expected}-node137`;}}});
  assert.equal((await service.info('origin','core')).source,'git');
  await assert.rejects(service.update('origin','core','stale'),/release changed/); assert.equal(calls,0);
  assert.equal((await service.update('origin','core',commit)).updateNeeded,false); assert.equal(calls,1);
  await service.update('origin','core',commit); assert.equal(calls,1);
});

test('a failed Git check still offers a compatible bundle and deploys it only once',async()=>{
  let current='old-release',calls=0;
  const service=new CloudCoreUpdates({bundle,resolve:async()=>({workspaceId:'ssh',target:'linux-x64',release:current}),git:{check:async()=>{throw Error('Node.js and npm were not found on the SSH host');},deploy:async()=>{throw Error('must not deploy Git');}},deploy:async()=>{calls++;current=release;},run:async(_id,action)=>action()});
  const info=await service.info('origin','core');assert.equal(info.available,true);assert.equal(info.source,'bundle');assert.match(info.reason!,/compatible bundled Core/);
  await service.update('origin','core',release);assert.equal(calls,1);
});
test('Git lookup failures return a useful result instead of rejecting the update-info IPC',async()=>{
  const unknown=structuredClone(bundle);unknown.cores['linux-x64']!.protocol=undefined;
  const service=new CloudCoreUpdates({bundle:unknown,resolve:async()=>({workspaceId:'ssh',target:'linux-x64'}),git:{check:async()=>{throw Error('SSH command failed at 23:24; password=PRIVATE');},deploy:async()=>{throw Error('must not deploy');}},deploy:async()=>{throw Error('must not deploy');},run:async(_id,action)=>action()});
  const info=await service.info('origin','core');assert.equal(info.available,false);assert.match(info.reason!,/Git release check failed/);assert.equal(info.reason!.includes('PRIVATE'),false);
});
test('source Gateways explain missing management connections without requiring a bundle',async()=>{
  const service=new CloudCoreUpdates({resolve:async()=>undefined,git:{check:async()=>undefined,deploy:async()=>{}},deploy:async()=>{},run:async(_id,action)=>action()});
  assert.match((await service.info('origin','core')).reason!,/matching saved local\/SSH workspace/);
});
test('a failed Git deployment is never retried through the bundle fallback',async()=>{
  let gitCalls=0,bundleCalls=0;const commit='d'.repeat(40);
  const service=new CloudCoreUpdates({bundle,resolve:async()=>({workspaceId:'ssh',target:'linux-x64',release:'old'}),git:{check:async()=>({commit,tag:'core-protocol-19-v0.1.42',branch:'dev'}),deploy:async()=>{gitCalls++;throw Error('SSH channel interrupted');}},deploy:async()=>{bundleCalls++;},run:async(_id,action)=>action()});
  await assert.rejects(service.update('origin','core',commit),/SSH channel interrupted/);assert.equal(gitCalls,1);assert.equal(bundleCalls,0);
});


test('Git failures in a source Gateway never request a packaged bundle or leak SSH output', async () => {
  const service = new CloudCoreUpdates({resolve:async()=>({workspaceId:'ssh',target:'linux-x64'}),git:{check:async()=>{throw Error('PRIVATE');},deploy:async()=>{}},deploy:async()=>{},run:async(_id,action)=>action()});
  const info = await service.info('origin','core');
  assert.equal(info.available,false); assert.doesNotMatch(info.reason!,/packaged|bundled|PRIVATE/);
  assert.match(info.reason!,/GitHub/);
});
test('an unreadable SSH host is not reported as a missing pairing or an IPC stack',async()=>{
  const service=new CloudCoreUpdates({resolve:async()=>{throw new CoreUpdateCheckError('Could not inspect a saved SSH host.');},git:{check:async()=>undefined,deploy:async()=>{}},deploy:async()=>{},run:async(_id,action)=>action()});
  assert.equal((await service.info('origin','core')).reason,'Could not inspect a saved SSH host.');
});
test('Hub requirements control bundle fallback and are refreshed before any deployment', async()=>{
  let minimum=20, calls=0;
  const service=new CloudCoreUpdates({bundle,compatibility:async()=>({minimum,maximum:minimum}),resolve:async()=>({workspaceId:'ssh',target:'linux-x64'}),deploy:async()=>{calls++;},run:async(_id,action)=>action()});
  assert.equal((await service.info('origin','core')).available,false);
  minimum=19;assert.equal((await service.info('origin','core')).available,true);
  minimum=20;await assert.rejects(service.update('origin','core',release),/protocol/);assert.equal(calls,0);
});
test('missing Hub protocol requirements do not silently select a Git release or bundle',async()=>{
  let calls=0;
  const service=new CloudCoreUpdates({bundle,compatibility:async()=>{throw Error('PRIVATE');},resolve:async()=>({workspaceId:'ssh',target:'linux-x64'}),git:{check:async()=>{calls++;return undefined;},deploy:async()=>{}},deploy:async()=>{},run:async(_id,action)=>action()});
  const info=await service.info('origin','core');assert.equal(info.available,false);assert.match(info.reason!,/Hub protocol requirements/);assert.equal(calls,0);
});


test('a missing compatible tag is distinguished from failed GitHub access',()=>{
  assert.match(coreUpdateCheckReason(Error('No protocol-compatible tagged Core is available on the selected branch.'),'main'),/No compatible Core release tag is available on main/);
});
test('a mismatched Git protocol tag cannot become a deployable update',async()=>{
  for(const tag of ['core-protocol-20-v99.0.0','untrusted']) {
    let calls=0;
    const service=new CloudCoreUpdates({compatibility:async()=>({minimum:19,maximum:19}),resolve:async()=>({workspaceId:'ssh',target:'linux-x64'}),git:{check:async()=>({commit:'a'.repeat(40),tag,branch:'dev'}),deploy:async()=>{calls++;}},deploy:async()=>{},run:async(_id,action)=>action()});
    assert.equal((await service.info('origin','core')).available,false);
    await assert.rejects(service.update('origin','core','a'.repeat(40)),/Hub protocol requirements/);assert.equal(calls,0);
  }
});
test('a stopped local Core retains its saved immutable Git selection',async()=>{
  const commit='a'.repeat(40);
  const service=new CloudCoreUpdates({resolve:async()=>({workspaceId:'local',target:'darwin-arm64',release:commit}),git:{check:async()=>({commit,tag:'core-protocol-19-v0.1.42',branch:'dev'}),deploy:async()=>{throw Error('must not deploy');}},deploy:async()=>{},run:async(_id,action)=>action()});
  assert.equal((await service.info('origin','core')).updateNeeded,false);
  assert.equal((await service.update('origin','core',commit)).currentRelease,commit);
});
function hubFixture(hub: "started" | "unavailable" | Error, switchTo?: string) {
  const commit = "d".repeat(40); let current: ManagedCloudCore = { workspaceId: "saved-server", target: "linux-x64", release: `${"a".repeat(40)}-node137` };
  const calls: string[] = [];
  const service = new CloudCoreUpdates({
    resolve: async () => current, deploy: async () => { throw Error("Must not use the bundle"); },
    git: { check: async () => ({ commit, tag: "core-protocol-19-v0.1.2", branch: "dev" }), deploy: async () => { calls.push("ssh"); current = { ...current, release: `${commit}-node137` }; } },
    hub: async (_origin, _core, branch, requested) => { calls.push(`hub:${branch}:${requested === commit}`); if (hub instanceof Error) throw hub; if (hub === "started" && switchTo) current = { ...current, release: switchTo.replace("COMMIT", commit) }; return hub; },
    poll: { intervalMs: 1, timeoutMs: 50 },
    run: async (_id, action) => action()
  });
  return { service, calls, commit };
}
test("Hub-directed updates let the Core switch itself and are confirmed from the selected release", async () => {
  const f = hubFixture("started", "COMMIT-node137");
  const after = await f.service.update("https://hub.example", "core-1", f.commit);
  assert.deepEqual(f.calls, ["hub:dev:true"]); assert.equal(after.updateNeeded, false);
});
test("unmanaged Cores fall back to SSH deployment, which starts the supervised launcher", async () => {
  const f = hubFixture("unavailable");
  await f.service.update("https://hub.example", "core-1", f.commit);
  assert.deepEqual(f.calls, ["hub:dev:true", "ssh"]);
});
test("an uncertain Hub update is never replayed over SSH and an unconfirmed switch is reported", async () => {
  const uncertain = hubFixture(new Error("uncertain"));
  await assert.rejects(uncertain.service.update("https://hub.example", "core-1", uncertain.commit), /uncertain/);
  assert.deepEqual(uncertain.calls, ["hub:dev:true"]);
  const stalled = hubFixture("started");
  await assert.rejects(stalled.service.update("https://hub.example", "core-1", stalled.commit), /not confirmed/);
  assert.deepEqual(stalled.calls, ["hub:dev:true"]);
});
