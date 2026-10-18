import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { protocolCompatibility } from "@remote-ide/protocol";
import { createServer, shutdownCore } from "./server.js";

it("serves overview.summary without a rootId and without changing selection", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "overview-")));
  vi.stubEnv("REMOTE_IDE_STATE_DIR", path.join(directory, "state"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    await promisify(execFile)("git", ["init", directory]);
    server = await createServer("127.0.0.1", 0, directory);
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
    await once(socket, "open");
    let sequence = 0;
    const request = (type: string, payload: unknown, rootId?: string) => new Promise<Record<string, any>>((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => reject(new Error(`No response to ${type}`)), 5_000);
      const message = (data: WebSocket.RawData) => {
        const value = JSON.parse(data.toString());
        if (value.id !== id) return;
        clearTimeout(timer); socket!.off("message", message); resolve(value);
      };
      socket!.on("message", message);
      socket!.send(JSON.stringify({ id, type, payload, rootId }));
    });
    await request("protocol.handshake", { compatibility: protocolCompatibility });
    const before = await request("workspace.roots", {});
    const rootId = before.result.selectedRootId as string;
    const tasksBefore = await request("tasks.list", {}, rootId);

    const summary = await request("overview.summary", {});
    expect(summary).toMatchObject({ ok: true, result: { items: [], truncated: false, roots: [{ id: rootId, running: 0, attention: 0 }] } });
    expect(summary.result.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(summary.rootId).toBeUndefined();

    expect(await request("overview.summary", { limit: 0 })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("overview.summary", { cursor: "bogus" })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });

    expect((await request("workspace.roots", {})).result.selectedRootId).toBe(rootId);
    expect((await request("tasks.list", {}, rootId)).result).toEqual(tasksBefore.result);
  } finally {
    socket?.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
