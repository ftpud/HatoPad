import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { protocolCompatibility } from "@hatopad/protocol";
import { createServer, shutdownCore } from "./server.js";

it("opens a plain project directory that is not a Git repository", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hatopad-plain-workspace-"));
  const state = await mkdtemp(path.join(os.tmpdir(), "hatopad-plain-state-"));
  await writeFile(path.join(workspace, "notes.txt"), "hello\n");
  vi.stubEnv("HATOPAD_STATE_DIR", state);
  const token = "startup-test-token-01234567890123456789";
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    server = await createServer("127.0.0.1", 0, workspace, { access: { token } });
    if (!server.address()) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await once(socket, "open");
    const request = async (id: string, type: string, payload: unknown, rootId?: string) => {
      const response = once(socket!, "message");
      socket!.send(JSON.stringify({ id, type, ...(rootId ? { rootId } : {}), payload }));
      return JSON.parse(String((await response)[0]));
    };
    expect(await request("hs", "protocol.handshake", { token, compatibility: protocolCompatibility })).toMatchObject({
      ok: true,
    });
    const roots = await request("roots", "workspace.roots", {});
    expect(await request("open", "workspace.open", {}, roots.result.selectedRootId)).toMatchObject({ ok: true });
  } finally {
    socket?.terminate();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs();
    await rm(workspace, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});
