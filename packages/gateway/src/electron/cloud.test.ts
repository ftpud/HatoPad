import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { CloudClient, cloudOrigin, cloudPairingScript, createCloudSettingsStore } from "./cloud.js";

test("cloud origins require HTTPS except on loopback and reject credentials and paths", () => {
  assert.equal(cloudOrigin("https://hub.example/"), "https://hub.example");
  assert.equal(cloudOrigin("http://localhost:8080"), "http://localhost:8080");
  for (const value of ["http://hub.example", "https://u:p@hub.example", "https://hub.example/api", "https://hub.example/?token=x", "file:///tmp"]) assert.throws(() => cloudOrigin(value));
});
test("loads every cloud server page and sends session CSRF and origin when claiming", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const request: typeof fetch = async (input, options) => {
    const url = String(input); calls.push({ url, options });
    const payload = url.endsWith("/api/session") ? { user: { id: "u", name: "User", email: "u@example.com" }, csrfToken: "csrf-secret" }
      : url.includes("cursor=") ? { cores: [{ id: "b", name: "B" }], nextCursor: null }
      : url.endsWith("/api/cores") ? { cores: [{ id: "a", name: "A" }], nextCursor: "a" } : { pairingId: "p" };
    return new Response(JSON.stringify(payload));
  };
  const client = new CloudClient("https://hub.example", request);
  assert.deepEqual((await client.account()).cores.map(core => core.id), ["a", "b"]);
  await client.call("/api/pairings/claim", { code: "ABCD-EFGH" });
  const claim = calls.at(-1)!;
  assert.equal(claim.options?.method, "POST");
  assert.equal(claim.options?.redirect, "error");
  assert.deepEqual(claim.options?.headers, { "content-type": "application/json", origin: "https://hub.example", "x-csrf-token": "csrf-secret" });
  assert.equal(claim.options?.body, JSON.stringify({ code: "ABCD-EFGH" }));
});
test("expired cloud sessions fail explicitly", async () => {
  const client = new CloudClient("https://hub.example", async () => new Response("", { status: 401 }));
  await assert.rejects(client.account(), /Sign in/);
});
test("pairing confirms only the selected account and keeps credentials on the Core host", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gateway-cloud-"));
  try {
    const moduleDirectory = path.join(directory, "node_modules/@hatopad/connector");
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(path.join(moduleDirectory, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
    await writeFile(path.join(moduleDirectory, "index.js"), `
      import {writeFile} from 'node:fs/promises';
      export class PairingStore { constructor(file){this.file=file} async load(){return undefined} }
      export async function pairDevice(options){
        options.showCode('ABCD-EFGH');
        if(!await options.confirmLocally({email:process.env.CLAIMANT_EMAIL}))return {status:'failed',reason:'declined locally'};
        await writeFile(options.store.file,'PRIVATE-CREDENTIAL');return {status:'paired'};
      }`);
    const file = path.join(directory, "pairing.json");
    const script = cloudPairingScript("https://hub.example", "owner@example.com", "My server");
    const options = { cwd: directory, env: { ...process.env, HATOPAD_HUB_PAIRING_FILE: file, CLAIMANT_EMAIL: "owner@example.com" } };
    const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], options);
    assert.equal(result.stdout.trim(), "HATOPAD_PAIR_CODE:ABCD-EFGH");
    assert.equal(await readFile(file, "utf8"), "PRIVATE-CREDENTIAL");
    await rm(file);
    await assert.rejects(promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { ...options, env: { ...options.env, CLAIMANT_EMAIL: "other@example.com" } }), /declined locally/);
    await assert.rejects(readFile(file));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cloud domain settings survive a new store instance without an account session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gateway-cloud-settings-"));
  try {
    const file = path.join(directory, "cloud.json");
    const store = createCloudSettingsStore(file);
    await store.update(settings => { settings.origin = cloudOrigin("https://custom.example/"); });
    assert.deepEqual(await createCloudSettingsStore(file).read(), { origin: "https://custom.example" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
