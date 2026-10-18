/**
 * Connector-facing relay envelope and pairing contracts.
 *
 * The relay wire version is independent of the Core protocol version: the
 * envelope only carries Core messages opaquely in `channel.data`.
 */

export const RELAY_WIRE_RANGE = { minimum: 1, maximum: 1 } as const;

export interface RelayLimits {
  /** Largest accepted serialized frame, in UTF-8 bytes. */
  maxFrameBytes: number;
  /** Concurrent channels per connector. */
  maxChannels: number;
  /** Bytes queued for one channel before it is closed as too slow. */
  maxQueuedBytesPerChannel: number;
  /** Frames accepted per channel per second. */
  maxFramesPerSecond: number;
  heartbeatIntervalMs: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxFrameBytes: 1024 * 1024,
  maxChannels: 16,
  maxQueuedBytesPerChannel: 4 * 1024 * 1024,
  maxFramesPerSecond: 200,
  heartbeatIntervalMs: 20_000
};

export type RelayErrorCode =
  | "unauthenticated"
  | "unauthorized"
  | "incompatible"
  | "malformed"
  | "too-large"
  | "unknown-channel"
  | "stale-generation"
  | "not-ready"
  | "channel-limit"
  | "quota"
  | "upstream-failed"
  | "revoked";

export interface VersionRange {
  minimum: number;
  maximum: number;
}

/** Connector -> hub, first frame after the WSS upgrade. The credential is the per-Core device credential, never the local Core token. */
export interface ConnectorHelloFrame {
  type: "hello";
  relay: VersionRange;
  credential: string;
  connectorVersion: string;
}

/** Hub -> connector, negotiated version and limits. */
export interface HelloOkFrame {
  type: "hello.ok";
  relay: number;
  limits: RelayLimits;
}

/** Hub -> connector. `channel` is scoped to this connector connection; `generation` is fresh per connection. */
export interface ChannelOpenFrame {
  type: "channel.open";
  channel: string;
  generation: number;
}

/** Connector -> hub after the local Core socket is open and authenticated. */
export interface ChannelReadyFrame {
  type: "channel.ready";
  channel: string;
  generation: number;
}

/** Either direction. `payload` is one existing Core protocol message (JSON, structurally encoded). */
export interface ChannelDataFrame {
  type: "channel.data";
  channel: string;
  generation: number;
  payload: unknown;
}

export interface ChannelCloseFrame {
  type: "channel.close";
  channel: string;
  generation: number;
  reason?: RelayErrorCode | "normal";
}

export interface RelayErrorFrame {
  type: "error";
  code: RelayErrorCode;
  channel?: string;
  generation?: number;
  /** Content-free diagnostic; must never contain credentials or workspace text. */
  message?: string;
}

export interface PingFrame {
  type: "ping";
}
export interface PongFrame {
  type: "pong";
}

export type RelayFrame =
  | ConnectorHelloFrame
  | HelloOkFrame
  | ChannelOpenFrame
  | ChannelReadyFrame
  | ChannelDataFrame
  | ChannelCloseFrame
  | RelayErrorFrame
  | PingFrame
  | PongFrame;

export const relayFrameTypes = [
  "hello",
  "hello.ok",
  "channel.open",
  "channel.ready",
  "channel.data",
  "channel.close",
  "error",
  "ping",
  "pong"
] as const;

export type RelayParseResult =
  | { ok: true; frame: RelayFrame }
  | { ok: false; code: "malformed" | "too-large"; reason: string };

const errorCodes: ReadonlySet<string> = new Set<RelayErrorCode>([
  "unauthenticated",
  "unauthorized",
  "incompatible",
  "malformed",
  "too-large",
  "unknown-channel",
  "stale-generation",
  "not-ready",
  "channel-limit",
  "quota",
  "upstream-failed",
  "revoked"
]);

const channelIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

export function isVersionRange(value: unknown): value is VersionRange {
  return isRecord(value) && hasOnlyKeys(value, ["minimum", "maximum"]) && isPositive(value.minimum) && isPositive(value.maximum) && value.minimum <= value.maximum;
}

const limitKeys = ["maxFrameBytes", "maxChannels", "maxQueuedBytesPerChannel", "maxFramesPerSecond", "heartbeatIntervalMs"] as const;

export function isRelayLimits(value: unknown): value is RelayLimits {
  return isRecord(value) && hasOnlyKeys(value, limitKeys) && limitKeys.every((key) => isPositive(value[key]));
}

function bad(reason: string): RelayParseResult {
  return { ok: false, code: "malformed", reason };
}

/**
 * Parse and validate one text frame from an untrusted peer. Never throws.
 * Unknown fields are rejected so contract drift is caught early; additive
 * changes require a new relay wire version.
 */
export function parseRelayFrame(text: string, maxFrameBytes = DEFAULT_RELAY_LIMITS.maxFrameBytes): RelayParseResult {
  if (text.length > maxFrameBytes || new TextEncoder().encode(text).length > maxFrameBytes) {
    return { ok: false, code: "too-large", reason: "frame exceeds size limit" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return bad("not JSON");
  }
  if (!isRecord(value) || typeof value.type !== "string") return bad("missing frame type");

  const allowed = (...keys: string[]) => Object.keys(value as object).every((key) => key === "type" || keys.includes(key));
  const channel = value.channel;
  const channelOk = typeof channel === "string" && channelIdPattern.test(channel);

  switch (value.type) {
    case "hello":
      if (!allowed("relay", "credential", "connectorVersion")) return bad("unknown field");
      if (!isVersionRange(value.relay)) return bad("invalid relay range");
      if (typeof value.credential !== "string" || value.credential.length < 1 || value.credential.length > 512) return bad("invalid credential");
      if (typeof value.connectorVersion !== "string" || value.connectorVersion.length > 64) return bad("invalid connector version");
      return { ok: true, frame: value as unknown as ConnectorHelloFrame };
    case "hello.ok":
      if (!allowed("relay", "limits")) return bad("unknown field");
      if (!isPositive(value.relay) || !isRelayLimits(value.limits)) return bad("invalid hello.ok");
      return { ok: true, frame: value as unknown as HelloOkFrame };
    case "channel.open":
    case "channel.ready":
      if (!allowed("channel", "generation")) return bad("unknown field");
      if (!channelOk || !isCount(value.generation)) return bad("invalid channel");
      return { ok: true, frame: value as unknown as ChannelOpenFrame | ChannelReadyFrame };
    case "channel.data":
      if (!allowed("channel", "generation", "payload")) return bad("unknown field");
      if (!channelOk || !isCount(value.generation)) return bad("invalid channel");
      if (!("payload" in value) || value.payload === undefined) return bad("missing payload");
      return { ok: true, frame: value as unknown as ChannelDataFrame };
    case "channel.close":
      if (!allowed("channel", "generation", "reason")) return bad("unknown field");
      if (!channelOk || !isCount(value.generation)) return bad("invalid channel");
      if (value.reason !== undefined && value.reason !== "normal" && !(typeof value.reason === "string" && errorCodes.has(value.reason))) {
        return bad("invalid close reason");
      }
      return { ok: true, frame: value as unknown as ChannelCloseFrame };
    case "error":
      if (!allowed("code", "channel", "generation", "message")) return bad("unknown field");
      if (typeof value.code !== "string" || !errorCodes.has(value.code)) return bad("invalid error code");
      if (value.channel !== undefined && !channelOk) return bad("invalid channel");
      if (value.generation !== undefined && !isCount(value.generation)) return bad("invalid generation");
      if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 200)) return bad("invalid message");
      return { ok: true, frame: value as unknown as RelayErrorFrame };
    case "ping":
    case "pong":
      if (!allowed()) return bad("unknown field");
      return { ok: true, frame: value as unknown as PingFrame | PongFrame };
    default:
      return bad("unknown frame type");
  }
}

export function serializeRelayFrame(frame: RelayFrame): string {
  return JSON.stringify(frame);
}

/** Highest wire version supported by both sides, or undefined when ranges do not overlap. */
export function negotiateRelayVersion(peer: VersionRange, local: VersionRange = RELAY_WIRE_RANGE): number | undefined {
  if (!isVersionRange(peer) || !isVersionRange(local)) return undefined;
  const version = Math.min(peer.maximum, local.maximum);
  return version >= Math.max(peer.minimum, local.minimum) ? version : undefined;
}

/** Pairing exchange. Transport (HTTPS) is hub-defined; these shapes are the connector-facing contract. */
export interface PairingStartRequest {
  /** Short single-use code displayed locally by Core and entered by the signed-in user. */
  code: string;
  /** Random per-installation identifier the issued credential is bound to. */
  deviceId: string;
  deviceName: string;
  connectorVersion: string;
  relay: VersionRange;
}

export type PairingStartResponse =
  | { status: "pending"; pairingId: string; expiresAt: string }
  | { status: "rejected"; reason: "expired" | "used" | "rate-limited" | "invalid" };

export interface PairingClaimant {
  name: string;
  email: string;
}

/** Poll never carries a credential: it only reports whether a signed-in user has claimed the code. */
export type PairingPollResponse =
  | { status: "pending"; claimedBy?: PairingClaimant }
  | { status: "rejected"; reason: "expired" | "denied" | "invalid" };

/** Sent by the connector after the local user reviewed the claimant. */
export interface PairingConfirmRequest {
  accept: boolean;
}

/** The credential is returned exactly once, only in answer to an accepted confirm. */
export type PairingConfirmResponse =
  | { status: "confirmed"; coreId: string; credential: string }
  | { status: "rejected"; reason: "expired" | "denied" | "invalid" };

export type ContractResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const idPattern = /^[A-Za-z0-9_-]{8,128}$/;
const codePattern = /^[A-Za-z0-9-]{4,32}$/;

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function checked<T>(value: unknown, keys: readonly string[], valid: (record: Record<string, unknown>) => boolean): ContractResult<T> {
  if (!isRecord(value)) return { ok: false, reason: "not an object" };
  if (!Object.keys(value).every((key) => keys.includes(key))) return { ok: false, reason: "unknown field" };
  return valid(value) ? { ok: true, value: value as T } : { ok: false, reason: "invalid field" };
}

export function parsePairingStartRequest(value: unknown): ContractResult<PairingStartRequest> {
  return checked(value, ["code", "deviceId", "deviceName", "connectorVersion", "relay"], (v) =>
    typeof v.code === "string" && codePattern.test(v.code) &&
    typeof v.deviceId === "string" && idPattern.test(v.deviceId) &&
    text(v.deviceName, 80) && text(v.connectorVersion, 64) && isVersionRange(v.relay)
  );
}

export function parsePairingStartResponse(value: unknown): ContractResult<PairingStartResponse> {
  if (isRecord(value) && value.status === "rejected") {
    return checked(value, ["status", "reason"], (v) => ["expired", "used", "rate-limited", "invalid"].includes(v.reason as string));
  }
  return checked(value, ["status", "pairingId", "expiresAt"], (v) =>
    v.status === "pending" && typeof v.pairingId === "string" && idPattern.test(v.pairingId) && isIsoTime(v.expiresAt)
  );
}

export function parsePairingPollResponse(value: unknown): ContractResult<PairingPollResponse> {
  if (isRecord(value) && value.status === "pending") {
    const result = checked<PairingPollResponse>(value, ["status", "claimedBy"], (v) => {
      if (v.claimedBy === undefined) return true;
      const claimant = v.claimedBy;
      return isRecord(claimant) && hasOnlyKeys(claimant, ["name", "email"]) && text(claimant.name, 120) && text(claimant.email, 254);
    });
    return result;
  }
  return checked(value, ["status", "reason"], (v) => v.status === "rejected" && ["expired", "denied", "invalid"].includes(v.reason as string));
}

export function parsePairingConfirmRequest(value: unknown): ContractResult<PairingConfirmRequest> {
  return checked(value, ["accept"], (v) => typeof v.accept === "boolean");
}

export function parsePairingConfirmResponse(value: unknown): ContractResult<PairingConfirmResponse> {
  if (isRecord(value) && value.status === "rejected") {
    return checked(value, ["status", "reason"], (v) => ["expired", "denied", "invalid"].includes(v.reason as string));
  }
  return checked(value, ["status", "coreId", "credential"], (v) =>
    v.status === "confirmed" && typeof v.coreId === "string" && idPattern.test(v.coreId) && text(v.credential, 512)
  );
}

export * from "./channels.js";
