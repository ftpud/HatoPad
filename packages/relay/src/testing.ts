import { ChannelTable } from "./channels.js";
import {
  DEFAULT_RELAY_LIMITS,
  negotiateRelayVersion,
  parseRelayFrame,
  serializeRelayFrame,
  type RelayFrame,
  type RelayLimits
} from "./index.js";

export interface TestRelayOptions {
  /** Credentials the fake hub accepts. */
  credentials: string[];
  limits?: Partial<RelayLimits>;
}

/**
 * Minimal in-memory hub for connector tests. It performs authentication,
 * version negotiation and strict channel validation, and has no accounts or
 * persistence; it is a contract fixture, not a production hub.
 */
export class TestRelay {
  readonly limits: RelayLimits;
  private readonly table: ChannelTable;
  private authenticated = false;
  private generation = 0;
  private nextChannel = 1;
  /** Frames the hub sent toward the connector. */
  readonly sent: RelayFrame[] = [];
  /** Data payloads received from the connector, per channel. */
  readonly received: { channel: string; payload: unknown }[] = [];

  constructor(private readonly options: TestRelayOptions) {
    this.limits = { ...DEFAULT_RELAY_LIMITS, ...options.limits };
    this.table = new ChannelTable(this.limits);
  }

  /** Feed one text frame from the connector; returns frames to send back as text. */
  receive(text: string): string[] {
    const parsed = parseRelayFrame(text, this.limits.maxFrameBytes);
    if (!parsed.ok) return this.reply({ type: "error", code: parsed.code });
    const frame = parsed.frame;

    if (!this.authenticated) {
      if (frame.type !== "hello") return this.reply({ type: "error", code: "unauthenticated" });
      if (!this.options.credentials.includes(frame.credential)) return this.reply({ type: "error", code: "unauthenticated" });
      const relay = negotiateRelayVersion(frame.relay);
      if (relay === undefined) return this.reply({ type: "error", code: "incompatible" });
      this.authenticated = true;
      this.generation += 1;
      return this.reply({ type: "hello.ok", relay, limits: this.limits });
    }

    switch (frame.type) {
      case "ping":
        return this.reply({ type: "pong" });
      case "channel.ready":
      case "channel.data":
      case "channel.close": {
        const check = this.table.accept(frame);
        if (!check.ok) return this.reply({ type: "error", code: check.code, channel: frame.channel, generation: frame.generation });
        if (frame.type === "channel.data") this.received.push({ channel: frame.channel, payload: frame.payload });
        return [];
      }
      default:
        return this.reply({ type: "error", code: "malformed" });
    }
  }

  /** Hub-initiated: open a channel on the current connector generation. */
  openChannel(): { channel: string; frame: string } {
    if (!this.authenticated) throw new Error("connector is not authenticated");
    const channel = `c${this.nextChannel++}`;
    const open: RelayFrame = { type: "channel.open", channel, generation: this.generation };
    const check = this.table.accept(open);
    if (!check.ok) throw new Error(`channel open rejected: ${check.code}`);
    this.sent.push(open);
    return { channel, frame: serializeRelayFrame(open) };
  }

  /** True once the connector has acknowledged the channel with channel.ready. */
  isChannelReady(channel: string): boolean {
    return this.table.data(channel, this.generation).ok;
  }

  /** Hub-initiated: send a Core message down a ready channel. */
  sendData(channel: string, payload: unknown): string {
    if (!this.authenticated) throw new Error("connector is not authenticated");
    const check = this.table.data(channel, this.generation);
    if (!check.ok) throw new Error(`channel data rejected: ${check.code}`);
    const frame: RelayFrame = { type: "channel.data", channel, generation: this.generation, payload };
    this.sent.push(frame);
    return serializeRelayFrame(frame);
  }

  /** Simulate a connector reconnect: all channels die and the generation advances. */
  dropConnection(): void {
    this.table.clear();
    this.authenticated = false;
  }

  private reply(frame: RelayFrame): string[] {
    this.sent.push(frame);
    return [serializeRelayFrame(frame)];
  }
}
