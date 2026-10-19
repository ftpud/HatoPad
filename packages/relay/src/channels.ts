import type { RelayErrorCode, RelayFrame, RelayLimits } from "./index.js";

type ChannelState = "opening" | "ready";

interface Channel {
  generation: number;
  state: ChannelState;
  windowStart: number;
  framesInWindow: number;
}

export type ChannelCheck = { ok: true } | { ok: false; code: RelayErrorCode };

/**
 * Per-connection channel table shared by hub and connector implementations.
 * Enforces: data only after ready, no unknown channels, stale generations
 * discarded, channel-count and per-channel rate limits.
 */
export class ChannelTable {
  private readonly channels = new Map<string, Channel>();

  constructor(
    private readonly limits: RelayLimits,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.channels.size;
  }

  open(channel: string, generation: number): ChannelCheck {
    if (this.channels.has(channel)) return { ok: false, code: "malformed" };
    if (this.channels.size >= this.limits.maxChannels) return { ok: false, code: "channel-limit" };
    this.channels.set(channel, { generation, state: "opening", windowStart: this.now(), framesInWindow: 0 });
    return { ok: true };
  }

  ready(channel: string, generation: number): ChannelCheck {
    const entry = this.channels.get(channel);
    if (!entry) return { ok: false, code: "unknown-channel" };
    if (entry.generation !== generation) return { ok: false, code: "stale-generation" };
    if (entry.state === "ready") return { ok: false, code: "malformed" };
    entry.state = "ready";
    return { ok: true };
  }

  data(channel: string, generation: number): ChannelCheck {
    const entry = this.channels.get(channel);
    if (!entry) return { ok: false, code: "unknown-channel" };
    if (entry.generation !== generation) return { ok: false, code: "stale-generation" };
    if (entry.state !== "ready") return { ok: false, code: "not-ready" };
    const time = this.now();
    if (time - entry.windowStart >= 1000) {
      entry.windowStart = time;
      entry.framesInWindow = 0;
    }
    entry.framesInWindow += 1;
    if (entry.framesInWindow > this.limits.maxFramesPerSecond) return { ok: false, code: "quota" };
    return { ok: true };
  }

  close(channel: string, generation: number): ChannelCheck {
    const entry = this.channels.get(channel);
    if (!entry) return { ok: false, code: "unknown-channel" };
    if (entry.generation !== generation) return { ok: false, code: "stale-generation" };
    this.channels.delete(channel);
    return { ok: true };
  }

  /** Apply any frame to the table; frames without channel semantics are accepted. */
  accept(frame: RelayFrame): ChannelCheck {
    switch (frame.type) {
      case "channel.open":
        return this.open(frame.channel, frame.generation);
      case "channel.ready":
        return this.ready(frame.channel, frame.generation);
      case "channel.data":
        return this.data(frame.channel, frame.generation);
      case "channel.close":
        return this.close(frame.channel, frame.generation);
      default:
        return { ok: true };
    }
  }

  clear(): void {
    this.channels.clear();
  }
}
