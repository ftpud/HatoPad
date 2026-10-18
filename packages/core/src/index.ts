import "./legacy-env-bootstrap.js";
import { loadCoreSessionToken } from "./access-policy.js";
import { installSignalShutdown } from "./signal-shutdown.js";
import { createServer, shutdownCore } from "./server.js";
import { migrateLegacyHome } from "./legacy-migration.js";
import { parseHubOptions, runHubPairing, startHubConnector } from "./hub-connection.js";

if (process.env.HATOPAD_MIGRATE_LEGACY_STATE === "1" && !process.env.HATOPAD_STATE_DIR) await migrateLegacyHome().catch((error) => console.error(`[core] Could not migrate the legacy state directory: ${error instanceof Error ? error.message : String(error)}`));

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const host = option("host", "127.0.0.1");
const port = Number(option("port", "7331"));
const workspace = option("workspace", "");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Port must be an integer between 1 and 65535");
  process.exit(1);
}
const hub = (() => { try { return parseHubOptions(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); } })();
if (hub.pairOrigin) process.exit((await runHubPairing(hub)) ? 0 : 1);
if (!workspace) {
  console.error("A workspace is required. Pass --workspace /absolute/path/to/workspace");
  process.exit(1);
}

try {
  const access = await loadCoreSessionToken(port);
  if (access.file) console.log(`[core] session token file: ${access.file}`);
  const allowedOrigins = process.env.HATOPAD_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);
  const server = await createServer(host, port, workspace, { access: { token: access.token, allowedOrigins } });
  const stopHub = hub.connect ? await startHubConnector(hub, port, access.token) : undefined;
  installSignalShutdown(async () => { await stopHub?.(); await shutdownCore(server); });
} catch (error) {
  console.error(`[core] failed to open workspace: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
