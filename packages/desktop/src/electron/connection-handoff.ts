import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";

export type DesktopConnectionHandoff = {
  schema: 1; expiresAt: number; kind: "cloud" | "ssh"; rootId?: string;
  origin?: string; coreId?: string; cookie?: string;
  host?: string; port?: number; username?: string; remotePort?: number; hostKeyFingerprint?: string;
  authenticationMethod?: "password" | "privateKey" | "agent"; password?: string; privateKeyPath?: string; passphrase?: string; agentSocket?: string; sessionToken?: string;
};
function validString(value: unknown, maximum = 16_384): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value); }
const port = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535;

export async function consumeConnectionHandoff(file: string): Promise<DesktopConnectionHandoff> {
  if (!/^connection-[a-f0-9-]{36}\.json$/.test(path.basename(file))) throw new Error("Invalid Desktop connection handoff path.");
  const handle = await open(file, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
  let trusted = false;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65_536 || (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())))) throw new Error("Desktop connection handoff must be private and owned by this user.");
    trusted = true;
    let value: DesktopConnectionHandoff;
    try { value = JSON.parse(await handle.readFile("utf8")); }
    catch { throw new Error("Invalid Desktop connection handoff."); }
    if (value.schema !== 1 || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || value.expiresAt > Date.now() + 300_000 || (value.rootId !== undefined && !validString(value.rootId, 1024))) throw new Error("Desktop connection handoff is invalid or expired.");
    if (value.kind === "cloud") {
      let origin: URL;
      try { origin = new URL(value.origin ?? ""); } catch { throw new Error("Invalid cloud connection handoff."); }
      if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))) || origin.origin !== value.origin || !validString(value.coreId, 200) || !validString(value.cookie)) throw new Error("Invalid cloud connection handoff.");
    } else if (value.kind === "ssh") {
      if (!validString(value.host, 255) || !port(value.port) || !port(value.remotePort) || !validString(value.username, 255) || !validString(value.hostKeyFingerprint, 200)) throw new Error("Invalid SSH connection handoff.");
      if (value.authenticationMethod === "password") { if (typeof value.password !== "string") throw new Error("Missing SSH password."); }
      else if (value.authenticationMethod === "privateKey") { if (!validString(value.privateKeyPath) || !path.isAbsolute(value.privateKeyPath)) throw new Error("Missing SSH private key path."); }
      else if (value.authenticationMethod === "agent") { if (!validString(value.agentSocket)) throw new Error("Missing SSH agent socket."); }
      else throw new Error("Invalid SSH authentication method.");
      if (value.sessionToken !== undefined && !/^[A-Za-z0-9_-]{32,256}$/.test(value.sessionToken)) throw new Error("Invalid Core session token.");
    } else throw new Error("Unknown Desktop connection type.");
    return value;
  } finally { await handle.close(); if (trusted) await unlink(file); }
}
