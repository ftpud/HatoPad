import { McpOAuthCallbacks } from "./mcp-oauth-callback.js";
import { startManagedConnection, type ManagedDesktopConnection } from "./managed-connection.js";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  powerMonitor,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsStore } from "./settings-store.js";
import { registerProjectTransferIpc } from "./project-transfer.js";
import { restoreWindowInputFocus } from "./window-focus.js";
import { isTrustedIpcFrame, isTrustedRendererUrl } from "./navigation-policy.js";
import { connectionToken } from "./connection-token.js";
import { legacyUserDataPath } from "./legacy-user-data.js";
import { applyLegacyEnvironmentWithWarning } from "@hatopad/protocol";
import {
  buildInstanceAddress,
  claimBuildInstance,
  desktopBuildFingerprint,
  type BuildInstanceLaunch,
} from "./build-instance.js";

applyLegacyEnvironmentWithWarning(process.env);

const bundleSmokeTest =
  (app.isPackaged && process.argv.includes("--bundle-smoke-test")) ||
  (!app.isPackaged && process.argv.includes("--startup-smoke-test"));
if (bundleSmokeTest)
  app.setPath("userData", path.join(app.getPath("temp"), `hatopad-desktop-bundle-smoke-${process.pid}`));
const directory = path.dirname(fileURLToPath(import.meta.url));
const appIcon = path.join(directory, "../assets/app-icon.png");
const rendererFilePath = path.resolve(directory, "../dist-renderer/index.html");
const dirtyWindows = new Set<number>();
const confirmedCloseWindows = new Set<number>();

function launchOption(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** One launch (usually one Gateway "Open"): its Core target, optional owned tunnel, and the windows using it. */
type LaunchConfig = { host?: string; port?: string; rootId?: string; cloudOrigin?: string };
type DesktopSession = { config: LaunchConfig; managed?: ManagedDesktopConnection; windows: Set<BrowserWindow> };
const sessions = new Set<DesktopSession>();
const windowSessions = new Map<number, DesktopSession>();
app.on("will-quit", () => {
  for (const session of sessions) session.managed?.stop();
});

const startupLaunch: BuildInstanceLaunch = Object.fromEntries(
  Object.entries({
    connectionFile: launchOption("connection-file"),
    host: launchOption("host"),
    port: launchOption("port"),
    rootId: launchOption("root-id"),
    cloudOrigin: launchOption("cloud-origin"),
  }).filter((entry) => entry[1] !== undefined),
);
function plainConfig(launch: BuildInstanceLaunch): LaunchConfig {
  const { connectionFile: _connectionFile, ...config } = launch;
  return config;
}

if (!bundleSmokeTest) app.setPath("userData", legacyUserDataPath(app.getPath("appData"), "Vibe Editor", "HatoPad"));
process.title = "HatoPad";
app.name = "HatoPad";
app.setName("HatoPad");
app.setAppUserModelId("com.hatopad.desktop");
app.commandLine.appendSwitch("class", "HatoPad");

// Launches of the same Desktop build share one process, so the Dock stacks their windows; other builds stay apart.
let pendingLaunches: BuildInstanceLaunch[] | undefined = [];
let releaseBuildInstance: () => void = () => undefined;
if (!bundleSmokeTest) {
  const fingerprint = desktopBuildFingerprint(path.resolve(directory, ".."), [
    app.getPath("userData"),
    process.env.VITE_DEV_SERVER_URL ?? "",
  ]);
  const claim = await claimBuildInstance(
    buildInstanceAddress(fingerprint, app.getPath("userData")),
    startupLaunch,
    (launch) => (pendingLaunches ? pendingLaunches.push(launch) : void openLaunch(launch)),
  );
  if (claim.role === "forwarded") {
    app.exit(0);
    await new Promise(() => undefined);
  } else releaseBuildInstance = claim.close;
}
app.on("will-quit", () => releaseBuildInstance());

const settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
function assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const frame = event.senderFrame;
  if (
    !isTrustedIpcFrame(
      frame ? { url: frame.url, isMainFrame: frame.parent === null } : null,
      Boolean(BrowserWindow.fromWebContents(event.sender)),
      rendererFilePath,
      process.env.VITE_DEV_SERVER_URL,
    )
  ) {
    throw new Error("IPC request rejected from an untrusted renderer frame");
  }
}
function handleIpc(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return listener(event, ...args);
  });
}
function onIpc(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event)) {
      event.returnValue = undefined;
      return;
    }
    listener(event, ...args);
  });
}
function isTrustedIpcEvent(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return isTrustedIpcFrame(
    frame ? { url: frame.url, isMainFrame: frame.parent === null } : null,
    Boolean(BrowserWindow.fromWebContents(event.sender)),
    rendererFilePath,
    process.env.VITE_DEV_SERVER_URL,
  );
}
registerProjectTransferIpc(assertTrustedIpcSender);
handleIpc("desktop:connection-token", (event, host: unknown, port: unknown) => {
  const owner = windowSessions.get(event.sender.id);
  const managed = [owner, ...sessions].find(
    (session) => session?.managed && host === session.managed.host && String(port) === session.managed.port,
  )?.managed;
  return managed ? managed.token : connectionToken(host, port, owner?.config ?? plainConfig(startupLaunch));
});
onIpc("desktop:settings-load", (event) => {
  event.returnValue = settings.all();
});
onIpc("desktop:settings-write", (_event, key: unknown, value: unknown) => settings.set(key, value));
app.on("before-quit", () => settings.flush());

onIpc("desktop:fullscreen-state", (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (owner) event.sender.send("desktop:fullscreen-changed", owner.isFullScreen());
});

onIpc("desktop:window-theme", (event, theme: unknown) => {
  if (theme !== "light" && theme !== "dark") return;
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner) return;
  owner.setBackgroundColor(theme === "dark" ? "#141927" : "#f6f8fd");
  if (process.platform !== "darwin")
    owner.setTitleBarOverlay({
      color: theme === "dark" ? "#141927" : "#edf1fc",
      symbolColor: theme === "dark" ? "#dce4f5" : "#25324d",
      height: 48,
    });
});

onIpc("editor:dirty-state", (event, dirty: boolean) => {
  if (dirty) dirtyWindows.add(event.sender.id);
  else dirtyWindows.delete(event.sender.id);
});
handleIpc("desktop:clipboard-read", () => clipboard.readText());
handleIpc("desktop:restore-input-focus", (event) =>
  restoreWindowInputFocus(BrowserWindow.fromWebContents(event.sender)),
);
handleIpc("desktop:clipboard-write", (_event, text: unknown) => {
  if (typeof text === "string" && text.length <= 2_000_000) clipboard.writeText(text);
});
const mcpOAuthCallbacks = new McpOAuthCallbacks();
const mcpOAuthOwners = new Set<number>();
app.on("before-quit", () => mcpOAuthCallbacks.close());
handleIpc("mcp-oauth:prepare", async (event, port?: unknown) => {
  if (port !== undefined && typeof port !== "number") throw new Error("Invalid OAuth callback port");
  const owner = event.sender.id;
  if (!mcpOAuthOwners.has(owner)) {
    mcpOAuthOwners.add(owner);
    event.sender.once("destroyed", () => {
      mcpOAuthCallbacks.close(owner);
      mcpOAuthOwners.delete(owner);
    });
  }
  return mcpOAuthCallbacks.prepare(event.sender.id, port);
});
handleIpc("mcp-oauth:wait", (event, id: unknown, state: unknown) => {
  if (typeof id !== "string" || typeof state !== "string") throw new Error("Invalid OAuth callback");
  return mcpOAuthCallbacks.wait(event.sender.id, id, state);
});
handleIpc("mcp-oauth:cancel", (event, id: unknown) => {
  if (typeof id === "string") mcpOAuthCallbacks.cancel(event.sender.id, id);
});
handleIpc("desktop:open-external", async (_event, value: unknown) => {
  if (typeof value !== "string" || value.length > 4096) return;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  await shell.openExternal(url.toString());
});
onIpc("editor:open-window", (event, options: unknown) => {
  if (!options || typeof options !== "object") return;
  const value = options as Record<string, unknown>;
  if (
    typeof value.host !== "string" ||
    typeof value.port !== "string" ||
    (value.type !== "file" && value.type !== "useful") ||
    typeof value.path !== "string" ||
    value.path.length > 1000 ||
    (value.rootId !== undefined && (typeof value.rootId !== "string" || value.rootId.length > 200)) ||
    (value.taskId !== undefined && (typeof value.taskId !== "string" || value.taskId.length > 200))
  )
    return;
  createWindow(windowSessions.get(event.sender.id) ?? fallbackSession(), {
    detached: "1",
    host: value.host,
    port: value.port,
    type: value.type,
    path: value.path,
    ...(value.scope === "global" || value.scope === "local" ? { scope: value.scope } : {}),
    ...(typeof value.rootId === "string" ? { rootId: value.rootId } : {}),
    ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
  });
});

async function startSession(launch: BuildInstanceLaunch): Promise<DesktopSession> {
  let config = plainConfig(launch);
  let managed: ManagedDesktopConnection | undefined;
  if (launch.connectionFile) {
    managed = await startManagedConnection(launch.connectionFile);
    config = { host: managed.host, port: managed.port, rootId: managed.rootId, cloudOrigin: managed.cloudOrigin };
  }
  const session: DesktopSession = { config, ...(managed ? { managed } : {}), windows: new Set() };
  sessions.add(session);
  return session;
}
function disposeSession(session: DesktopSession): void {
  session.managed?.stop();
  sessions.delete(session);
}
/** A window-less session kept only for macOS Dock reopen, or a plain one from the launch arguments. */
function fallbackSession(): DesktopSession {
  const latest = [...sessions].at(-1);
  if (latest) return latest;
  const session: DesktopSession = { config: plainConfig(startupLaunch), windows: new Set() };
  sessions.add(session);
  return session;
}
let launchesInFlight = 0;
async function openLaunch(launch: BuildInstanceLaunch): Promise<void> {
  launchesInFlight++;
  try {
    const session = await startSession(launch);
    for (const idle of [...sessions]) if (idle !== session && !idle.windows.size) disposeSession(idle);
    createWindow(session);
  } catch (error) {
    dialog.showErrorBox(
      "Could not connect Desktop",
      error instanceof Error ? error.message : "Desktop connection failed.",
    );
    // Quit only when nothing is open and no other launch is still connecting.
    if (launchesInFlight === 1 && !BrowserWindow.getAllWindows().length) app.quit();
  } finally {
    launchesInFlight--;
  }
}

function createWindow(session: DesktopSession, extraQuery: Record<string, string> = {}): void {
  const window = new BrowserWindow({
    title: extraQuery.detached === "1" ? (extraQuery.path?.split("/").pop() ?? "HatoPad") : "HatoPad",
    icon: appIcon,
    show: !bundleSmokeTest,
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: "#f6f8fd",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 18 },
    ...(process.platform !== "darwin"
      ? { titleBarOverlay: { color: "#edf1fc", symbolColor: "#25324d", height: 48 } }
      : {}),
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  const contentsId = window.webContents.id;
  session.windows.add(window);
  windowSessions.set(contentsId, session);
  window.on("closed", () => {
    session.windows.delete(window);
    windowSessions.delete(contentsId);
    dirtyWindows.delete(contentsId);
    confirmedCloseWindows.delete(contentsId);
    // Stop a closed project's tunnel, but keep the last one so the macOS Dock can reopen it.
    if (!session.windows.size && [...sessions].some((other) => other.windows.size)) disposeSession(session);
  });
  const publishFullscreen = () => window.webContents.send("desktop:fullscreen-changed", window.isFullScreen());
  window.on("enter-full-screen", publishFullscreen);
  window.on("leave-full-screen", publishFullscreen);
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, rendererFilePath, process.env.VITE_DEV_SERVER_URL)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererUrl(url, rendererFilePath, process.env.VITE_DEV_SERVER_URL)) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[desktop] failed to load ${url}: ${code} ${description}`);
  });
  window.on("close", (event) => {
    if (!dirtyWindows.has(contentsId) || confirmedCloseWindows.has(contentsId)) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      buttons: ["Cancel", "Close without saving"],
      defaultId: 0,
      cancelId: 0,
      title: "Unsaved changes",
      message: "There are unsaved files.",
      detail: "Closing now will discard those changes.",
    });
    if (choice === 1) {
      confirmedCloseWindows.add(contentsId);
      window.close();
    } else restoreWindowInputFocus(window);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const query = {
    ...Object.fromEntries(
      Object.entries(session.config).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    ...extraQuery,
  };
  const load = devUrl
    ? (() => {
        const url = new URL(devUrl);
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        return window.loadURL(url.toString());
      })()
    : window.loadFile(rendererFilePath, { query });
  if (bundleSmokeTest) {
    const timeout = setTimeout(() => app.exit(1), 30_000);
    void load
      .then(async () => {
        const healthy = await window.webContents.executeJavaScript(
          "Boolean(window.desktop && document.getElementById('root'))",
        );
        if (!healthy) throw new Error("Packaged Desktop renderer or preload failed");
        clearTimeout(timeout);
        app.exit(0);
      })
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  }
  void load.catch((error: unknown) => console.error("[desktop] page load failed", error));
}

void app.whenReady().then(() => {
  powerMonitor.on("resume", () => {
    for (const session of sessions) session.managed?.reconnect?.();
  });
  app.setName("HatoPad");
  process.title = "HatoPad";
  if (process.platform === "darwin") app.dock?.setIcon(nativeImage.createFromPath(appIcon));
  const queued = pendingLaunches ?? [];
  pendingLaunches = undefined;
  for (const launch of [startupLaunch, ...queued]) void openLaunch(launch);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(fallbackSession());
});
