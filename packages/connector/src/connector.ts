import WebSocket from "ws";
import {
  ChannelTable,
  DEFAULT_RELAY_LIMITS,
  RELAY_WIRE_RANGE,
  parseRelayFrame,
  serializeRelayFrame,
  type RelayErrorCode,
  type RelayFrame,
  type RelayLimits
} from "@remote-ide/relay";
import { parseHubUrl, parseLocalCoreUrl } from "./endpoint.js";

export type ConnectorStatus =
  | { state: "connecting" }
  | { state: "online"; relay: number }
  | { state: "offline"; reason: string; retryInMs: number }
  /** Terminal: credential revoked/unknown or relay versions incompatible. Do not retry. */
  | { state: "stopped"; reason: "revoked" | "incompatible" | "shutdown" };

export interface ConnectorOptions {
  hubUrl: string;
  /** Per-Core device credential issued by pairing. Never the local Core token. */
  credential: string;
  /** The only endpoint ever dialed upstream. */
  localCoreUrl: string;
  /** Local Core session token; injected into the local handshake only. */
  localToken?: string;
  connectorVersion?: string;
  allowInsecureHub?: boolean;
  onStatus?: (status: ConnectorStatus) => void;
  /** Content-free diagnostics only. */
  onDiagnostic?: (message: string) => void;
  random?: () => number;
  backoff?: { initialMs: number; maxMs: number };
  helloTimeoutMs?: number;
}

interface LocalChannel {
  socket: WebSocket;
  generation: number;
}

/**
 * Outbound relay connector. One hub connection multiplexes bounded channels;
 * each channel owns a separate local Core socket so Core's per-connection
 * root/task selection stays independent. Core keeps running when the hub link drops.
 */
export class CoreConnector {
  private readonly hubUrl: URL;
  private readonly localUrl: URL;
  private readonly backoff: { initialMs: number; maxMs: number };
  private hub?: WebSocket;
  private channels = new Map<string, LocalChannel>();
  private table?: ChannelTable;
  private limits: RelayLimits = DEFAULT_RELAY_LIMITS;
  private attempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastHubActivity = 0;
  private stopped = false;
  private ready = false;

  constructor(private readonly options: ConnectorOptions) {
    this.hubUrl = parseHubUrl(options.hubUrl, options.allowInsecureHub);
    this.localUrl = parseLocalCoreUrl(options.localCoreUrl);
    this.backoff = options.backoff ?? { initialMs: 500, maxMs: 30_000 };
    if (!options.credential) throw new Error("Connector credential is required");
  }

  start(): void {
    if (this.stopped) throw new Error("Connector was stopped");
    if (this.hub || this.retryTimer) return;
    this.connect();
  }

  /** Graceful shutdown: close channels and the hub link; never retries afterward. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.teardown(true);
    this.options.onStatus?.({ state: "stopped", reason: "shutdown" });
  }

  private diagnostic(message: string): void {
    this.options.onDiagnostic?.(message);
  }

  private connect(): void {
    this.options.onStatus?.({ state: "connecting" });
    const hub = new WebSocket(this.hubUrl, { maxPayload: this.limits.maxFrameBytes * 2, handshakeTimeout: 15_000 });
    this.hub = hub;
    this.ready = false;
    let terminal: "revoked" | "incompatible" | undefined;
    const helloTimer = setTimeout(() => hub.terminate(), this.options.helloTimeoutMs ?? 15_000);

    hub.on("open", () => {
      this.lastHubActivity = Date.now();
      this.sendHub({ type: "hello", relay: { ...RELAY_WIRE_RANGE }, credential: this.options.credential, connectorVersion: this.options.connectorVersion ?? "0.1.0" });
    });
    hub.on("message", (data, isBinary) => {
      this.lastHubActivity = Date.now();
      if (isBinary) { this.hubError("malformed"); return; }
      const parsed = parseRelayFrame(data.toString(), this.limits.maxFrameBytes);
      if (!parsed.ok) { this.hubError(parsed.code); return; }
      const frame = parsed.frame;
      if (!this.ready) {
        if (frame.type === "hello.ok") {
          clearTimeout(helloTimer);
          this.ready = true;
          this.limits = frame.limits;
          this.table = new ChannelTable(frame.limits);
          this.attempt = 0;
          this.startHeartbeat(hub);
          this.options.onStatus?.({ state: "online", relay: frame.relay });
        } else if (frame.type === "error") {
          if (frame.code === "unauthenticated" || frame.code === "revoked" || frame.code === "unauthorized") terminal = "revoked";
          else if (frame.code === "incompatible") terminal = "incompatible";
          hub.close();
        } else {
          this.hubError("unauthenticated");
          hub.close();
        }
        return;
      }
      this.handleFrame(frame);
    });
    hub.on("close", () => {
      clearTimeout(helloTimer);
      if (this.hub !== hub) return;
      this.teardown(false);
      if (this.stopped) return;
      if (terminal) {
        this.stopped = true;
        this.options.onStatus?.({ state: "stopped", reason: terminal });
        return;
      }
      this.scheduleReconnect("hub connection closed");
    });
    hub.on("error", () => this.diagnostic("hub socket error"));
  }

  private scheduleReconnect(reason: string): void {
    const window = Math.min(this.backoff.maxMs, this.backoff.initialMs * 2 ** Math.min(this.attempt, 16));
    this.attempt += 1;
    const random = this.options.random ?? Math.random;
    const retryInMs = Math.round(window / 2 + random() * (window / 2));
    this.options.onStatus?.({ state: "offline", reason, retryInMs });
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; if (!this.stopped) this.connect(); }, retryInMs);
  }

  private startHeartbeat(hub: WebSocket): void {
    clearInterval(this.heartbeat);
    const interval = this.limits.heartbeatIntervalMs;
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastHubActivity > interval * 2.5) { this.diagnostic("hub heartbeat timeout"); hub.terminate(); return; }
      this.sendHub({ type: "ping" });
    }, interval);
  }

  /** Drop every channel and the hub socket. Local Core sockets close; Core work continues. */
  private teardown(closeHub: boolean): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const channel of this.channels.values()) channel.socket.close(1001, "relay closed");
    this.channels.clear();
    this.table?.clear();
    this.ready = false;
    const hub = this.hub;
    this.hub = undefined;
    if (closeHub && hub) hub.close(1001, "connector stopping");
  }

  private sendHub(frame: RelayFrame): void {
    if (this.hub?.readyState === WebSocket.OPEN) this.hub.send(serializeRelayFrame(frame));
  }

  private hubError(code: RelayErrorCode, channel?: string, generation?: number): void {
    this.sendHub({ type: "error", code, ...(channel !== undefined ? { channel } : {}), ...(generation !== undefined ? { generation } : {}) });
  }

  private handleFrame(frame: RelayFrame): void {
    const table = this.table!;
    switch (frame.type) {
      case "ping": this.sendHub({ type: "pong" }); return;
      case "pong": return;
      case "error": this.diagnostic(`hub error ${frame.code}`); return;
      case "channel.open": {
        const check = table.open(frame.channel, frame.generation);
        if (!check.ok) { this.hubError(check.code, frame.channel, frame.generation); return; }
        this.openLocal(frame.channel, frame.generation);
        return;
      }
      case "channel.data": {
        const check = table.data(frame.channel, frame.generation);
        if (!check.ok) {
          this.hubError(check.code, frame.channel, frame.generation);
          if (check.code === "quota") this.closeChannel(frame.channel, frame.generation, "quota");
          return;
        }
        const channel = this.channels.get(frame.channel);
        if (!channel || channel.socket.readyState !== WebSocket.OPEN) return;
        if (channel.socket.bufferedAmount > this.limits.maxQueuedBytesPerChannel) {
          this.closeChannel(frame.channel, frame.generation, "quota");
          return;
        }
        channel.socket.send(this.injectCredential(frame.payload));
        return;
      }
      case "channel.close": {
        const channel = this.channels.get(frame.channel);
        const check = table.close(frame.channel, frame.generation);
        if (!check.ok) { this.hubError(check.code, frame.channel, frame.generation); return; }
        this.channels.delete(frame.channel);
        channel?.socket.close(1000, "channel closed");
        return;
      }
      default:
        this.hubError("malformed");
    }
  }

  /** The browser never holds the local token: overwrite whatever its handshake carried. */
  private injectCredential(payload: unknown): string {
    if (typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "protocol.handshake") {
      const request = payload as { payload?: Record<string, unknown> };
      const inner = { ...(typeof request.payload === "object" && request.payload ? request.payload : {}) };
      delete inner.token;
      if (this.options.localToken) inner.token = this.options.localToken;
      return JSON.stringify({ ...payload, payload: inner });
    }
    return JSON.stringify(payload);
  }

  private openLocal(channel: string, generation: number): void {
    const socket = new WebSocket(this.localUrl, { maxPayload: this.limits.maxFrameBytes * 8 });
    this.channels.set(channel, { socket, generation });
    socket.on("open", () => {
      const result = this.table?.ready(channel, generation);
      if (!result?.ok) { socket.close(); return; }
      this.sendHub({ type: "channel.ready", channel, generation });
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary || this.hub?.readyState !== WebSocket.OPEN) return;
      const text = data.toString();
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { this.diagnostic("local Core sent non-JSON"); return; }
      if (this.hub.bufferedAmount > this.limits.maxQueuedBytesPerChannel * this.limits.maxChannels) {
        this.closeChannel(channel, generation, "quota");
        return;
      }
      this.sendHub({ type: "channel.data", channel, generation, payload });
    });
    socket.on("close", () => {
      if (this.channels.get(channel)?.socket !== socket) return;
      this.channels.delete(channel);
      if (this.table?.close(channel, generation).ok) this.sendHub({ type: "channel.close", channel, generation, reason: "normal" });
    });
    socket.on("error", () => {
      this.diagnostic("local Core socket error");
      if (this.channels.get(channel)?.socket === socket && this.table?.close(channel, generation).ok) {
        this.channels.delete(channel);
        this.sendHub({ type: "channel.close", channel, generation, reason: "upstream-failed" });
      }
    });
  }

  private closeChannel(channel: string, generation: number, reason: RelayErrorCode): void {
    const entry = this.channels.get(channel);
    this.channels.delete(channel);
    this.table?.close(channel, generation);
    entry?.socket.close(1013, "channel over budget");
    this.sendHub({ type: "channel.close", channel, generation, reason });
  }
}
