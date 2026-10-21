import { CoreUpdates } from "./core-update.js";
import "./legacy-env-bootstrap.js";
import { loadCoreSessionToken } from "./access-policy.js";
import { installSignalShutdown } from "./signal-shutdown.js";
import { createServer, shutdownCore } from "./server.js";
import { migrateLegacyHome } from "./legacy-migration.js";
import { parseHubOptions, runHubPairing, startHubConnector } from "./hub-connection.js";

process.title = "hatopad-core";

if (process.env.HATOPAD_MIGRATE_LEGACY_STATE === "1" && !process.env.HATOPAD_STATE_DIR)
  await migrateLegacyHome().catch((error) =>
    console.error(
      `[core] Could not migrate the legacy state directory: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );

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
const hub = (() => {
  try {
    return parseHubOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
if (hub.pairOrigin) process.exit((await runHubPairing(hub)) ? 0 : 1);
if (!workspace) {
  console.error("A workspace is required. Pass --workspace /absolute/path/to/workspace");
  process.exit(1);
}

try {
  const access = await loadCoreSessionToken(port);
  if (access.file) console.log(`[core] session token file: ${access.file}`);
  const allowedOrigins = process.env.HATOPAD_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  let stopHub: (() => Promise<void>) | undefined;
  let server: Awaited<ReturnType<typeof createServer>>;
  const updates =
    process.send && process.env.HATOPAD_CORE_UPDATE_MANAGED === "1"
      ? new CoreUpdates({
          repository: process.env.HATOPAD_CORE_UPDATE_REPOSITORY!,
          runningCommit: process.env.HATOPAD_CORE_RUNNING_COMMIT!,
          failure: process.env.HATOPAD_CORE_UPDATE_FAILED === "1",
          release: process.env.HATOPAD_CORE_RELEASE_MODE === "1",
          restart: async (target) => {
            await new Promise<void>((resolve, reject) =>
              process.send!({ type: "hatopad-core-update", ...target }, (error) => (error ? reject(error) : resolve())),
            );
            // Release supervisors build first and keep this Core serving; stop only when told the new release is ready.
            if (process.env.HATOPAD_CORE_RELEASE_MODE === "1")
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                  process.off("message", receive);
                  reject(new Error("Update timed out"));
                }, 30 * 60_000);
                timer.unref();
                const receive = (value: unknown) => {
                  const type = (value as { type?: unknown } | null)?.type;
                  if (type !== "hatopad-core-update-go" && type !== "hatopad-core-update-abort") return;
                  clearTimeout(timer);
                  process.off("message", receive);
                  type === "hatopad-core-update-go" ? resolve() : reject(new Error("Update was not prepared"));
                };
                process.on("message", receive);
              });
            await stopHub?.();
            await shutdownCore(server);
            process.exit(75);
          },
        })
      : new CoreUpdates();
  server = await createServer(host, port, workspace, { updates, access: { token: access.token, allowedOrigins } });
  stopHub = hub.connect ? await startHubConnector(hub, port, access.token) : undefined;
  // Lets a release supervisor distinguish a serving Core from one that merely started.
  process.send?.({ type: "hatopad-core-ready" });
  installSignalShutdown(async () => {
    await stopHub?.();
    await shutdownCore(server);
  });
} catch (error) {
  console.error(`[core] failed to open workspace: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
