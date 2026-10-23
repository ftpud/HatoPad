import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** What a Desktop launch asks for; forwarded verbatim to the process that already runs the same build. */
export type BuildInstanceLaunch = {
  connectionFile?: string;
  host?: string;
  port?: string;
  rootId?: string;
  cloudOrigin?: string;
};

export type BuildInstanceClaim = { role: "primary" | "standalone"; close(): void } | { role: "forwarded" };

const launchKeys = ["connectionFile", "host", "port", "rootId", "cloudOrigin"] as const;
const maximumMessageBytes = 65_536;

/**
 * Content fingerprint of a Desktop build. Windows opened through a shared process load that process's files,
 * so only byte-identical builds may share one; the same Core commit downloaded twice still matches.
 */
export function desktopBuildFingerprint(appRoot: string, context: readonly string[] = []): string {
  const hash = createHash("sha256");
  for (const value of context) hash.update(`${value}\0`);
  const files = [
    ...buildFiles(path.join(appRoot, "dist-electron")),
    path.join(appRoot, "dist-renderer", "index.html"),
    path.join(appRoot, "compatibility.json"),
  ];
  for (const file of files) {
    hash.update(`${path.relative(appRoot, file)}\0`);
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("missing\0");
    }
  }
  return hash.digest("hex").slice(0, 24);
}

function buildFiles(directory: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return buildFiles(file);
      return /\.(?:c|m)?js$/.test(entry.name) ? [file] : [];
    });
}

/** A private socket per build: inside the user-only settings directory, or a hashed temp path when that is too long. */
export function buildInstanceAddress(
  fingerprint: string,
  userData: string,
  platform: NodeJS.Platform = process.platform,
  temporary = os.tmpdir(),
): string {
  if (platform === "win32") return `\\\\.\\pipe\\hatopad-desktop-${fingerprint}`;
  const preferred = path.join(userData, "instances", `desktop-${fingerprint}.sock`);
  // Unix socket paths are limited to roughly 104 bytes on macOS.
  return Buffer.byteLength(preferred) < 100 ? preferred : path.join(temporary, `hatopad-desktop-${fingerprint}.sock`);
}

/**
 * Hands this launch to the process already running the same build, or becomes that process.
 * When the owner cannot be reached or replaced, the launch runs standalone instead of failing.
 */
export async function claimBuildInstance(
  address: string,
  launch: BuildInstanceLaunch,
  onLaunch: (launch: BuildInstanceLaunch) => void,
  options: { attempts?: number; timeoutMs?: number } = {},
): Promise<BuildInstanceClaim> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const forwarded = await forwardLaunch(address, launch, options.timeoutMs ?? 5_000);
    if (forwarded === "delivered") return { role: "forwarded" };
    if (forwarded === "unresponsive") break;
    try {
      return { role: "primary", close: await listen(address, onLaunch) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") break;
    }
  }
  return { role: "standalone", close: () => undefined };
}

export function parseBuildInstanceLaunch(value: unknown): BuildInstanceLaunch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Desktop launch");
  const input = value as Record<string, unknown>;
  const launch: BuildInstanceLaunch = {};
  for (const key of launchKeys) {
    const item = input[key];
    if (item === undefined) continue;
    if (typeof item !== "string" || !item || item.length > 4096 || /[\r\n\0]/.test(item))
      throw new Error("Invalid Desktop launch");
    launch[key] = item;
  }
  if (launch.connectionFile !== undefined && !path.isAbsolute(launch.connectionFile))
    throw new Error("Invalid Desktop launch");
  return launch;
}

function forwardLaunch(
  address: string,
  launch: BuildInstanceLaunch,
  timeoutMs: number,
): Promise<"delivered" | "absent" | "unresponsive"> {
  return new Promise((resolve) => {
    const socket = net.connect(address);
    let reply = "";
    let settled = false;
    const finish = (result: "delivered" | "absent" | "unresponsive") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("unresponsive"), timeoutMs);
    socket.once("connect", () => socket.write(`${JSON.stringify(launch)}\n`));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.includes("\n")) finish(reply.startsWith("ok\n") ? "delivered" : "unresponsive");
    });
    socket.once("end", () => finish(reply.startsWith("ok\n") ? "delivered" : "unresponsive"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") finish("absent");
      else if (error.code === "ECONNREFUSED") {
        // Nobody listens: a crashed owner left its socket file behind.
        if (process.platform !== "win32") rmSync(address, { force: true });
        finish("absent");
      } else finish("unresponsive");
    });
  });
}

function listen(address: string, onLaunch: (launch: BuildInstanceLaunch) => void): Promise<() => void> {
  if (process.platform !== "win32") mkdirSync(path.dirname(address), { recursive: true, mode: 0o700 });
  const server = net.createServer((socket) => {
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      if (Buffer.byteLength(buffered) > maximumMessageBytes) {
        socket.destroy();
        return;
      }
      const end = buffered.indexOf("\n");
      if (end < 0) return;
      let launch: BuildInstanceLaunch;
      try {
        launch = parseBuildInstanceLaunch(JSON.parse(buffered.slice(0, end)));
      } catch {
        socket.end("invalid\n");
        return;
      }
      socket.end("ok\n");
      onLaunch(launch);
    });
    socket.on("error", () => undefined);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.off("error", reject);
      if (process.platform !== "win32") chmodSync(address, 0o600);
      resolve(() => {
        server.close();
        if (process.platform !== "win32") rmSync(address, { force: true });
      });
    });
  });
}
