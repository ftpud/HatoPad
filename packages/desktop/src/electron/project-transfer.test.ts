import assert from "node:assert/strict";
import { once } from "node:events";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: vi.fn() }, dialog: {}, ipcMain: { handle: vi.fn() } }));
let helpers: typeof import("./project-transfer.js");
beforeAll(async () => {
  helpers = await import("./project-transfer.js");
});

describe("Electron project transfer validation", () => {
  it("accepts only bounded structured start requests", () => {
    expect(
      helpers.validateStart({
        localId: "local",
        token: "ticket",
        host: "127.0.0.1",
        port: 9000,
        direction: "upload",
        size: 12,
      }),
    ).toMatchObject({ size: 12 });
    expect(() =>
      helpers.validateStart({
        localId: "local",
        token: "ticket",
        host: "host",
        port: 9000,
        direction: "upload",
        size: -1,
      }),
    ).toThrow("Invalid transfer");
  });
  it("rejects host strings that could alter the transfer URL", () => {
    expect(helpers.encodeHost("::1")).toBe("[::1]");
    expect(() => helpers.encodeHost("host/path")).toThrow("Invalid Core host");
  });
  it("maps cancellation and oversized channel closes to actionable errors", () => {
    expect(helpers.safeTransferError(4000, "")).toBe("Transfer cancelled");
    expect(helpers.safeTransferError(1009, "")).toContain("size limit");
  });
  it("expires abandoned local path choices and consumes used choices once", () => {
    vi.useFakeTimers();
    try {
      const store = new helpers.LocalChoiceStore(100);
      const used = store.put({ path: "/local/used", direction: "upload" });
      expect(store.take(used)).toMatchObject({ path: "/local/used" });
      expect(store.take(used)).toBeUndefined();
      const abandoned = store.put({ path: "/local/abandoned", direction: "download" });
      vi.advanceTimersByTime(101);
      expect(store.take(abandoned)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

it.each([false, true])(
  "uploads and downloads binary and empty files (cloud=%s)",
  async (cloud) => {
    const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { WebSocketServer } = await import("ws");
    const { createCloudBridge } = await import("./cloud-tunnel.js");
    const { remoteTransferChunkBytes } = await import("@hatopad/protocol");
    const directory = await mkdtemp(path.join(tmpdir(), "desktop-transfer-"));
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const content = Buffer.alloc(cloud ? 14 * 1024 * 1024 : remoteTransferChunkBytes * 3 + 13, 0xfe);
    const uploads: Buffer[] = [];
    let direction: "upload" | "download" = "upload";
    let expected = content;
    server.on("connection", (socket) => {
      const received: Buffer[] = [];
      const frameTimes: number[] = [];
      const sendDownload = () => {
        for (let offset = 0; offset < expected.length; offset += remoteTransferChunkBytes) {
          const chunk = expected.subarray(offset, offset + remoteTransferChunkBytes);
          socket.send(cloud ? JSON.stringify({ type: "projectTransfer.data", data: chunk.toString("base64") }) : chunk);
        }
        if (cloud)
          socket.send(JSON.stringify({ type: "projectTransfer.close", code: 1000, reason: "Transfer complete" }));
        socket.close(1000, "Transfer complete");
      };
      socket.on("message", (data) => {
        if (cloud) {
          const now = Date.now();
          frameTimes.push(now);
          while (frameTimes[0]! < now - 1000) frameTimes.shift();
          expect(frameTimes.length).toBeLessThanOrEqual(200);
          const frame = JSON.parse(data.toString());
          if (frame.type === "protocol.handshake") {
            expect(frame.payload.remoteTransferToken).toBe("ticket");
            socket.send(
              JSON.stringify({ id: frame.id, ok: true, result: { capabilities: ["filesystem.remoteTransfer.json"] } }),
            );
            socket.send(JSON.stringify({ type: "projectTransfer.ready" }));
            if (direction === "download") sendDownload();
            return;
          }
        }
        const chunk = cloud ? Buffer.from(JSON.parse(data.toString()).data, "base64") : Buffer.from(data as Buffer);
        if (chunk.length) received.push(chunk);
        else {
          uploads.push(Buffer.concat(received));
          if (cloud)
            socket.send(JSON.stringify({ type: "projectTransfer.close", code: 1000, reason: "Transfer complete" }));
          socket.close(1000, "Transfer complete");
        }
      });
      if (!cloud && direction === "download") sendDownload();
    });
    const bridge = cloud
      ? await createCloudBridge({
          origin: `http://127.0.0.1:${port}`,
          coreId: "core",
          cookie: async () => "session=secret",
        })
      : undefined;
    try {
      for (const bytes of [content, Buffer.alloc(0)]) {
        expected = bytes;
        for (const operation of ["upload", "download"] as const) {
          direction = operation;
          const file = path.join(directory, operation);
          if (operation === "upload") await writeFile(file, bytes);
          const progress = vi.fn();
          await helpers.runTransfer(
            file,
            {
              localId: "local",
              token: "ticket",
              host: "127.0.0.1",
              port: bridge?.port ?? port,
              direction: operation,
              size: bytes.length,
            },
            `${cloud}-${operation}`,
            progress,
          );
          if (operation === "upload") assert.deepEqual(uploads.at(-1), bytes);
          else assert.deepEqual(await readFile(file), bytes);
        }
      }
    } finally {
      bridge?.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
  10_000,
);
