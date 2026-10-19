import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

export type CloudRelayTarget = { origin: string; coreId: string; cookie(): Promise<string> };
const maxFrameBytes = 64 * 1024 * 1024;
const maxBufferedBytes = 128 * 1024 * 1024;

export async function openCloudRelay(target: CloudRelayTarget): Promise<WebSocket> {
  const url = new URL("/relay/browser", target.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("coreId", target.coreId);
  const cookie = await target.cookie();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: target.origin, headers: { cookie }, handshakeTimeout: 15_000, maxPayload: maxFrameBytes });
    socket.on("error", () => undefined);
    const fail = () => { socket.terminate(); reject(new Error("Could not connect to cloud Core. Refresh cloud status and check your sign-in.")); };
    socket.once("error", fail);
    socket.once("close", fail);
    socket.once("open", () => { socket.off("error", fail); socket.off("close", fail); resolve(socket); });
  });
}

/** Authenticated loopback bridge for Desktop. Cloud cookies stay in Desktop's main process. */
export async function createCloudBridge(target: CloudRelayTarget): Promise<{ port: number; token: string; close(): void }> {
  const token = randomBytes(32).toString("hex");
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const wss = new WebSocketServer({ server, maxPayload: maxFrameBytes, perMessageDeflate: false });
  const sockets = new Set<WebSocket>();
  let stopped = false;
  wss.on("connection", (local) => {
    sockets.add(local);
    let remote: WebSocket | undefined;
    let authenticated = false;
    let queue: string[] = [];
    let queuedBytes = 0;
    const close = () => { clearTimeout(timeout); sockets.delete(local); local.terminate(); if (remote) { sockets.delete(remote); remote.terminate(); } };
    const timeout = setTimeout(close, 15_000);
    local.on("close", close); local.on("error", close);
    const forward = (destination: WebSocket, text: string) => {
      if (destination.readyState !== WebSocket.OPEN || destination.bufferedAmount + Buffer.byteLength(text) > maxBufferedBytes) { close(); return; }
      destination.send(text, { binary: false }, (error) => { if (error) close(); });
    };
    local.on("message", (data, binary) => {
      if (binary) { close(); return; }
      let text = data.toString();
      if (!authenticated) {
        try {
          const message = JSON.parse(text);
          const supplied = message.payload?.token;
          if (message.type !== "protocol.handshake" || typeof supplied !== "string" || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { close(); return; }
          authenticated = true;
          delete message.payload.token;
          text = JSON.stringify(message);
        } catch { close(); return; }
        void openCloudRelay(target).then((socket) => {
          if (stopped || local.readyState !== WebSocket.OPEN) { socket.terminate(); return; }
          clearTimeout(timeout); remote = socket; sockets.add(remote);
          remote.on("close", close); remote.on("error", close);
          remote.on("message", (data, binary) => { if (binary) close(); else forward(local, data.toString()); });
          for (const message of queue) forward(remote, message);
          queue = []; queuedBytes = 0;
        }).catch(close);
      }
      if (remote) forward(remote, text);
      else {
        queuedBytes += Buffer.byteLength(text);
        if (queuedBytes > maxBufferedBytes || queue.length >= 128) { close(); return; }
        queue.push(text);
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind cloud Desktop bridge.");
  return { port: address.port, token, close() { stopped = true; for (const socket of sockets) socket.terminate(); sockets.clear(); wss.close(); server.close(); } };
}
