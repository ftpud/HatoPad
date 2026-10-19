import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  RELAY_WIRE_RANGE,
  parsePairingConfirmResponse,
  parsePairingPollResponse,
  parsePairingStartResponse,
  type PairingClaimant,
  type PairingStartRequest,
} from "@hatopad/relay";

export interface StoredPairing {
  hubUrl: string;
  coreId: string;
  deviceId: string;
  /** Per-Core device credential. Keep out of logs; this is not the local Core token. */
  credential: string;
}

const posix = process.platform !== "win32";

/** The credential file must be a private regular file we own; anything else may expose or substitute the credential. */
async function assertPrivateFile(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Pairing store must be a regular file");
  if (posix && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())))
    throw new Error("Pairing store must be private (0600) and owned by this user");
}

async function assertSafeDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Pairing store directory must be a real directory");
  if (posix && ((info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())))
    throw new Error("Pairing store directory must be owned by this user and not writable by others");
}

/** File-backed credential store: created directories 0700, file 0600, exclusive temp file, atomic replace. */
export class PairingStore {
  constructor(private readonly path: string) {}

  async load(): Promise<StoredPairing | undefined> {
    let text: string;
    try {
      await assertPrivateFile(this.path);
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error instanceof Error && error.message.startsWith("Pairing store")
        ? error
        : new Error("Pairing store is unreadable");
    }
    try {
      const value = JSON.parse(text) as Partial<StoredPairing>;
      if (
        typeof value.hubUrl === "string" &&
        typeof value.coreId === "string" &&
        typeof value.deviceId === "string" &&
        typeof value.credential === "string"
      )
        return value as StoredPairing;
    } catch {
      /* fall through */
    }
    return undefined;
  }

  async save(pairing: StoredPairing): Promise<void> {
    const directory = dirname(this.path);
    const created = await mkdir(directory, { recursive: true, mode: 0o700 });
    if (created !== undefined && posix) await chmod(created, 0o700);
    await assertSafeDirectory(directory);
    const temporary = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(pairing));
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    await handle.close();
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  /** Unpair locally. The hub-side credential must also be revoked by its owner. */
  async clear(): Promise<void> {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export interface PairOptions {
  /** HTTPS origin of the hub, e.g. https://hub.example. */
  hubOrigin: string;
  deviceName: string;
  connectorVersion?: string;
  store: PairingStore;
  /** Show the single-use code to the person at this machine. */
  showCode(code: string, expiresAt: string): void;
  /** Local prompt naming the signed-in user who claimed the code; resolve false to refuse. The hub issues nothing until this accepts. */
  confirmLocally(claimant: PairingClaimant): Promise<boolean>;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  /** Per-request network timeout; defaults to 15 s so a silent hub cannot hang pairing. */
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}

export type PairResult = { status: "paired"; pairing: StoredPairing } | { status: "failed"; reason: string };

const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 8 characters from an unambiguous alphabet, grouped for reading aloud. */
export function generatePairingCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function endpoint(origin: string, path: string): URL {
  const url = new URL(path, origin);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("Hub origin must use https://");
  return url;
}

/**
 * Pairing with local confirmation BEFORE issuance. The connector holds a random
 * proof (sent as a bearer token on every call) that only this process knows; the
 * hub never returns a credential to a poll. Only after a signed-in user claims
 * the displayed code and the person at this machine accepts the named claimant
 * does the confirm call return the credential, exactly once. A lost confirm
 * response is never replayed: start a fresh pairing instead.
 */
export async function pairDevice(options: PairOptions): Promise<PairResult> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const proof = randomBytes(32).toString("base64url");
  const deviceId = randomBytes(24).toString("base64url");
  const code = generatePairingCode();
  const body: PairingStartRequest = {
    code,
    deviceId,
    deviceName: options.deviceName,
    connectorVersion: options.connectorVersion ?? "0.1.0",
    relay: { ...RELAY_WIRE_RANGE },
  };
  const call = async (method: "GET" | "POST", url: URL, payload?: unknown) => {
    const response = await doFetch(url, {
      method,
      headers: {
        authorization: `Bearer ${proof}`,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.requestTimeoutMs ?? 15_000)])
        : AbortSignal.timeout(options.requestTimeoutMs ?? 15_000),
      redirect: "error",
    });
    if (response.status === 429) return { rateLimited: true as const };
    if (!response.ok) throw new Error(`Hub rejected the request (HTTP ${response.status})`);
    return { json: (await response.json()) as unknown };
  };
  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, options.pollIntervalMs ?? 2000);
      function done() {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", done);
        resolve();
      }
      options.signal?.addEventListener("abort", done, { once: true });
    });

  try {
    const started = await call("POST", endpoint(options.hubOrigin, "/api/pairing/start"), body);
    if ("rateLimited" in started) return { status: "failed", reason: "rate-limited" };
    const start = parsePairingStartResponse(started.json);
    if (!start.ok) return { status: "failed", reason: "invalid hub response" };
    if (start.value.status === "rejected") return { status: "failed", reason: start.value.reason };
    const { pairingId, expiresAt } = start.value;
    options.showCode(code, expiresAt);

    const pairingUrl = endpoint(options.hubOrigin, `/api/pairing/${encodeURIComponent(pairingId)}`);
    const deadline = Date.parse(expiresAt);
    let claimant: PairingClaimant | undefined;
    while (!claimant) {
      if (options.signal?.aborted) return { status: "failed", reason: "aborted" };
      if (now() >= deadline) return { status: "failed", reason: "expired" };
      const polled = await call("GET", pairingUrl);
      if (!("rateLimited" in polled)) {
        const poll = parsePairingPollResponse(polled.json);
        if (!poll.ok) return { status: "failed", reason: "invalid hub response" };
        if (poll.value.status === "rejected") return { status: "failed", reason: poll.value.reason };
        claimant = poll.value.claimedBy;
      }
      if (!claimant) await sleep();
    }

    const accept = await options.confirmLocally(claimant);
    const confirmed = await call("POST", new URL(`${pairingUrl.pathname}/confirm`, pairingUrl), { accept });
    if ("rateLimited" in confirmed) return { status: "failed", reason: "rate-limited" };
    if (!accept) return { status: "failed", reason: "declined locally" };
    const result = parsePairingConfirmResponse(confirmed.json);
    if (!result.ok) return { status: "failed", reason: "invalid hub response" };
    if (result.value.status === "rejected") return { status: "failed", reason: result.value.reason };
    const pairing: StoredPairing = {
      hubUrl: options.hubOrigin,
      coreId: result.value.coreId,
      deviceId,
      credential: result.value.credential,
    };
    await options.store.save(pairing);
    return { status: "paired", pairing };
  } catch (error) {
    if (options.signal?.aborted) return { status: "failed", reason: "aborted" };
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
      return { status: "failed", reason: "hub did not respond in time" };
    // Messages here come from our own checks or fetch; never include request bodies or the proof.
    return { status: "failed", reason: error instanceof Error ? error.message : "pairing failed" };
  }
}
