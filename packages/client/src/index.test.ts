import { afterEach, expect, it, vi } from "vitest";
import { CoreClient } from "./index";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  static capabilities?: string[];
  static maintenance = false;
  static incompatible = false;
  get capabilities() {
    return Socket.capabilities;
  }
  sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  constructor(readonly url: string) {
    Socket.instances.push(this);
  }
  send(text: string) {
    const request = JSON.parse(text);
    this.sent.push(request);
    const result = ["protocol.handshake", "protocol.maintenance"].includes(request.type)
      ? {
          compatible: !Socket.incompatible,
          ...(Socket.maintenance && request.type === "protocol.maintenance" ? { maintenance: true } : {}),
          ...(this.capabilities ? { capabilities: this.capabilities } : {}),
        }
      : request.type === "workspace.roots"
        ? { roots: [{ id: "root" }, { id: "saved" }], selectedRootId: "root" }
        : request.type === "workspace.selectRoot"
          ? { tree: [] }
          : { roots: [{ id: "root" }], selectedRootId: "root" };
    this.onmessage?.({ data: JSON.stringify({ id: request.id, ok: true, result }) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  Socket.instances = [];
  Socket.capabilities = undefined;
  Socket.maintenance = false;
  Socket.incompatible = false;
});
it("connects using injected URL and credentials without Electron globals", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  const getToken = vi.fn(async () => "private-local-credential");
  try {
    const connecting = client.connect({ url: "wss://core.example/socket", getToken });
    const socket = Socket.instances[0]!;
    socket.open();
    await connecting;
    expect(socket.url).toBe("wss://core.example/socket");
    expect(getToken).toHaveBeenCalledOnce();
    expect(socket.sent[0]!.payload.token).toBe("private-local-credential");
    expect(client.getRoot()).toBe("root");
    expect(client.supports("overview.summary")).toBe(false);
  } finally {
    client.disconnect();
  }
});
it("rejects obsolete asynchronous credentials after disconnect", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  let release!: (token: string) => void;
  const token = new Promise<string>((resolve) => {
    release = resolve;
  });
  const connecting = client.connect({ url: "wss://core.example/socket", getToken: () => token });
  const rejected = expect(connecting).rejects.toThrow("Connection replaced or closed");
  const socket = Socket.instances[0]!;
  socket.open();
  client.disconnect();
  release("secret");
  await rejected;
  await Promise.resolve();
  expect(socket.sent).toEqual([]);
});
it("fails lean root restore on Cores without the capability instead of fetching the full tree", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  client.setRoot("saved");
  const connecting = client.connect({ url: "wss://core.example/socket", leanWorkspace: true });
  const socket = Socket.instances[0]!;
  socket.open();
  await expect(connecting).rejects.toThrow("too old for lean workspace restore");
  expect(socket.sent.map((request) => request.type)).not.toContain("workspace.selectRoot");
});
it("restores a saved root without the tree when the Core advertises the capability", async () => {
  vi.stubGlobal("WebSocket", Socket);
  Socket.capabilities = ["workspace.selectRoot.includeTree"];
  const client = new CoreClient();
  client.setRoot("saved");
  const connecting = client.connect({ url: "wss://core.example/socket", leanWorkspace: true });
  const socket = Socket.instances[0]!;
  socket.open();
  await connecting;
  expect(client.supports("workspace.selectRoot.includeTree")).toBe(true);
  expect(socket.sent.find((request) => request.type === "workspace.selectRoot")!.payload).toMatchObject({
    rootId: "saved",
    includeTree: false,
  });
  client.disconnect();
});

it("keeps all overview reads unscoped even when another root is selected", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  const connecting = client.connect({ url: "wss://core.example/socket" });
  const socket = Socket.instances[0]!;
  socket.open();
  await connecting;
  try {
    client.setRoot("other");
    await client.request("overview.work", { limit: 1 });
    await client.request("overview.events", { limit: 1 });
    for (const request of socket.sent.filter((request) => ["overview.work", "overview.events"].includes(request.type)))
      expect(request).not.toHaveProperty("rootId");
    expect(client.getRoot()).toBe("other");
  } finally {
    client.disconnect();
  }
});
it("identifies the exact rejected operation for out-of-order error responses", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  try {
    const connecting = client.connect({ url: "wss://cloud.example/relay" });
    const socket = Socket.instances[0]!;
    socket.open();
    await connecting;
    const requests: { id: string; type: string }[] = [];
    socket.send = (text: string) => {
      requests.push(JSON.parse(text));
    };
    const first = client.request("workspace.open", {});
    const second = client.request("tasks.list", {});
    const firstCheck = expect(first).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      requestType: "workspace.open",
      message: "INVALID_REQUEST: This operation is not available through HatoHub [workspace.open]",
    });
    const secondCheck = expect(second).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      requestType: "tasks.list",
      message: "INVALID_REQUEST: This operation is not available through HatoHub [tasks.list]",
    });
    for (const request of [...requests].reverse())
      socket.onmessage?.({
        data: JSON.stringify({
          id: request.id,
          ok: false,
          error: { code: "INVALID_REQUEST", message: "This operation is not available through HatoHub" },
        }),
      });
    await Promise.all([firstCheck, secondCheck]);
  } finally {
    client.disconnect();
  }
});

it("maintenance checks never discover roots and refuse older Cores that ignore the mode", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  const pending = client.connect({ url: "ws://core", maintenance: true });
  const socket = Socket.instances.at(-1)!;
  socket.readyState = Socket.OPEN;
  socket.onopen?.();
  await expect(pending).rejects.toThrow(/one-time external update/);
  expect(socket.sent.map((item) => item.type)).toEqual(["protocol.maintenance"]);
  client.disconnect();
});

it("uses an explicitly accepted incompatible maintenance connection without workspace reads", async () => {
  vi.stubGlobal("WebSocket", Socket);
  Socket.maintenance = true;
  Socket.incompatible = true;
  const client = new CoreClient();
  try {
    const pending = client.connect({ url: "ws://core", maintenance: true });
    const socket = Socket.instances.at(-1)!;
    socket.open();
    await pending;
    expect(socket.sent.map((item) => item.type)).toEqual(["protocol.maintenance"]);
    await expect(client.request("workspace.roots", {})).rejects.toThrow(/Maintenance/);
    await client.request("core.update.check", { branch: "dev" });
    expect(socket.sent.at(-1)).not.toHaveProperty("rootId");
  } finally {
    client.disconnect();
  }
});

const legacyInvalidRequest = {
  id: "unknown",
  ok: false,
  error: { code: "INVALID_REQUEST", message: "Request must contain a valid id, type, and payload" },
};

it.each([false, true])(
  "rejects an uncorrelated legacy negotiation immediately (maintenance=%s)",
  async (maintenance) => {
    class LegacySocket extends Socket {
      override send(text: string) {
        this.sent.push(JSON.parse(text));
        this.onmessage?.({ data: JSON.stringify(legacyInvalidRequest) });
      }
    }
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", LegacySocket);
    const client = new CoreClient();
    try {
      const rejected = vi.fn();
      const connecting = client.connect({ url: "ws://legacy-core", maintenance });
      void connecting.catch(rejected);
      const socket = Socket.instances.at(-1)!;
      socket.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(rejected).toHaveBeenCalledOnce();
      expect(rejected.mock.calls[0]![0]).toMatchObject({
        code: "INVALID_REQUEST",
        requestType: maintenance ? "protocol.maintenance" : "protocol.handshake",
      });
      expect((rejected.mock.calls[0]![0] as Error).message).toContain(
        maintenance ? "one-time external update" : "INVALID_REQUEST",
      );
      expect(socket.sent.map((item) => item.type)).toEqual([
        maintenance ? "protocol.maintenance" : "protocol.handshake",
      ]);
      expect(client.isConnected()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.disconnect();
      vi.useRealTimers();
    }
  },
);

it("does not attribute an uncorrelated error when negotiation has multiple pending requests", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  const connecting = client.connect({ url: "ws://core" });
  const connectionFailed = vi.fn();
  void connecting.catch(connectionFailed);
  const socket = Socket.instances.at(-1)!;
  socket.send = (text) => {
    socket.sent.push(JSON.parse(text));
  };
  try {
    socket.open();
    await Promise.resolve();
    const read = client.request("workspace.roots", {});
    const readFailed = vi.fn();
    void read.catch(readFailed);
    socket.onmessage?.({ data: JSON.stringify(legacyInvalidRequest) });
    await Promise.resolve();
    expect(socket.sent.map((item) => item.type)).toEqual(["protocol.handshake", "workspace.roots"]);
    expect(connectionFailed).not.toHaveBeenCalled();
    expect(readFailed).not.toHaveBeenCalled();
    client.disconnect();
    await expect(connecting).rejects.toThrow("Connection replaced or closed");
    await expect(read).rejects.toThrow("Connection replaced or closed");
  } finally {
    client.disconnect();
  }
});

it("ignores an uncorrelated error for a normal mutation after negotiation without replaying it", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const client = new CoreClient();
  try {
    const connecting = client.connect({ url: "ws://core" });
    const socket = Socket.instances.at(-1)!;
    socket.open();
    await connecting;
    let sent: { id: string; type: string } | undefined;
    const send = vi.fn((text: string) => {
      sent = JSON.parse(text);
    });
    socket.send = send;
    const changed = vi.fn(),
      failed = vi.fn();
    const mutation = client.request("workspace.saveOptions", { options: { openFiles: [] } });
    void mutation.then(changed, failed);
    socket.onmessage?.({ data: JSON.stringify(legacyInvalidRequest) });
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    socket.onmessage?.({ data: JSON.stringify({ id: sent!.id, ok: true, rootId: "root", result: {} }) });
    await expect(mutation).resolves.toEqual({});
    expect(send).toHaveBeenCalledOnce();
  } finally {
    client.disconnect();
  }
});
