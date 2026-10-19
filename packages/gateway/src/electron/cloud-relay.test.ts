import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { listCloudRoots, type CloudRelayTarget } from "./cloud-relay.js";

async function fixture(rejectedType?: string) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid test address");
  const origin = `http://127.0.0.1:${address.port}`;
  const requests: any[] = [];
  const upgrades: { url?: string; origin?: string; cookie?: string }[] = [];
  const roots = [{ id: "root-1", alias: "Project", path: "/srv/project", primary: true }];
  server.on("connection", (socket, request) => {
    upgrades.push({ url: request.url, origin: request.headers.origin, cookie: request.headers.cookie });
    socket.on("error", () => undefined);
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()); requests.push(message);
      if (message.type === rejectedType) {
        socket.send(JSON.stringify({ id: message.id, ok: false, error: { code: "INVALID_REQUEST", message: "This operation is not available through HatoHub" } }));
        return;
      }
      const result = message.type === "protocol.handshake" ? { compatible: true } : { roots, selectedRootId: "root-1" };
      socket.send(JSON.stringify({ id: message.id, ok: true, result }));
    });
  });
  const target: CloudRelayTarget = { origin, coreId: "core-1", cookie: async () => "hub-session=PRIVATE-SESSION" };
  return { target, requests, upgrades, roots, async close() { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test("discovers cloud roots through a compatible authenticated relay connection", async () => {
  const hub = await fixture();
  try {
    assert.deepEqual(await listCloudRoots(hub.target, { minimum: 19, maximum: 19 }), hub.roots);
    assert.deepEqual(hub.requests.map(request => request.type), ["protocol.handshake", "workspace.roots"]);
    assert.deepEqual(hub.requests[0].payload.compatibility, { minimum: 19, maximum: 19 });
    assert.equal(hub.upgrades[0]?.origin, hub.target.origin);
    assert.equal(hub.upgrades[0]?.cookie, "hub-session=PRIVATE-SESSION");
    assert.equal(hub.upgrades[0]?.url, "/relay/browser?coreId=core-1");
  } finally { await hub.close(); }
});

test("Core discovery names the exact operation rejected by HatoHub", async () => {
  const hub = await fixture("workspace.roots");
  try {
    await assert.rejects(listCloudRoots(hub.target, { minimum: 19, maximum: 19 }), { message: "INVALID_REQUEST: This operation is not available through HatoHub [workspace.roots]" });
  } finally { await hub.close(); }
});
