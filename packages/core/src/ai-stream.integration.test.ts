import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { protocolCompatibility, type AiSession } from "@hatopad/protocol";
import { createServer, shutdownCore } from "./server.js";

it("transfers only changed messages and fetches screenshots separately over a real connection", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ai-stream-")));
  const state = path.join(directory, "state");
  await mkdir(state);
  vi.stubEnv("HATOPAD_STATE_DIR", state);
  const image = { type: "image" as const, mimeType: "image/png", data: "a".repeat(5_000_000) };
  const chat: AiSession = {
    id: "chat",
    status: "done",
    model: "auto",
    reasoning: "low",
    messages: [{ id: "screenshot", role: "activity", text: "Screenshot", timestamp: "now", content: [image] }],
  };
  const file = path.join(state, `${createHash("sha256").update(directory).digest("hex")}-codex.json`);
  await writeFile(file, JSON.stringify(chat));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    server = await createServer("127.0.0.1", 0, directory);
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
    await once(socket, "open");
    let sequence = 0;
    const request = (type: string, payload: unknown, rootId?: string) =>
      new Promise<any>((resolve, reject) => {
        const id = String(++sequence);
        const timer = setTimeout(() => {
          socket!.off("message", receive);
          reject(new Error(`No response to ${type}`));
        }, 5000);
        const receive = (data: WebSocket.RawData) => {
          const response = JSON.parse(data.toString());
          if (response.id !== id) return;
          clearTimeout(timer);
          socket!.off("message", receive);
          resolve(response);
        };
        socket!.on("message", receive);
        socket!.send(JSON.stringify({ id, type, payload, rootId }));
      });
    expect(
      await request("protocol.handshake", { compatibility: protocolCompatibility, deferSessionImages: true }),
    ).toMatchObject({ ok: true });
    const root = (await request("workspace.roots", {})).result.selectedRootId;
    const first = await request("ai.get", { provider: "codex" }, root);
    expect(first.ok).toBe(true);
    expect(JSON.stringify(first).length).toBeLessThan(5000);
    const imageId = first.result.session.messages[0].content[0].deferred;
    expect(imageId).toEqual(expect.any(String));
    const unchanged = await request("ai.get", { provider: "codex", after: first.result.cursor }, root);
    expect(unchanged.result).toMatchObject({ updates: [], messageCount: 1, session: { messages: [] } });
    chat.messages.push({ id: "reply", role: "assistant", text: "New reply", timestamp: "now" });
    await writeFile(file, JSON.stringify(chat));
    const next = await request("ai.get", { provider: "codex", after: first.result.cursor }, root);
    expect(next.result.updates).toEqual([{ index: 1, message: chat.messages[1] }]);
    expect(JSON.stringify(next).length).toBeLessThan(5000);
    const payload = { provider: "codex", sessionId: "chat", messageId: "screenshot", contentIndex: 0, imageId };
    expect((await request("ai.image", payload, root)).result.image).toEqual(image);
    expect(await request("ai.image", { ...payload, sessionId: "old-chat" }, root)).toMatchObject({ ok: false });
    expect(await request("ai.image", { ...payload, imageId: "old-image" }, root)).toMatchObject({ ok: false });
    expect(await request("protocol.keepAlive", {})).toMatchObject({ ok: true });
  } finally {
    socket?.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
