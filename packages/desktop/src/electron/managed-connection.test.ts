import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer, connect } from "node:net";
import ssh2 from "ssh2";
import { WebSocket, WebSocketServer } from "ws";
import { test } from "vitest";
import { startManagedConnection } from "./managed-connection.js";

async function handoff(directory: string, value: Record<string, unknown>) {
  const file = path.join(directory, `connection-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ schema: 1, expiresAt: Date.now() + 120_000, ...value }), { mode: 0o600 }); return file;
}
test("Desktop maintains its cloud transport after the launch handoff is gone", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-owned-cloud-"));
  const hub = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(hub, "listening");
  const address = hub.address(); assert.ok(address && typeof address !== "string");
  let requests = 0;
  hub.on("connection", (socket, request) => {
    assert.equal(request.headers.cookie, "hub-session=PRIVATE"); socket.on("error", () => undefined);
    socket.on("message", data => { const message = JSON.parse(data.toString()); assert.equal(message.payload.token, undefined); requests++; socket.send(JSON.stringify({ id: message.id, ok: true, result: { compatible: true } })); });
  });
  let managed: Awaited<ReturnType<typeof startManagedConnection>> | undefined;
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const file = await handoff(directory, { kind: "cloud", origin, coreId: "core-1", cookie: "hub-session=PRIVATE", rootId: "selected-root" });
    managed = await startManagedConnection(file); await assert.rejects(access(file));
    assert.equal(managed.cloudOrigin, origin); assert.equal(managed.rootId, "selected-root");
    const local = new WebSocket(`ws://${managed.host}:${managed.port}`); await once(local, "open");
    const reply = once(local, "message"); local.send(JSON.stringify({ id: "hello", type: "protocol.handshake", payload: { token: managed.token } }));
    assert.equal(JSON.parse((await reply)[0].toString()).ok, true); assert.equal(requests, 1);
    local.close(); await once(local, "close");
  } finally { managed?.stop(); for (const socket of hub.clients) socket.terminate(); await new Promise<void>(resolve => hub.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
test("Desktop owns a pinned SSH tunnel and forwards data without Gateway", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-owned-ssh-"));
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
  const parsed = ssh2.utils.parseKey(key); assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed));
  const fingerprint = `SHA256:${createHash("sha256").update(parsed.getPublicSSH()).digest("hex")}`;
  const echo = createServer(socket => socket.pipe(socket)); echo.listen(0, "127.0.0.1"); await once(echo, "listening");
  const echoAddress = echo.address(); assert.ok(echoAddress && typeof echoAddress !== "string");
  const server = new ssh2.Server({ hostKeys: [key] }, client => {
    client.on("error", () => undefined);
    client.on("authentication", context => { if (context.method === "password" && context.username === "user" && context.password === "private-password") context.accept(); else context.reject(); });
    client.on("tcpip", (accept, reject, info) => {
      const target = connect(info.destPort, info.destIP); target.on("error", () => reject());
      target.once("connect", () => { const channel = accept(); if (channel) { channel.on("error", () => target.destroy()); channel.once("close", () => target.destroy()); target.pipe(channel).pipe(target); } });
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let managed: Awaited<ReturnType<typeof startManagedConnection>> | undefined;
  try {
    const connection = { kind: "ssh", host: "127.0.0.1", port: address.port, username: "user", remotePort: echoAddress.port, hostKeyFingerprint: fingerprint, authenticationMethod: "password", password: "private-password", sessionToken: "a".repeat(64) };
    const file = await handoff(directory, connection); managed = await startManagedConnection(file); await assert.rejects(access(file));
    assert.equal(managed.token, "a".repeat(64));
    const local = connect(Number(managed.port), managed.host); await once(local, "connect");
    const received = once(local, "data"); local.write("desktop remains connected");
    assert.equal((await received)[0].toString(), "desktop remains connected"); local.destroy();
    managed.stop(); managed = undefined;
    await assert.rejects(startManagedConnection(await handoff(directory, { ...connection, hostKeyFingerprint: "SHA256:" + "0".repeat(64) })), /host|verification/i);
  } finally { managed?.stop(); await new Promise<void>(resolve => server.close(() => resolve())); await new Promise<void>(resolve => echo.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}, 15_000);
