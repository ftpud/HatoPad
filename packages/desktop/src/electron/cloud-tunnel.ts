import { protocolCompatibility, remoteTransferChunkBytes, type RemoteTransferFrame } from "@hatopad/protocol";
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
    const socket = new WebSocket(url, {
      origin: target.origin,
      headers: { cookie },
      handshakeTimeout: 15_000,
      maxPayload: maxFrameBytes,
    });
    socket.on("error", () => undefined);
    const fail = () => {
      socket.terminate();
      reject(new Error("Could not connect to cloud Core. Refresh cloud status and check your sign-in."));
    };
    socket.once("error", fail);
    socket.once("close", fail);
    socket.once("open", () => {
      socket.off("error", fail);
      socket.off("close", fail);
      resolve(socket);
    });
  });
}

/** Authenticated loopback bridge for Desktop. Cloud cookies stay in Desktop's main process. */
export async function createCloudBridge(
  target: CloudRelayTarget,
): Promise<{ port: number; token: string; close(): void }> {
  const token = randomBytes(32).toString("hex");
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: maxFrameBytes, perMessageDeflate: false });
  const sockets = new Set<WebSocket>();
  let stopped = false;
  wss.on("connection", (local, request) => {
    if (request.url?.startsWith("/project-transfer?")) {
      const ticket = new URL(request.url, "http://localhost").searchParams.get("token");
      if (!ticket) {
        local.close(1008, "Transfer ticket is required");
        return;
      }
      relayProjectTransfer(local, target, ticket, sockets, () => stopped);
      return;
    }
    sockets.add(local);
    let remote: WebSocket | undefined;
    let authenticated = false;
    let queue: string[] = [];
    let queuedBytes = 0;
    const close = () => {
      clearTimeout(timeout);
      sockets.delete(local);
      local.terminate();
      if (remote) {
        sockets.delete(remote);
        remote.terminate();
      }
    };
    const timeout = setTimeout(close, 15_000);
    local.on("close", close);
    local.on("error", close);
    const forward = (destination: WebSocket, text: string) => {
      if (
        destination.readyState !== WebSocket.OPEN ||
        destination.bufferedAmount + Buffer.byteLength(text) > maxBufferedBytes
      ) {
        close();
        return;
      }
      destination.send(text, { binary: false }, (error) => {
        if (error) close();
      });
    };
    local.on("message", (data, binary) => {
      if (binary) {
        close();
        return;
      }
      let text = data.toString();
      if (!authenticated) {
        try {
          const message = JSON.parse(text);
          const supplied = message.payload?.token;
          if (
            message.type !== "protocol.handshake" ||
            typeof supplied !== "string" ||
            supplied.length !== token.length ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
          ) {
            close();
            return;
          }
          authenticated = true;
          delete message.payload.token;
          text = JSON.stringify(message);
        } catch {
          close();
          return;
        }
        void openCloudRelay(target)
          .then((socket) => {
            if (stopped || local.readyState !== WebSocket.OPEN) {
              socket.terminate();
              return;
            }
            clearTimeout(timeout);
            remote = socket;
            sockets.add(remote);
            remote.on("close", close);
            remote.on("error", close);
            remote.on("message", (data, binary) => {
              if (binary) close();
              else forward(local, data.toString());
            });
            for (const message of queue) forward(remote, message);
            queue = [];
            queuedBytes = 0;
          })
          .catch(close);
      }
      if (remote) forward(remote, text);
      else {
        queuedBytes += Buffer.byteLength(text);
        if (queuedBytes > maxBufferedBytes || queue.length >= 128) {
          close();
          return;
        }
        queue.push(text);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind cloud Desktop bridge.");
  return {
    port: address.port,
    token,
    close() {
      stopped = true;
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      wss.close();
      server.close();
    },
  };
}

/** A dedicated relay channel, authorized by the one-use Core transfer ticket. */
function relayProjectTransfer(
  local: WebSocket,
  target: CloudRelayTarget,
  ticket: string,
  sockets: Set<WebSocket>,
  stopped: () => boolean,
): void {
  sockets.add(local);
  local.pause();
  let remote: WebSocket | undefined;
  let completed = false;
  let ready = false;
  let nextFrameAt = 0;
  let pendingBytes = 0;
  let pendingFrames = 0;
  const sends = new Set<ReturnType<typeof setTimeout>>();
  const fail = () => {
    clearTimeout(timeout);
    if (!completed && local.readyState === WebSocket.OPEN) {
      local.resume();
      local.close(1011, "Cloud file transfer interrupted");
    }
    remote?.terminate();
  };
  const timeout = setTimeout(fail, 15_000);
  local.on("error", fail);
  local.once("close", (code) => {
    clearTimeout(timeout);
    sockets.delete(local);
    for (const timer of sends) clearTimeout(timer);
    sends.clear();
    if (remote) {
      sockets.delete(remote);
      if (!completed && code === 4000 && remote.readyState === WebSocket.OPEN)
        remote.send(JSON.stringify({ type: "projectTransfer.close", code: 4000, reason: "Transfer cancelled" }));
      remote.close();
    }
  });
  local.on("message", (data, binary) => {
    if (!ready || !binary || !remote || remote.readyState !== WebSocket.OPEN) {
      fail();
      return;
    }
    const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
    // Bound relay frames even when a direct sender uses larger binary frames.
    const chunks = Math.max(1, Math.ceil(buffer.length / remoteTransferChunkBytes));
    if (pendingBytes + remote.bufferedAmount + buffer.length * 2 > maxBufferedBytes) {
      fail();
      return;
    }
    local.pause();
    for (let index = 0; index < chunks; index++) {
      const chunk = buffer.subarray(index * remoteTransferChunkBytes, (index + 1) * remoteTransferChunkBytes);
      const text = JSON.stringify({ type: "projectTransfer.data", data: chunk.toString("base64") });
      pendingBytes += Buffer.byteLength(text);
      pendingFrames += 1;
      // Stay below the relay's 200 frames/second quota, including fast local senders.
      const scheduledAt = Math.max(Date.now(), nextFrameAt);
      nextFrameAt = scheduledAt + 10;
      const timer = setTimeout(() => {
        sends.delete(timer);
        if (remote?.readyState !== WebSocket.OPEN) {
          fail();
          return;
        }
        remote.send(text, (error) => {
          pendingBytes -= Buffer.byteLength(text);
          pendingFrames -= 1;
          if (error) fail();
          else if (!pendingFrames) local.resume();
        });
      }, scheduledAt - Date.now());
      sends.add(timer);
    }
  });
  void openCloudRelay(target)
    .then((socket) => {
      if (stopped() || local.readyState !== WebSocket.OPEN) {
        socket.terminate();
        return;
      }
      remote = socket;
      sockets.add(socket);
      socket.on("error", fail);
      socket.once("close", () => {
        sockets.delete(socket);
        if (!completed) fail();
      });
      socket.on("message", (data, binary) => {
        try {
          if (binary) throw new Error();
          const frame = JSON.parse(data.toString()) as RemoteTransferFrame;
          if (frame.type === "projectTransfer.ready") {
            clearTimeout(timeout);
            ready = true;
            local.resume();
          } else if (frame.type === "projectTransfer.data") {
            if (typeof frame.data !== "string" || frame.data.length > remoteTransferChunkBytes * 2) throw new Error();
            const chunk = Buffer.from(frame.data, "base64");
            if (chunk.length > remoteTransferChunkBytes || chunk.toString("base64") !== frame.data) throw new Error();
            if (local.bufferedAmount + chunk.length > maxBufferedBytes) throw new Error();
            socket.pause();
            local.send(chunk, { binary: true }, (error) => {
              if (error) fail();
              else socket.resume();
            });
          } else if (frame.type === "projectTransfer.close") {
            if (![1000, 1001, 1008, 1009, 1011, 4000].includes(frame.code) || typeof frame.reason !== "string")
              throw new Error();
            completed = true;
            clearTimeout(timeout);
            local.close(frame.code, frame.reason);
          } else {
            const reply = frame as unknown as { id?: string; ok?: boolean; result?: { capabilities?: string[] } };
            if (
              reply.id !== "project-transfer" ||
              !reply.ok ||
              !reply.result?.capabilities?.includes("filesystem.remoteTransfer.json")
            )
              throw new Error();
          }
        } catch {
          fail();
        }
      });
      socket.send(
        JSON.stringify({
          id: "project-transfer",
          type: "protocol.handshake",
          payload: { compatibility: protocolCompatibility, remoteTransferToken: ticket },
        }),
      );
    })
    .catch(fail);
}
