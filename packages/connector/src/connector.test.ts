import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { TestRelay } from "@hatopad/relay/testing";
import {
  CoreConnector,
  PairingStore,
  pairDevice,
  parseHubUrl,
  parseLocalCoreUrl,
  type ConnectorStatus,
} from "./index.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function listen(): Promise<{ server: WebSocketServer; port: number }> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 }, () =>
      resolve({ server, port: (server.address() as { port: number }).port }),
    );
    cleanups.push(
      () =>
        new Promise<void>((done) => {
          for (const client of server.clients) client.terminate();
          server.close(() => done());
        }),
    );
  });
}

const until = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out: ${label}`);
};

describe("endpoint restrictions", () => {
  it("accepts only loopback ws for Core and wss for the hub", () => {
    expect(() => parseLocalCoreUrl("ws://127.0.0.1:1234")).not.toThrow();
    expect(() => parseLocalCoreUrl("ws://evil.example:1234")).toThrow();
    expect(() => parseLocalCoreUrl("wss://127.0.0.1:1234")).toThrow();
    expect(() => parseLocalCoreUrl("ws://user:pw@127.0.0.1:1")).toThrow();
    expect(() => parseHubUrl("wss://hub.example")).not.toThrow();
    expect(() => parseHubUrl("ws://hub.example")).toThrow();
    expect(() => parseHubUrl("ws://127.0.0.1:9")).toThrow();
    expect(() => parseHubUrl("ws://127.0.0.1:9", true)).not.toThrow();
  });
});

describe("connector against test relay and fake Core", () => {
  async function setup(credential = "good", maxFrameBytes?: number) {
    const relay = new TestRelay({ credentials: ["good"], ...(maxFrameBytes ? { limits: { maxFrameBytes } } : {}) });
    const hubSide = await listen();
    let hubSocket: WebSocket | undefined;
    hubSide.server.on("connection", (socket) => {
      hubSocket = socket;
      socket.on("message", (data) => {
        for (const reply of relay.receive(data.toString())) socket.send(reply);
      });
    });
    const core = await listen();
    const coreMessages: string[] = [];
    core.server.on("connection", (socket) => {
      socket.on("message", (data) => {
        coreMessages.push(data.toString());
        socket.send(JSON.stringify({ id: "1", ok: true, result: { echoed: true } }));
      });
    });
    const statuses: ConnectorStatus[] = [];
    const connector = new CoreConnector({
      hubUrl: `ws://127.0.0.1:${hubSide.port}`,
      allowInsecureHub: true,
      credential,
      localCoreUrl: `ws://127.0.0.1:${core.port}`,
      localToken: "LOCAL-SECRET",
      onStatus: (status) => statuses.push(status),
      backoff: { initialMs: 20, maxMs: 40 },
      random: () => 0,
    });
    cleanups.push(() => connector.stop());
    return { relay, connector, statuses, coreMessages, core: core.server, hub: () => hubSocket };
  }

  it("relays data after ready and injects the local token only toward Core", async () => {
    const { relay, connector, statuses, coreMessages, hub } = await setup();
    connector.start();
    await until(() => statuses.some((s) => s.state === "online"), "online");
    const { channel, frame } = relay.openChannel();
    hub()!.send(frame);
    // Hub sends data before the channel is ready: connector must refuse it.
    hub()!.send(JSON.stringify({ type: "channel.data", channel, generation: 1, payload: { id: "0", type: "x" } }));
    await until(() => relay.isChannelReady(channel), "ready");
    hub()!.send(
      relay.sendData(channel, {
        id: "1",
        type: "protocol.handshake",
        payload: { compatibility: {}, token: "BROWSER-GUESS" },
      }),
    );
    await until(() => coreMessages.length === 1, "core received handshake");
    const forwarded = JSON.parse(coreMessages[0]!);
    expect(forwarded.payload.token).toBe("LOCAL-SECRET");
    expect(coreMessages).toHaveLength(1); // the early data frame never reached Core
    await until(() => relay.received.length === 1, "reply relayed");
    expect(JSON.stringify(relay.received)).not.toContain("LOCAL-SECRET");
    expect(relay.received[0]).toEqual({ channel, payload: { id: "1", ok: true, result: { echoed: true } } });
  });

  it("relays multi-megabyte project replies without dropping Hub", async () => {
    const { relay, connector, statuses, core, hub } = await setup();
    connector.start();
    await until(() => statuses.some((s) => s.state === "online"), "online");
    const { channel, frame } = relay.openChannel();
    hub()!.send(frame);
    await until(() => relay.isChannelReady(channel), "ready");
    const payload = { id: "large-project", ok: true, result: { text: "x".repeat(12 * 1024 * 1024) } };
    [...core.clients][0]!.send(JSON.stringify(payload));
    await until(() => relay.received.length === 1, "large reply received");
    expect(relay.received[0]).toEqual({ channel, payload });
    expect(hub()!.readyState).toBe(WebSocket.OPEN);
  });

  it("isolates an oversized Core reply without disconnecting Hub or another browser", async () => {
    const { relay, connector, statuses, core, hub } = await setup("good", 1024 * 1024);
    connector.start();
    await until(() => statuses.some((s) => s.state === "online"), "online");
    const first = relay.openChannel();
    hub()!.send(first.frame);
    const second = relay.openChannel();
    hub()!.send(second.frame);
    await until(
      () => relay.isChannelReady(first.channel) && relay.isChannelReady(second.channel),
      "both channels ready",
    );
    const sockets = [...core.clients];
    sockets[0]!.send(JSON.stringify({ id: "history", ok: true, result: { text: "x".repeat(4 * 1024 * 1024) } }));
    await until(() => !relay.isChannelReady(first.channel), "oversized channel closed");
    expect(hub()!.readyState).toBe(WebSocket.OPEN);
    expect(relay.isChannelReady(second.channel)).toBe(true);
    hub()!.send(relay.sendData(second.channel, { id: "still-alive", type: "protocol.keepAlive", payload: {} }));
    await until(() => relay.received.some((reply) => reply.channel === second.channel), "other channel still works");
    expect(statuses.filter((s) => s.state === "online")).toHaveLength(1);
    expect(statuses.some((s) => s.state === "offline")).toBe(false);
  });

  it("authenticates maintenance requests with the local token without exposing it to Hub", async () => {
    const { relay, connector, statuses, coreMessages, hub } = await setup();
    connector.start();
    await until(() => statuses.some((s) => s.state === "online"), "online");
    const { channel, frame } = relay.openChannel();
    hub()!.send(frame);
    // Hub sends data before the channel is ready: connector must refuse it.
    hub()!.send(JSON.stringify({ type: "channel.data", channel, generation: 1, payload: { id: "0", type: "x" } }));
    await until(() => relay.isChannelReady(channel), "ready");
    hub()!.send(
      relay.sendData(channel, {
        id: "1",
        type: "protocol.maintenance",
        payload: { compatibility: {}, token: "BROWSER-GUESS" },
      }),
    );
    await until(() => coreMessages.length === 1, "core received handshake");
    const forwarded = JSON.parse(coreMessages[0]!);
    expect(forwarded.payload.token).toBe("LOCAL-SECRET");
    expect(coreMessages).toHaveLength(1); // the early data frame never reached Core
    await until(() => relay.received.length === 1, "reply relayed");
    expect(JSON.stringify(relay.received)).not.toContain("LOCAL-SECRET");
    expect(relay.received[0]).toEqual({ channel, payload: { id: "1", ok: true, result: { echoed: true } } });
  });

  it("stops without retrying when the credential is rejected", async () => {
    const { connector, statuses } = await setup("bad");
    connector.start();
    await until(() => statuses.some((s) => s.state === "stopped"), "stopped");
    expect(statuses.at(-1)).toEqual({ state: "stopped", reason: "revoked" });
  });

  it.each(["revoked", "unauthenticated", "unauthorized", "incompatible"] as const)(
    "stops without retrying on an unscoped %s error after going online, even if the hub stays open",
    async (code) => {
      const { connector, statuses, hub } = await setup();
      connector.start();
      await until(() => statuses.some((s) => s.state === "online"), "online");
      const socket = hub()!;
      socket.send(JSON.stringify({ type: "error", code }));
      await until(() => statuses.some((s) => s.state === "stopped"), "stopped");
      expect(statuses.at(-1)).toEqual({
        state: "stopped",
        reason: code === "incompatible" ? "incompatible" : "revoked",
      });
      await until(
        () => socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING,
        "hub closed",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(statuses.filter((s) => s.state === "connecting")).toHaveLength(1);
      expect(statuses.some((s) => s.state === "offline")).toBe(false);
    },
  );

  it("keeps the connector online for a channel-scoped error", async () => {
    const { connector, statuses, hub } = await setup();
    connector.start();
    await until(() => statuses.some((s) => s.state === "online"), "online");
    hub()!.send(JSON.stringify({ type: "error", code: "revoked", channel: "c1", generation: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(statuses.some((s) => s.state === "stopped")).toBe(false);
  });

  it("reconnects with fresh channels after the hub link drops", async () => {
    const { relay, connector, statuses, hub } = await setup();
    connector.start();
    await until(() => statuses.some((s) => s.state === "online"), "online");
    relay.dropConnection();
    hub()!.terminate();
    await until(() => statuses.filter((s) => s.state === "online").length === 2, "online again");
    expect(statuses.some((s) => s.state === "offline")).toBe(true);
  });
});

describe("pairing", () => {
  function hub(options: { accept?: boolean } = {}) {
    const calls: Array<{ method: string; path: string; auth: string | null; body: unknown }> = [];
    let polls = 0;
    const handler = (async (url: URL, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const path = new URL(url).pathname;
      calls.push({
        method: init.method,
        path,
        auth: init.headers.authorization ?? null,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      if (path === "/api/pairing/start")
        return Response.json({
          status: "pending",
          pairingId: "pairing-0001",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      if (path === "/api/pairing/pairing-0001") {
        polls += 1;
        return Response.json(
          polls < 2
            ? { status: "pending" }
            : { status: "pending", claimedBy: { name: "Ann", email: "ann@example.com" } },
        );
      }
      if (path === "/api/pairing/pairing-0001/confirm")
        return Response.json(
          JSON.parse(init.body!).accept
            ? { status: "confirmed", coreId: "core-00001", credential: "DEVICE-CRED" }
            : { status: "rejected", reason: "denied" },
        );
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, handler };
  }

  it("issues nothing until the local user accepts the named claimant, then stores a 0600 credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const path = join(dir, "nested", "pairing.json");
    const store = new PairingStore(path);
    const { calls, handler } = hub();
    let shown = "";
    let prompted: unknown;
    const paired = await pairDevice({
      hubOrigin: "https://hub.example",
      deviceName: "Laptop",
      store,
      fetch: handler,
      pollIntervalMs: 1,
      showCode: (code) => {
        shown = code;
      },
      confirmLocally: async (claimant) => {
        prompted = claimant;
        expect(calls.some((c) => c.path.endsWith("/confirm"))).toBe(false);
        return true;
      },
    });
    expect(paired.status).toBe("paired");
    expect(prompted).toEqual({ name: "Ann", email: "ann@example.com" });
    expect(shown).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const proofs = new Set(calls.map((c) => c.auth));
    expect(proofs.size).toBe(1);
    expect([...proofs][0]).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
    expect((calls[0]!.body as { code: string }).code).toBe(shown);
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain([...proofs][0]!.slice(7));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8")).credential).toBe("DEVICE-CRED");
  });

  it("tells the hub when declined locally and stores nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const store = new PairingStore(join(dir, "pairing.json"));
    const { calls, handler } = hub();
    const declined = await pairDevice({
      hubOrigin: "https://hub.example",
      deviceName: "Laptop",
      store,
      fetch: handler,
      pollIntervalMs: 1,
      showCode: () => undefined,
      confirmLocally: async () => false,
    });
    expect(declined).toEqual({ status: "failed", reason: "declined locally" });
    expect(calls.at(-1)).toMatchObject({ path: "/api/pairing/pairing-0001/confirm", body: { accept: false } });
    expect(await store.load()).toBeUndefined();
  });

  it("does not replay a confirm whose response was lost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const store = new PairingStore(join(dir, "pairing.json"));
    const { calls, handler } = hub();
    const lossy = (async (url: URL, init: never) => {
      if (new URL(url).pathname.endsWith("/confirm")) {
        await handler(url, init);
        throw new Error("connection reset");
      }
      return handler(url, init);
    }) as unknown as typeof fetch;
    const result = await pairDevice({
      hubOrigin: "https://hub.example",
      deviceName: "x",
      store,
      fetch: lossy,
      pollIntervalMs: 1,
      showCode: () => undefined,
      confirmLocally: async () => true,
    });
    expect(result.status).toBe("failed");
    expect(calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(1);
    expect(await store.load()).toBeUndefined();
  });

  it("rejects non-HTTPS hubs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const result = await pairDevice({
      hubOrigin: "http://hub.example",
      deviceName: "x",
      store: new PairingStore(join(dir, "p.json")),
      showCode: () => undefined,
      confirmLocally: async () => true,
    });
    expect(result.status).toBe("failed");
  });

  const sample = {
    hubUrl: "https://hub.example",
    coreId: "core-00001",
    deviceId: "device-0001",
    credential: "DEVICE-CRED",
  };

  it("refuses to load a credential file that is group/world readable, a symlink, or not a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const file = join(dir, "pairing.json");
    const store = new PairingStore(file);
    await store.save(sample);
    expect(await store.load()).toEqual(sample);
    await chmod(file, 0o644);
    await expect(store.load()).rejects.toThrow(/private/);
    await chmod(file, 0o600);

    const target = join(dir, "real.json");
    await writeFile(target, JSON.stringify(sample), { mode: 0o600 });
    const link = join(dir, "link.json");
    await symlink(target, link);
    await expect(new PairingStore(link).load()).rejects.toThrow(/regular file/);

    await mkdir(join(dir, "folder.json"));
    await expect(new PairingStore(join(dir, "folder.json")).load()).rejects.toThrow(/regular file/);
    expect(await new PairingStore(join(dir, "missing.json")).load()).toBeUndefined();
  });

  it("replaces a symlinked or weak existing file instead of following it, and refuses writable directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const victim = join(dir, "victim.txt");
    await writeFile(victim, "keep me");
    await chmod(victim, 0o644);
    const file = join(dir, "pairing.json");
    await symlink(victim, file);
    const store = new PairingStore(file);
    await store.save(sample);
    expect(await readFile(victim, "utf8")).toBe("keep me");
    expect((await stat(victim)).mode & 0o777).toBe(0o644);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await store.load()).toEqual(sample);

    const open = await mkdtemp(join(tmpdir(), "pair-"));
    await chmod(open, 0o777);
    await expect(new PairingStore(join(open, "pairing.json")).save(sample)).rejects.toThrow(/not writable by others/);

    await store.clear();
    expect(await store.load()).toBeUndefined();
    await store.clear();
  });

  it("creates new directories 0700", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    await new PairingStore(join(dir, "a", "b", "pairing.json")).save(sample);
    expect((await stat(join(dir, "a"))).mode & 0o777).toBe(0o700);
  });

  it("times out silent hubs and stops promptly when aborted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pair-"));
    const store = new PairingStore(join(dir, "pairing.json"));
    const hang = ((_url: URL, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      )) as unknown as typeof fetch;
    const timedOut = await pairDevice({
      hubOrigin: "https://hub.example",
      deviceName: "x",
      store,
      fetch: hang,
      requestTimeoutMs: 30,
      showCode: () => undefined,
      confirmLocally: async () => true,
    });
    expect(timedOut).toEqual({ status: "failed", reason: "hub did not respond in time" });

    const controller = new AbortController();
    const pending = (async (url: URL) =>
      new URL(url).pathname.endsWith("/start")
        ? Response.json({
            status: "pending",
            pairingId: "pairing-0001",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          })
        : Response.json({ status: "pending" })) as unknown as typeof fetch;
    const started = Date.now();
    const result = pairDevice({
      hubOrigin: "https://hub.example",
      deviceName: "x",
      store,
      fetch: pending,
      pollIntervalMs: 60_000,
      signal: controller.signal,
      showCode: () => setTimeout(() => controller.abort(), 20),
      confirmLocally: async () => true,
    });
    expect(await result).toEqual({ status: "failed", reason: "aborted" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
