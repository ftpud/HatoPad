import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { coreCapabilities, protocolCompatibility } from "@hatopad/protocol";
import { createServer, shutdownCore } from "./server.js";

it("advertises capabilities and bounds file, diff and conversation reads", async () => {
  const container = await realpath(await mkdtemp(path.join(os.tmpdir(), "phone-bounds-")));
  const directory = path.join(container, "repo"); await mkdir(directory);
  vi.stubEnv("HATOPAD_STATE_DIR", path.join(container, "state"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    const git = (...args: string[]) => promisify(execFile)("git", args, { cwd: directory });
    await git("init");
    await git("config", "user.email", "t@example.com");
    await git("config", "user.name", "t");
    await writeFile(path.join(directory, "big.txt"), "a\n".repeat(100));
    await git("add", ".");
    await git("commit", "-m", "init");
    await writeFile(path.join(directory, "big.txt"), "b\n".repeat(100));
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
    const handshake = await request("protocol.handshake", { compatibility: protocolCompatibility });
    expect(handshake.result.capabilities).toEqual([...coreCapabilities]);
    const rootId = (await request("workspace.roots", {})).result.selectedRootId as string;

    const scheduleInput = { name: "Cloud schedule", dueAt: new Date(Date.now() + 86_400_000).toISOString(), action: { type: "prompt", provider: "codex", prompt: "Synthetic check" } };
    const scheduleCreated = await request("schedules.create", scheduleInput, rootId);
    expect(scheduleCreated).toMatchObject({ ok: true });
    const schedule = (await request("schedules.list", {}, rootId)).result.schedules[0];
    expect(typeof schedule.revision).toBe("string");
    expect(await request("schedules.update", { scheduleId: schedule.id, input: { ...scheduleInput, rootId: "foreign" }, enabled: true, expectedRevision: schedule.revision }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("schedules.update", { scheduleId: schedule.id, input: { ...scheduleInput, name: "Updated" }, enabled: false, expectedRevision: schedule.revision }, rootId)).toMatchObject({ ok: true, result: { schedule: { id: schedule.id, name: "Updated", enabled: false } } });
    expect(await request("schedules.update", { scheduleId: schedule.id, input: scheduleInput, enabled: true, expectedRevision: schedule.revision }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    const secondRootPath = path.join(directory, "second-root"); await mkdir(secondRootPath);
    const secondRoot = (await request("workspace.addRoot", { path: secondRootPath, alias: "Other" })).result.root.id;
    expect(await request("workspace.selectRoot", { rootId: secondRoot, includeTree: false }, rootId)).toMatchObject({ ok: true });
    expect((await request("schedules.list", {}, secondRoot)).result.schedules).toEqual([]);
    expect(await request("schedules.delete", { scheduleId: schedule.id }, secondRoot)).toMatchObject({ ok: false, error: { code: "FILE_NOT_FOUND" } });
    await request("workspace.selectRoot", { rootId, includeTree: false }, secondRoot);
    const timer = await request("timers.create", { provider: "codex", prompt: "Synthetic continuation", seconds: 86_400 }, rootId);
    expect(timer).toMatchObject({ ok: true });
    await request("workspace.selectRoot", { rootId: secondRoot, includeTree: false }, rootId);
    expect((await request("timers.list", { rootScoped: true }, secondRoot)).result.timers).toEqual([]);
    expect(await request("timers.cancel", { timerId: timer.result.timer.id, rootScoped: true }, secondRoot)).toMatchObject({ ok: false, error: { code: "FILE_NOT_FOUND" } });
    await request("workspace.selectRoot", { rootId, includeTree: false }, secondRoot);
    for (const payload of [{ seconds: 0 }, { seconds: 604_801 }, { seconds: 60, dueAt: scheduleInput.dueAt }, { dueAt: "invalid" }]) expect(await request("timers.create", { provider: "codex", prompt: "Synthetic", ...payload }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("timers.cancel", { timerId: timer.result.timer.id, rootScoped: "true" }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("timers.cancel", { timerId: timer.result.timer.id }, rootId)).toMatchObject({ ok: true, result: { cancelled: true } });
    await request("schedules.delete", { scheduleId: schedule.id }, rootId);

    expect((await request("git.summary", { limit: 1 }, rootId)).result).toMatchObject({ additions: 100, deletions: 100 });
    expect(await request("git.summary", { limit: 501 }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect((await request("taskGit.summary", { limit: 5 }, rootId)).result.checkpoints).toEqual([]);
    const cloudTask = (await request("tasks.create", { branch: "cloud-message-test" }, rootId)).result.task;
    expect(await request("tasks.commitMessage.set", { taskId: cloudTask.id, message: "Draft for cloud" }, rootId)).toMatchObject({ ok: true, result: { message: "Draft for cloud" } });
    expect(await request("tasks.commitMessage.get", { taskId: cloudTask.id }, rootId)).toMatchObject({ ok: true, result: { message: "Draft for cloud", head: expect.any(String) } });
    expect(await request("tasks.commitMessage.update", { taskId: cloudTask.id, message: "Stale", expectedHead: "0".repeat(40) }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await request("workspace.selectRoot", { rootId: secondRoot, includeTree: false }, rootId);
    expect(await request("tasks.commitMessage.get", { taskId: cloudTask.id }, secondRoot)).toMatchObject({ ok: false, error: { code: "FILE_NOT_FOUND" } });
    await request("workspace.selectRoot", { rootId, includeTree: false }, secondRoot);

    const selectedBeforeWork = (await request("tasks.list", {}, rootId)).result.selectedTaskId;
    const workOverview = await request("overview.work", { limit: 1 });
    expect(workOverview).toMatchObject({ ok: true, result: { rows: [expect.objectContaining({ rootId: expect.any(String), sessions: expect.any(Array), terminals: expect.any(Number) })], totalTargets: expect.any(Number) } });
    expect(JSON.stringify(workOverview.result)).not.toContain("b\\nb\\n");
    expect((await request("tasks.list", {}, rootId)).result.selectedTaskId).toBe(selectedBeforeWork);
    expect(await request("overview.work", { limit: 26 })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("ai.configureNext", { configuration: { unexpected: true } }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("ai.configureNext", { configuration: {} }, rootId)).toMatchObject({ ok: true, result: { session: { nextConfiguration: {} } } });

    expect(await request("filesystem.readFile", { path: "big.txt", maxBytes: 10 }, rootId)).toMatchObject({ ok: false, error: { code: "FILE_TOO_LARGE" } });
    expect(await request("filesystem.readFile", { path: "big.txt", maxBytes: 1000 }, rootId)).toMatchObject({ ok: true });
    expect(await request("filesystem.readFile", { path: "big.txt" }, rootId)).toMatchObject({ ok: true });
    for (const maxBytes of [0, -1, 1.5, "9", 3 * 1024 * 1024]) expect(await request("filesystem.readFile", { path: "big.txt", maxBytes }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });

    const small = await request("git.diff", { path: "big.txt", maxBytes: 50 }, rootId);
    expect(small.result).toEqual({ path: "big.txt", originalContent: "", modifiedContent: "", hunks: [], tooLarge: true });
    const full = await request("git.diff", { path: "big.txt", maxBytes: 100_000 }, rootId);
    expect(full.result.tooLarge).toBeUndefined();
    expect(full.result.hunks.length).toBeGreaterThan(0);
    expect((await request("git.diff", { path: "big.txt" }, rootId)).result.modifiedContent).toContain("b");

    expect(await request("harnesses.progress", { runId: "missing" }, rootId)).toMatchObject({ ok: false, error: { code: "FILE_NOT_FOUND" } });
    expect(await request("harnesses.progress", { runId: "" }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });

    const switched = await request("tasks.switch", { includeTree: false }, rootId);
    expect(switched).toMatchObject({ ok: true, result: { tree: [] } });
    expect((await request("tasks.switch", {}, rootId)).result.tree.length).toBeGreaterThan(0);
    expect(await request("ai.get", { summary: "yes" }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect((await request("ai.get", { summary: true }, rootId)).result.session.messages).toEqual([]);
    expect(await request("ai.sessions", { summary: true, limit: 5 }, rootId)).toMatchObject({ ok: true, result: { sessions: expect.any(Array) } });
    expect(await request("ai.sessions", { limit: 0 }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });

    const page = await request("ai.messages", { limit: 5 }, rootId);
    expect(page).toMatchObject({ ok: true, result: { messages: [], clipped: [] } });
    expect(await request("ai.messages", { limit: 1000 }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await request("ai.messages", { before: "nope" }, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  } finally {
    socket?.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(container, { recursive: true, force: true });
  }
}, 20_000);

it("rejects an invalid connection sessionMessageLimit only after authentication and accepts valid ones", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "session-limit-")));
  vi.stubEnv("HATOPAD_STATE_DIR", path.join(directory, "state"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  const sockets: WebSocket[] = [];
  try {
    await promisify(execFile)("git", ["init", directory]);
    server = await createServer("127.0.0.1", 0, directory);
    const port = (server.address() as { port: number }).port;
    const handshake = async (payload: Record<string, unknown>) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      sockets.push(socket);
      await once(socket, "open");
      socket.send(JSON.stringify({ id: "1", type: "protocol.handshake", payload: { compatibility: protocolCompatibility, ...payload } }));
      const [data] = await once(socket, "message");
      return JSON.parse(data.toString()) as Record<string, any>;
    };
    expect(await handshake({ sessionMessageLimit: 0 })).toMatchObject({ ok: true, result: { compatible: true } });
    expect(await handshake({ sessionMessageLimit: 101 })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await handshake({ sessionMessageLimit: -1 })).toMatchObject({ ok: false });
  } finally {
    for (const socket of sockets) socket.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

it("lists directories lazily, hides escapes and restores roots without a tree", async () => {
  const container = await realpath(await mkdtemp(path.join(os.tmpdir(), "list-dir-")));
  const directory = path.join(container, "repo");
  await mkdir(path.join(directory, "src"), { recursive: true });
  vi.stubEnv("HATOPAD_STATE_DIR", path.join(container, "state"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    for (const name of ["b.txt", "a.txt", "c.txt", "src/inner.txt"]) await writeFile(path.join(directory, name), name);
    await mkdir(path.join(container, "outside"));
    await symlink(path.join(container, "outside"), path.join(directory, "escape"));
    await symlink(path.join(directory, "src"), path.join(directory, "linked-src"));
    await promisify(execFile)("git", ["init"], { cwd: directory });
    server = await createServer("127.0.0.1", 0, directory);
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
    await once(socket, "open");
    let sequence = 0;
    const request = (type: string, payload: unknown, rootId?: string) => new Promise<Record<string, any>>((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => reject(new Error(`No response to ${type}`)), 5_000);
      const message = (data: WebSocket.RawData) => { const value = JSON.parse(data.toString()); if (value.id !== id) return; clearTimeout(timer); socket!.off("message", message); resolve(value); };
      socket!.on("message", message);
      socket!.send(JSON.stringify({ id, type, payload, rootId }));
    });
    await request("protocol.handshake", { compatibility: protocolCompatibility });
    const rootId = (await request("workspace.roots", {})).result.selectedRootId as string;

    const first = await request("filesystem.listDirectory", { limit: 3 }, rootId);
    expect(first.result.entries.map((entry: { name: string; type: string }) => `${entry.type}:${entry.name}`)).toEqual(["directory:linked-src", "directory:src", "file:a.txt"]);
    expect(first.result.nextCursor).toBeDefined();
    const second = await request("filesystem.listDirectory", { path: "", limit: 3, cursor: first.result.nextCursor }, rootId);
    expect(second.result.entries.map((entry: { name: string }) => entry.name)).toEqual(["b.txt", "c.txt"]);
    expect(second.result.nextCursor).toBeUndefined();
    const names = [...first.result.entries, ...second.result.entries].map((entry: { name: string }) => entry.name);
    expect(names).not.toContain("escape");
    expect(names).not.toContain(".git");
    expect((await request("filesystem.listDirectory", { path: "src" }, rootId)).result.entries).toEqual([{ name: "inner.txt", path: "src/inner.txt", type: "file" }]);

    for (const bad of [{ path: "../outside" }, { path: "escape" }, { path: "a.txt" }, { path: "missing" }]) expect((await request("filesystem.listDirectory", bad, rootId)).ok).toBe(false);
    for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: "5" }, { cursor: 5 }, { path: 5 }]) expect(await request("filesystem.listDirectory", bad, rootId)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });

    expect(await request("workspace.open", { includeTree: false }, rootId)).toMatchObject({ ok: true, result: { tree: [], workspace: directory } });
    expect((await request("workspace.open", {}, rootId)).result.tree.length).toBeGreaterThan(0);

    const lean = await request("workspace.selectRoot", { rootId, preserveTaskSelection: true, includeTree: false }, rootId);
    expect(lean).toMatchObject({ ok: true, result: { tree: [] } });
    expect((await request("workspace.selectRoot", { rootId, preserveTaskSelection: true }, rootId)).result.tree.length).toBeGreaterThan(0);
  } finally {
    socket?.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(container, { recursive: true, force: true });
  }
}, 20_000);
