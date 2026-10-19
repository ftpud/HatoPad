import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { protocolCompatibility } from "@hatopad/protocol";
import { createServer, shutdownCore } from "./server.js";

it("keeps each connection's task selection independent of other clients' switches", async () => {
  const container = await realpath(await mkdtemp(path.join(os.tmpdir(), "selection-")));
  const directory = path.join(container, "repo");
  await mkdir(directory);
  vi.stubEnv("HATOPAD_STATE_DIR", path.join(container, "state"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  const sockets: WebSocket[] = [];
  try {
    const git = (...args: string[]) => promisify(execFile)("git", args, { cwd: directory });
    await git("init", "-b", "main");
    await git("config", "user.email", "t@example.com");
    await git("config", "user.name", "t");
    await writeFile(path.join(directory, "a.txt"), "root\n");
    await git("add", ".");
    await git("commit", "-m", "init");
    server = await createServer("127.0.0.1", 0, directory);
    const port = (server.address() as { port: number }).port;

    const connect = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      sockets.push(socket);
      await once(socket, "open");
      let sequence = 0;
      const request = (type: string, payload: unknown, rootId?: string) => new Promise<Record<string, any>>((resolve, reject) => {
        const id = String(++sequence);
        const timer = setTimeout(() => reject(new Error(`No response to ${type}`)), 15_000);
        const message = (data: WebSocket.RawData) => {
          const value = JSON.parse(data.toString());
          if (value.id !== id) return;
          clearTimeout(timer); socket.off("message", message); resolve(value);
        };
        socket.on("message", message);
        socket.send(JSON.stringify({ id, type, payload, rootId }));
      });
      await request("protocol.handshake", { compatibility: protocolCompatibility });
      const rootId = (await request("workspace.roots", {})).result.selectedRootId as string;
      return { request, rootId };
    };

    const a = await connect();
    const b = await connect();
    const created = await a.request("tasks.create", { branch: "phone-task" }, a.rootId);
    expect(created.ok).toBe(true);
    const taskId = created.result.task.id as string;
    const switched = await a.request("tasks.switch", { taskId, includeTree: false }, a.rootId);
    expect(switched.result.selectedTaskId).toBe(taskId);
    const aWorkspace = switched.result.workspace as string;
    expect(aWorkspace).not.toBe(directory);

    // B never selected anything: it must still see and run in the root workspace.
    const bList = await b.request("tasks.list", {}, b.rootId);
    expect(bList.result.tasks.map((task: { id: string }) => task.id)).toContain(taskId);
    expect(bList.result.selectedTaskId).toBeUndefined();
    expect((await b.request("workspace.open", { includeIgnored: false }, b.rootId)).result.workspace).toBe(directory);
    expect((await a.request("tasks.list", {}, a.rootId)).result.selectedTaskId).toBe(taskId);

    // A third client starts from the durable default (A's task) and then stays pinned there.
    const c = await connect();
    expect((await c.request("tasks.list", {}, c.rootId)).result.selectedTaskId).toBe(taskId);
    await a.request("tasks.switch", {}, a.rootId);
    expect((await a.request("tasks.list", {}, a.rootId)).result.selectedTaskId).toBeUndefined();
    expect((await c.request("tasks.list", {}, c.rootId)).result.selectedTaskId).toBe(taskId);
    expect((await c.request("workspace.open", { includeIgnored: false }, c.rootId)).result.workspace).toBe(aWorkspace);
    expect((await b.request("tasks.list", {}, b.rootId)).result.selectedTaskId).toBeUndefined();
  } finally {
    for (const socket of sockets) socket.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(container, { recursive: true, force: true });
  }
}, 60_000);
