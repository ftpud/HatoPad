import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
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
