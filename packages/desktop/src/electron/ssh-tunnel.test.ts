import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { connect, type Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "vitest";
import type { Client } from "ssh2";
import { SshTunnel, type SshTunnelStatus } from "./ssh-tunnel.js";

class FakeClient extends EventEmitter {
  ended = false;
  end(): this {
    this.ended = true;
    return this;
  }
  forwardOut(..._args: unknown[]): void {
    /* No local connections are needed for lifecycle tests. */
  }
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for tunnel state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("reconnects a closed SSH transport without changing the local port", async () => {
  const clients = [new FakeClient(), new FakeClient()];
  const statuses: Array<{ status: SshTunnelStatus; port: number }> = [];
  let connects = 0;
  const tunnel = new SshTunnel({
    localPort: 0,
    remotePort: 7331,
    reconnectDelayMs: 1,
    connect: async () => clients[connects++] as unknown as Client,
    onStatus: (status, port) => statuses.push({ status, port }),
  });

  const port = await tunnel.start();
  clients[0]!.emit("close");
  await until(() => connects === 2 && statuses.at(-1)?.status === "running");

  assert.equal(tunnel.localPort, port);
  assert.equal(statuses.at(-1)?.port, port);
  tunnel.stop();
});

test("catches transport errors and retries failed reconnects in the background", async () => {
  const first = new FakeClient();
  const replacement = new FakeClient();
  let connects = 0;
  const tunnel = new SshTunnel({
    localPort: 0,
    remotePort: 7331,
    reconnectDelayMs: 1,
    connect: async () => {
      connects += 1;
      if (connects === 1) return first as unknown as Client;
      if (connects === 2) throw new Error("network is still waking up");
      return replacement as unknown as Client;
    },
  });

  await tunnel.start();
  assert.doesNotThrow(() => first.emit("error", new Error("socket closed after sleep")));
  await until(() => connects === 3);
  assert.equal(first.ended, true);
  tunnel.stop();
});

test("resume reconnect is immediate and preserves the bound port", async () => {
  const clients = [new FakeClient(), new FakeClient()];
  let connects = 0;
  const tunnel = new SshTunnel({
    localPort: 0,
    remotePort: 7331,
    connect: async () => clients[connects++] as unknown as Client,
  });
  const port = await tunnel.start();

  tunnel.reconnect();
  await until(() => connects === 2);

  assert.equal(tunnel.localPort, port);
  assert.equal(clients[0]!.ended, true);
  tunnel.stop();
});

class ChannelClient extends FakeClient {
  channels: Duplex[] = [];
  forwardOut(
    _a: string,
    _b: number,
    _c: string,
    _d: number,
    callback: (error: Error | undefined, stream: Duplex) => void,
  ) {
    const channel = new Duplex({
      read() {},
      write(_chunk, _encoding, done) {
        done();
      },
    });
    this.channels.push(channel);
    callback(undefined, channel);
  }
}

function connectLocal(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => resolve(socket));
    socket.on("error", reject);
  });
}

const closed = (socket: Socket) => until(() => socket.destroyed);

test("closes the local socket when the SSH channel is destroyed without end or error", async () => {
  const client = new ChannelClient();
  const tunnel = new SshTunnel({ localPort: 0, remotePort: 1, connect: async () => client as unknown as Client });
  const port = await tunnel.start();
  const socket = await connectLocal(port);
  await until(() => client.channels.length === 1);
  client.channels[0]!.destroy();
  await closed(socket);
  tunnel.stop();
});

test("closes the SSH channel when the local socket goes away", async () => {
  const client = new ChannelClient();
  const tunnel = new SshTunnel({ localPort: 0, remotePort: 1, connect: async () => client as unknown as Client });
  const port = await tunnel.start();
  const socket = await connectLocal(port);
  await until(() => client.channels.length === 1);
  socket.destroy();
  await until(() => client.channels[0]!.destroyed);
  tunnel.stop();
});

test("stop and transport loss tear down active forwarded connections", async () => {
  const clients = [new ChannelClient(), new ChannelClient()];
  let connects = 0;
  const tunnel = new SshTunnel({
    localPort: 0,
    remotePort: 1,
    reconnectDelayMs: 1,
    connect: async () => clients[connects++] as unknown as Client,
  });
  const port = await tunnel.start();
  const first = await connectLocal(port);
  await until(() => clients[0]!.channels.length === 1);
  clients[0]!.emit("close");
  await closed(first);
  await until(() => clients[0]!.channels[0]!.destroyed);
  await until(() => connects === 2);
  const second = await connectLocal(port);
  await until(() => clients[1]!.channels.length === 1);
  tunnel.stop();
  await closed(second);
  await until(() => clients[1]!.channels[0]!.destroyed);
});

test("stopping during SSH startup does not bind a listener or report running", async () => {
  const statuses: SshTunnelStatus[] = [];
  let release!: (client: Client) => void;
  const tunnel = new SshTunnel({
    localPort: 0,
    remotePort: 1,
    connect: () => new Promise<Client>((resolve) => (release = resolve)),
    onStatus: (status) => statuses.push(status),
  });
  const starting = tunnel.start();
  await until(() => release !== undefined);
  tunnel.stop();
  const client = new FakeClient();
  release(client as unknown as Client);
  await assert.rejects(starting, /cancelled/);
  assert.equal(statuses.includes("running"), false);
  assert.equal(tunnel.localPort, 0);
  assert.equal(client.ended, true);
});
