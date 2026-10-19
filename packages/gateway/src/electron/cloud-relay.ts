import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Compatibility } from "./client-compatibility.js";

export type CloudRoot = { id: string; alias: string; path: string; primary: boolean };
export type CloudRelayTarget = { origin: string; coreId: string; cookie(): Promise<string> };
const maxBufferedBytes = 8 * 1024 * 1024;

export async function openCloudRelay(target: CloudRelayTarget): Promise<WebSocket> {
  const url = new URL("/relay/browser", target.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("coreId", target.coreId);
  const cookie = await target.cookie();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: target.origin, headers: { cookie }, handshakeTimeout: 15_000, maxPayload: maxBufferedBytes });
    socket.on("error", () => undefined);
    const fail = () => { socket.terminate(); reject(new Error("Could not connect to cloud Core. Refresh cloud status and check your sign-in.")); };
    socket.once("error", fail);
    socket.once("close", fail);
    socket.once("open", () => { socket.off("error", fail); socket.off("close", fail); resolve(socket); });
  });
}

/** A short-lived, read-only Core connection; no workspace state is read locally. */
export async function listCloudRoots(target: CloudRelayTarget, compatibility: Compatibility): Promise<CloudRoot[]> {
  const socket = await openCloudRelay(target);
  try {
    const request = (type: string, payload: unknown) => new Promise<any>((resolve, reject) => {
      const id = randomBytes(16).toString("hex");
      const finish = (error?: Error, value?: unknown) => {
        clearTimeout(timer); socket.off("message", receive); socket.off("close", closed); socket.off("error", closed);
        error ? reject(error) : resolve(value);
      };
      const closed = () => finish(new Error("Cloud Core disconnected."));
      const receive = (data: import("ws").RawData) => {
        try {
          const reply = JSON.parse(data.toString());
          if (reply.id !== id) return;
          reply.ok ? finish(undefined, reply.result) : finish(new Error(`${reply.error?.code ?? "ERROR"}: ${reply.error?.message ?? "Cloud Core request failed."} [${type}]`));
        } catch { finish(new Error("Invalid cloud Core response.")); }
      };
      const timer = setTimeout(() => finish(new Error("Cloud Core request timed out.")), 15_000);
      socket.on("message", receive); socket.once("close", closed); socket.once("error", closed);
      if (socket.readyState !== WebSocket.OPEN) { closed(); return; }
      socket.send(JSON.stringify({ id, type, payload }));
    });
    const handshake = await request("protocol.handshake", { compatibility, clientVersion: "0.1.0", sessionMessageLimit: 0 });
    if (!handshake.compatible) throw new Error(handshake.message ?? "Cloud Core is incompatible with this Desktop version.");
    const result = await request("workspace.roots", {});
    if (!Array.isArray(result.roots) || !result.roots.every((root: CloudRoot) => root && typeof root.id === "string" && typeof root.alias === "string" && typeof root.path === "string")) throw new Error("Invalid cloud Core list.");
    return result.roots;
  } finally { socket.close(); }
}

/** Authenticated loopback bridge for Desktop. Cloud cookies never leave Gateway. */
export async function createCloudBridge(target: CloudRelayTarget): Promise<{ port: number; token: string; close(): void }> {
  const token = randomBytes(32).toString("hex");
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const wss = new WebSocketServer({ server, maxPayload: maxBufferedBytes, perMessageDeflate: false });
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
