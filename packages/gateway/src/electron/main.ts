import { matchLocalCloudCore } from "./managed-local-core.js";
import { LocalCoreReleases } from "./local-core-release.js";
import { writeDesktopHandoff } from "./desktop-handoff.js";
import { CloudCoreUpdates, CoreUpdateCheckError, coreUpdateCheckReason, type ManagedCloudCore } from "./cloud-core-update.js";
import { signInCloudWithBrowser } from "./cloud-browser-signin.js";
import { applyCloudCoreUpdate, CloudUpdateUncertainError, listCloudRoots, type CloudRelayTarget } from "./cloud-relay.js";
import { CloudClient, cloudOrigin, cloudPairingScript, createCloudSettingsStore } from "./cloud.js";
import { clientArtifactVersion, clientArchiveCommand, validateClientRuntime } from "./client-artifact.js";
import { EDITOR_FLAG, bundleCoreCompatible, loadBundle, coreTarget, verifiedCoreArchive, installBundleCommand, prepareBundledCore } from "./bundled-runtime.js";
import { prepareLocalWorkspaceDirectory } from "./local-workspace.js";
import { legacyUserDataPath } from "./legacy-user-data.js";
import { applyLegacyEnvironmentWithWarning } from "./legacy-env.js";
import { installedNodeEnvironment, remoteNodeEnvironment } from "./remote-node.js";
import { executeSshCommand as execute } from "./ssh-command.js";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, powerMonitor, safeStorage, session, shell as electronShell, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";
import { connectionHealthForLatency, type ConnectionRuntime } from "./connection-health.js";
import { connectionConfig, normalizeStoredAuthentication, sshConnectionError, testSshConnection, validatePrivateKey, validatePrivateKeyPath, type AuthenticationMethod, type ConnectionAuth, type ConnectionDetails } from "./connection-auth.js";
import { defaultRepositorySettings, normalizeRepositorySettings, provisionCommand, repositorySettingsOrDefault, type RepositorySettings } from "./repository-settings.js";
import { legacyRemoteMigrationCommand, parseDiscoveredWorkspaceDirectories, parseValidatedWorkspaceDirectory, validateWorkspaceDirectoryInput, workspaceDiscoveryCommand, workspaceRegistrationCommand, workspaceUnregistrationCommand, workspaceValidationCommand } from "./workspace-path.js";
import { compatibleClient, readCompatibility, type Compatibility } from "./client-compatibility.js";
import { boundedProvisioningLog, classifyProvisioningFailure } from "./provisioning.js";
import { buildConnectionDiagnostics } from "./diagnostics.js";
import { SshTunnel } from "./ssh-tunnel.js";
import { activateRelease, activatedReleaseVerificationCommand, coreHealthProbe, parseProvisionedRelease, serverActivationCommand, serverStopCommand, workspaceReleaseDirectory, type ProvisionedRelease, WorkspaceOperations } from "./deployment.js";
import { isTrustedIpcFrame, isTrustedRendererUrl } from "./navigation-policy.js";
import { JsonStateStore } from "./state-store.js";

type Connection = { id: string; name: string; host: string; port: number; username: string; hostKeyFingerprint?: string } & ConnectionAuth;
type Workspace = { id: string; connectionId: string; name: string; directory: string; remotePort: number };
type PortTunnel = { id: string; connectionId: string; port: number };
type StoredConnection = { id: string; kind?: "ssh" | "local"; name: string; host: string; port: number; username: string; authenticationMethod?: AuthenticationMethod; password: string; privateKeyPath?: string; passphrase?: string; hostKeyFingerprint?: string };
type State = { connections: StoredConnection[]; workspaces: Workspace[]; portTunnels: PortTunnel[]; repository: RepositorySettings; coreReleases?: Record<string, string> };
type PublicState = { connections: { id: string; kind: "ssh" | "local"; name: string; host: string; port: number; username: string; authenticationMethod: AuthenticationMethod; privateKeyPath?: string; hostKeyFingerprint?: string }[]; workspaces: Workspace[]; portTunnels: PortTunnel[] };
type Runtime = { status: "idle" | "working" | "server" | "client" | "error"; message: string; updatedAt: string; stage: string; logs?: string[]; retryable?: boolean; repairable?: boolean };
type TunnelRuntime = { status: "idle" | "working" | "running" | "error"; message: string; updatedAt: string; stage: string };
type ConnectionRuntimeSnapshot = ConnectionRuntime & { updatedAt: string; stage: string };

const bundle = app.isPackaged ? await loadBundle(process.resourcesPath) : undefined;
/** The bundled Editor's app directory; it runs on this executable with `--hatopad` (see entry.ts). */
const bundledDesktop = bundle ? path.join(process.resourcesPath, "bundle", bundle.desktopApp) : undefined;
function desktopCommand(desktopMain: string): { command: string; args: string[] } {
  return bundle ? { command: process.execPath, args: [EDITOR_FLAG] } : { command: process.env.HATOPAD_DESKTOP_EXECUTABLE || process.execPath, args: [desktopMain] };
}
const bundleSmokeTest = (app.isPackaged && process.argv.includes("--bundle-smoke-test")) || (!app.isPackaged && process.argv.includes("--startup-smoke-test"));
applyLegacyEnvironmentWithWarning(process.env);
if (!bundleSmokeTest) app.setPath("userData", legacyUserDataPath(app.getPath("appData"), "Vibe Gateway", "HatoPad Gateway"));
if (bundleSmokeTest) app.setPath("userData", path.join(app.getPath("temp"), `hatopad-gateway-bundle-smoke-${process.pid}`));
const directory = path.dirname(fileURLToPath(import.meta.url));
const rendererFilePath = path.join(directory, "../dist-renderer/index.html");
const appIcon = path.join(directory, "../assets/app-icon.png");
const runtimes = new Map<string, Runtime>();
const portTunnelRuntimes = new Map<string, TunnelRuntime>();
const portTunnels = new Map<string, SshTunnel>();
const connectionRuntimes = new Map<string, ConnectionRuntimeSnapshot>();
const provisioningClients = new Map<string, Client>();
const cancelledProvisioning = new Set<string>();
let quitRequested = false;
const workspaceOperations = new WorkspaceOperations();
const localServers = new Map<string, ReturnType<typeof spawn>>();

app.name = "HatoPad Gateway";
app.setName("HatoPad Gateway");
app.setAppUserModelId("com.hatopad.gateway");
process.title = "HatoPad Gateway";
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window?.isMinimized()) window.restore();
  window?.show(); window?.focus();
});
app.commandLine.appendSwitch("class", "HatoPadGateway");

function handleIpc(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (quitRequested) throw new Error("Gateway is shutting down");
    const frame = event.senderFrame;
    if (!isTrustedIpcFrame(frame ? { url: frame.url, isMainFrame: frame.parent === null } : null, Boolean(BrowserWindow.fromWebContents(event.sender)), rendererFilePath, process.env.VITE_DEV_SERVER_URL)) throw new Error("IPC request rejected from an untrusted renderer frame");
    return listener(event, ...args);
  });
}

function stateFile(): string { return path.join(app.getPath("userData"), "gateway.json"); }
function decodeState(text: string): State {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Gateway state must be a JSON object");
  const state = value as Partial<State>;
  if (state.connections !== undefined && !Array.isArray(state.connections)) throw new Error("Gateway connections must be an array");
  if (state.workspaces !== undefined && !Array.isArray(state.workspaces)) throw new Error("Gateway workspaces must be an array");
  if (state.portTunnels !== undefined && !Array.isArray(state.portTunnels)) throw new Error("Gateway port tunnels must be an array");
  return { connections: (state.connections ?? []).map(normalizeStoredAuthentication), workspaces: state.workspaces ?? [], portTunnels: state.portTunnels ?? [], repository: repositorySettingsOrDefault(state.repository), coreReleases: state.coreReleases && typeof state.coreReleases === "object" && !Array.isArray(state.coreReleases) ? Object.fromEntries(Object.entries(state.coreReleases).filter(([id,commit])=>/^[A-Za-z0-9_-]{1,200}$/.test(id) && typeof commit === "string" && /^[a-f0-9]{40}$/.test(commit))) : {} };
}
const stateStore = new JsonStateStore<State>(stateFile(), () => ({ connections: [], workspaces: [], portTunnels: [], repository: defaultRepositorySettings }), decodeState);
async function readState(): Promise<State> { return stateStore.read(); }
async function updateState<R>(mutate: (state: State) => R | Promise<R>): Promise<{ state: State; result: R }> { return stateStore.update(mutate); }
let stateFlushedForQuit = false;
app.on("before-quit", (event) => {
  if (stateFlushedForQuit || !ownsInstance) return;
  event.preventDefault(); quitRequested = true;
  void stateStore.flush().finally(() => { stateFlushedForQuit = true; app.quit(); });
});
function encrypt(password: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system");
  return safeStorage.encryptString(password).toString("base64");
}
function decrypt(password: string): string {
  try { return safeStorage.decryptString(Buffer.from(password, "base64")); }
  // The operating system ties the encryption key to the application name. After the HatoPad rename a secret saved by the
  // previous build may not decrypt; ask for it again instead of failing with an opaque error.
  catch { throw new Error("A saved SSH password or passphrase can no longer be decrypted, which can happen after the app was renamed. Edit the connection and enter it again."); }
}
function publicState(state: State): PublicState {
  return { connections: state.connections.map((connection) => { const item = normalizeStoredAuthentication(connection); return { id: item.id, kind: connection.kind === "local" ? "local" : "ssh", name: item.name, host: item.host, port: item.port, username: item.username, authenticationMethod: item.authenticationMethod, ...(item.privateKeyPath ? { privateKeyPath: item.privateKeyPath } : {}), ...(item.hostKeyFingerprint ? { hostKeyFingerprint: item.hostKeyFingerprint } : {}) }; }), workspaces: state.workspaces, portTunnels: state.portTunnels };
}
function id(): string { return crypto.randomUUID(); }
function shell(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function runtime(workspaceId: string, status: Runtime["status"], message: string, details: Partial<Omit<Runtime, "status" | "message" | "updatedAt">> = {}): void {
  const value = { status, message, updatedAt: new Date().toISOString(), stage: details.stage ?? status, ...details }; runtimes.set(workspaceId, value);
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("gateway:status", workspaceId, value);
}
function portTunnelRuntime(tunnelId: string, status: TunnelRuntime["status"], message: string): void {
  const value = { status, message, updatedAt: new Date().toISOString(), stage: status }; portTunnelRuntimes.set(tunnelId, value);
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("gateway:tunnelStatus", tunnelId, value);
}
function connectionRuntime(connectionId: string, value: ConnectionRuntime): void {
  const timestamped = { ...value, updatedAt: new Date().toISOString(), stage: "ssh-health-check" };
  connectionRuntimes.set(connectionId, timestamped);
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("gateway:connectionStatus", connectionId, timestamped);
}
async function credentials(connectionId: string, state?: State): Promise<Connection> {
  const item = (state ?? await readState()).connections.find((connection) => connection.id === connectionId);
  if (!item) throw new Error("SSH connection was not found");
  const normalized = normalizeStoredAuthentication(item);
  if (normalized.authenticationMethod === "privateKey") return { ...normalized, authenticationMethod: "privateKey", privateKeyPath: normalized.privateKeyPath ?? "", ...(normalized.passphrase ? { passphrase: decrypt(normalized.passphrase) } : {}) };
  if (normalized.authenticationMethod === "agent") return { ...normalized, authenticationMethod: "agent" };
  return { ...normalized, authenticationMethod: "password", password: decrypt(normalized.password) };
}
function connectWithConfig(config: Parameters<Client["connect"]>[0]): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const onReady = () => {
      client.off("error", onError);
      // Every ready SSH client needs a durable error listener. Individual
      // operations and managed tunnels add their own reporting, while this
      // guard prevents a later transport error from reaching Electron as an
      // uncaught exception and native system error dialog.
      client.on("error", () => undefined);
      // Best effort: move pre-rename server files so a running server and its releases keep being found.
      execute(client, legacyRemoteMigrationCommand()).catch(() => undefined).finally(() => resolve(client));
    };
    const onError = (error: Error) => { client.off("ready", onReady); reject(sshConnectionError(error, config.privateKey ? "privateKey" : config.agent ? "agent" : "password")); };
    client.once("ready", onReady).once("error", onError).connect(config);
  });
}
async function connect(connection: ConnectionDetails): Promise<Client> { return connectWithConfig(await connectionConfig(connection, readFile)); }
async function withWorkspace(workspaceId: string): Promise<{ workspace: Workspace; connection: Connection }> {
  const state = await readState(); const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Workspace was not found");
  return { workspace, connection: await credentials(workspace.connectionId) };
}
async function workspaceAndStoredConnection(workspaceId: string): Promise<{ workspace: Workspace; connection: StoredConnection }> {
  const state = await readState(); const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Workspace was not found");
  const connection = state.connections.find((item) => item.id === workspace.connectionId);
  if (!connection) throw new Error("Connection was not found");
  return { workspace, connection };
}
async function localArtifactPaths(toolchainOnly = false): Promise<{ coreMain: string; desktopRoot: string; node: string; env: NodeJS.ProcessEnv }> {
  if (bundle) {
    const target = coreTarget(process.platform, process.arch);
    const shippedCore = bundle.cores[target];
    if (!shippedCore || !toolchainOnly && !bundleCoreCompatible(shippedCore)) throw new Error(`This bundle does not include a protocol-compatible Core for ${target}. Install a compatible Gateway release.`);
    const root = await prepareBundledCore(process.resourcesPath, path.join(app.getPath("userData"), "cores"), shippedCore, (archive, destination) => runLocal("tar", ["-xzf", archive, "-C", destination], destination));
    return { coreMain: path.join(root, "packages/core/dist/index.js"), desktopRoot: bundledDesktop!, node: path.join(root, "bin/node"), env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}` } };
  }
  const repositoryRoot = path.resolve(directory, "../../..");
  return { coreMain: path.join(repositoryRoot, "packages/core/dist/index.js"), desktopRoot: path.join(repositoryRoot, "packages/desktop"), node: process.env.HATOPAD_NODE_EXECUTABLE || "node", env: process.env };
}
async function stopLocalServer(workspaceId: string): Promise<void> {
  const previous = localServers.get(workspaceId);
  if (previous && previous.exitCode === null && previous.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { previous.off("exit", exited); reject(new Error("Previous local Core is still stopping; retry after shutdown completes")); }, 35_000);
      const exited = () => { clearTimeout(timer); resolve(); };
      previous.once("exit", exited); previous.kill();
    });
  }
  if (localServers.get(workspaceId) === previous) localServers.delete(workspaceId);
}
const coreReleasesDirectory = () => path.join(app.getPath("userData"), "core-releases");
const localReleaseName = /^[0-9a-f]{40,64}-node[0-9]+(?:-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$/;
/** The release supervisor records the release it switched to here; it outranks Gateway's older saved commit. */
const localSelectionFile = (workspaceId: string) => path.join(coreReleasesDirectory(), `selected-${workspaceId}`);
async function selectedLocalRelease(workspaceId: string): Promise<string | undefined> {
  const value = (await readFile(localSelectionFile(workspaceId), "utf8").catch(() => "")).trim();
  return localReleaseName.test(value) ? value : undefined;
}
async function startLocalServer(workspaceId: string, expectedCommit?: string, repository?: RepositorySettings, useBundle = false, compatibility?: Compatibility): Promise<{ remotePort: number }> {
  const { workspace } = await workspaceAndStoredConnection(workspaceId);
  if (useBundle) await rm(localSelectionFile(workspaceId), { force: true });
  const selectedRelease = useBundle || expectedCommit ? undefined : await selectedLocalRelease(workspaceId);
  const savedCommit = useBundle ? undefined : selectedRelease?.split("-node")[0] ?? (await readState()).coreReleases?.[workspaceId];
  let { coreMain, node, env } = await localArtifactPaths(Boolean(expectedCommit || savedCommit));
  if (expectedCommit) {
    const npm = bundle ? path.resolve(path.dirname(coreMain), "../../../lib/node_modules/npm/bin/npm-cli.js") : process.env.npm_execpath;
    if (!npm) throw Error("Start Gateway through npm to build a compatible Core.");
    const release = await localCoreReleases.prepare(repository ?? (await readState()).repository, expectedCommit, {node,npm,env}, compatibility);
    coreMain = path.join(release,"packages/core/dist/index.js");
  } else if (savedCommit) coreMain = path.join(await localCoreReleases.installed(savedCommit,node,env),"packages/core/dist/index.js");
  await access(coreMain).catch(() => { throw new Error(bundle ? "Bundled Core is missing or damaged. Reinstall HatoPad Gateway." : "Local Core is not built. Run npm run build before starting a local workspace."); });
  await prepareLocalWorkspaceDirectory(workspace.directory);
  await stopLocalServer(workspaceId);
  runtime(workspaceId, "working", "Starting local Core...");
  const logDirectory = path.join(app.getPath("userData"), "logs");
  const logPath = path.join(logDirectory, `local-core-${workspace.id}.log`);
  await mkdir(logDirectory, { recursive: true });
  const log = await open(logPath, "a");
  const pairingFile = path.join(app.getPath("userData"), "cloud-pairings", `${workspaceId}.json`);
  const paired = await access(pairingFile).then(() => true, () => false);
  // Releases from the local cache that include the supervisor can update themselves through Hub.
  const releaseRoot = path.resolve(path.dirname(coreMain), "../../..");
  const supervisor = path.join(releaseRoot, "scripts/core-release-service.mjs");
  const supervised = path.dirname(releaseRoot) === coreReleasesDirectory() && localReleaseName.test(path.basename(releaseRoot)) &&
    await access(supervisor).then(() => true, () => false) && (await readFile(coreMain, "utf8").catch(() => "")).includes("HATOPAD_CORE_RELEASE_MODE");
  const child = spawn(node, [supervised ? supervisor : coreMain, ...(paired ? ["--hub-connect"] : []), "--host", "127.0.0.1", "--port", String(workspace.remotePort), "--workspace", workspace.directory], {
    cwd: workspace.directory, detached: true,
    env: { ...env, ...(supervised ? { HATOPAD_CORE_RELEASE_ROOT: coreReleasesDirectory(), HATOPAD_CORE_RELEASES_DIR: coreReleasesDirectory(), HATOPAD_CORE_RELEASE_SELECTION: localSelectionFile(workspaceId) } : {}), HATOPAD_HUB_PAIRING_FILE: pairingFile, ...(bundleSmokeTest ? { HATOPAD_STATE_DIR: path.join(app.getPath("userData"), "core-state") } : {}), HATOPAD_SESSION_TOKEN: "", HATOPAD_SESSION_TOKEN_FILE: path.join(app.getPath("userData"), "core-tokens", `${workspaceId}.token`) },
    // macOS child processes such as Git and node-pty need valid inherited descriptors.
    // Keep stdin attached to /dev/null and retain Core output in a durable diagnostic log.
    stdio: ["ignore", log.fd, log.fd]
  });
  try { await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); }
  finally { await log.close(); }
  child.once("exit", (code) => { if (localServers.get(workspaceId) !== child) return; localServers.delete(workspaceId); runtime(workspaceId, code === 0 ? "idle" : "error", code === 0 ? "Stopped" : `Local Core exited with ${code}`); });
  localServers.set(workspaceId, child);
  try {
    const tokenFile = path.join(app.getPath("userData"), "core-tokens", `${workspaceId}.token`);
    const deadline = Date.now() + 10_000;
    let token: string | undefined;
    while (!token && Date.now() < deadline) {
      try { token = (await readFile(tokenFile, "utf8")).trim(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!token) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!token) throw new Error("Local Core did not create its authentication token");
    await runLocal(node, ["--input-type=commonjs", "-e", coreHealthProbe(workspace.remotePort)], path.resolve(path.dirname(coreMain), "../../.."), { ...env, HATOPAD_SESSION_TOKEN: token });
  } catch (error) {
    child.kill(); localServers.delete(workspaceId);
    runtime(workspaceId, "error", `Local Core failed health verification. Inspect ${logPath}`);
    throw error;
  }
  if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Local Core exited during startup. Inspect ${logPath}`);
  runtime(workspaceId, "server", `Server listening locally on ${workspace.remotePort} (log: ${logPath})`);
  if (supervised) await mkdir(coreReleasesDirectory(), { recursive: true }).then(() => writeFile(localSelectionFile(workspaceId), path.basename(releaseRoot), { mode: 0o600 }));
  else await rm(localSelectionFile(workspaceId), { force: true });
  if (expectedCommit || useBundle) await updateState(state => { if (expectedCommit) state.coreReleases = { ...state.coreReleases, [workspaceId]: expectedCommit }; else if (state.coreReleases) delete state.coreReleases[workspaceId]; });
  child.unref();
  return { remotePort: workspace.remotePort };
}
async function startLocalClient(workspaceId: string): Promise<void> {
  const { workspace } = await workspaceAndStoredConnection(workspaceId); const { desktopRoot } = await localArtifactPaths();
  const desktopMain = path.join(desktopRoot, "dist-electron/main.js"); await access(desktopMain).catch(() => { throw new Error(bundle ? "Bundled Desktop is missing or damaged. Reinstall HatoPad Gateway." : "Local Desktop is not built. Run npm run build before starting a local workspace."); });
  const desktop = desktopCommand(desktopMain);
  const child = spawn(desktop.command, [...desktop.args, "--host", "127.0.0.1", "--port", String(workspace.remotePort)], { cwd: desktopRoot, env: { ...process.env, VITE_DEV_SERVER_URL: "", HATOPAD_SESSION_TOKEN: "", HATOPAD_SESSION_TOKEN_FILE: path.join(app.getPath("userData"), "core-tokens", `${workspaceId}.token`) }, detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref(); runtime(workspaceId, "client", `Client connected locally on port ${workspace.remotePort}`);
}
async function refreshStatuses(connectionId?: string): Promise<void> {
  const state = await readState();
  const workspaces = state.workspaces.filter((workspace) => !connectionId || workspace.connectionId === connectionId);
  const localConnectionIds = new Set(state.connections.filter((connection) => connection.kind === "local").map((connection) => connection.id));
  for (const localId of localConnectionIds) {
    if (connectionId && connectionId !== localId) continue;
    connectionRuntime(localId, { status: "online", message: "Local Mac is available", latencyMs: 0 });
    for (const workspace of workspaces.filter((item) => item.connectionId === localId)) runtime(workspace.id, localServers.has(workspace.id) ? "server" : "idle", localServers.has(workspace.id) ? `Server listening locally on ${workspace.remotePort}` : "Stopped");
  }
  const remoteWorkspaces = workspaces.filter((workspace) => !localConnectionIds.has(workspace.connectionId));
  for (const workspace of remoteWorkspaces) runtime(workspace.id, "working", "Checking remote server...");
  const groups = new Map<string, Workspace[]>();
  for (const workspace of remoteWorkspaces) groups.set(workspace.connectionId, [...(groups.get(workspace.connectionId) ?? []), workspace]);
  await Promise.all([...groups.entries()].map(async ([currentConnectionId, items]) => {
    let client: Client | undefined;
    const previous = connectionRuntimes.get(currentConnectionId);
    connectionRuntime(currentConnectionId, { status: "reconnecting", message: previous?.status === "offline" ? "Reconnecting to SSH host..." : "Checking SSH connection..." });
    try {
      const startedAt = performance.now();
      client = await connect(await credentials(currentConnectionId));
      const latencyMs = Math.round(performance.now() - startedAt);
      connectionRuntime(currentConnectionId, connectionHealthForLatency(latencyMs));
      for (const workspace of items) {
        const pidFile = `~/.hatopad-server-${workspace.id}.pid`;
        const result = (await execute(client, `bash -lc ${shell(`if [ -f ${pidFile} ] && kill -0 $(cat ${pidFile}) 2>/dev/null; then echo running; else rm -f ${pidFile}; echo stopped; fi`)}`)).trim();
        runtime(workspace.id, result === "running" ? "server" : "idle", result === "running" ? `Server listening remotely on ${workspace.remotePort}` : "Stopped");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      connectionRuntime(currentConnectionId, { status: "offline", message: `SSH unavailable: ${message}` });
      for (const workspace of items) runtime(workspace.id, "error", `Status check failed: ${message}`);
    } finally { client?.end(); }
  }));
}
async function provision(workspaceId: string, client: Client, settings: RepositorySettings, repair = false, expectedCommit?: string, compatibility?: Compatibility): Promise<ProvisionedRelease> {
  if (bundle && !expectedCommit) {
    const platform = (await execute(client, "uname -s; uname -m")).trim().split(/\s+/);
    const target = coreTarget(platform[0]!, platform[1]!);
    const shippedCore = bundle.cores[target];
    if (shippedCore && bundleCoreCompatible(shippedCore)) {
      runtime(workspaceId, "working", "Uploading bundled Core…", { stage: "bundle-upload" });
      const core = repair ? { ...shippedCore, release: `${shippedCore.release}-repair-${id().replaceAll("-", "")}` } : shippedCore;
      const archive = await verifiedCoreArchive(process.resourcesPath, core);
      const upload = `.hatopad-upload-${id()}`;
      await execute(client, `umask 077; mkdir "$HOME/${upload}"`);
      try {
        const home = (await execute(client, "printf '%s' \"$HOME\"" )).trim();
        await new Promise<void>((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : sftp.fastPut(archive, path.posix.join(home, upload, "core.tar.gz"), failure => { sftp.end(); failure ? reject(failure) : resolve(); })));
        const result = parseProvisionedRelease(await execute(client, `bash -lc ${shell(installBundleCommand(core, upload))}`));
        if (cancelledProvisioning.has(workspaceId)) throw new Error("Provisioning cancelled");
        return result;
      } finally { await execute(client, `rm -rf "$HOME/${upload}"`).catch(() => undefined); }
    }
  }
  const preferredRelease = (await execute(client, `bash -lc ${shell(`${workspaceReleaseDirectory(workspaceId)}; printf '%s' "$release"`)}`)).trim();
  const command = provisionCommand(settings, installedNodeEnvironment(preferredRelease || undefined), repair, preferredRelease || undefined, expectedCommit ? { expectedCommit, compatibility } : undefined);
  const logs: string[] = [];
  const output = await execute(client, `bash -lc ${shell(command)}`, (line) => {
    logs.push(line);
    const stage = line.match(/^HATOPAD_STAGE:(.+)$/)?.[1];
    runtime(workspaceId, "working", stage ? `${stage.replaceAll("-", " ")}…` : "Provisioning remote HatoPad application…", { stage: stage ?? "provisioning", logs: boundedProvisioningLog(logs) });
  });
  if (cancelledProvisioning.has(workspaceId)) throw new Error("Provisioning cancelled");
  return parseProvisionedRelease(output);
}
async function startServer(workspaceId: string, repair = false, expectedCommit?: string, repository?: RepositorySettings, compatibility?: Compatibility): Promise<{ remotePort: number }> {
  const { workspace, connection } = await withWorkspace(workspaceId); runtime(workspaceId, "working", expectedCommit ? "Updating compatible Core…" : bundle ? "Deploying bundled Core…" : "Updating and building remote server...");
  const client = await connect(connection); provisioningClients.set(workspaceId, client); cancelledProvisioning.delete(workspaceId);
  try {
    const build = await provision(workspaceId, client, repository ?? (await readState()).repository, repair, expectedCommit, compatibility);
    const environment = installedNodeEnvironment(build.release);
    runtime(workspaceId, "working", "Preparing workspace directory and Git repository…", { stage: "workspace" });
    await execute(client, workspaceValidationCommand(workspace.directory));
    const portScript = `const net=require("net");const preferred=${workspace.remotePort};let fallback=false;const open=port=>{const server=net.createServer();server.unref();server.once("error",error=>{if(error.code==="EADDRINUSE"&&!fallback){fallback=true;open(0);return}throw error});server.listen(port,"127.0.0.1",()=>{console.log(server.address().port);server.close()})};open(preferred)`;
    const selectedPort = Number((await execute(client, `bash -lc ${shell(`${environment}; node -e ${shell(portScript)}`)}`)).trim());
    if (!Number.isInteger(selectedPort) || selectedPort < 1) throw new Error("Could not allocate a remote Core port");
    if (selectedPort !== workspace.remotePort) {
      await updateState((state) => { state.workspaces = state.workspaces.map((item) => item.id === workspace.id ? { ...item, remotePort: selectedPort } : item); });
      workspace.remotePort = selectedPort;
    }
    const run = serverActivationCommand(workspace.id, workspace.directory, workspace.remotePort, build.release, environment);
    const activationLogs: string[] = [];
    runtime(workspaceId, "working", "Starting Core and waiting for protocol health…", { stage: "activation" });
    await activateRelease(build.release, (onOutput) => execute(client, `bash -lc ${shell(run)}`, onOutput), async () => {
      if (cancelledProvisioning.has(workspaceId)) throw new Error("Provisioning cancelled");
      runtime(workspaceId, "working", "Reconnecting to verify the activated Core…", { stage: "activation", logs: boundedProvisioningLog(activationLogs) });
      const verificationClient = await connect(connection);
      provisioningClients.set(workspaceId, verificationClient);
      try {
        const verify = activatedReleaseVerificationCommand(workspace.id, workspace.remotePort, build.release, environment);
        await execute(verificationClient, `bash -lc ${shell(verify)}`);
        if (cancelledProvisioning.has(workspaceId)) throw new Error("Provisioning cancelled");
      } finally { verificationClient.end(); }
    }, (line) => {
      activationLogs.push(line);
      runtime(workspaceId, "working", "Starting Core and waiting for protocol health…", { stage: "activation", logs: boundedProvisioningLog(activationLogs) });
    }); runtime(workspaceId, "server", `Server listening remotely on ${workspace.remotePort}${build.release.includes("-bundle-") ? ` (bundled ${bundle?.version})` : build.rebuilt ? " (rebuilt)" : " (build reused)"}`);
    return { remotePort: workspace.remotePort };
  } catch (error) {
    const failure = classifyProvisioningFailure(cancelledProvisioning.has(workspaceId) ? new Error("Provisioning cancelled") : error);
    const previous = runtimes.get(workspaceId);
    runtime(workspaceId, "error", failure.message, { stage: previous?.stage ?? "provisioning", logs: previous?.logs, retryable: failure.retryable, repairable: failure.repairable });
    throw error;
  } finally { provisioningClients.delete(workspaceId); cancelledProvisioning.delete(workspaceId); client.end(); }
}
async function stopServer(workspaceId: string): Promise<void> {
  const { workspace, connection } = await withWorkspace(workspaceId); runtime(workspaceId, "working", "Stopping remote server...");
  const client = await connect(connection);
  try { await execute(client, `bash -lc ${shell(serverStopCommand(workspace.id, workspace.directory, bundle ? "" : remoteNodeEnvironment))}`); }
  finally { client.end(); }
  runtime(workspaceId, "idle", "Stopped");
}
async function download(client: Client, remote: string, local: string): Promise<void> {
  await new Promise<void>((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : sftp.fastGet(remote, local, (failure) => failure ? reject(failure) : resolve())));
}
function runLocal(command: string, args: string[], cwd: string, env = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    let executable = command;
    if (process.platform === "win32" && command === "tar") executable = "tar.exe";
    const child = spawn(executable, args, { cwd, env, stdio: "inherit", shell: false });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited with ${code}`)));
  });
}
async function startPortTunnel(tunnelId: string): Promise<void> {
  const state = await readState();
  const tunnel = state.portTunnels.find((item) => item.id === tunnelId);
  if (!tunnel) throw new Error("Port tunnel was not found");
  if (!Number.isInteger(tunnel.port) || tunnel.port < 1 || tunnel.port > 65535) throw new Error("Tunnel port must be between 1 and 65535");
  portTunnelRuntime(tunnelId, "working", "Connecting over SSH...");
  stopPortTunnel(tunnelId, false);
  try {
    const managed = new SshTunnel({
      localPort: tunnel.port,
      remotePort: tunnel.port,
      connect: async () => connect(await credentials(tunnel.connectionId)),
      onStatus: (status, localPort, error) => {
        if (status === "running") portTunnelRuntime(tunnelId, "running", `127.0.0.1:${localPort} → remote 127.0.0.1:${tunnel.port}`);
        else portTunnelRuntime(tunnelId, "working", error ? `Reconnecting after SSH error: ${error.message}` : "Connecting over SSH...");
      },
    });
    await managed.start();
    portTunnels.set(tunnelId, managed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    portTunnelRuntime(tunnelId, "error", message);
    throw error;
  }
}
function stopPortTunnel(tunnelId: string, notify = true): void {
  const active = portTunnels.get(tunnelId);
  portTunnels.delete(tunnelId);
  active?.stop();
  if (notify) portTunnelRuntime(tunnelId, "idle", "Stopped");
}
async function startClient(workspaceId: string): Promise<void> {
  const { workspace, connection } = await withWorkspace(workspaceId); runtime(workspaceId, "working", "Checking remote client build...");
  let observedHostKey = connection.hostKeyFingerprint;
  const client = await connectWithConfig(await connectionConfig(connection, readFile, fingerprint => { observedHostKey = fingerprint; }));
  connection.hostKeyFingerprint = observedHostKey;
  try {
  const releaseDirectory = (await execute(client, `bash -lc ${shell(`set -e; ${workspaceReleaseDirectory(workspaceId)}; printf '%s' "$release_directory"`)}`)).trim();
  if (!path.posix.isAbsolute(releaseDirectory) || /[\r\n\0]/.test(releaseDirectory)) { client.end(); throw new Error("Invalid deployed release directory"); }
  const sessionToken = (await execute(client, `if [ -f ~/.hatopad-server-${workspaceId}.token ]; then cat ~/.hatopad-server-${workspaceId}.token; fi`)).trim();
  if (sessionToken && !/^[A-Za-z0-9_-]{32,256}$/.test(sessionToken)) throw new Error("Remote Core session token is invalid");
  if (bundle) {
    const remoteHome = (await execute(client, `printf '%s' "$HOME"`)).trim();
    const matchesBundle = Object.values(bundle.cores).some(core => {
      const expected = path.posix.join(remoteHome, ".hatopad-deploy/releases", core.release);
      return releaseDirectory === expected || (releaseDirectory.startsWith(expected) && /^-repair-[a-f0-9]{32}$/.test(releaseDirectory.slice(expected.length)));
    });
    if (!matchesBundle) throw new Error("Start the bundled Core before opening Desktop");
    await launchClient(workspaceId, workspace, connection, bundledDesktop!, true, sessionToken);
    return;
  }
  const commit = (await execute(client, `git -C ${shell(releaseDirectory)} rev-parse HEAD`)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) { client.end(); throw new Error("Remote HatoPad checkout was not found. Start the server first."); }
  const remoteCompatibilityOutput = await execute(client, `bash -lc ${shell(`${remoteNodeEnvironment}; cd ${shell(releaseDirectory)}; node --input-type=module -e ${shell("import { protocolCompatibility } from './packages/protocol/dist/index.js'; console.log(JSON.stringify(protocolCompatibility))")}`)}`);
  const remoteCompatibility = JSON.parse(remoteCompatibilityOutput) as Compatibility;
  if (!compatibleClient(remoteCompatibility, remoteCompatibility)) { client.end(); throw new Error("Remote Core reported an invalid protocol compatibility range"); }
  const localDesktop = cloudDesktopRoot();
  let localDesktopCompatible = false;
  try {
    const localManifest = JSON.parse(await readFile(path.join(localDesktop, "compatibility.json"), "utf8"));
    const compatibility = readCompatibility(localManifest);
    await access(path.join(localDesktop, "dist-electron/main.js"));
    localDesktopCompatible = localManifest.connectionHandoff === 1 && Boolean(compatibility && compatibleClient(compatibility, remoteCompatibility));
  } catch { /* A compatible downloaded Desktop can still be selected below. */ }
  if (localDesktopCompatible) { await launchClient(workspaceId, workspace, connection, localDesktop, true, sessionToken); return; }
  const clientsDirectory = path.join(app.getPath("userData"), "clients", workspace.id);
  const clientRoot = path.join(clientsDirectory, commit); const archive = path.join(app.getPath("temp"), `hatopad-${workspace.id}-${commit}.tar.gz`);
  const buildMarker = path.join(clientRoot, ".gateway-client-built");
  const expectedMarker = `${clientArtifactVersion}:${commit}`;
  let clientBuilt = false;
  try {
    const marker = (await readFile(buildMarker, "utf8")).trim();
    clientBuilt = marker === expectedMarker;
    await access(path.join(clientRoot, "package.json")); await access(path.join(clientRoot, "compatibility.json")); await access(path.join(clientRoot, "dist-electron", "main.js")); await access(path.join(clientRoot, "dist-renderer", "index.html")); await validateClientRuntime(clientRoot);
    const compatibility = readCompatibility(JSON.parse(await readFile(path.join(clientRoot, "compatibility.json"), "utf8")));
    clientBuilt = clientBuilt && !!compatibility && compatibleClient(compatibility, remoteCompatibility);
    if (clientBuilt && marker !== expectedMarker) await writeFile(buildMarker, `${expectedMarker}\n`, "utf8");
  }
  catch { clientBuilt = false; }
  if (!clientBuilt) {
    const cached = await readdir(clientsDirectory, { withFileTypes: true }).catch(() => []);
    const rollback = (await Promise.all(cached.filter((entry) => entry.isDirectory() && entry.name !== commit).map(async (entry) => {
      const candidate = path.join(clientsDirectory, entry.name);
      try {
        const marker = (await readFile(path.join(candidate, ".gateway-client-built"), "utf8")).trim();
        const compatibility = readCompatibility(JSON.parse(await readFile(path.join(candidate, "compatibility.json"), "utf8")));
        await access(path.join(candidate, "dist-electron", "main.js")); await access(path.join(candidate, "dist-renderer", "index.html")); await validateClientRuntime(candidate);
        return marker.startsWith(`${clientArtifactVersion}:`) && compatibility && compatibleClient(compatibility, remoteCompatibility) ? candidate : undefined;
      } catch { return undefined; }
    }))).find(Boolean);
    if (rollback) {
      const choice = await dialog.showMessageBox({ type: "warning", buttons: ["Download update", "Use last known-good client", "Cancel"], defaultId: 0, cancelId: 2, title: "Desktop update available", message: "The cached Desktop cannot be used with this Core.", detail: "Choose a verified update or keep using the last compatible client." });
      if (choice.response === 1) { client.end(); await launchClient(workspaceId, workspace, connection, rollback, true, sessionToken); return; }
      if (choice.response === 2) { client.end(); throw new Error("Desktop update was cancelled"); }
    }
  }
  if (!clientBuilt) {
  try {
    const remoteArchive = `/tmp/hatopad-${workspace.id}-${id()}.tar.gz`;
    const checksum = (await execute(client, `bash -lc ${shell(`set -e; release_directory=${shell(releaseDirectory)}; test -f "$release_directory/packages/desktop/compatibility.json"; test -f "$release_directory/node_modules/ws/package.json"; cd "$release_directory/packages/desktop"; remote_archive=${shell(remoteArchive)}; ${clientArchiveCommand()}; if command -v sha256sum >/dev/null 2>&1; then sha256sum ${remoteArchive}; else shasum -a 256 ${remoteArchive}; fi`)}`)).trim().split(/\s+/)[0];
    await mkdir(path.dirname(archive), { recursive: true }); await download(client, remoteArchive, archive);
    const actual = createHash("sha256").update(await readFile(archive)).digest("hex");
    if (actual !== checksum) throw new Error("Downloaded Desktop artifacts failed checksum verification");
    await execute(client, `rm -f ${remoteArchive}`);
  } finally { client.end(); }
    await mkdir(clientRoot, { recursive: true });
    runtime(workspaceId, "working", "Installing remote-built client artifacts...");
    await runLocal("tar", ["-xzf", archive, "-C", clientRoot], clientRoot); await rm(archive, { force: true });
    await validateClientRuntime(clientRoot);
    const downloadedCompatibility = readCompatibility(JSON.parse(await readFile(path.join(clientRoot, "compatibility.json"), "utf8")));
    if (!downloadedCompatibility || !compatibleClient(downloadedCompatibility, remoteCompatibility)) throw new Error("Downloaded Desktop is not compatible with the remote Core");
    await writeFile(buildMarker, `${expectedMarker}\n`, "utf8");
  } else { client.end(); runtime(workspaceId, "working", "Reusing local client build..."); }
  await launchClient(workspaceId, workspace, connection, clientRoot, clientBuilt, sessionToken);
  } finally { client.end(); }
}
async function launchClient(workspaceId: string, workspace: Workspace, connection: Connection, clientRoot: string, clientBuilt: boolean, sessionToken?: string): Promise<void> {
  const localIcon = bundle ? undefined : process.env.HATOPAD_DESKTOP_ICON;
  if (localIcon) {
    await mkdir(path.join(clientRoot, "assets"), { recursive: true });
    try { await access(path.join(clientRoot, "assets", "app-icon.png")); }
    catch { await copyFile(localIcon, path.join(clientRoot, "assets", "app-icon.png")); }
  }
  await launchManagedDesktop(clientRoot, { ...connection, kind: "ssh", remotePort: workspace.remotePort,
    ...(sessionToken ? { sessionToken } : {}), ...(connection.authenticationMethod === "agent" ? { agentSocket: process.env.SSH_AUTH_SOCK } : {}) });
  runtime(workspaceId, "client", `Desktop launched (Gateway can be closed)${clientBuilt ? " (artifacts reused)" : " (artifacts downloaded)"}`);
}
async function launchManagedDesktop(desktopRoot: string, connection: Record<string, unknown>): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(desktopRoot, "compatibility.json"), "utf8"));
  if (manifest.connectionHandoff !== 1) throw new Error("This Desktop version cannot own its connection. Update/rebuild Desktop before connecting.");
  const desktopMain = path.join(desktopRoot, "dist-electron/main.js");
  await access(desktopMain);
  const file = await writeDesktopHandoff(path.join(app.getPath("userData"), "connection-launches"), connection);
  const desktop = desktopCommand(desktopMain);
  const logPath = path.join(app.getPath("userData"), "logs", "desktop-launch.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  const log = await open(logPath, "a", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(desktop.command, [...desktop.args, "--connection-file", file], {
      cwd: desktopRoot, env: { ...process.env, VITE_DEV_SERVER_URL: "", HATOPAD_SESSION_TOKEN: "", HATOPAD_SESSION_TOKEN_FILE: "" }, detached: true, stdio: ["ignore", log.fd, log.fd]
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  } catch (error) { await rm(file, { force: true }); throw error; }
  finally { await log.close(); }
  try {
    const deadline = Date.now() + 15_000;
    while (await access(file).then(() => true, () => false)) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) throw new Error(`Desktop did not accept its connection handoff. Inspect ${logPath} for the startup error.`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    child.unref();
  } catch (error) { child.kill(); await rm(file, { force: true }); throw error; }
}

function cloudDesktopRoot(): string { return bundledDesktop ?? path.resolve(directory, "../../desktop"); }
async function cloudTarget(coreId: string): Promise<CloudRelayTarget> {
  const client = await cloudClient();
  const account = await client.account();
  const core = account.cores.find((item) => item.id === coreId);
  if (!core) throw new Error("Cloud Core is unavailable.");
  if (core.status !== "online") throw new Error("Cloud Core is offline. Refresh cloud status and try again.");
  return { origin: client.origin, coreId, cookie: async () => (await cloudSession().cookies.get({ url: client.origin })).map(cookie => `${cookie.name}=${cookie.value}`).join("; ") };
}
async function cloudRoots(target: CloudRelayTarget) {
  const compatibility = readCompatibility(JSON.parse(await readFile(path.join(cloudDesktopRoot(), "compatibility.json"), "utf8")));
  if (!compatibility) throw new Error("Desktop compatibility metadata is unavailable. Rebuild or reinstall Gateway.");
  return listCloudRoots(target, compatibility);
}
const cloudSettings = createCloudSettingsStore(path.join(app.getPath("userData"), "cloud.json"));
async function saveCloudOrigin(input: string): Promise<string> {
  const origin = cloudOrigin(input.trim());
  const previous = (await cloudSettings.read()).origin;
  if (previous && previous !== origin) {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && window.webContents.session === cloudSession()) window.close();
    await cloudSession().clearStorageData();
  }
  await cloudSettings.update((value) => { value.origin = origin; });
  return origin;
}
handleIpc("gateway:cloudSaveOrigin", async (_event, input: string) => {
  if (cloudConnecting) throw new Error("Close cloud sign-in before changing its URL.");
  return saveCloudOrigin(input);
});
function cloudSession() { return session.fromPartition("persist:hatopad-cloud"); }
async function cloudClient(): Promise<CloudClient> {
  const { origin } = await cloudSettings.read();
  if (!origin) throw new Error("Connect to cloud first.");
  return new CloudClient(origin, (input, init) => cloudSession().fetch(input instanceof URL ? input.href : input, init));
}
let cloudConnecting = false;
let cloudLoginAbort: AbortController | undefined;
app.on("will-quit", () => cloudLoginAbort?.abort());
handleIpc("gateway:cloudCancelSignIn", () => cloudLoginAbort?.abort());
handleIpc("gateway:cloudGet", async () => {
  if (!(await cloudSettings.read()).origin) return undefined;
  try { return await (await cloudClient()).account(); }
  catch (error) { if (error instanceof Error && error.message.startsWith("Sign in")) return undefined; throw error; }
});
handleIpc("gateway:cloudConnect", async (_event, input: string) => {
  if (cloudConnecting) throw new Error("Cloud sign-in is already open.");
  cloudConnecting = true;
  cloudLoginAbort = new AbortController();
  try {
    const origin = await saveCloudOrigin(input);
    const client = new CloudClient(origin, (input, init) => cloudSession().fetch(input instanceof URL ? input.href : input, init));
    let account;
    try { account = await client.account(); } catch { /* Sign in through the Hub's OIDC flow. */ }
    if (!account) {
      await signInCloudWithBrowser({ origin, fetch: (input, init) => cloudSession().fetch(input instanceof URL ? input.href : input, init), openExternal: (url) => electronShell.openExternal(url), signal: cloudLoginAbort.signal });
      account = await client.account();
    }
    return account;
  } finally { cloudConnecting = false; cloudLoginAbort = undefined; }
});
handleIpc("gateway:cloudDisconnect", async () => {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && window.webContents.session === cloudSession()) window.close();
  await cloudSession().clearStorageData();
});
async function managedCloudCore(origin: string, coreId: string): Promise<ManagedCloudCore | undefined> {
  const state = await readState();
  const workspaces = state.workspaces.filter(item => /^[A-Za-z0-9_-]{1,200}$/.test(item.id));
  const matches = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const pairing = value as { hubUrl?: string; coreId?: string };
    try { return pairing.coreId === coreId && typeof pairing.hubUrl === "string" && cloudOrigin(pairing.hubUrl) === origin; } catch { return false; }
  };
  // Pairing files contain private credentials: only compare their public identity here.
  for (const connection of state.connections.filter(item => item.kind === "local")) {
    for (const workspace of workspaces.filter(item => item.connectionId === connection.id)) {
      try {
        const pairing = JSON.parse(await readFile(path.join(app.getPath("userData"), "cloud-pairings", `${workspace.id}.json`), "utf8"));
        const entry = localServers.get(workspace.id)?.spawnargs[1];
        const running = entry && path.basename(entry) === "core-release-service.mjs" ? path.join(path.dirname(entry), "../packages/core/dist/index.js") : entry;
        const selected = matchLocalCloudCore(pairing, origin, coreId, workspace.id, coreTarget(process.platform, process.arch), running);
        if (selected) {
          const commit = state.coreReleases?.[workspace.id];
          const switched = await selectedLocalRelease(workspace.id);
          return { ...selected, ...(switched ? { release: switched } : !selected.release && commit ? { release: commit } : {}) };
        }
      } catch { /* This local workspace has no matching accessible pairing. */ }
    }
  }
  const results = await Promise.allSettled(state.connections.filter(item => item.kind !== "local").map(async connection => {
    const ids = workspaces.filter(item => item.connectionId === connection.id).map(item => item.id);
    if (!ids.length) return undefined;
    const ssh = await connect(await credentials(connection.id, state));
    try {
      const script = `const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const entries=[];for(const id of ${JSON.stringify(ids)}){try{const pairing=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.hatopad/cloud-pairings',id+'.json'),'utf8'));let release;try{release=fs.readFileSync(path.join(os.homedir(),'.hatopad-server-'+id+'.release'),'utf8').trim()}catch{}entries.push({id,hubUrl:pairing.hubUrl,coreId:pairing.coreId,release})}catch{}}console.log('HATOPAD_CLOUD_MANAGED:'+JSON.stringify({os:os.platform(),arch:os.arch(),entries}))`;
      // Packaged hosts need no system Node/npm: prefer an installed release's runtime.
      const environment = `export PATH="$HOME/.local/bin:$HOME/.volta/bin:$PATH:/usr/local/bin:/opt/homebrew/bin"
for workspace_id in ${ids.map(shell).join(" ")}; do
  selected=$(cat "$HOME/.hatopad-server-$workspace_id.release" 2>/dev/null || true)
  if [[ "$selected" =~ ^[0-9a-f]{40,64}-node[0-9]+(-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$ ]] && [ -x "$HOME/.hatopad-deploy/releases/$selected/bin/node" ]; then
    export PATH="$HOME/.hatopad-deploy/releases/$selected/bin:$PATH"; break
  fi
done
if ! command -v node >/dev/null 2>&1; then
${remoteNodeEnvironment}
fi`;
      const output = await execute(ssh, `bash -lc ${shell(`${environment}; node -e ${shell(script)}`)}`);
      const line = output.split(/\r?\n/).find(item => item.startsWith("HATOPAD_CLOUD_MANAGED:"));
      if (!line) return undefined;
      const metadata = JSON.parse(line.slice("HATOPAD_CLOUD_MANAGED:".length)) as { os: string; arch: string; entries: { id: string; hubUrl?: string; coreId?: string; release?: string }[] };
      const entry = metadata.entries.find(item => ids.includes(item.id) && matches(item));
      return entry ? { workspaceId: entry.id, target: coreTarget(metadata.os, metadata.arch), ...(entry.release ? { release: entry.release } : {}) } : undefined;
    } finally { ssh.end(); }
  }));
  const selected = results.find((result): result is PromiseFulfilledResult<ManagedCloudCore> => result.status === "fulfilled" && Boolean(result.value))?.value;
  if (selected) return selected;
  if (results.some(result => result.status === "rejected")) throw new CoreUpdateCheckError("Could not inspect a saved SSH host. Reconnect its management connection and check Node access, then retry.");
  return undefined;
}
async function cloudReleaseSettings(origin: string): Promise<{ settings: RepositorySettings; compatibility: Compatibility }> {
  const client = await cloudClient();
  if (client.origin !== origin) throw new CoreUpdateCheckError("Cloud account changed. Refresh before updating.");
  let environment;
  try { environment = await client.environment(); }
  catch (error) { throw new CoreUpdateCheckError(error instanceof Error && /^(Hub does not advertise|Gateway and Hub support)/.test(error.message) ? error.message : "Could not read Hub protocol requirements. Reconnect to Hub and retry."); }
  return { settings: { ...(await readState()).repository, branch: environment.releaseBranch }, compatibility: environment.protocolCompatibility };
}
const localCoreReleases = new LocalCoreReleases(path.join(app.getPath("userData"), "core-releases"));
const cloudCoreUpdates = new CloudCoreUpdates({ bundle, resolve: managedCloudCore,
  compatibility: async origin => (await cloudReleaseSettings(origin)).compatibility,
  git: {
    check: async (_core, origin) => {
      const { settings, compatibility } = await cloudReleaseSettings(origin);
      // GitHub discovery runs on Gateway, independently of the remote Core, Node and Git.
      try { return await localCoreReleases.check(settings, compatibility); }
      catch (error) { throw new CoreUpdateCheckError(coreUpdateCheckReason(error, settings.branch)); }
    },
    deploy: async (workspaceId, commit, origin) => {
      const { settings, compatibility } = await cloudReleaseSettings(origin);
      return (await workspaceAndStoredConnection(workspaceId)).connection.kind === "local"
        ? startLocalServer(workspaceId, commit, settings, false, compatibility)
        : startServer(workspaceId, false, commit, settings, compatibility);
    }
  },
  hub: async (origin, coreId, branch, commit) => {
    const { compatibility } = await cloudReleaseSettings(origin);
    return applyCloudCoreUpdate(await cloudTarget(coreId), compatibility, branch, commit).catch(error => { if (error instanceof CloudUpdateUncertainError) throw error; return "unavailable" as const; });
  },
  deploy: async workspaceId => (await workspaceAndStoredConnection(workspaceId)).connection.kind === "local" ? startLocalServer(workspaceId, undefined, undefined, true) : startServer(workspaceId),
  run: (workspaceId, action) => workspaceOperations.run(workspaceId, "cloud-core-update", action)
});
async function authorizedCloudCore(coreId: string): Promise<string> {
  const client = await cloudClient();
  if (!(await client.account()).cores.some(item => item.id === coreId && item.access === "owner")) throw new Error("Cloud Core is unavailable.");
  return client.origin;
}
handleIpc("gateway:cloudCoreUpdateInfo", async (_event, coreId: string) => cloudCoreUpdates.info(await authorizedCloudCore(coreId), coreId));
handleIpc("gateway:cloudUpdateCore", async (_event, coreId: string, expectedRelease: string) => cloudCoreUpdates.update(await authorizedCloudCore(coreId), coreId, expectedRelease));
handleIpc("gateway:cloudListCores", async (_event, coreId: string) => cloudRoots(await cloudTarget(coreId)));
handleIpc("gateway:cloudOpen", async (_event, coreId: string, rootId: string) => {
  const target = await cloudTarget(coreId);
  if (typeof rootId !== "string" || !rootId) throw new Error("Cloud workspace is unavailable. Refresh the Core list.");
  const desktopRoot = cloudDesktopRoot();
  const desktopMain = path.join(desktopRoot, "dist-electron/main.js");
  await access(desktopMain).catch(() => { throw new Error("Desktop is missing. Build or reinstall Gateway before connecting to cloud."); });
  await launchManagedDesktop(desktopRoot, { kind: "cloud", origin: target.origin, coreId, rootId, cookie: await target.cookie() });
});
handleIpc("gateway:cloudAddServer", async (_event, workspaceId: string) => workspaceOperations.run(workspaceId, "add-to-cloud", async () => {
  const cloud = await cloudClient();
  const account = await cloud.account();
  const { workspace, connection } = await workspaceAndStoredConnection(workspaceId);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(workspace.id)) throw new Error("Invalid workspace ID");
  const script = cloudPairingScript(cloud.origin, account.user.email, workspace.name);
  let claim: Promise<unknown> | undefined;
  const onLine = (line: string) => {
    const match = /^HATOPAD_PAIR_CODE:([A-Za-z0-9-]{4,32})$/.exec(line);
    if (match && !claim) { claim = cloud.call("/api/pairings/claim", { code: match[1] }); void claim.catch(() => undefined); }
  };
  if (connection.kind === "local") {
    const { coreMain, node, env } = await localArtifactPaths();
    const pairingFile = path.join(app.getPath("userData"), "cloud-pairings", `${workspace.id}.json`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(node, ["--input-type=module", "-e", script], { cwd: path.resolve(path.dirname(coreMain), "../../.."), env: { ...env, HATOPAD_HUB_PAIRING_FILE: pairingFile }, stdio: ["ignore", "pipe", "pipe"] });
      let pending = "";
      child.stdout.on("data", (data) => { pending += data.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ""; lines.forEach(onLine); });
      child.stderr.resume();
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Cloud pairing timed out.")); }, 180_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error("Cloud pairing failed. The server may already be paired; check its cloud account.")); });
    });
    await claim;
    await startLocalServer(workspaceId);
  } else {
    const ssh = await connect(await credentials(connection.id));
    try {
      const command = `set -eu; ${remoteNodeEnvironment}; ${workspaceReleaseDirectory(workspace.id)}; cd "$release_directory"; if [ -x bin/node ]; then export PATH="$PWD/bin:$PATH"; fi; export HATOPAD_HUB_PAIRING_FILE="$HOME/.hatopad/cloud-pairings/${workspace.id}.json"; node --input-type=module -e ${shell(script)}`;
      await execute(ssh, `bash -lc ${shell(command)}`, onLine);
      await claim;
    } finally { ssh.end(); }
    await startServer(workspaceId);
  }
  return cloud.account();
}));

handleIpc("gateway:get", async () => {
  const state = await readState();
  setTimeout(() => { void refreshStatuses(); }, 0);
  return { cloudOrigin: (await cloudSettings.read()).origin ?? "", state: publicState(state), repository: state.repository, distribution: bundle ? "bundled" : "source", runtimes: Object.fromEntries(runtimes), tunnelRuntimes: Object.fromEntries(portTunnelRuntimes), connectionRuntimes: Object.fromEntries(connectionRuntimes) };
});
handleIpc("gateway:saveRepository", async (_event, input: Partial<RepositorySettings>) => { if (bundle) throw new Error("Repository settings are unavailable in bundled releases"); if (!input.repository?.trim() || !input.branch?.trim()) throw new Error("Repository URL and branch are required"); const { result } = await updateState((state) => { state.repository = normalizeRepositorySettings(input); return state.repository; }); return result; });
handleIpc("gateway:refreshStatuses", (_event, connectionId?: string) => refreshStatuses(connectionId));
handleIpc("gateway:copyDiagnostics", async (_event, connectionId: string) => {
  const state = await readState();
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) throw new Error("SSH connection was not found");
  const workspaces = state.workspaces.filter((item) => item.connectionId === connectionId);
  const portTunnelItems = state.portTunnels.filter((item) => item.connectionId === connectionId);
  const report = buildConnectionDiagnostics({
    generatedAt: new Date().toISOString(), version: app.getVersion(), platform: `${process.platform}-${process.arch}`,
    connection: { name: connection.name, authenticationMethod: normalizeStoredAuthentication(connection).authenticationMethod },
    connectionRuntime: connectionRuntimes.get(connectionId), workspaces, runtimes: Object.fromEntries(runtimes),
    tunnels: portTunnelItems, tunnelRuntimes: Object.fromEntries(portTunnelRuntimes),
  });
  clipboard.writeText(report);
  return { copiedAt: new Date().toISOString() };
});
handleIpc("gateway:pickPrivateKey", async () => {
  const selected = await dialog.showOpenDialog({ title: "Choose SSH private key", properties: ["openFile"], filters: [{ name: "SSH private keys", extensions: ["pem", "key", "ppk"] }, { name: "All files", extensions: ["*"] }] });
  if (selected.canceled || !selected.filePaths[0]) return undefined;
  const selectedPath = selected.filePaths[0];
  validatePrivateKeyPath(selectedPath);
  let key: Buffer;
  try { key = await readFile(selectedPath); }
  catch { throw new Error(`Could not read the private key file at ${selectedPath}`); }
  try { validatePrivateKey(key); }
  catch (error) {
    // A passphrase is entered in the form after selecting an encrypted key.
    if (!(error instanceof Error) || !/requires its passphrase/.test(error.message)) throw error;
  }
  return selectedPath;
});
handleIpc("gateway:testConnection", async (_event, input: { id?: string; kind?: "ssh" | "local"; host: string; port: number; username: string; authenticationMethod: AuthenticationMethod; password?: string; privateKeyPath?: string; passphrase?: string; hostKeyFingerprint?: string }) => {
  if (input.kind === "local") return { message: "Local Mac connection is ready." };
  const authenticationMethod = input.authenticationMethod === "privateKey" || input.authenticationMethod === "agent" ? input.authenticationMethod : "password";
  if (!input.host.trim() || !input.username.trim() || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("Host, username, and a valid SSH port are required");
  const existing = input.id ? (await readState()).connections.find((item) => item.id === input.id) : undefined;
  const saved = existing && normalizeStoredAuthentication(existing).authenticationMethod === authenticationMethod ? await credentials(input.id!) : undefined;
  const base = { host: input.host.trim(), port: input.port, username: input.username.trim(), ...(input.hostKeyFingerprint ? { hostKeyFingerprint: input.hostKeyFingerprint } : {}) };
  const connection = authenticationMethod === "privateKey"
    ? { ...base, authenticationMethod, privateKeyPath: input.privateKeyPath?.trim() || (saved?.authenticationMethod === "privateKey" ? saved.privateKeyPath : ""), ...(input.passphrase ? { passphrase: input.passphrase } : saved?.authenticationMethod === "privateKey" && saved.passphrase ? { passphrase: saved.passphrase } : {}) } as const
    : authenticationMethod === "agent" ? { ...base, authenticationMethod } as const
    : { ...base, authenticationMethod, password: input.password || (saved?.authenticationMethod === "password" ? saved.password : "") } as const;
  if (connection.authenticationMethod === "password" && !connection.password) throw new Error("Password is required");
  let fingerprint: string | undefined;
  await testSshConnection(await connectionConfig(connection, readFile, (value) => { fingerprint = value; }), connectWithConfig);
  return { message: `SSH connection succeeded. Server host key: ${fingerprint ?? "unavailable"}`, hostKeyFingerprint: fingerprint };
});
handleIpc("gateway:saveConnection", async (_event, input: { id?: string; kind?: "ssh" | "local"; name: string; host: string; port: number; username: string; authenticationMethod: AuthenticationMethod; password?: string; privateKeyPath?: string; passphrase?: string; hostKeyFingerprint?: string }) => {
  const { result } = await updateState(async (state) => {
    const existing = input.id ? state.connections.find((item) => item.id === input.id) : undefined;
    if (input.kind === "local") {
      if (bundle && process.platform === "win32") throw new Error("Connect to a Linux or WSL host over SSH to run bundled Core on Windows");
      const item: StoredConnection = { id: input.id ?? id(), kind: "local", name: input.name.trim(), host: "localhost", port: 0, username: process.env.USER ?? "local", authenticationMethod: "agent", password: "" };
      if (!item.name) throw new Error("Connection name is required");
      state.connections = [...state.connections.filter((value) => value.id !== item.id), item]; return publicState(state);
    }
    if (!input.hostKeyFingerprint) throw new Error("Test the SSH connection and explicitly trust its server host-key fingerprint before saving.");
    const item: StoredConnection = { id: input.id ?? id(), name: input.name, host: input.host, port: input.port, username: input.username, authenticationMethod: input.authenticationMethod, password: "", hostKeyFingerprint: input.hostKeyFingerprint };
    if (input.authenticationMethod === "password") { item.password = input.password ? encrypt(input.password) : existing?.authenticationMethod !== "privateKey" ? existing?.password ?? "" : ""; if (!item.password) throw new Error("Password is required"); }
    else if (input.authenticationMethod === "privateKey") { item.privateKeyPath = input.privateKeyPath?.trim() || (existing?.authenticationMethod === "privateKey" ? existing.privateKeyPath : ""); if (!item.privateKeyPath) throw new Error("A private key file is required for key authentication"); validatePrivateKeyPath(item.privateKeyPath); let key: Buffer; try { key = await readFile(item.privateKeyPath); } catch { throw new Error(`Could not read the private key file at ${item.privateKeyPath}`); } validatePrivateKey(key, input.passphrase || (existing?.authenticationMethod === "privateKey" && existing.passphrase ? decrypt(existing.passphrase) : undefined)); item.passphrase = input.passphrase ? encrypt(input.passphrase) : existing?.authenticationMethod === "privateKey" ? existing.passphrase : undefined; }
    state.connections = [...state.connections.filter((value) => value.id !== item.id), item]; return publicState(state);
  });
  return result;
});
handleIpc("gateway:deleteConnection", async (_event, connectionId: string) => { const { result } = await updateState((state) => { for (const workspace of state.workspaces.filter((item) => item.connectionId === connectionId)) { localServers.get(workspace.id)?.kill(); localServers.delete(workspace.id); } for (const tunnel of state.portTunnels.filter((item) => item.connectionId === connectionId)) stopPortTunnel(tunnel.id, false); state.connections = state.connections.filter((item) => item.id !== connectionId); state.workspaces = state.workspaces.filter((item) => item.connectionId !== connectionId); state.portTunnels = state.portTunnels.filter((item) => item.connectionId !== connectionId); return publicState(state); }); return result; });
handleIpc("gateway:discoverWorkspaceDirectories", async (_event, connectionId: string) => {
  const stored = (await readState()).connections.find((item) => item.id === connectionId);
  if (stored?.kind === "local") return [];
  const client = await connect(await credentials(connectionId));
  try { return parseDiscoveredWorkspaceDirectories(await execute(client, workspaceDiscoveryCommand())); }
  finally { client.end(); }
});
handleIpc("gateway:pickWorkspaceDirectory", async () => {
  const selected = await dialog.showOpenDialog({ title: "Choose local project", properties: ["openDirectory", "createDirectory"] });
  return selected.canceled ? undefined : selected.filePaths[0];
});
handleIpc("gateway:saveWorkspace", async (_event, input: Omit<Workspace, "id"> & { id?: string }) => {
  const directory = input.directory.trim();
  if (!input.name.trim()) throw new Error("Workspace name is required");
  if (!Number.isInteger(input.remotePort) || input.remotePort < 1024 || input.remotePort > 65535) throw new Error("Core port must be between 1024 and 65535");
  const { result } = await updateState(async (state) => {
    const previous = input.id ? state.workspaces.find((item) => item.id === input.id) : undefined;
    const storedConnection = state.connections.find((item) => item.id === input.connectionId);
    if (!storedConnection) throw new Error("Connection was not found");
    if (storedConnection.kind === "local") {
      const preparedDirectory = await prepareLocalWorkspaceDirectory(directory);
      const item = { ...input, name: input.name.trim(), directory: preparedDirectory, id: input.id ?? id() } as Workspace;
      state.workspaces = [...state.workspaces.filter((value) => value.id !== item.id), item]; return publicState(state);
    }
    validateWorkspaceDirectoryInput(directory);
    const client = await connect(await credentials(input.connectionId, state));
    let validatedDirectory: string;
    try {
      validatedDirectory = parseValidatedWorkspaceDirectory(await execute(client, workspaceValidationCommand(directory)));
      await execute(client, workspaceRegistrationCommand(validatedDirectory));
      if (previous?.connectionId === input.connectionId && previous.directory !== validatedDirectory && !state.workspaces.some((item) => item.id !== previous.id && item.connectionId === previous.connectionId && item.directory === previous.directory)) await execute(client, workspaceUnregistrationCommand(previous.directory));
    }
    finally { client.end(); }
    const item = { ...input, name: input.name.trim(), directory: validatedDirectory, id: input.id ?? id() } as Workspace;
    state.workspaces = [...state.workspaces.filter((value) => value.id !== item.id), item]; return publicState(state);
  });
  return result;
});
handleIpc("gateway:deleteWorkspace", async (_event, workspaceId: string) => {
  const { state, result: workspace } = await updateState((state) => {
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    localServers.get(workspaceId)?.kill(); localServers.delete(workspaceId);
    state.workspaces = state.workspaces.filter((item) => item.id !== workspaceId);
    return workspace;
  });
  const storedConnection = workspace ? state.connections.find((item) => item.id === workspace.connectionId) : undefined;
  if (workspace && storedConnection?.kind !== "local" && !state.workspaces.some((item) => item.connectionId === workspace.connectionId && item.directory === workspace.directory)) {
    let client: Client | undefined;
    try { client = await connect(await credentials(workspace.connectionId)); await execute(client, workspaceUnregistrationCommand(workspace.directory)); }
    catch { /* Local removal must remain possible while the SSH server is offline. */ }
    finally { client?.end(); }
  }
  return publicState(await readState());
});
handleIpc("gateway:savePortTunnel", async (_event, input: Omit<PortTunnel, "id"> & { id?: string }) => { if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("Tunnel port must be between 1 and 65535"); if (input.id) stopPortTunnel(input.id, false); const { result } = await updateState((state) => { if (!state.connections.some((item) => item.id === input.connectionId)) throw new Error("SSH connection was not found"); const item = { ...input, id: input.id ?? id() } as PortTunnel; if (state.portTunnels.some((value) => value.id !== item.id && value.connectionId === item.connectionId && value.port === item.port)) throw new Error(`Port ${item.port} is already configured for this connection`); state.portTunnels = [...state.portTunnels.filter((value) => value.id !== item.id), item]; return publicState(state); }); return result; });
handleIpc("gateway:deletePortTunnel", async (_event, tunnelId: string) => { stopPortTunnel(tunnelId, false); const { result } = await updateState((state) => { state.portTunnels = state.portTunnels.filter((item) => item.id !== tunnelId); return publicState(state); }); portTunnelRuntimes.delete(tunnelId); return result; });
handleIpc("gateway:startPortTunnel", (_event, tunnelId: string) => startPortTunnel(tunnelId));
handleIpc("gateway:stopPortTunnel", (_event, tunnelId: string) => stopPortTunnel(tunnelId));
handleIpc("gateway:startServer", async (_event, workspaceId: string) => workspaceOperations.run(workspaceId, "start-server", async () => (await workspaceAndStoredConnection(workspaceId)).connection.kind === "local" ? startLocalServer(workspaceId) : startServer(workspaceId)));
handleIpc("gateway:repairServer", async (_event, workspaceId: string) => workspaceOperations.run(workspaceId, "repair-server", async () => (await workspaceAndStoredConnection(workspaceId)).connection.kind === "local" ? startLocalServer(workspaceId) : startServer(workspaceId, true)));
handleIpc("gateway:cancelProvisioning", (_event, workspaceId: string) => { cancelledProvisioning.add(workspaceId); provisioningClients.get(workspaceId)?.end(); runtime(workspaceId, "idle", "Provisioning cancelled"); });
handleIpc("gateway:stopServer", async (_event, workspaceId: string) => workspaceOperations.run(workspaceId, "stop-server", async () => { if ((await workspaceAndStoredConnection(workspaceId)).connection.kind !== "local") return stopServer(workspaceId); await stopLocalServer(workspaceId); runtime(workspaceId, "idle", "Stopped"); }));
handleIpc("gateway:startClient", async (_event, workspaceId: string) => workspaceOperations.run(workspaceId, "start-client", async () => (await workspaceAndStoredConnection(workspaceId)).connection.kind === "local" ? startLocalClient(workspaceId) : startClient(workspaceId)));

handleIpc("gateway:window-fullscreen", (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false);

function createWindow(): void {
  const window = new BrowserWindow({ show: !bundleSmokeTest, width: 1040, height: 720, minWidth: 820, minHeight: 560, icon: appIcon, backgroundColor: "#f6f8fd", titleBarStyle: "hidden", trafficLightPosition: { x: 28, y: 28 }, ...(process.platform !== "darwin" ? { titleBarOverlay: { color: "#f6f8fd", symbolColor: "#52627e", height: 40 } } : {}), webPreferences: { preload: path.join(directory, "preload.cjs"), contextIsolation: true, nodeIntegration: false } });
  const publishFullscreen = () => window.webContents.send("gateway:fullscreen-changed", window.isFullScreen());
  window.on("enter-full-screen", publishFullscreen);
  window.on("leave-full-screen", publishFullscreen);
  window.removeMenu(); const devUrl = process.env.VITE_DEV_SERVER_URL;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guardNavigation = (event: { preventDefault(): void }, url: string) => { if (!isTrustedRendererUrl(url, rendererFilePath, devUrl)) event.preventDefault(); };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  const load = devUrl ? window.loadURL(devUrl) : window.loadFile(rendererFilePath);
  if (bundleSmokeTest) {
    const timeout = setTimeout(() => app.exit(1), 30_000);
    void load.then(async () => {
      const distribution = bundle ? "bundled" : "source";
      const healthy = await window.webContents.executeJavaScript(`window.gateway && window.gateway.get().then(result => result.distribution === '${distribution}')`);
      if (!healthy) throw new Error("Gateway renderer, preload or distribution mode failed");
      await access(bundledDesktop ? path.join(bundledDesktop, "dist-electron", "main.js") : process.env.HATOPAD_DESKTOP_EXECUTABLE!);
      if (process.argv.includes("--bundle-core-smoke-test") || process.argv.includes("--startup-core-smoke-test")) {
        const { createServer } = await import("node:net");
        const probe = createServer();
        await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
        const address = probe.address();
        if (!address || typeof address === "string") throw new Error("Could not allocate local Core test port");
        await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
        const smokeId = "bundle-smoke-local";
        await updateState(state => {
          state.connections.push({ id: smokeId, kind: "local", name: "Bundle smoke", host: "127.0.0.1", port: 22, username: "", password: "" });
          state.workspaces.push({ id: smokeId, connectionId: smokeId, name: "Bundle smoke", directory: path.join(app.getPath("userData"), "workspace"), remotePort: address.port });
        });
        try {
          await startLocalServer(smokeId);
          await stopLocalServer(smokeId);
          await startLocalServer(smokeId);
        } finally { await stopLocalServer(smokeId); }
        console.log(`[gateway] ${distribution} local Core passed start, stop and restart checks`);
      }
      clearTimeout(timeout); app.exit(0);
    }).catch(error => { console.error(error); app.exit(1); });
  } else void load.catch(error => console.error("Gateway page load failed", error));
}
if (ownsInstance) app.whenReady().then(() => {
  app.setName("HatoPad Gateway"); process.title = "HatoPad Gateway";
  if (process.platform === "darwin") app.dock?.setIcon(nativeImage.createFromPath(appIcon));
  powerMonitor.on("resume", () => {
    for (const tunnel of portTunnels.values()) tunnel.reconnect();
  });
  createWindow();
});
app.on("window-all-closed", () => { for (const tunnel of portTunnels.values()) tunnel.stop(); if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
