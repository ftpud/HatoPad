import { EventEmitter } from "node:events";
import { WebSocket, type RawData } from "ws";
import { remoteTransferChunkBytes, type RemoteTransferFrame } from "@hatopad/protocol";

/** Minimal transport shared by direct binary sockets and JSON relay sockets. */
export interface TransferSocket {
  readonly readyState: number;
  readonly OPEN: number;
  on: EventEmitter["on"];
  once: EventEmitter["once"];
  off: EventEmitter["off"];
  pause(): void;
  resume(): void;
  close(code?: number, reason?: string): void;
  send(data: Buffer | string, options: { binary: boolean }, callback?: (error?: Error) => void): void;
}

/** Keeps the file service's atomic writes and backpressure identical on cloud and SSH. */
export class JsonTransferSocket extends EventEmitter implements TransferSocket {
  readonly OPEN = WebSocket.OPEN;
  constructor(private readonly socket: WebSocket) {
    super();
    socket.once("close", (code, reason) => this.emit("close", code, reason));
    socket.once("error", (error) => this.emit("error", error));
    // Setup may fail before the file service installs its own listener.
    this.on("error", () => undefined);
  }
  get readyState() {
    return this.socket.readyState;
  }
  pause() {
    this.socket.pause();
  }
  resume() {
    this.socket.resume();
  }
  ready() {
    this.sendFrame({ type: "projectTransfer.ready" });
  }
  receive(data: RawData, binary: boolean): void {
    try {
      if (binary || data.toString().length > remoteTransferChunkBytes * 2) throw new Error();
      const frame = JSON.parse(data.toString()) as RemoteTransferFrame;
      if (frame.type === "projectTransfer.close" && frame.code === 4000) {
        this.close(4000, "Transfer cancelled");
        return;
      }
      if (frame.type !== "projectTransfer.data" || typeof frame.data !== "string") throw new Error();
      const chunk = Buffer.from(frame.data, "base64");
      if (chunk.length > remoteTransferChunkBytes || chunk.toString("base64") !== frame.data) throw new Error();
      this.emit("message", chunk, true);
    } catch {
      this.close(1008, "Invalid transfer frame");
    }
  }
  send(data: Buffer | string, _options: { binary: boolean }, callback?: (error?: Error) => void): void {
    // The shared relay allows 200 frames/second. Pace data so file transfers
    // cannot exhaust that quota; the file stream waits for this callback.
    this.sendFrame({ type: "projectTransfer.data", data: Buffer.from(data).toString("base64") }, (error) => {
      if (error) callback?.(error);
      else setTimeout(() => callback?.(), 10);
    });
  }
  close(code = 1000, reason = ""): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.sendFrame({ type: "projectTransfer.close", code, reason });
    this.socket.close(code, reason);
  }
  private sendFrame(frame: RemoteTransferFrame, callback?: (error?: Error) => void): void {
    this.socket.send(JSON.stringify(frame), { binary: false }, callback);
  }
}
