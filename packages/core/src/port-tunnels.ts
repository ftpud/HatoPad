import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { CoreError } from "./errors.js";

const chunkBytes = 32 * 1024;
function invalid(message: string): never {
  throw new CoreError("INVALID_REQUEST", message);
}
type Stream = { socket: Socket; reading: boolean; writing: boolean; failed: boolean };

/** One authenticated connection owns these streams. Only numeric loopback ports are dialed. */
export class PortTunnels {
  private readonly streams = new Map<string, Stream>();
  private stopped = false;
  constructor(
    private readonly corePort: number,
    private readonly budget = { active: 0 },
  ) {}
  async handle(type: string, payload: unknown): Promise<unknown> {
    if (this.stopped) invalid("Port tunnel connection is closed");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid("Invalid port tunnel payload");
    const input = payload as Record<string, unknown>;
    if (type === "portTunnel.open") {
      if (
        Object.keys(input).some((key) => key !== "port") ||
        !Number.isInteger(input.port) ||
        (input.port as number) < 1 ||
        (input.port as number) > 65535 ||
        input.port === this.corePort
      )
        invalid("Invalid destination port");
      if (this.streams.size >= 16 || this.budget.active >= 128) invalid("Port tunnel stream limit");
      const id = randomBytes(18).toString("hex");
      const socket = new Socket({ allowHalfOpen: true });
      const stream: Stream = { socket, reading: false, writing: false, failed: false };
      this.streams.set(id, stream);
      this.budget.active++;
      socket.on("error", () => {
        stream.failed = true;
      });
      socket.once("close", () => {
        this.budget.active--;
      });
      socket.setTimeout(5 * 60_000, () => socket.destroy());
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => socket.destroy(), 10_000);
          const closed = () => {
            cleanup();
            reject(new Error("Destination port unavailable"));
          };
          const connected = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timer);
            socket.off("close", closed);
            socket.off("connect", connected);
          };
          socket.once("close", closed);
          socket.once("connect", connected);
          socket.connect(input.port as number, "127.0.0.1");
        });
        if (this.stopped || socket.destroyed) invalid("Port tunnel connection is closed");
        return { streamId: id };
      } catch {
        this.streams.delete(id);
        socket.destroy();
        invalid("Destination port unavailable");
      }
    }
    if (typeof input.streamId !== "string" || !/^[a-f0-9]{36}$/.test(input.streamId)) invalid("Invalid stream ID");
    if (Object.keys(input).some((key) => key !== "streamId" && !(type === "portTunnel.write" && key === "data")))
      invalid("Unknown port tunnel field");
    const stream = this.streams.get(input.streamId as string);
    if (type === "portTunnel.close") {
      this.streams.delete(input.streamId as string);
      stream?.socket.destroy();
      return {};
    }
    if (!stream) invalid("Port tunnel stream is closed");
    const { socket } = stream;
    if (type === "portTunnel.read") {
      if (stream.reading) invalid("A read is already pending");
      stream.reading = true;
      try {
        // Pull at most one bounded chunk. TCP applies backpressure while no read is requested.
        const read = () => socket.read(Math.min(socket.readableLength || chunkBytes, chunkBytes)) as Buffer | null;
        let data = read();
        if (!data && !socket.destroyed && !socket.readableEnded) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              socket.off("readable", done);
              socket.off("end", done);
              socket.off("close", done);
              resolve();
            };
            const timer = setTimeout(done, 1000);
            socket.once("readable", done);
            socket.once("end", done);
            socket.once("close", done);
          });
          data = read();
        }
        if (stream.failed) invalid("Destination connection failed");
        return { data: data?.toString("base64") ?? "", eof: !data && (socket.destroyed || socket.readableEnded) };
      } finally {
        stream.reading = false;
      }
    }
    if (type === "portTunnel.write") {
      if (
        typeof input.data !== "string" ||
        input.data.length > 43692 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)
      )
        invalid("Invalid tunnel data");
      const data = Buffer.from(input.data as string, "base64");
      if (
        !data.length ||
        data.length > chunkBytes ||
        data.toString("base64") !== input.data ||
        stream.writing ||
        socket.writableEnded ||
        socket.destroyed
      )
        invalid("Tunnel write unavailable");
      stream.writing = true;
      try {
        await new Promise<void>((resolve, reject) =>
          socket.write(data, (error) => (error ? reject(new Error("Destination write failed")) : resolve())),
        );
      } finally {
        stream.writing = false;
      }
      return {};
    }
    if (type === "portTunnel.end") {
      if (stream.writing) invalid("A write is pending");
      socket.end();
      return {};
    }
    return invalid("Unknown port tunnel operation");
  }
  close(): void {
    this.stopped = true;
    for (const stream of this.streams.values()) stream.socket.destroy();
  }
}
