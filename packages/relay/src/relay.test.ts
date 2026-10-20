import { describe, expect, it } from "vitest";
import {
  ChannelTable,
  DEFAULT_RELAY_LIMITS,
  negotiateRelayVersion,
  parsePairingConfirmRequest,
  parsePairingConfirmResponse,
  parsePairingPollResponse,
  parsePairingStartRequest,
  parsePairingStartResponse,
  parseRelayFrame,
} from "./index.js";
import { TestRelay } from "./testing.js";

const hello = (credential = "good", relay = { minimum: 1, maximum: 1 }) =>
  JSON.stringify({ type: "hello", relay, credential, connectorVersion: "0.1.0" });

describe("relay frame validation", () => {
  it("accepts valid frames and rejects unknown fields, bad ids and oversize input", () => {
    expect(
      parseRelayFrame(JSON.stringify({ type: "channel.data", channel: "a1", generation: 1, payload: { type: "x" } }))
        .ok,
    ).toBe(true);
    expect(parseRelayFrame(JSON.stringify({ type: "channel.open", channel: "a1", generation: 1, extra: 1 })).ok).toBe(
      false,
    );
    expect(parseRelayFrame(JSON.stringify({ type: "channel.open", channel: "../x", generation: 1 })).ok).toBe(false);
    expect(parseRelayFrame(JSON.stringify({ type: "channel.open", channel: "a", generation: -1 })).ok).toBe(false);
    expect(parseRelayFrame("not json").ok).toBe(false);
    expect(parseRelayFrame("[]").ok).toBe(false);
    const big = parseRelayFrame(
      JSON.stringify({ type: "channel.data", channel: "a", generation: 0, payload: "x".repeat(100) }),
      50,
    );
    expect(big).toMatchObject({ ok: false, code: "too-large" });
  });

  it("negotiates independent wire versions", () => {
    expect(negotiateRelayVersion({ minimum: 1, maximum: 3 })).toBe(1);
    expect(negotiateRelayVersion({ minimum: 2, maximum: 3 })).toBeUndefined();
    expect(negotiateRelayVersion({ minimum: 3, maximum: 1 })).toBeUndefined();
  });
});

describe("channel table", () => {
  it("rejects data before ready, unknown channels and stale generations", () => {
    const table = new ChannelTable(DEFAULT_RELAY_LIMITS);
    expect(table.data("a", 1)).toEqual({ ok: false, code: "unknown-channel" });
    table.open("a", 2);
    expect(table.data("a", 2)).toEqual({ ok: false, code: "not-ready" });
    expect(table.ready("a", 1)).toEqual({ ok: false, code: "stale-generation" });
    expect(table.ready("a", 2).ok).toBe(true);
    expect(table.data("a", 1)).toEqual({ ok: false, code: "stale-generation" });
    expect(table.data("a", 2).ok).toBe(true);
    expect(table.close("a", 2).ok).toBe(true);
    expect(table.data("a", 2)).toEqual({ ok: false, code: "unknown-channel" });
  });

  it("enforces channel count and per-channel rate limits", () => {
    let time = 0;
    const table = new ChannelTable({ ...DEFAULT_RELAY_LIMITS, maxChannels: 1, maxFramesPerSecond: 2 }, () => time);
    expect(table.open("a", 1).ok).toBe(true);
    expect(table.open("b", 1)).toEqual({ ok: false, code: "channel-limit" });
    table.ready("a", 1);
    expect(table.data("a", 1).ok).toBe(true);
    expect(table.data("a", 1).ok).toBe(true);
    expect(table.data("a", 1)).toEqual({ ok: false, code: "quota" });
    time = 1000;
    expect(table.data("a", 1).ok).toBe(true);
  });
});

describe("test relay fixture", () => {
  it("requires authentication and a compatible version", () => {
    const relay = new TestRelay({ credentials: ["good"] });
    expect(JSON.parse(relay.receive(JSON.stringify({ type: "ping" }))[0]!)).toMatchObject({ code: "unauthenticated" });
    expect(JSON.parse(relay.receive(hello("bad"))[0]!)).toMatchObject({ code: "unauthenticated" });
    expect(JSON.parse(relay.receive(hello("good", { minimum: 2, maximum: 2 }))[0]!)).toMatchObject({
      code: "incompatible",
    });
    expect(JSON.parse(relay.receive(hello())[0]!)).toMatchObject({ type: "hello.ok", relay: 1 });
  });

  it("routes channel data only after ready and drops old generations after reconnect", () => {
    const relay = new TestRelay({ credentials: ["good"] });
    relay.receive(hello());
    const { channel } = relay.openChannel();
    const early = relay.receive(JSON.stringify({ type: "channel.data", channel, generation: 1, payload: {} }));
    expect(JSON.parse(early[0]!)).toMatchObject({ code: "not-ready" });
    relay.receive(JSON.stringify({ type: "channel.ready", channel, generation: 1 }));
    relay.receive(JSON.stringify({ type: "channel.data", channel, generation: 1, payload: { type: "hello" } }));
    expect(relay.received).toEqual([{ channel, payload: { type: "hello" } }]);

    relay.dropConnection();
    relay.receive(hello());
    const stale = relay.receive(JSON.stringify({ type: "channel.data", channel, generation: 1, payload: {} }));
    expect(JSON.parse(stale[0]!)).toMatchObject({ code: "unknown-channel" });
  });
});

describe("strict contracts", () => {
  const ok = { minimum: 1, maximum: 1 };
  it("rejects bad ranges, limits and versions", () => {
    for (const relay of [
      { minimum: 0, maximum: 1 },
      { minimum: 1.5, maximum: 2 },
      { minimum: -1, maximum: 1 },
      { minimum: 1, maximum: 1, extra: 1 },
      { minimum: Number.NaN, maximum: 1 },
    ]) {
      expect(parseRelayFrame(JSON.stringify({ type: "hello", relay, credential: "c", connectorVersion: "1" })).ok).toBe(
        false,
      );
    }
    expect(negotiateRelayVersion({ minimum: Number.NaN, maximum: 1 })).toBeUndefined();
    expect(negotiateRelayVersion({ minimum: 0, maximum: 1 })).toBeUndefined();
    expect(negotiateRelayVersion(ok)).toBe(1);
    const limits = { ...DEFAULT_RELAY_LIMITS };
    expect(parseRelayFrame(JSON.stringify({ type: "hello.ok", relay: 1, limits })).ok).toBe(true);
    expect(
      parseRelayFrame(JSON.stringify({ type: "hello.ok", relay: 1, limits: { ...limits, maxChannels: 0 } })).ok,
    ).toBe(false);
    expect(parseRelayFrame(JSON.stringify({ type: "hello.ok", relay: 1, limits: { ...limits, extra: 1 } })).ok).toBe(
      false,
    );
    expect(parseRelayFrame(JSON.stringify({ type: "hello.ok", relay: 1, limits: { maxChannels: 1 } })).ok).toBe(false);
  });

  it("validates pairing requests and responses at runtime", () => {
    const request = {
      code: "ABCD-1234",
      deviceId: "device-0001",
      deviceName: "Laptop",
      connectorVersion: "0.1.0",
      relay: ok,
    };
    expect(parsePairingStartRequest(request).ok).toBe(true);
    expect(parsePairingStartRequest({ ...request, extra: 1 }).ok).toBe(false);
    expect(parsePairingStartRequest({ ...request, code: "x" }).ok).toBe(false);
    expect(parsePairingStartRequest({ ...request, deviceId: "short" }).ok).toBe(false);
    expect(
      parsePairingStartResponse({ status: "pending", pairingId: "pairing-0001", expiresAt: "2026-01-01T00:00:00Z" }).ok,
    ).toBe(true);
    expect(parsePairingStartResponse({ status: "pending", pairingId: "pairing-0001", expiresAt: "soon" }).ok).toBe(
      false,
    );
    expect(parsePairingStartResponse({ status: "rejected", reason: "rate-limited" }).ok).toBe(true);
    expect(parsePairingStartResponse({ status: "rejected", reason: "other" }).ok).toBe(false);
    expect(parsePairingPollResponse({ status: "pending" }).ok).toBe(true);
    expect(
      parsePairingPollResponse({ status: "pending", claimedBy: { name: "Ann", email: "ann@example.com" } }).ok,
    ).toBe(true);
    expect(parsePairingPollResponse({ status: "pending", claimedBy: { name: "Ann" } }).ok).toBe(false);
    expect(
      parsePairingPollResponse({ status: "pending", claimedBy: { name: "Ann", email: "a@b.c", extra: 1 } }).ok,
    ).toBe(false);
    // A poll must never be able to deliver a credential.
    expect(parsePairingPollResponse({ status: "confirmed", coreId: "core-00001", credential: "secret" }).ok).toBe(
      false,
    );
    expect(parsePairingPollResponse({ status: "pending", credential: "x" }).ok).toBe(false);
    expect(parsePairingConfirmRequest({ accept: true }).ok).toBe(true);
    expect(parsePairingConfirmRequest({ accept: "yes" }).ok).toBe(false);
    expect(parsePairingConfirmResponse({ status: "confirmed", coreId: "core-00001", credential: "secret" }).ok).toBe(
      true,
    );
    expect(parsePairingConfirmResponse({ status: "confirmed", coreId: "core-00001" }).ok).toBe(false);
    expect(parsePairingConfirmResponse({ status: "rejected", reason: "denied" }).ok).toBe(true);
  });

  it("fixture refuses impossible hub traffic", () => {
    const relay = new TestRelay({ credentials: ["good"], limits: { maxChannels: 1 } });
    expect(() => relay.openChannel()).toThrow(/not authenticated/);
    relay.receive(hello());
    const { channel } = relay.openChannel();
    expect(() => relay.openChannel()).toThrow(/channel-limit/);
    expect(() => relay.sendData(channel, {})).toThrow(/not-ready/);
    expect(() => relay.sendData("nope", {})).toThrow(/unknown-channel/);
    relay.receive(JSON.stringify({ type: "channel.ready", channel, generation: 1 }));
    expect(() => relay.sendData(channel, { type: "x" })).not.toThrow();
  });
});
