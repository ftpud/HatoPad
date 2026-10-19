import { createServer, type Server, type Socket } from "node:net";
import { WebSocket } from "ws";
import { openCloudRelay, requestCloud, type CloudRelayTarget } from "./cloud-relay.js";
import type { Compatibility } from "./client-compatibility.js";

type Options = {
  target: CloudRelayTarget;
  compatibility: Compatibility;
  localPort: number;
  remotePort: number;
  onStatus(status: "running" | "error", message: string): void;
};
/** TCP on local loopback, carried over one authenticated Hub/Core channel. */
export class CloudPortTunnel {
  private server?: Server;
  private remote?: WebSocket;
  private readonly clients = new Set<Socket>();
  private keepAlive?: NodeJS.Timeout;
  private generation = 0;
  constructor(private readonly options: Options) {}
  async start(): Promise<number> {
    for (const port of [this.options.localPort, this.options.remotePort])
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Tunnel ports must be between 1 and 65535");
    this.stop();
    const generation = this.generation;
    const remote = await openCloudRelay(this.options.target);
    if (generation !== this.generation) {
      remote.terminate();
      throw Error("Port tunnel was stopped");
    }
    this.remote = remote;
    remote.setMaxListeners(128);
    const failed = () => {
      if (this.remote !== remote) return;
      this.stop();
      this.options.onStatus(
        "error",
        "Cloud disconnected. Active connections were closed; run the tunnel again after refreshing cloud status.",
      );
    };
    remote.once("close", failed);
    remote.once("error", failed);
    try {
      const hello = await requestCloud(remote, "protocol.maintenance", {
        compatibility: this.options.compatibility,
        clientVersion: "0.1.0",
      });
      if (
        hello?.maintenance !== true ||
        hello.compatible !== true ||
        !Array.isArray(hello.capabilities) ||
        !hello.capabilities.includes("ports.tunnel")
      )
        throw Error("This Core does not support cloud port tunneling. Update Core and Gateway.");
      if (generation !== this.generation || this.remote !== remote) throw Error("Port tunnel was stopped");
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        if (this.clients.size >= 16) {
          socket.destroy();
          return;
        }
        this.clients.add(socket);
        socket.on("error", () => undefined);
        socket.once("close", () => this.clients.delete(socket));
        void this.forward(socket, remote).catch(() => socket.destroy());
      });
      this.server = server;
      server.on("error", () => {
        if (this.server === server) {
          this.stop();
          this.options.onStatus("error", "Local tunnel listener failed. Choose an available local port.");
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.options.localPort, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (generation !== this.generation) throw Error("Port tunnel was stopped");
      this.keepAlive = setInterval(() => {
        void requestCloud(remote, "protocol.keepAlive", {}).catch(failed);
      }, 30_000);
      this.keepAlive.unref();
      this.options.onStatus(
        "running",
        `127.0.0.1:${this.options.localPort} → Core 127.0.0.1:${this.options.remotePort}`,
      );
      return this.options.localPort;
    } catch (error) {
      if (this.remote === remote) this.stop();
      throw error;
    }
  }
  private async forward(local: Socket, remote: WebSocket): Promise<void> {
    let streamId: string | undefined;
    local.pause();
    const closeRemote = () => {
      if (streamId && remote.readyState === WebSocket.OPEN)
        void requestCloud(remote, "portTunnel.close", { streamId }).catch(() => undefined);
    };
    local.once("close", closeRemote);
    try {
      const result = await requestCloud(remote, "portTunnel.open", { port: this.options.remotePort });
      if (typeof result?.streamId !== "string" || !/^[a-f0-9]{36}$/.test(result.streamId))
        throw Error("Invalid tunnel stream");
      streamId = result.streamId;
      if (local.destroyed || this.remote !== remote) {
        closeRemote();
        return;
      }
      const writing = (async () => {
        for await (const bytes of local) {
          const buffer = Buffer.from(bytes);
          for (let offset = 0; offset < buffer.length; offset += 32768)
            await requestCloud(remote, "portTunnel.write", {
              streamId,
              data: buffer.subarray(offset, offset + 32768).toString("base64"),
            });
        }
        if (!local.destroyed && remote.readyState === WebSocket.OPEN)
          await requestCloud(remote, "portTunnel.end", { streamId });
      })();
      const reading = (async () => {
        while (!local.destroyed) {
          const result = await requestCloud(remote, "portTunnel.read", { streamId });
          if (typeof result?.data !== "string" || result.data.length > 43692 || typeof result.eof !== "boolean")
            throw Error("Invalid tunnel response");
          const data = Buffer.from(result.data, "base64");
          if (data.length > 32768 || data.toString("base64") !== result.data) throw Error("Invalid tunnel response");
          if (data.length)
            await new Promise<void>((resolve, reject) =>
              local.write(data, (error) => (error ? reject(error) : resolve())),
            );
          if (result.eof) {
            local.end();
            break;
          }
        }
      })();
      // A failure closes both directions immediately; no TCP data is retried.
      await Promise.all([writing, reading]);
    } finally {
      local.off("close", closeRemote);
      closeRemote();
      local.destroy();
    }
  }
  stop(): void {
    this.generation++;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    const remote = this.remote;
    this.remote = undefined;
    for (const socket of this.clients) socket.destroy();
    this.clients.clear();
    this.server?.close();
    this.server = undefined;
    remote?.terminate();
  }
  reconnect(): void {
    void this.start().catch(() =>
      this.options.onStatus("error", "Cloud reconnection failed. Refresh cloud status and run the tunnel again."),
    );
  }
}
