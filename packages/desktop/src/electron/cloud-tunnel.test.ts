import assert from "node:assert/strict";
import { test } from "vitest";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { createCloudBridge, type CloudRelayTarget } from "./cloud-tunnel.js";

async function fixture(rejectedType?: string, replyBytes = 0) {
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
      const message = JSON.parse(data.toString());
      requests.push(message);
      if (message.type === rejectedType) {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: false,
            error: { code: "INVALID_REQUEST", message: "This operation is not available through HatoHub" },
          }),
        );
        return;
      }
      const result =
        message.type === "protocol.handshake"
          ? { compatible: true }
          : { roots, selectedRootId: "root-1", ...(replyBytes ? { padding: "x".repeat(replyBytes) } : {}) };
      socket.send(JSON.stringify({ id: message.id, ok: true, result }));
    });
  });
  const target: CloudRelayTarget = { origin, coreId: "core-1", cookie: async () => "hub-session=PRIVATE-SESSION" };
  return {
    target,
    requests,
    upgrades,
    roots,
    async close() {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.on("error", () => undefined);
  await once(socket, "open");
  return socket;
}
async function request(socket: WebSocket, message: unknown) {
  const reply = once(socket, "message");
  socket.send(JSON.stringify(message));
  return JSON.parse((await reply)[0].toString());
}

test("Desktop bridge authenticates locally, removes its token, and reconnects with current cookies", async () => {
  const hub = await fixture();
  let cookie = "hub-session=FIRST";
  const bridge = await createCloudBridge({ ...hub.target, cookie: async () => cookie });
  try {
    const first = await connect(bridge.port);
    const handshake = {
      id: "hello",
      type: "protocol.handshake",
      payload: { compatibility: { minimum: 19, maximum: 19 }, token: bridge.token },
    };
    assert.equal((await request(first, handshake)).result.compatible, true);
    assert.equal(hub.requests[0].payload.token, undefined);
    assert.equal(hub.upgrades[0]?.cookie, "hub-session=FIRST");
    assert.deepEqual(
      (await request(first, { id: "roots", type: "workspace.roots", payload: {} })).result.roots,
      hub.roots,
    );
    first.close();
    await once(first, "close");
    cookie = "hub-session=SECOND";
    const second = await connect(bridge.port);
    assert.equal((await request(second, handshake)).ok, true);
    assert.equal(hub.upgrades[1]?.cookie, "hub-session=SECOND");
    const closed = once(second, "close");
    bridge.close();
    await closed;
  } finally {
    bridge.close();
    await hub.close();
  }
});

test("bridge rejects clients without its token before opening any cloud channel", async () => {
  const hub = await fixture();
  const bridge = await createCloudBridge(hub.target);
  try {
    const local = await connect(bridge.port);
    const closed = once(local, "close");
    local.send(JSON.stringify({ id: "guess", type: "protocol.handshake", payload: { token: "wrong-token" } }));
    await closed;
    assert.equal(hub.upgrades.length, 0);
  } finally {
    bridge.close();
    await hub.close();
  }
});

test("relay failures surface to Desktop and leave no hanging loopback connection", async () => {
  const hub = await fixture();
  await hub.close();
  const bridge = await createCloudBridge(hub.target);
  try {
    const local = await connect(bridge.port);
    const closed = once(local, "close");
    local.send(JSON.stringify({ id: "hello", type: "protocol.handshake", payload: { token: bridge.token } }));
    await closed;
  } finally {
    bridge.close();
  }
});

test("bridge carries project replies larger than the previous 8 MiB bridge limit", async () => {
  const hub = await fixture(undefined, 12 * 1024 * 1024);
  const bridge = await createCloudBridge(hub.target);
  const local = await connect(bridge.port);
  try {
    await request(local, { id: "hello", type: "protocol.handshake", payload: { token: bridge.token } });
    const reply = await request(local, { id: "large", type: "workspace.roots", payload: {} });
    assert.equal(reply.result.padding.length, 12 * 1024 * 1024);
    assert.equal(local.readyState, WebSocket.OPEN);
  } finally {
    local.terminate();
    bridge.close();
    await hub.close();
  }
});
