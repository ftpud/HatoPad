import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { protocolCompatibility } from "@hatopad/protocol";
import { CoreConnector, type ConnectorStatus } from "@hatopad/connector";
import { TestRelay } from "@hatopad/relay/testing";
import { createServer, shutdownCore } from "./server.js";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const until = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 300; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out: ${label}`);
};

it("relays two independent browser channels to a real Core with the local token injected only toward Core", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "hub-connector-")));
  vi.stubEnv("HATOPAD_STATE_DIR", path.join(directory, "state"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await promisify(execFile)("git", ["init", directory]);
  const token = "local-core-token-that-must-not-leak";
  const core = await createServer("127.0.0.1", 0, directory, { access: { token } });
  cleanups.push(() => shutdownCore(core));
  const corePort = (core.address() as { port: number }).port;

  const relay = new TestRelay({ credentials: ["device-credential"] });
  let hubSocket: WebSocket | undefined;
  const hub = await new Promise<WebSocketServer>((resolve) => {
    const server: WebSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 }, () => resolve(server));
  });
  cleanups.push(
    () =>
      new Promise<void>((done) => {
        for (const client of hub.clients) client.terminate();
        hub.close(() => done());
      }),
  );
  hub.on("connection", (socket) => {
    hubSocket = socket;
    socket.on("message", (data) => {
      for (const reply of relay.receive(data.toString())) socket.send(reply);
    });
  });

  const statuses: ConnectorStatus[] = [];
  const connector = new CoreConnector({
    hubUrl: `ws://127.0.0.1:${(hub.address() as { port: number }).port}`,
    allowInsecureHub: true,
    credential: "device-credential",
    localCoreUrl: `ws://127.0.0.1:${corePort}`,
    localToken: token,
    onStatus: (status) => statuses.push(status),
  });
  cleanups.push(() => connector.stop());
  connector.start();
  await until(() => statuses.some((s) => s.state === "online"), "online");

  const channels = [relay.openChannel(), relay.openChannel()];
  for (const { frame } of channels) hubSocket!.send(frame);
  await until(() => channels.every(({ channel }) => relay.isChannelReady(channel)), "channels ready");

  const send = (channel: string, message: unknown) => hubSocket!.send(relay.sendData(channel, message));
  const replies = (channel: string, id: string) =>
    relay.received.filter((r) => r.channel === channel && (r.payload as { id?: string }).id === id);
  // The browser sends a wrong token; Core must still accept because the connector replaces it.
  for (const { channel } of channels)
    send(channel, {
      id: "h",
      type: "protocol.handshake",
      payload: { compatibility: protocolCompatibility, token: "browser-guess" },
    });
  await until(() => channels.every(({ channel }) => replies(channel, "h").length === 1), "handshakes");
  for (const { channel } of channels)
    expect(replies(channel, "h")[0]!.payload).toMatchObject({ ok: true, result: { compatible: true } });

  // Requests are answered per channel; Core's per-connection state is independent.
  for (const { channel } of channels) send(channel, { id: "r", type: "workspace.roots", payload: {} });
  await until(() => channels.every(({ channel }) => replies(channel, "r").length === 1), "roots");
  for (const { channel } of channels) expect(replies(channel, "r")[0]!.payload).toMatchObject({ ok: true });

  expect(JSON.stringify(relay.received)).not.toContain(token);
  expect(JSON.stringify(relay.sent)).not.toContain(token);

  // Dropping the hub link closes channel sockets but leaves Core running and usable directly.
  hubSocket!.terminate();
  await until(() => statuses.some((s) => s.state === "offline"), "offline");
  const direct = new WebSocket(`ws://127.0.0.1:${corePort}`);
  await new Promise((resolve, reject) => {
    direct.once("open", resolve);
    direct.once("error", reject);
  });
  direct.close();
}, 20_000);
