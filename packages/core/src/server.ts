import { closeMcpConnections } from "./mcp-client.js";
import { executeWorkflowMcp } from "./mcp-library.js";
import { handleRequest } from "./routes/dispatch.js";
import type { SessionServices } from "./routes/context.js";
import {
  delay,
  DeliveryBusy,
  collectWorkflowReviewEvidence,
  runWorkflowVerification,
  startWorkflow,
  workflowCapturesSnapshots,
  availableWorkflowWorkspace,
  validateWorkflowBinding,
  resolveWorkflowBinding,
  validateWorkflowTarget,
  workflowSessionWorkspace,
  workflowFeatureOptions,
  workflowConfiguration,
  steerWorkflowSession,
  settleWorkflowSession,
  providerOperation,
  assertWorkflowModelAvailable,
} from "./request-support.js";
import { PortTunnels } from "./port-tunnels.js";
import { CoreUpdates } from "./core-update.js";

import { SupervisionFeed } from "./supervision-feed.js";

import { validateRequestPayload } from "./request-validation.js";
import { coreAccessPolicy, type CoreAccessOptions } from "./access-policy.js";
import { executeTerminalControlAsync } from "./workflow-terminal.js";
import { RequestAdmission, requestAdmissionLimit, type RequestAdmissionOptions } from "./request-admission.js";
import {
  configureWebSocketOutput,
  sendWebSocketData,
  sendWebSocketPong,
  websocketOutboundLimits,
  type WebSocketOutboundOptions,
} from "./websocket-output.js";
export { sendWebSocketData } from "./websocket-output.js";
import { monitorWebSocket, websocketLivenessThresholds, type WebSocketLivenessOptions } from "./websocket-liveness.js";

import { managedProcesses } from "./managed-processes.js";
import type { RawData } from "ws";
import { WebSocket, WebSocketServer } from "ws";
import chokidar from "chokidar";
import { workspaceWatchOptions } from "./workspace-watch.js";
import path from "node:path";

import { realpath } from "node:fs/promises";

import {
  type CoreCapability,
  coreCapabilities,
  overviewLimits,
  presenceLeaseMs,
  serverProtocolVersion,
  requestTypes,
  type FileTreeNode,
  type ProtocolOperations,
  type Request,
  type RequestType,
  type Response,
  type ServerEvent,
  type WorkspaceOptions,
  type WorkspaceRoot,
} from "@hatopad/protocol";

import { MetadataHintBatcher } from "./metadata-hints.js";
import { workPage, workText, triggerIssueKind, type WorkTarget } from "./overview-work.js";
import { TerminalWatchers } from "./terminal-watchers.js";

import { CoreError } from "./errors.js";
import { WorkspaceFileSystem } from "./filesystem.js";
import { TerminalSessionHost } from "./process-manager.js";
import { GitService } from "./git.js";
import { WorkspaceStateStore, flushWorkspaceStateWrites } from "./workspace-state.js";
import { WorkspaceSearch } from "./search.js";
import { LanguageRegistry, LanguageSessions } from "./language/registry.js";
import type { LanguageServiceEvents } from "./language/service.js";
import { BUILT_IN_LANGUAGES } from "./plugins/builtin.js";

import { loadPlugins } from "./plugins/loader.js";

import { watchGitState } from "./git-watch.js";
import { WorkspaceTaskStore } from "./tasks.js";
import { ServerStorage } from "./storage.js";
import { UsefulFilesStore } from "./useful-files.js";
import { ConfigurationService } from "./configuration.js";
import { ensureSelfConfiguration } from "./self-configuration.js";
import { SkillsStore } from "./skills.js";
import { AgentsStore } from "./agents.js";
import { HarnessStore } from "./harnesses.js";
import { executeWorkflowSkill, workflowSessionSkillIds } from "./workflow-skills.js";
import { executeTaskControls } from "./workflow-task-controls.js";
import { executeFlowScript } from "./workflow-script.js";
import { WorkflowAppService } from "./workflow-app.js";
import { HarnessRunner } from "./harness-runner.js";

import { RunConfigService } from "./run-configs.js";

import { createAcpRegistry } from "./ai/index.js";
import { AppEventBridge, appBridgeInstanceId } from "./app-events.js";
import { ScheduleService } from "./schedules.js";
import { TriggerService } from "./triggers.js";
import { AiTimerService, AiTimerStore } from "./ai-timers.js";
import { AppToolService, appToolServer, withAppTools } from "./app-tools.js";
import { TaskCheckpointStore } from "./task-checkpoints.js";
import { RemoteTransferService } from "./remote-transfer.js";
import { WorkspaceRootRegistry } from "./workspace-roots.js";

import { buildOverview, pageOverview, type OverviewSource, type WorkflowSource } from "./overview.js";

import { boundSessionsInResult, validSessionMessageLimit } from "./ai/session-bounds.js";
import type { OverviewRootCounts, ScheduledAction, AiProvider, HarnessBlock } from "@hatopad/protocol";

type SwitchedWatch = {
  watcher: ReturnType<typeof chokidar.watch>;
  gitWatcher: ReturnType<typeof chokidar.watch>;
  batcher: WorkspaceWatchBatcher;
};

export class LiveRootSelections<T extends object> {
  private readonly selections = new Map<T, string>();
  private readonly pending = new Map<T, string>();
  connect(session: T, rootId: string): void {
    this.selections.set(session, rootId);
  }
  beginSelection(session: T, rootId: string): void {
    if (!this.selections.has(session)) throw new Error("Session is not connected");
    this.pending.set(session, rootId);
  }
  select(session: T, rootId: string): void {
    if (!this.selections.has(session)) throw new Error("Session is not connected");
    this.selections.set(session, rootId);
    this.pending.delete(session);
  }
  cancelSelection(session: T): void {
    this.pending.delete(session);
  }
  disconnect(session: T): void {
    this.selections.delete(session);
    this.pending.delete(session);
  }
  isSelected(rootId: string): boolean {
    return [...this.selections.values(), ...this.pending.values()].some((selected) => selected === rootId);
  }
  selected(session: T): string | undefined {
    return this.selections.get(session);
  }
}

export function assertRootRemovalAllowed<T extends object>(selections: LiveRootSelections<T>, rootId: string): void {
  if (selections.isSelected(rootId))
    throw new CoreError("INVALID_REQUEST", "Every connected client must select another root before removing this root");
}

export async function transactionalRootSelection<T>(
  prepare: () => Promise<T>,
  commit: (candidate: T) => Promise<void> | void,
  dispose: (candidate: T) => Promise<void> | void,
): Promise<T> {
  let candidate: T | undefined;
  try {
    candidate = await prepare();
    await commit(candidate);
    return candidate;
  } catch (error) {
    if (candidate !== undefined) await dispose(candidate);
    throw error;
  }
}

const coreProtocolCompatibility = { minimum: serverProtocolVersion, maximum: serverProtocolVersion };

/** Collapses noisy watcher streams into a bounded, state-reconciliation signal. */
export class WorkspaceWatchBatcher {
  private paths = new Set<string>();
  private overflow = false;
  private degraded?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly rootId: string;
  private readonly emit: (event: Extract<ServerEvent, { type: "filesystem.changed" }>) => void;
  private readonly delay: number;
  private readonly limit: number;
  constructor(
    emit: (event: Extract<ServerEvent, { type: "filesystem.changed" }>) => void,
    delay?: number,
    limit?: number,
  );
  constructor(
    rootId: string,
    emit: (event: Extract<ServerEvent, { type: "filesystem.changed" }>) => void,
    delay?: number,
    limit?: number,
  );
  constructor(
    rootOrEmit: string | ((event: Extract<ServerEvent, { type: "filesystem.changed" }>) => void),
    emitOrDelay?: ((event: Extract<ServerEvent, { type: "filesystem.changed" }>) => void) | number,
    delayOrLimit = 120,
    limit = 256,
  ) {
    this.rootId = typeof rootOrEmit === "string" ? rootOrEmit : "legacy";
    this.emit =
      typeof rootOrEmit === "string"
        ? (emitOrDelay as (event: Extract<ServerEvent, { type: "filesystem.changed" }>) => void)
        : rootOrEmit;
    this.delay = typeof rootOrEmit === "string" ? delayOrLimit : typeof emitOrDelay === "number" ? emitOrDelay : 120;
    this.limit = typeof rootOrEmit === "string" ? limit : delayOrLimit;
  }
  change(relativePath: string): void {
    if (this.paths.size >= this.limit) this.overflow = true;
    else this.paths.add(relativePath);
    this.schedule();
  }
  refresh(): void {
    this.overflow = true;
    this.schedule();
  }
  degrade(message: string): void {
    this.degraded = message;
    this.overflow = true;
    this.schedule();
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.paths.size && !this.degraded && !this.overflow) return;
    this.emit({
      type: "filesystem.changed",
      payload: {
        rootId: this.rootId,
        paths: [...this.paths],
        overflow: this.overflow,
        health: this.degraded ? "degraded" : "healthy",
        ...(this.degraded ? { message: this.degraded } : {}),
      },
    });
    this.paths.clear();
    this.overflow = false;
    this.degraded = undefined;
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
  private schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delay);
  }
}

export function protocolHandshake(compatibility: { minimum: number; maximum: number }): {
  compatibility: typeof coreProtocolCompatibility;
  compatible: boolean;
  message?: string;
  capabilities?: CoreCapability[];
} {
  const valid =
    Number.isInteger(compatibility.minimum) &&
    Number.isInteger(compatibility.maximum) &&
    compatibility.minimum > 0 &&
    compatibility.minimum <= compatibility.maximum;
  const compatible =
    valid &&
    compatibility.minimum <= coreProtocolCompatibility.maximum &&
    coreProtocolCompatibility.minimum <= compatibility.maximum;
  return compatible
    ? { compatible, compatibility: coreProtocolCompatibility, capabilities: [...coreCapabilities] }
    : {
        compatible,
        compatibility: coreProtocolCompatibility,
        message: `Core supports protocol ${coreProtocolCompatibility.minimum}-${coreProtocolCompatibility.maximum}; this Desktop supports ${compatibility.minimum}-${compatibility.maximum}`,
      };
}

const shutdownHandlers = new WeakMap<WebSocketServer, () => Promise<void>>();
export function shutdownCore(server: WebSocketServer): Promise<void> {
  const shutdown = shutdownHandlers.get(server);
  return shutdown
    ? shutdown()
    : new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export type CoreConnectionOptions = WebSocketLivenessOptions & {
  updates?: CoreUpdates;
  outbound?: WebSocketOutboundOptions;
  admission?: RequestAdmissionOptions;
  access?: CoreAccessOptions;
};

export async function createServer(
  host: string,
  port: number,
  workspacePath: string,
  options: CoreConnectionOptions = {},
): Promise<WebSocketServer> {
  const updates = options.updates ?? new CoreUpdates();
  const access = coreAccessPolicy(host, options.access);
  const liveness = websocketLivenessThresholds(options);
  const outbound = websocketOutboundLimits(options.outbound);
  const admissionLimit = requestAdmissionLimit(options.admission);
  const portTunnelBudget = { active: 0 };
  await ensureSelfConfiguration();
  const rootWorkspace = workspacePath;
  const roots = await WorkspaceRootRegistry.open(rootWorkspace);
  const tasks = new WorkspaceTaskStore(rootWorkspace);
  const usefulFiles = new UsefulFilesStore(rootWorkspace);
  const agents = new AgentsStore(rootWorkspace);
  const harnesses = new HarnessStore(rootWorkspace);
  const rootContexts = new Map<
    string,
    { tasks: WorkspaceTaskStore; usefulFiles: UsefulFilesStore; agents: AgentsStore; harnesses: HarnessStore }
  >();
  rootContexts.set(roots.primary().id, { tasks, usefulFiles, agents, harnesses });
  const contextFor = (rootId: string) => {
    let context = rootContexts.get(rootId);
    if (!context) {
      const root = roots.get(rootId);
      context = {
        tasks: new WorkspaceTaskStore(root.path),
        usefulFiles: new UsefulFilesStore(root.path),
        agents: new AgentsStore(root.path),
        harnesses: new HarnessStore(root.path),
      };
      rootContexts.set(rootId, context);
    }
    return context;
  };
  const feed = new SupervisionFeed();
  const taskStates = new Map<string, Map<string, import("@hatopad/protocol").WorkspaceTask>>();
  for (const root of roots.list())
    taskStates.set(root.id, new Map((await contextFor(root.id).tasks.list()).tasks.map((task) => [task.id, task])));
  const taskScans = new Map<string, Promise<void>>();
  const recordTaskChanges = (rootId: string) => {
    const scan = (taskScans.get(rootId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const next = new Map((await contextFor(rootId).tasks.list()).tasks.map((task) => [task.id, task])),
          previous = taskStates.get(rootId);
        taskStates.set(rootId, next);
        if (!previous) return;
        for (const [id, task] of next) {
          const prior = previous.get(id);
          if (!prior) feed.push("task-created", rootId, { taskId: id });
          else if (task.status !== prior.status)
            feed.push(task.status === "finished" ? "task-finished" : "task-reopened", rootId, { taskId: id });
          else if (task.archived && !prior.archived) feed.push("task-archived", rootId, { taskId: id });
        }
        for (const id of previous.keys()) if (!next.has(id)) feed.push("task-deleted", rootId, { taskId: id });
      });
    taskScans.set(rootId, scan);
    void scan.catch(() => undefined);
  };
  const savedTasks = await tasks.list();
  const workspaceOwners = new Map<string, string>([
    [path.resolve(rootWorkspace), roots.primary().id],
    ...savedTasks.tasks.map((task) => [path.resolve(tasks.taskPath(task.id)), roots.primary().id] as const),
  ]);
  const ownerRootId = async (target: string): Promise<string | undefined> => {
    const resolved = path.resolve(target);
    const known = workspaceOwners.get(resolved);
    if (known) return known;
    const direct = roots
      .list()
      .filter((root) => resolved === root.path || resolved.startsWith(`${root.path}${path.sep}`))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (direct) {
      workspaceOwners.set(resolved, direct.id);
      return direct.id;
    }
    const canonical = await realpath(resolved).catch(() => resolved);
    if (canonical !== resolved) {
      const rootId = await ownerRootId(canonical);
      if (rootId) {
        workspaceOwners.set(resolved, rootId);
        return rootId;
      }
    }
    for (const [rootId, context] of rootContexts) {
      const registry = await context.tasks.list();
      if (registry.tasks.some((task) => path.resolve(context.tasks.taskPath(task.id)) === resolved)) {
        workspaceOwners.set(resolved, rootId);
        return rootId;
      }
    }
    return undefined;
  };
  if (savedTasks.selectedTaskId) workspacePath = tasks.taskPath(savedTasks.selectedTaskId);
  const validation = new WorkspaceFileSystem();
  await validation.initialize(workspacePath);
  const workspace = validation.getWorkspace();
  const workspaceState = new WorkspaceStateStore(workspace, process.env.HATOPAD_STATE_DIR);
  const watcher = chokidar.watch(workspace, await workspaceWatchOptions(workspace));
  // A large initial scan must not block protocol health or crash Core on a
  // native watch limit. The filesystem is queried directly by workspace.open.
  watcher.on("error", (error) => console.error(`[core] watcher initialization: ${String(error)}`));
  let draining = false;
  let inFlight = 0;
  const idleWaiters = new Set<() => void>();
  const sessionCleanups = new Set<Promise<void>>();
  /** Runs a cleanup in the background but keeps it visible to shutdown and logs failures instead of leaving them unhandled. */
  const trackCleanup = (cleanup: Promise<void>) => {
    const tracked = cleanup.catch((error) => console.error("[core] Language service cleanup failed", error));
    sessionCleanups.add(tracked);
    void tracked.finally(() => sessionCleanups.delete(tracked));
  };
  const bridgeCommands = new Set<Promise<void>>();
  const socketMonitors = new Set<() => void>();
  const remoteTransfers = new RemoteTransferService();
  const activeSessions = new Set<WebSocket>();
  const liveRootSelections = new LiveRootSelections<WebSocket>();
  const rootWatchSubscriptionsForServer = new Map<string, Set<SwitchedWatch>>();
  const rootWatchOwnersForServer = new Map<SwitchedWatch, () => void>();
  const removingRoots = new Set<string>();
  const metadataHints = new MetadataHintBatcher((event) => {
    if (draining) return;
    if (event.type === "tasks.changed" && event.payload.rootId) recordTaskChanges(event.payload.rootId);
    if (event.type === "harness.changed") {
      const runner = harnessRunners.get(event.payload.rootId);
      if (runner)
        void runner
          .readRun(event.payload.runId)
          .then((run) => {
            if (run && ["succeeded", "failed", "blocked"].includes(run.status))
              feed.push(
                run.status === "succeeded" ? "workflow-completed" : "workflow-failed",
                event.payload.rootId,
                { runId: run.id, ...(run.binding?.taskId ? { taskId: run.binding.taskId } : {}) },
                `${event.payload.rootId}:${run.id}:${run.status}:${run.completedAt ?? ""}`,
              );
          })
          .catch(() => undefined);
    }
    const rootId = (event.payload as { rootId?: string }).rootId;
    const encoded = JSON.stringify(event);
    for (const socket of activeSessions)
      if (!rootId || liveRootSelections.selected(socket) === rootId) sendWebSocketData(socket, encoded);
  });
  /** Socket -> lease expiry of its last visible `client.presence` report. */
  const presence = new Map<WebSocket, number>();
  const terminalSubscriptions = new Map<WebSocket, { rootId: string; workspace: string; terminalIds: Set<string> }>();
  const terminalWatchers = new TerminalWatchers<WebSocket>((socket, event) =>
    sendWebSocketData(socket, JSON.stringify(event)),
  );
  const terminalOwners = new Map<string, { socket: WebSocket; rootId: string; workspace: string }>();
  const processesChanged = () => {
    const encoded = JSON.stringify({ type: "processes.changed", payload: {} } satisfies ServerEvent);
    for (const socket of activeSessions) sendWebSocketData(socket, encoded);
  };
  managedProcesses.on("changed", processesChanged);
  let runConfigs: RunConfigService;
  const terminalHost = new TerminalSessionHost((event) => {
    if (event.type === "opened") {
      void ownerRootId(event.workspace)
        .then((rootId) => {
          if (!rootId) return;
          const message = JSON.stringify({
            type: "terminal.opened",
            payload: { rootId, workspace: event.workspace, session: event.session },
          } satisfies ServerEvent);
          for (const socket of activeSessions) {
            const subscription = terminalSubscriptions.get(socket);
            if (
              subscription &&
              path.resolve(subscription.workspace) === event.workspace &&
              subscription.rootId === rootId
            )
              sendWebSocketData(socket, message);
          }
        })
        .catch((error) => console.error("[core] Could not announce terminal", error));
      return;
    }
    if (event.type === "output") terminalWatchers.output(event.workspace, event.terminalId, event.data);
    else terminalWatchers.exit(event.workspace, event.terminalId, event.exitCode);
    runConfigs?.onTerminalEvent(event);
    const owner = terminalOwners.get(event.terminalId);
    if (owner && owner.workspace === event.workspace) {
      const message: ServerEvent =
        event.type === "output"
          ? {
              type: "terminal.output",
              payload: { rootId: owner.rootId, terminalId: event.terminalId, data: event.data },
            }
          : {
              type: "terminal.exit",
              payload: { rootId: owner.rootId, terminalId: event.terminalId, exitCode: event.exitCode },
            };
      sendWebSocketData(owner.socket, JSON.stringify(message));
    }
  });
  const workflowApps = new WorkflowAppService(terminalHost);
  runConfigs = new RunConfigService(
    terminalHost,
    (changedWorkspace) => {
      void Promise.all([runConfigs.list(changedWorkspace), ownerRootId(changedWorkspace)]).then(([configs, rootId]) => {
        if (!rootId) return;
        const encoded = JSON.stringify({
          type: "runConfig.changed",
          payload: { rootId, configs },
        } satisfies ServerEvent);
        for (const socket of activeSessions) sendWebSocketData(socket, encoded);
      });
    },
    rootWorkspace,
  );
  const runConfigWatcher = chokidar.watch(
    [runConfigs.directory(rootWorkspace, "global"), runConfigs.directory(rootWorkspace, "local")],
    { ignoreInitial: true, depth: 0, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } },
  );
  runConfigWatcher.on("all", () => {
    for (const [changedWorkspace, rootId] of workspaceOwners) {
      void runConfigs.list(changedWorkspace).then((configs) => {
        const encoded = JSON.stringify({
          type: "runConfig.changed",
          payload: { rootId, configs },
        } satisfies ServerEvent);
        for (const socket of activeSessions) sendWebSocketData(socket, encoded);
      });
    }
  });
  const appEvents = new AppEventBridge(rootWorkspace, undefined, appBridgeInstanceId);
  await appEvents.ready();
  const appEventWatcher = chokidar.watch(appEvents.directory, { ignoreInitial: true, depth: 0 });
  await new Promise<void>((resolve, reject) => {
    appEventWatcher.once("ready", resolve);
    appEventWatcher.once("error", reject);
  });
  appEventWatcher.on("add", (file) => {
    if (!file.endsWith(".json")) return;
    void appEvents
      .consume(file)
      .then(async (event) => {
        if (!event) return;
        const rootId =
          event.type === "tasks.changed"
            ? roots.primary().id
            : ((await ownerRootId(event.workspace)) ?? roots.primary().id);
        if (event.type === "tasks.changed") recordTaskChanges(rootId);
        const message: ServerEvent =
          event.type === "tasks.changed"
            ? { type: "tasks.changed", payload: { rootId } }
            : event.type === "ai.changed"
              ? { type: "ai.changed", payload: { rootId } }
              : {
                  type: "commit-message.changed",
                  payload: { rootId, workspace: event.workspace, message: event.message },
                };
        const encoded = JSON.stringify(message);
        for (const socket of activeSessions) sendWebSocketData(socket, encoded);
      })
      .catch((error) =>
        console.error(`[core] app event error: ${error instanceof Error ? error.message : String(error)}`),
      );
  });
  const aiChanged = (changedWorkspace: string) => {
    void ownerRootId(changedWorkspace).then((rootId) => {
      if (!rootId) return;
      const encoded = JSON.stringify({ type: "ai.changed", payload: { rootId } } satisfies ServerEvent);
      for (const socket of activeSessions) sendWebSocketData(socket, encoded);
    });
  };
  const checkpointStores = new Map<string, TaskCheckpointStore>();
  const checkpointStore = (target: string) => {
    const key = path.resolve(target);
    let store = checkpointStores.get(key);
    if (!store) {
      store = new TaskCheckpointStore(key);
      checkpointStores.set(key, store);
    }
    return store;
  };
  await Promise.all(
    [rootWorkspace, ...savedTasks.tasks.map((task) => tasks.taskPath(task.id))].map((target) =>
      checkpointStore(target).recover(),
    ),
  );
  const taskGitChanged = (changedWorkspace: string) => {
    void ownerRootId(changedWorkspace).then((rootId) => {
      if (!rootId) return;
      const encoded = JSON.stringify({ type: "taskGit.changed", payload: { rootId } } satisfies ServerEvent);
      for (const socket of activeSessions) sendWebSocketData(socket, encoded);
    });
  };
  const plugins = await loadPlugins(undefined, {
    builtInLanguages: new Set(BUILT_IN_LANGUAGES.map((language) => language.descriptor.id)),
  });
  for (const plugin of plugins.status)
    if (plugin.state === "failed") console.warn(`Plugin ${plugin.id} not loaded: ${plugin.error}`);
  const acp = createAcpRegistry(
    aiChanged,
    {
      begin: async (target, provider, prompt, sessionId, provenance) => {
        const id = await checkpointStore(target).begin(
          provider as AiProvider,
          prompt,
          sessionId,
          undefined,
          provenance,
        );
        taskGitChanged(target);
        return id;
      },
      complete: async (target, ids, status, provenance) => {
        await Promise.all(ids.map((id) => checkpointStore(target).complete(id, status, provenance)));
        taskGitChanged(target);
      },
    },
    async (target) => {
      const rootId = await ownerRootId(target);
      return rootId ? roots.get(rootId).path : rootWorkspace;
    },
    rootWorkspace,
    plugins.providers,
  );
  // Read-only across every root: uses provider `get` on explicit workspace paths and never selects a root/task.
  const overviewSummary = async (payload: { limit?: number; cursor?: string }) => {
    const sources: OverviewSource[] = [];
    let truncated = false;
    const allRoots = roots.list();
    if (allRoots.length > overviewLimits.maxRoots) truncated = true;
    for (const root of allRoots.slice(0, overviewLimits.maxRoots)) {
      const store = contextFor(root.id).tasks;
      const registry = await store.list();
      const visible = registry.tasks.filter((task) => task.status === "active" && !task.archived);
      if (visible.length > overviewLimits.maxTasksPerRoot) truncated = true;
      const targets = [
        { taskId: undefined as string | undefined, workspace: root.path },
        ...visible
          .slice(0, overviewLimits.maxTasksPerRoot)
          .map((task) => ({ taskId: task.id as string | undefined, workspace: store.taskPath(task.id) })),
      ];
      for (const target of targets) {
        const sessions = await Promise.all(
          acp.list().map(async (item) => ({
            provider: item.id as AiProvider,
            session: await acp.get(item.id).get(target.workspace),
          })),
        );
        sources.push({ rootId: root.id, alias: root.alias, taskId: target.taskId, sessions });
      }
    }
    const workflows: WorkflowSource[] = [];
    const counts = new Map<string, OverviewRootCounts>();
    for (const root of allRoots.slice(0, overviewLimits.maxRoots)) {
      const registry = await contextFor(root.id).tasks.list();
      const summaries = await contextFor(root.id).harnesses.summaries();
      counts.set(root.id, {
        tasks: registry.tasks.filter((task) => task.status === "active" && !task.archived).length,
        finishedTasks: registry.tasks.filter((task) => task.status === "finished" && !task.archived).length,
        schedules: schedules.list().filter((item) => item.rootId === root.id && item.enabled).length,
        triggers: triggers.list().filter((item) => item.rootId === root.id && item.enabled).length,
        workflowsActive: summaries.filter(
          (run) => !["succeeded", "failed", "cancelled", "blocked"].includes(run.status),
        ).length,
      });
    }
    for (const root of allRoots.slice(0, overviewLimits.maxRoots)) {
      const store = contextFor(root.id).harnesses;
      const waiting = (await store.summaries())
        .filter((run) => run.status === "awaiting_permission" || run.status === "awaiting_user_input")
        .slice(0, overviewLimits.maxWorkflowRunsPerRoot);
      if (!waiting.length) continue;
      const stored = await store.runs();
      for (const summary of waiting) {
        // Prefer the live execution (newer than disk) but never create a runner just to look.
        const run =
          (await harnessRunners.get(root.id)?.readRun(summary.id)) ?? stored.find((item) => item.id === summary.id);
        if (run) workflows.push({ rootId: root.id, alias: root.alias, run });
      }
    }
    const now = Date.now();
    return {
      ...pageOverview(buildOverview(sources, truncated, workflows, counts), payload),
      presence: { active: [...presence.values()].some((until) => until > now) },
    };
  };
  const overviewWork = async (
    payload: ProtocolOperations["overview.work"]["payload"],
  ): Promise<ProtocolOperations["overview.work"]["result"]> => {
    const allRoots = roots.list();
    const targets: WorkTarget[] = [];
    let truncated = allRoots.length > overviewLimits.maxRoots;
    const workflowLists = new Map<string, Awaited<ReturnType<HarnessStore["summaries"]>>>();
    for (const root of allRoots.slice(0, overviewLimits.maxRoots)) {
      const context = contextFor(root.id),
        registry = await context.tasks.list();
      const tasks = [...registry.tasks].sort((a, b) => a.id.localeCompare(b.id));
      if (tasks.length > overviewLimits.maxTasksPerRoot) truncated = true;
      targets.push({
        rootId: root.id,
        rootAlias: workText(root.alias),
        name: workText(root.alias),
        status: "root",
        archived: false,
        workspace: root.path,
      });
      for (const task of tasks.slice(0, overviewLimits.maxTasksPerRoot))
        targets.push({
          rootId: root.id,
          rootAlias: workText(root.alias),
          taskId: task.id,
          name: workText(task.name),
          branch: workText(task.branch, 200),
          status: task.status,
          archived: task.archived,
          workspace: context.tasks.taskPath(task.id),
        });
    }
    targets.sort((a, b) => a.rootId.localeCompare(b.rootId) || (a.taskId ?? "").localeCompare(b.taskId ?? ""));
    const page = workPage(targets, payload, truncated);
    const timers = await aiTimers.list(),
      allSchedules = schedules.list(),
      allTriggers = triggers.list(true);
    const providers = acp.list().slice(0, 32);
    if (acp.list().length > providers.length) page.result.truncated = true;
    for (const target of page.targets) {
      const { workspace, ...identity } = target;
      const row: import("@hatopad/protocol").OverviewWorkRow = {
        ...identity,
        sessions: [],
        terminals: terminalHost.list(workspace).filter((terminal) => terminal.status === "running").length,
        workflowsActive: 0,
        workflowRunIds: [],
        schedules: 0,
        triggers: 0,
        timers: [],
        timerCount: 0,
        issues: [],
      };
      for (const item of providers) {
        try {
          const session = await acp.get(item.id).get(workspace);
          const last = session.messages.at(-1),
            preview =
              session.messages
                .slice(-100)
                .reverse()
                .find((message) => message.role === "assistant" || message.role === "activity") ?? last;
          row.sessions.push({
            provider: item.id,
            ...(session.id ? { sessionId: session.id } : {}),
            status: session.status,
            preview: workText(preview?.text),
            ...((last?.timestamp ?? session.updatedAt) ? { updatedAt: last?.timestamp ?? session.updatedAt } : {}),
            pendingQuestion: Boolean(session.pendingQuestion),
            pendingPermission: Boolean(session.pendingPermission),
            ...(session.failure ? { failure: { ...session.failure, message: workText(session.failure.message) } } : {}),
          });
          if (session.failure || session.status === "error")
            row.issues.push({
              id: `ai:${item.id}:${session.id ?? ""}`,
              kind:
                session.failure?.kind === "quota_exhausted"
                  ? "quota"
                  : session.failure?.kind === "permission_required"
                    ? "provider-setup"
                    : "task-error",
              title: workText(session.failure?.message || "Agent task failed"),
              provider: item.id,
              ...(session.updatedAt ? { at: session.updatedAt } : {}),
            });
        } catch {
          row.issues.push({
            id: `provider:${item.id}`,
            kind: "provider-setup",
            title: "Provider state unavailable",
            provider: item.id,
          });
        }
      }
      try {
        const git = await new GitService(workspace).summary(1);
        row.git = {
          additions: git.additions,
          deletions: git.deletions,
          unknownCounts: git.unknownCounts,
          totalFiles: git.totalFiles,
          conflicts: git.conflicts,
          branch: workText(git.branch, 200),
          ...(git.upstream ? { upstream: git.upstream } : {}),
        };
        if (git.conflicts)
          row.issues.push({
            id: "git:conflicts",
            kind: "merge-conflict",
            title: `${git.conflicts} files have merge conflicts`,
          });
      } catch {
        row.gitUnavailable = true;
      }
      let runs = workflowLists.get(target.rootId);
      if (!runs) {
        runs = await contextFor(target.rootId).harnesses.summaries();
        workflowLists.set(target.rootId, runs);
      }
      const ownedRuns = runs.filter((run) => (run.binding?.taskId ?? undefined) === target.taskId);
      const ownedRunIds = new Set(ownedRuns.map((run) => run.id));
      const activeRuns = ownedRuns.filter(
        (run) => !["succeeded", "failed", "blocked", "cancelled"].includes(run.status),
      );
      row.workflowsActive = activeRuns.length;
      row.workflowRunIds = activeRuns.slice(0, 10).map((run) => run.id);
      for (const run of ownedRuns.filter((run) => run.status === "failed" || run.status === "blocked").slice(0, 10))
        row.issues.push({
          id: `workflow:${run.id}`,
          kind: "workflow-failed",
          title: workText(run.error || "Workflow failed or was interrupted"),
          runId: run.id,
          at: run.completedAt ?? run.createdAt,
        });
      const ownedTimers = timers.filter(
        (timer) =>
          path.resolve(timer.workspace) === path.resolve(workspace) ||
          (timer.workflowRunId !== undefined && ownedRunIds.has(timer.workflowRunId)),
      );
      row.timerCount = ownedTimers.length;
      row.timers = ownedTimers.slice(0, 10).map((timer) => ({
        id: timer.id,
        provider: timer.provider,
        dueAt: timer.dueAt,
        ...(timer.workflowRunId ? { workflowRunId: timer.workflowRunId } : {}),
        ...(timer.workflowBlockId ? { workflowBlockId: timer.workflowBlockId } : {}),
      }));
      for (const timer of ownedTimers.filter((timer) => Date.parse(timer.dueAt) < Date.now()).slice(0, 10))
        row.issues.push({
          id: `timer:${timer.id}`,
          kind: "timer-overdue",
          title: "Continuation timer is overdue",
          timerId: timer.id,
          at: timer.dueAt,
        });
      const ownSchedules = allSchedules.filter(
        (schedule) => schedule.rootId === target.rootId && schedule.taskId === target.taskId,
      );
      row.schedules = ownSchedules.filter((schedule) => schedule.enabled).length;
      for (const schedule of ownSchedules.filter((schedule) => schedule.lastError).slice(0, 10))
        row.issues.push({
          id: `schedule:${schedule.id}`,
          kind: "schedule-failed",
          title: workText(schedule.lastError),
          scheduleId: schedule.id,
          ...(schedule.lastRunAt ? { at: schedule.lastRunAt } : {}),
        });
      const ownTriggers = allTriggers.filter(
        (trigger) => trigger.rootId === target.rootId && trigger.taskId === target.taskId,
      );
      row.triggers = ownTriggers.filter((trigger) => trigger.enabled).length;
      for (const trigger of ownTriggers.filter((trigger) => trigger.lastError || trigger.lastSkipped).slice(0, 10))
        row.issues.push({
          id: `trigger:${trigger.id}`,
          kind: triggerIssueKind(trigger.lastError, trigger.lastSkipped),
          title: workText(trigger.lastSkipped ?? trigger.lastError),
          triggerId: trigger.id,
          ...(trigger.lastFiredAt ? { at: trigger.lastFiredAt } : {}),
        });
      page.result.rows.push(row);
    }
    if (Buffer.byteLength(JSON.stringify(page.result)) > 900_000)
      throw new CoreError("INVALID_REQUEST", "Work overview exceeds the response budget; use a smaller page");
    return page.result;
  };
  const harnessRunners = new Map<string, HarnessRunner>();
  const storage = new ServerStorage({
    roots: () => roots.list().map((root) => root.path),
    isBusy: async (target) => {
      if (
        terminalHost.hasWorkspace(target) ||
        (await managedProcesses.list()).some((process) => process.workspace === target)
      )
        return true;
      for (const root of roots.list()) {
        const runs = await contextFor(root.id).harnesses.summaries();
        if (
          runs.some(
            (run) =>
              !["succeeded", "failed", "cancelled", "blocked"].includes(run.status) &&
              (run.binding?.workspace === target ||
                run.workspace === target ||
                run.children?.some((child) => child.workspace === target)),
          )
        )
          return true;
      }
      return false;
    },
    changed: () => {
      for (const root of roots.list()) {
        const encoded = JSON.stringify({ type: "tasks.changed", payload: { rootId: root.id } } satisfies ServerEvent);
        for (const socket of activeSessions) sendWebSocketData(socket, encoded);
      }
    },
  });
  const harnessRunner = (rootId: string): HarnessRunner => {
    if (draining) throw new CoreError("INVALID_REQUEST", "Core is shutting down");
    let runner = harnessRunners.get(rootId);
    if (!runner) {
      runner = new HarnessRunner(
        contextFor(rootId).harnesses,
        (runId) => {
          metadataHints.enqueue({ type: "harness.changed", payload: { rootId, runId } });
          metadataHints.enqueue({ type: "tasks.changed", payload: { rootId } });
        },
        4,
        undefined,
        (document) => {
          const event = JSON.stringify({
            type: "workflow.document",
            payload: { rootId, ...document },
          } satisfies ServerEvent);
          for (const socket of activeSessions) sendWebSocketData(socket, event);
        },
        (provider, workspace, input) =>
          steerWorkflowSession(acp.get(provider), workspace, input, aiTimers, roots.get(rootId).path, rootWorkspace),
      );
      harnessRunners.set(rootId, runner);
    }
    return runner;
  };
  const aiTimers = new AiTimerService(
    new AiTimerStore(rootWorkspace),
    acp,
    rootWorkspace,
    (workspace) => {
      aiChanged(workspace);
      const encoded = JSON.stringify({ type: "timers.changed", payload: {} } satisfies ServerEvent);
      for (const socket of activeSessions) sendWebSocketData(socket, encoded);
    },
    async (timer, effect, reconcile) => {
      if (!timer.workflowRunId || !timer.workflowBlockId) return effect();
      let owner: { rootId: string; run: import("@hatopad/protocol").HarnessRun } | undefined;
      for (const candidate of roots.list()) {
        const run = await harnessRunner(candidate.id).readRun(timer.workflowRunId);
        if (run) {
          owner = { rootId: candidate.id, run };
          break;
        }
      }
      if (!owner) throw new CoreError("FILE_NOT_FOUND", "Workflow timer run no longer exists");
      const boundRoot = roots.get(owner.rootId).path;
      await validateWorkflowTarget(owner.run, timer.workspace, {
        tasks: contextFor(owner.rootId).tasks,
        rootWorkspace: boundRoot,
        workspacePath: boundRoot,
      });
      return harnessRunner(owner.rootId).runTimerOperation(
        timer.workflowRunId,
        timer.workflowBlockId,
        `timer-fire:${timer.workflowOperationKey ?? timer.id}`,
        { timerId: timer.id, dueAt: timer.dueAt },
        effect,
        reconcile,
      );
    },
    (timer) => {
      void (async () => {
        const rootId = await ownerRootId(timer.workspace);
        if (!rootId) return;
        const context = contextFor(rootId);
        const task = (await context.tasks.list()).tasks.find(
          (task) => context.tasks.taskPath(task.id) === timer.workspace,
        );
        feed.push("timer-fired", rootId, {
          ...(task ? { taskId: task.id } : {}),
          ...(timer.workflowRunId ? { runId: timer.workflowRunId } : {}),
        });
      })().catch(() => undefined);
    },
  );
  const recoveryBridgeWorkspace = rootWorkspace;
  for (const recoveryRoot of roots.list()) {
    const rootWorkspace = recoveryRoot.path;
    const { tasks, agents, harnesses } = contextFor(recoveryRoot.id);
    const recoveryRunner = harnessRunner(recoveryRoot.id);
    const recoveryDispatch = async (
      block: HarnessBlock,
      prompt: string,
      runtime: Parameters<Parameters<HarnessRunner["start"]>[2]>[2],
    ) =>
      providerOperation(async () => {
        const run = (await harnesses.runs()).find((item) => item.id === runtime.runId);
        if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
        const workspace = (
          await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath: rootWorkspace })
        ).workspace;
        if (block.type === "mcp") return executeWorkflowMcp(block, prompt, rootWorkspace, runtime.assertActive);
        if (block.type === "skill" && block.skillId)
          return executeWorkflowSkill(block, new SkillsStore(undefined, rootWorkspace), workspace, runtime);
        if (block.type === "script")
          return executeFlowScript(block, prompt, workspace, runtime.assertActive, {
            rootWorkspace,
            workflowRunId: runtime.runId,
            workflowBlockId: runtime.blockId,
          });
        if (block.type === "terminal_control")
          return executeTerminalControlAsync(prompt, workspace, workflowApps.terminals, runtime.assertActive);
        if (block.type === "run_app")
          return workflowApps.execute(block, prompt, workspace, runtime.assertActive, {
            rootWorkspace,
            workflowRunId: runtime.runId,
            workflowBlockId: runtime.blockId,
          });
        if (block.type === "task_controls")
          return executeTaskControls(
            block,
            prompt,
            {
              acp,
              tasks,
              agents,
              harnessRunner: recoveryRunner,
              aiTimers,
              rootWorkspace,
              bridgeWorkspace: recoveryBridgeWorkspace,
              workspacePath: workspace,
              defaultProvider: acp.defaultId,
            },
            runtime,
          );
        if (block.type === "verification") return runWorkflowVerification(block, workspace, recoveryRunner, runtime);
        if (block.type === "review") {
          const evidence = await collectWorkflowReviewEvidence(block, workspace, recoveryRunner, runtime);
          prompt += `\n\nCore-recorded review evidence:\nCommit: ${evidence.revision}\nBase: ${evidence.baseRevision}\nChanged files: ${evidence.files.join(", ")}\n\nDiff:\n${evidence.diff}`;
        }
        const provider = acp.get(block.provider);
        await assertWorkflowModelAvailable(provider, block.model, block.reasoning);
        if (block.watchdog) return recoveryRunner.watch(runtime.runId, runtime.blockId, () => provider.usage());
        const sessionWorkspace = await workflowSessionWorkspace(workspace, runtime.runId, runtime.blockId);
        await runtime.started(sessionWorkspace);
        const agentFile = block.agent
          ? (await agents.list(workspace)).find(
              (item) => item.scope === block.agent!.scope && item.name === block.agent!.name,
            )
          : undefined;
        if (block.agent && !agentFile)
          throw new CoreError("FILE_NOT_FOUND", `Agent preset '${block.agent.name}' does not exist`);
        const appTools = withAppTools(
          rootWorkspace,
          sessionWorkspace,
          undefined,
          agentFile?.agent,
          provider.descriptor.id,
          recoveryBridgeWorkspace,
        );
        const workflowTools = appToolServer(
          rootWorkspace,
          sessionWorkspace,
          provider.descriptor.id,
          recoveryBridgeWorkspace,
          { ...runtime, flow: ["ai", "chatbox"].includes(block.type) },
        );
        const mcpServers = [...appTools.servers.filter((server) => server.name !== workflowTools.name), workflowTools];
        const workflowAgent = appTools.agent
          ? { ...appTools.agent, mcpServers: [...new Set([...(appTools.agent.mcpServers ?? []), workflowTools.name])] }
          : undefined;
        const configuration = workflowConfiguration(provider.descriptor.options, block);
        const skillIds = await workflowSessionSkillIds(
          run?.definition,
          block,
          new SkillsStore(undefined, rootWorkspace),
          workspace,
        );
        runtime.assertActive();
        await provider.startFreshSession(sessionWorkspace, {
          prompt,
          configuration,
          mcpServers,
          captureSnapshots: workflowCapturesSnapshots(run, block.id),
          ...(skillIds ? { skillIds } : {}),
          agent: workflowAgent,
          ...(block.agent ? { agentPreset: block.agent } : {}),
        });
        runtime.assertActive();
        managedProcesses.setWorkspaceContext(sessionWorkspace, {
          workflowRunId: runtime.runId,
          workflowBlockId: runtime.blockId,
        });
        return settleWorkflowSession(
          provider,
          sessionWorkspace,
          aiTimers,
          undefined,
          () => recoveryRunner.isActive(runtime.runId),
          runtime.activity,
        );
      });
    const recoveryAppend: NonNullable<Parameters<HarnessRunner["start"]>[4]> = async (block, prompt, runtime) =>
      providerOperation(async () => {
        const recovered = await recoveryRunner.readRun(runtime.runId);
        if (!recovered) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
        const binding = await resolveWorkflowBinding(recovered, undefined, {
          tasks,
          rootWorkspace,
          workspacePath: rootWorkspace,
        });
        if ((await availableWorkflowWorkspace(runtime.workspace)) !== binding.workspace)
          throw new CoreError("INVALID_REQUEST", "Workflow recovery session worktree changed");
        const provider = acp.get(block.provider);
        if (!recoveryRunner.isActive(runtime.runId)) throw new Error("Workflow is no longer active");
        const current = await provider.get(runtime.workspace);
        const workflowTools = appToolServer(
          rootWorkspace,
          runtime.workspace,
          provider.descriptor.id,
          recoveryBridgeWorkspace,
          { runId: runtime.runId, blockId: runtime.blockId, flow: ["ai", "chatbox"].includes(block.type) },
        );
        if (current.status === "in_progress" || current.status === "user_prompt")
          await provider.steer(runtime.workspace, prompt);
        else
          await provider.send(runtime.workspace, {
            prompt,
            configuration: {
              ...(current.configuration ?? { model: current.model, reasoning: current.reasoning }),
              ...workflowFeatureOptions(provider.descriptor.options, block),
            },
            mcpServers: [workflowTools],
            captureSnapshots: workflowCapturesSnapshots(recovered, block.id),
          });
        if (!recoveryRunner.isActive(runtime.runId)) throw new Error("Workflow is no longer active");
        return settleWorkflowSession(
          provider,
          runtime.workspace,
          aiTimers,
          undefined,
          () => recoveryRunner.isActive(runtime.runId),
          runtime.activity,
        );
      });
    await recoveryRunner.recover(recoveryDispatch, acp.defaultId, recoveryAppend, {
      binding: async (run) => {
        run.binding ??= await resolveWorkflowBinding(run, undefined, {
          tasks,
          rootWorkspace,
          workspacePath: rootWorkspace,
        });
        run.workspace = run.binding.workspace;
        await validateWorkflowBinding(run.binding, tasks, rootWorkspace);
      },
      session: async (provider, target) =>
        acp
          .get(provider)
          .get(target)
          .catch(() => undefined),
      timer: async (runId, blockId, provider, target) => {
        const timer = await aiTimers.next(target, provider);
        return timer?.workflowRunId === runId && timer.workflowBlockId === blockId;
      },
      child: async (child) =>
        (await tasks.list()).tasks.some(
          (task) => task.id === child.taskId && path.resolve(tasks.taskPath(task.id)) === path.resolve(child.workspace),
        ),
    });
  }
  const scheduledPromptTargets = new Set<string>();
  const deliverAction = async (
    schedule: { rootId: string; taskId?: string; action: ScheduledAction; lastWorkflowRunId?: string },
    active: () => boolean,
    reaction: string,
    note = "",
  ): Promise<{ workflowRunId?: string }> => {
    const root = roots.get(schedule.rootId);
    const context = contextFor(root.id);
    const task = schedule.taskId
      ? (await context.tasks.list()).tasks.find((item) => item.id === schedule.taskId)
      : undefined;
    if (schedule.taskId && (!task || task.archived || task.status === "finished"))
      throw new CoreError("INVALID_REQUEST", "Scheduled task is missing, archived, or finished");
    const target = task ? context.tasks.taskPath(task.id) : root.path;
    const action = schedule.action;
    const provider = acp.get(action.provider);
    if (action.type === "workflow") {
      const previous = schedule.lastWorkflowRunId
        ? (await context.harnesses.runs()).find((item) => item.id === schedule.lastWorkflowRunId)
        : undefined;
      if (
        previous &&
        [
          "queued",
          "running",
          "waiting",
          "awaiting_permission",
          "awaiting_user_input",
          "waiting_timer",
          "retry_scheduled",
        ].includes(previous.status)
      )
        throw new DeliveryBusy(`Previous scheduled workflow is still active; ${reaction} to prevent overlap`);
      if (!active()) return {};
      const run = await startWorkflow(
        {
          harnessId: action.harnessId,
          input: action.input + note,
          provider: action.provider,
          startBlockId: action.startBlockId,
        },
        {
          acp,
          tasks: context.tasks,
          agents: context.agents,
          harnessRunner: harnessRunner(root.id),
          workflowApps,
          aiTimers,
          rootWorkspace: root.path,
          bridgeWorkspace: rootWorkspace,
          workspacePath: target,
        },
      );
      return { workflowRunId: run.id };
    }
    const targetKey = `${target}\0${provider.descriptor.id}`;
    if (scheduledPromptTargets.has(targetKey))
      throw new DeliveryBusy(`Another schedule or trigger is starting this agent; ${reaction} to prevent overlap`);
    scheduledPromptTargets.add(targetKey);
    try {
      const session = await provider.get(target);
      if (session.status === "in_progress" || session.status === "user_prompt")
        throw new DeliveryBusy(`Target agent is busy; ${reaction} to preserve its current turn`);
      const preset = action.agent
        ? (await context.agents.list(target)).find(
            (item) => item.scope === action.agent!.scope && item.name === action.agent!.name,
          )
        : undefined;
      if (action.agent && !preset) throw new CoreError("FILE_NOT_FOUND", "Scheduled agent preset no longer exists");
      const tools = withAppTools(root.path, target, undefined, preset?.agent, action.provider, rootWorkspace);
      if (!active()) return {};
      const request = {
        prompt: action.prompt + note,
        configuration: {
          ...(session.configuration ?? { model: session.model, reasoning: session.reasoning }),
          ...(action.model ? { model: action.model } : {}),
          ...(action.reasoning ? { reasoning: action.reasoning } : {}),
        },
        mcpServers: tools.servers,
        agent: tools.agent,
        agentPreset: action.agent,
      };
      if (action.newSession) await provider.startFreshSession(target, request);
      else await provider.send(target, request);
      return {};
    } finally {
      scheduledPromptTargets.delete(targetKey);
    }
  };
  const schedules = new ScheduleService(
    rootWorkspace,
    (schedule, active) => deliverAction(schedule, active, "schedule paused"),
    () => {
      const encoded = JSON.stringify({ type: "timers.changed", payload: {} } satisfies ServerEvent);
      for (const socket of activeSessions) {
        sendWebSocketData(socket, encoded);
        sendWebSocketData(
          socket,
          JSON.stringify({ type: "automation.changed", payload: { kind: "schedule" } } satisfies ServerEvent),
        );
      }
    },
  );
  const triggers = new TriggerService(
    rootWorkspace,
    async (trigger, event, active) => {
      const note = `\n\n[Started by trigger "${trigger.name}": ${event.description}]${event.data ? `\n\`\`\`\n${event.data}\n\`\`\`` : ""}`;
      try {
        const result = await deliverAction(trigger, active, "trigger skipped", note);
        if (active())
          feed.push("trigger-fired", trigger.rootId, {
            ...(trigger.taskId ? { taskId: trigger.taskId } : {}),
            ...(result.workflowRunId ? { runId: result.workflowRunId } : {}),
          });
        return result;
      } catch (error) {
        if (error instanceof DeliveryBusy) return { skipped: error.message };
        throw error;
      }
    },
    () => {
      const encoded = JSON.stringify({ type: "timers.changed", payload: {} } satisfies ServerEvent);
      for (const socket of activeSessions) {
        sendWebSocketData(socket, encoded);
        sendWebSocketData(
          socket,
          JSON.stringify({ type: "automation.changed", payload: { kind: "trigger" } } satisfies ServerEvent),
        );
      }
    },
  );
  await aiTimers.start();
  const onTasksChanged = async () => {
    recordTaskChanges(roots.primary().id);
    const encoded = JSON.stringify({
      type: "tasks.changed",
      payload: { rootId: roots.primary().id },
    } satisfies ServerEvent);
    for (const socket of activeSessions) sendWebSocketData(socket, encoded);
  };
  const onCommitMessageChanged = async (changedWorkspace: string, message: string) => {
    const rootId = await ownerRootId(changedWorkspace);
    if (!rootId) return;
    const encoded = JSON.stringify({
      type: "commit-message.changed",
      payload: { rootId, workspace: changedWorkspace, message },
    } satisfies ServerEvent);
    for (const socket of activeSessions) sendWebSocketData(socket, encoded);
  };
  const appCommandWatcher = chokidar.watch(appEvents.commandsDirectory, { ignoreInitial: true, depth: 0 });
  await new Promise<void>((resolve, reject) => {
    appCommandWatcher.once("ready", resolve);
    appCommandWatcher.once("error", reject);
  });
  appCommandWatcher.on("add", (file) => {
    if (!file.endsWith(".json")) return;
    const pending = appEvents.consumeCommand(file, async (command) => {
      if (draining) throw new CoreError("INVALID_REQUEST", "Core is shutting down");
      const currentWorkspace = command.currentWorkspace ?? rootWorkspace;
      const workflowRootId = command.workflowRunId
        ? [...harnessRunners].find(([, runner]) => runner.isActive(command.workflowRunId!))?.[0]
        : undefined;
      const rootId = workflowRootId ?? (await ownerRootId(currentWorkspace)) ?? roots.primary().id;
      const root = roots.get(rootId);
      const context = contextFor(rootId);
      const changed = async () => {
        recordTaskChanges(rootId);
        const encoded = JSON.stringify({ type: "tasks.changed", payload: { rootId } } satisfies ServerEvent);
        for (const socket of activeSessions) sendWebSocketData(socket, encoded);
      };
      if (
        command.workflowRunId &&
        command.workflowBlockId &&
        [
          "workflow_connections",
          "workflow_use_block",
          "workflow_block_output",
          "workflow_block_messages",
          "workflow_choose_path",
        ].includes(command.name)
      )
        return harnessRunner(rootId).flowTool(
          command.workflowRunId,
          command.workflowBlockId,
          command.name,
          command.args,
        );
      const workflow =
        command.workflowRunId && command.workflowBlockId
          ? {
              runId: command.workflowRunId,
              blockId: command.workflowBlockId,
              resumeFailed: () => harnessRunner(rootId).resumeFailed(command.workflowRunId!, command.workflowBlockId!),
              runStack: (inputs: string[], path?: string) =>
                harnessRunner(rootId).runStack(command.workflowRunId!, command.workflowBlockId!, inputs, path),
            }
          : undefined;
      const ownedWorkflow = workflow
        ? {
            ...workflow,
            flow: harnessRunner(rootId).isFlowBlock(workflow.runId, workflow.blockId),
            assertActive: () => {
              if (!harnessRunner(rootId).isActive(workflow.runId)) throw new Error("Workflow is no longer active");
            },
            planFeatures: (features: Array<{ id: string; prompt: string; prerequisites?: string[] }>) =>
              harnessRunner(rootId).planFeatures(workflow.runId, features),
            assertFeatureReady: (featureId: string) =>
              harnessRunner(rootId).assertFeatureReady(workflow.runId, featureId),
            dispatchFeature: (featureId: string, taskId: string) =>
              harnessRunner(rootId).dispatchFeature(workflow.runId, featureId, taskId),
            completeFeature: (taskId: string, commit: string) =>
              harnessRunner(rootId).completeFeature(workflow.runId, taskId, commit),
            registerChild: (taskId: string, provider: AiProvider, workspace: string) =>
              harnessRunner(rootId).registerChild(workflow.runId, {
                taskId,
                provider,
                workspace,
                blockId: workflow.blockId,
              }),
            operation: <T>(
              kind: "timer_create" | "task_create" | "prompt_delivery" | "merge",
              key: string,
              input: unknown,
              effect: () => Promise<T>,
              reconcile?: () => Promise<T | null | undefined>,
            ) =>
              harnessRunner(rootId).runOperation(workflow.runId, workflow.blockId, kind, key, input, effect, reconcile),
            recordTool: (name: string, args: Record<string, unknown>, result?: unknown, error?: unknown) =>
              harnessRunner(rootId).recordTool(workflow.runId, workflow.blockId, name, args, result, error),
          }
        : undefined;
      const configurationFilesystem = new WorkspaceFileSystem();
      await configurationFilesystem.initialize(currentWorkspace);
      const configurationRegistry = new LanguageRegistry();
      const configurationEvents: LanguageServiceEvents = {
        output() {},
        exit() {},
        debugState() {},
        semanticChanged() {},
      };
      const configurationState = new WorkspaceStateStore(currentWorkspace, process.env.HATOPAD_STATE_DIR);
      for (const language of BUILT_IN_LANGUAGES)
        configurationRegistry.register(language.descriptor, (workspace) =>
          language.create({
            workspace,
            filesystem: configurationFilesystem,
            state: configurationState,
            events: configurationEvents,
            rootId,
            emit() {},
          }),
        );
      for (const language of plugins.languages)
        configurationRegistry.register(language.descriptor, (workspace) =>
          language.create(workspace, configurationEvents),
        );
      const configurationLanguages = new LanguageSessions(configurationRegistry, currentWorkspace);
      runConfigs.registerWorkspace(currentWorkspace, root.path);
      const configuration = new ConfigurationService(
        root.path,
        currentWorkspace,
        {
          agents: context.agents,
          skills: new SkillsStore(undefined, root.path),
          useful: context.usefulFiles,
          workflows: context.harnesses,
          tasks: context.tasks,
          triggers: { service: triggers, rootId: root.id },
          languages: configurationLanguages,
          runs: runConfigs,
        },
        acp,
        async (resource, global) => {
          const encoded = JSON.stringify({
            type: "configuration.changed",
            payload: { rootId, resource, global },
          } satisfies ServerEvent);
          for (const socket of activeSessions) sendWebSocketData(socket, encoded);
          if (resource.startsWith("tasks/")) await changed();
        },
      );
      try {
        return await new AppToolService(
          context.tasks,
          acp,
          currentWorkspace,
          changed,
          onCommitMessageChanged,
          command.currentProvider,
          context.agents,
          root.path,
          aiTimers,
          rootWorkspace,
          ownedWorkflow,
          configuration,
          async (id) => {
            if (!command.currentProvider)
              throw new CoreError("INVALID_REQUEST", "Skill loading requires a provider conversation");
            const session = await acp.get(command.currentProvider).get(currentWorkspace);
            return new SkillsStore(undefined, root.path).load(currentWorkspace, id, session);
          },
        ).call(command.name, command.args);
      } finally {
        await configurationLanguages.dispose();
      }
    });
    bridgeCommands.add(pending);
    void pending
      .finally(() => bridgeCommands.delete(pending))
      .catch((error) => console.error("[core] App command cleanup failed", error));
  });
  const gitIndexWatcher = await watchGitState(workspace, () => {
    const encoded = JSON.stringify({
      type: "git.changed",
      payload: { rootId: roots.primary().id },
    } satisfies ServerEvent);
    for (const socket of activeSessions) sendWebSocketData(socket, encoded);
  });
  const rootBatcher = new WorkspaceWatchBatcher(roots.primary().id, (event) => {
    const encoded = JSON.stringify(event);
    for (const socket of activeSessions) sendWebSocketData(socket, encoded);
  });
  const broadcastChange = (absolutePath: string) => {
    const relativePath = path.relative(workspace, absolutePath).split(path.sep).join("/");
    if (relativePath && !relativePath.startsWith("..")) rootBatcher.change(relativePath);
  };
  watcher.on("ready", () => rootBatcher.refresh());
  watcher
    .on("add", broadcastChange)
    .on("change", broadcastChange)
    .on("unlink", broadcastChange)
    .on("addDir", broadcastChange)
    .on("unlinkDir", broadcastChange)
    .on("raw", (eventName) => {
      if (String(eventName).includes("OVERFLOW"))
        rootBatcher.degrade("Filesystem watcher overflow; synchronizing affected files.");
    })
    .on("error", (error) => {
      console.error(`[core] watcher error: ${String(error)}`);
      rootBatcher.degrade(`Filesystem watcher degraded: ${String(error)}`);
    });
  // Bind only after asynchronous startup, so an early client cannot connect
  // before the protocol connection handler is installed.
  const server = new WebSocketServer({
    host,
    port,
    autoPong: false,
    verifyClient: (
      { origin }: { origin?: string },
      done: (accepted: boolean, code?: number, message?: string) => void,
    ) => done(access.allowsOrigin(origin || undefined), 403, "Origin not allowed"),
  });
  server.once("close", () => {
    for (const dispose of socketMonitors) dispose();
    socketMonitors.clear();
  });
  const listening = new Promise<void>((resolve, reject) => {
    const ready = () => {
      server.off("error", failed);
      resolve();
    };
    const failed = (error: Error) => {
      server.off("listening", ready);
      reject(error);
    };
    server.once("listening", ready);
    server.once("error", failed);
  });
  void listening.catch(() => undefined);
  let cleanupPromise: Promise<void> | undefined;
  const cleanupServices = () =>
    (cleanupPromise ??= (async () => {
      await storage.drain();
      managedProcesses.off("changed", processesChanged);
      metadataHints.dispose();
      rootBatcher.dispose();
      terminalHost.closeAll();
      const results = await Promise.allSettled([
        schedules.close(),
        triggers.close(),
        remoteTransfers.close(),
        workflowApps.closeAll(),
        watcher.close(),
        gitIndexWatcher.close(),
        runConfigWatcher.close(),
        appEventWatcher.close(),
        appCommandWatcher.close(),
      ]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          "Core services could not be closed",
        );
    })());
  server.on("close", () => {
    void cleanupServices().catch((error) => console.error("[core] Service cleanup failed", error));
  });
  let shutdownPromise: Promise<void> | undefined;
  shutdownHandlers.set(
    server,
    () =>
      (shutdownPromise ??= (async () => {
        draining = true;
        metadataHints.dispose();
        const schedulesStopped = schedules.close();
        const triggersStopped = triggers.close();
        const timersStopped = aiTimers.suspend();
        void schedulesStopped.catch(() => undefined);
        void triggersStopped.catch(() => undefined);
        void timersStopped.catch(() => undefined);
        const suspended = await Promise.allSettled([
          appCommandWatcher.close(),
          ...[...harnessRunners.values()].map((runner) => runner.suspend()),
        ]);
        const closed = new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(),
          ),
        );
        for (const socket of server.clients) socket.close(1001, "Core is shutting down");
        const forceClose = setTimeout(() => {
          for (const socket of server.clients) socket.terminate();
        }, 500);
        try {
          const providerResults = await Promise.allSettled([
            typeof acp.shutdown === "function" ? acp.shutdown() : Promise.resolve(),
            timersStopped,
            schedulesStopped,
            triggersStopped,
          ]);
          if (inFlight) await new Promise<void>((resolve) => idleWaiters.add(resolve));
          await closed;
          const cleanupResults = await Promise.allSettled([
            ...bridgeCommands,
            ...sessionCleanups,
            cleanupServices(),
            flushWorkspaceStateWrites(),
            closeMcpConnections(),
            ...[...harnessRunners.values()].map((runner) => runner.drain()),
          ]);
          const failures = [...suspended, ...providerResults, ...cleanupResults].filter(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          if (failures.length)
            throw new AggregateError(
              failures.map((result) => result.reason),
              "Core shutdown did not finish cleanly",
            );
        } finally {
          clearTimeout(forceClose);
        }
      })()),
  );
  server.on("listening", () => console.log(`[core] listening on ws://${host}:${port}`));
  server.on("connection", (socket, request) => {
    if (draining) {
      socket.close(1001, "Core is shutting down");
      return;
    }
    configureWebSocketOutput(socket, outbound);
    socket.on("ping", (data) => sendWebSocketPong(socket, data));
    if (remoteTransfers.accepts(request.url)) {
      void remoteTransfers.attach(socket, request.url).catch((error) => {
        console.error("[core] File transfer failed:", error instanceof Error ? error.message : String(error));
        if (socket.readyState === WebSocket.OPEN) socket.close(1011, "File transfer failed");
      });
      return;
    }
    const portTunnels = new PortTunnels((server.address() as { port: number }).port, portTunnelBudget);
    socket.once("close", () => portTunnels.close());
    const admission = new RequestAdmission(admissionLimit, () => socket.readyState === WebSocket.OPEN);
    socket.once("close", () => admission.close());
    const disposeMonitor = monitorWebSocket(socket, liveness);
    socketMonitors.add(disposeMonitor);
    socket.once("close", () => socketMonitors.delete(disposeMonitor));
    let protocolAccepted = false;
    let maintenanceOnly = false;
    let updateCompatibility = { minimum: serverProtocolVersion, maximum: serverProtocolVersion };
    let sessionMessageLimit: number | undefined;
    // The durable registry selection is only the default for a new connection. Each connection pins its own
    // task per root on first use so another client's switch can never change what this one reports or runs.
    const taskPins = new Map<string, string | null>();
    const effectiveTaskId = (
      rootId: string,
      registry: { tasks: { id: string }[]; selectedTaskId?: string },
    ): string | undefined => {
      if (!taskPins.has(rootId)) taskPins.set(rootId, registry.selectedTaskId ?? null);
      const pinned = taskPins.get(rootId);
      return pinned && registry.tasks.some((task) => task.id === pinned) ? pinned : undefined;
    };
    const withConnectionSelection = <T>(rootId: string, result: T): T => {
      const record = result as unknown as { tasks?: { id: string }[]; selectedTaskId?: string };
      if (!record || !Array.isArray(record.tasks)) return result;
      const { selectedTaskId: _durable, ...rest } = record;
      const taskId = effectiveTaskId(rootId, record as { tasks: { id: string }[]; selectedTaskId?: string });
      return (taskId ? { ...rest, selectedTaskId: taskId } : rest) as T;
    };
    let selectedRoot = roots.primary();
    liveRootSelections.connect(socket, selectedRoot.id);
    const makeServices = async (nextWorkspace: string, ownerRootId = selectedRoot.id): Promise<SessionServices> => {
      const filesystem = new WorkspaceFileSystem();
      await filesystem.initialize(nextWorkspace);
      admission.assertOpen();
      workspaceOwners.set(path.resolve(nextWorkspace), ownerRootId);
      runConfigs.registerWorkspace(nextWorkspace, roots.get(ownerRootId).path);
      runConfigWatcher.add(runConfigs.directory(nextWorkspace, "local"));
      const workspaceState = new WorkspaceStateStore(nextWorkspace, process.env.HATOPAD_STATE_DIR);
      const search = new WorkspaceSearch(filesystem);
      const git = new GitService(nextWorkspace);
      const send = (message: ServerEvent) => {
        if (socket.readyState === WebSocket.OPEN) sendWebSocketData(socket, JSON.stringify(message));
      };
      const eventsFor = (language: string): LanguageServiceEvents => ({
        output: (data, stream) =>
          send({ type: "language.output", payload: { rootId: ownerRootId, language, data, stream } }),
        exit: (exitCode, signal) =>
          send({ type: "language.exit", payload: { rootId: ownerRootId, language, exitCode, signal } }),
        debugState: (state) =>
          send({ type: "language.debug.state", payload: { ...state, rootId: ownerRootId, language } }),
        semanticChanged: () => send({ type: "language.semantic.changed", payload: { rootId: ownerRootId, language } }),
      });
      const languageRegistry = new LanguageRegistry();
      for (const language of BUILT_IN_LANGUAGES) {
        languageRegistry.register(language.descriptor, (workspace) =>
          language.create({
            workspace,
            filesystem,
            state: workspaceState,
            events: eventsFor(language.descriptor.id),
            rootId: ownerRootId,
            emit: send,
          }),
        );
      }
      for (const contribution of plugins.languages) {
        const language = contribution.descriptor.id;
        languageRegistry.register(contribution.descriptor, (workspace) =>
          contribution.create(workspace, eventsFor(language)),
        );
      }
      const languages = new LanguageSessions(languageRegistry, nextWorkspace);
      const checkpoints = checkpointStore(nextWorkspace);
      await checkpoints.recover();
      if (socket.readyState !== WebSocket.OPEN) {
        await languages.dispose();
        throw new CoreError("INVALID_REQUEST", "Session closed while services were being prepared");
      }
      return {
        workspacePath: nextWorkspace,
        filesystem,
        search,
        git,
        languages,
        plugins: plugins.status,
        workspaceState,
        checkpoints,
      };
    };
    let servicesPromise: Promise<SessionServices> | undefined;
    /** Resolves once no task switch is in flight for this connection. */
    let switching: Promise<void> = Promise.resolve();
    const switchedWatches = new Map<string, SwitchedWatch>();
    const rootWatchSubscriptions = rootWatchSubscriptionsForServer;
    const closeSwitchedWatch = async (rootId: string, subscription: SwitchedWatch) => {
      rootWatchOwnersForServer.get(subscription)?.();
      rootWatchOwnersForServer.delete(subscription);
      subscription.batcher.dispose();
      await Promise.all([subscription.watcher.close(), subscription.gitWatcher.close()]);
      rootWatchSubscriptions.get(rootId)?.delete(subscription);
      if (!rootWatchSubscriptions.get(rootId)?.size) rootWatchSubscriptions.delete(rootId);
    };
    const prepareSwitchedWatch = async (
      nextWorkspace: string,
      ownerRootId = selectedRoot.id,
    ): Promise<SwitchedWatch | undefined> => {
      if (nextWorkspace === workspace) return undefined;
      const switchedWatcher = chokidar.watch(nextWorkspace, await workspaceWatchOptions(nextWorkspace));
      const batcher = new WorkspaceWatchBatcher(ownerRootId, (event) =>
        sendWebSocketData(socket, JSON.stringify(event)),
      );
      const sendChange = (absolutePath: string) => {
        const relativePath = path.relative(nextWorkspace, absolutePath).split(path.sep).join("/");
        if (relativePath && !relativePath.startsWith("..")) batcher.change(relativePath);
      };
      switchedWatcher.on("ready", () => batcher.refresh());
      switchedWatcher
        .on("add", sendChange)
        .on("change", sendChange)
        .on("unlink", sendChange)
        .on("addDir", sendChange)
        .on("unlinkDir", sendChange)
        .on("raw", (eventName) => {
          if (String(eventName).includes("OVERFLOW"))
            batcher.degrade("Filesystem watcher overflow; synchronizing affected files.");
        })
        .on("error", (error) => batcher.degrade(`Filesystem watcher degraded: ${String(error)}`));
      let switchedGitIndexWatcher: ReturnType<typeof chokidar.watch> | undefined;
      try {
        switchedGitIndexWatcher = await watchGitState(nextWorkspace, () => {
          sendWebSocketData(
            socket,
            JSON.stringify({ type: "git.changed", payload: { rootId: ownerRootId } } satisfies ServerEvent),
          );
        });
        return { watcher: switchedWatcher, gitWatcher: switchedGitIndexWatcher, batcher };
      } catch (error) {
        batcher.dispose();
        await switchedWatcher.close();
        await switchedGitIndexWatcher?.close();
        throw error;
      }
    };
    const commitSwitchedWatch = async (rootId: string, next: SwitchedWatch | undefined) => {
      if (socket.readyState !== WebSocket.OPEN) {
        if (next) await closeSwitchedWatch(rootId, next);
        return;
      }
      const previous = switchedWatches.get(rootId);
      if (next) {
        switchedWatches.set(rootId, next);
        let subscriptions = rootWatchSubscriptions.get(rootId);
        if (!subscriptions) {
          subscriptions = new Set();
          rootWatchSubscriptions.set(rootId, subscriptions);
        }
        subscriptions.add(next);
        rootWatchOwnersForServer.set(next, () => {
          if (switchedWatches.get(rootId) === next) switchedWatches.delete(rootId);
        });
      } else switchedWatches.delete(rootId);
      if (previous)
        await closeSwitchedWatch(rootId, previous).catch((error) =>
          console.error(`[core] watcher cleanup error: ${String(error)}`),
        );
    };
    // Task selection is durable server state and may have changed since Core started. A fresh
    // post-sleep socket must be routed to that selected worktree before workspace.open runs.
    // Otherwise the renderer restores the selected task label while requests still hit the old
    // startup workspace until another explicit task switch happens.
    const initializeServices = async () => {
      const registry = await tasks.list();
      admission.assertOpen();
      const pinnedTaskId = effectiveTaskId(selectedRoot.id, registry);
      const selectedWorkspace = pinnedTaskId ? tasks.taskPath(pinnedTaskId) : rootWorkspace;
      terminalSubscriptions.set(socket, {
        rootId: selectedRoot.id,
        workspace: selectedWorkspace,
        terminalIds: new Set(),
      });
      await commitSwitchedWatch(selectedRoot.id, await prepareSwitchedWatch(selectedWorkspace));
      return makeServices(selectedWorkspace);
    };
    const client = request.socket.remoteAddress ?? "unknown";
    console.log(`[core] connected: ${client}`);
    socket.on("message", async (data) => {
      if (draining) {
        socket.close(1001, "Core is shutting down");
        return;
      }
      inFlight += 1;
      let id = "unknown";
      let releaseAdmission: (() => void) | undefined;
      try {
        admission.assertOpen();
        const parsed = parseRequest(data);
        id = parsed.id;
        if (parsed.rootId !== undefined && (typeof parsed.rootId !== "string" || !parsed.rootId))
          throw new CoreError("INVALID_REQUEST", "rootId must be a nonempty string");
        validateRequestPayload(parsed.type, parsed.payload);
        console.log(`[core] request ${parsed.id}: ${parsed.type}`);
        if (parsed.type === "protocol.handshake" || parsed.type === "protocol.maintenance") {
          if (protocolAccepted) throw new CoreError("INVALID_REQUEST", "Protocol handshake has already completed");
          try {
            access.authenticate(parsed.payload.token);
          } catch (error) {
            setTimeout(() => socket.close(1008, "Authentication failed"), 0);
            throw error;
          }
          const limitRequested = validSessionMessageLimit(parsed.payload.sessionMessageLimit);
          const result = protocolHandshake(parsed.payload.compatibility);
          const compatible = result.compatible;
          maintenanceOnly = parsed.type === "protocol.maintenance";
          updateCompatibility = parsed.payload.compatibility;
          if (maintenanceOnly) {
            protocolAccepted = true;
            sendWebSocketData(socket, JSON.stringify({ id, ok: true, result: { ...result, maintenance: true } }));
            return;
          }
          sendWebSocketData(socket, JSON.stringify({ id, ok: true, result } satisfies Response));
          if (!compatible) setTimeout(() => socket.close(1008, "Incompatible protocol"), 0);
          else {
            protocolAccepted = true;
            sessionMessageLimit = limitRequested;
            servicesPromise = initializeServices();
            void servicesPromise.catch(() => undefined);
          }
          return;
        }
        if (!protocolAccepted)
          throw new CoreError("INVALID_REQUEST", "Complete protocol.handshake before sending requests");
        if (parsed.type.startsWith("portTunnel.")) {
          if (!protocolHandshake(updateCompatibility).compatible)
            throw new CoreError("INVALID_REQUEST", "Port tunnels require compatible Core and Gateway versions");
          releaseAdmission = admission.acquire();
          const result = await portTunnels.handle(parsed.type, parsed.payload);
          sendWebSocketData(socket, JSON.stringify({ id, ok: true, result }));
          return;
        }
        if (maintenanceOnly) {
          if (!["core.update.check", "core.update.apply", "protocol.keepAlive"].includes(parsed.type))
            throw new CoreError("INVALID_REQUEST", "Maintenance connections only allow Core updates");
          if (parsed.type !== "protocol.keepAlive") releaseAdmission = admission.acquire();
          const result =
            parsed.type === "core.update.check"
              ? await updates.check(parsed.payload, false, updateCompatibility)
              : parsed.type === "core.update.apply"
                ? await updates.apply(parsed.payload, updateCompatibility)
                : parsed.type === "protocol.keepAlive"
                  ? {}
                  : undefined;
          if (result === undefined)
            throw new CoreError("INVALID_REQUEST", "Maintenance connections only allow Core updates");
          sendWebSocketData(socket, JSON.stringify({ id, ok: true, result }));
          return;
        }
        // Browser-compatible liveness probe must not wait for workspace services or switches.
        if (parsed.type === "protocol.keepAlive") {
          sendWebSocketData(
            socket,
            JSON.stringify({ id, ok: true, result: {} } satisfies Response<"protocol.keepAlive">),
          );
          return;
        }
        if (parsed.type === "client.presence") {
          if (parsed.payload.visible) presence.set(socket, Date.now() + presenceLeaseMs);
          else presence.delete(socket);
          sendWebSocketData(socket, JSON.stringify({ id, ok: true, result: {} } satisfies Response<"client.presence">));
          return;
        }
        releaseAdmission = admission.acquire();
        if (parsed.type === "workspace.roots") {
          sendWebSocketData(
            socket,
            JSON.stringify({ id, ok: true, result: { roots: roots.list(), selectedRootId: selectedRoot.id } }),
          );
          return;
        }
        if (parsed.type === "overview.events") {
          if (parsed.payload.rootId) roots.get(parsed.payload.rootId);
          sendWebSocketData(
            socket,
            JSON.stringify({ id, ok: true, result: feed.page(parsed.payload) } satisfies Response<"overview.events">),
          );
          return;
        }
        if (parsed.type === "overview.work") {
          sendWebSocketData(
            socket,
            JSON.stringify({
              id,
              ok: true,
              result: await overviewWork(parsed.payload),
            } satisfies Response<"overview.work">),
          );
          return;
        }
        if (parsed.type === "overview.summary") {
          sendWebSocketData(
            socket,
            JSON.stringify({
              id,
              ok: true,
              result: await overviewSummary(parsed.payload),
            } satisfies Response<"overview.summary">),
          );
          return;
        }
        if (parsed.type === "workspace.addRoot") {
          const root = await roots.add(parsed.payload.path, parsed.payload.alias);
          sendWebSocketData(socket, JSON.stringify({ id, ok: true, result: { root, roots: roots.list() } }));
          return;
        }
        assertRequestRoot(parsed, selectedRoot.id);
        if (parsed.type === "workspace.removeRoot") {
          assertRootRemovalAllowed(liveRootSelections, parsed.payload.rootId);
          const target = roots.get(parsed.payload.rootId);
          const targetContext = contextFor(target.id);
          if (workflowApps.hasWorkspace(target.path))
            throw new CoreError("INVALID_REQUEST", "Kill running workflow apps before removing this root");
          const [targetTasks, targetOptions] = await Promise.all([
            targetContext.tasks.list(),
            new WorkspaceStateStore(target.path, process.env.HATOPAD_STATE_DIR).load(),
          ]);
          const blocker = rootRemovalBlocker({
            tasks: targetTasks.tasks.length,
            openFiles: targetOptions.openFiles.length,
            terminals: terminalHost.hasWorkspace(target.path),
            transfers: remoteTransfers.hasWorkspace(target.path),
          });
          if (blocker) throw new CoreError("INVALID_REQUEST", blocker);
          admission.assertOpen();
          assertRootRemovalAllowed(liveRootSelections, target.id);
          removingRoots.add(target.id);
          try {
            const subscriptions = [...(rootWatchSubscriptions.get(target.id) ?? [])];
            await Promise.all(subscriptions.map((subscription) => closeSwitchedWatch(target.id, subscription)));
            admission.assertOpen();
            await roots.remove(parsed.payload.rootId);
            rootContexts.delete(parsed.payload.rootId);
          } finally {
            removingRoots.delete(target.id);
          }
          sendWebSocketData(
            socket,
            JSON.stringify({
              id,
              ok: true,
              rootId: parsed.rootId,
              result: { roots: roots.list(), selectedRootId: selectedRoot.id },
            }),
          );
          return;
        }
        if (parsed.type === "filesystem.searchRoots") {
          const rootIds = [...new Set(parsed.payload.rootIds)];
          if (!rootIds.length || rootIds.length > 16)
            throw new CoreError("INVALID_REQUEST", "Search must name between 1 and 16 registered roots");
          const results = await Promise.all(
            rootIds.map(async (rootId) => {
              const root = roots.get(rootId);
              const context = contextFor(rootId);
              const taskRegistry = await context.tasks.list();
              const pinned = effectiveTaskId(rootId, taskRegistry);
              const target = pinned ? context.tasks.taskPath(pinned) : root.path;
              const filesystem = new WorkspaceFileSystem();
              await filesystem.initialize(target);
              const result = await new WorkspaceSearch(filesystem).search(
                parsed.payload.query,
                parsed.payload.path,
                parsed.payload.matchCase,
                { include: parsed.payload.include, exclude: parsed.payload.exclude },
              );
              return { matches: result.matches.map((match) => ({ ...match, rootId })), truncated: result.truncated };
            }),
          );
          const matches = results.flatMap((result) => result.matches).slice(0, 500);
          sendWebSocketData(
            socket,
            JSON.stringify({
              id,
              ok: true,
              rootId: parsed.rootId,
              result: {
                matches,
                truncated:
                  results.some((result) => result.truncated) ||
                  results.reduce((count, result) => count + result.matches.length, 0) > matches.length,
              },
            }),
          );
          return;
        }
        if (parsed.type === "filesystem.readRootFile") {
          const root = roots.get(parsed.payload.targetRootId);
          const context = contextFor(root.id);
          const taskRegistry = await context.tasks.list();
          const pinned = effectiveTaskId(root.id, taskRegistry);
          const target = pinned ? context.tasks.taskPath(pinned) : root.path;
          const filesystem = new WorkspaceFileSystem();
          await filesystem.initialize(target);
          const file = await filesystem.read(parsed.payload.path);
          sendWebSocketData(
            socket,
            JSON.stringify({
              id,
              ok: true,
              rootId: parsed.rootId,
              result: { rootId: root.id, path: parsed.payload.path, ...file },
            }),
          );
          return;
        }
        // Requests are handled concurrently, so anything that arrives while a task switch is
        // rebuilding the services has to wait for it. Otherwise it would run against the
        // previous worktree and answer the client with another task's state.
        const requestRoot = roots.get(
          parsed.type === "workspace.selectRoot" ? parsed.payload.rootId : (parsed.rootId ?? selectedRoot.id),
        );
        const rootContext = contextFor(requestRoot.id);
        const switchesWorkspace =
          parsed.type === "tasks.switch" || parsed.type === "tasks.delete" || parsed.type === "workspace.selectRoot";
        if (!switchesWorkspace) await switching;
        let release: (() => void) | undefined;
        if (switchesWorkspace) {
          const previous = switching;
          switching = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
        }
        let services: SessionServices;
        let rootSelectionResult:
          | {
              root: WorkspaceRoot;
              workspace: string;
              projectName: string;
              tree: FileTreeNode[];
              options: WorkspaceOptions;
            }
          | undefined;
        try {
          services = await servicesPromise!;
          admission.assertOpen();
          if (parsed.type === "workspace.selectRoot") {
            const nextRoot = roots.get(parsed.payload.rootId);
            if (removingRoots.has(nextRoot.id))
              throw new CoreError("INVALID_REQUEST", "Workspace root is being removed");
            liveRootSelections.beginSelection(socket, nextRoot.id);
            const previousServices = services;
            let candidate: {
              nextServices: SessionServices;
              nextWatch: SwitchedWatch | undefined;
              result: {
                root: WorkspaceRoot;
                workspace: string;
                projectName: string;
                tree: FileTreeNode[];
                options: WorkspaceOptions;
              };
            };
            try {
              candidate = await transactionalRootSelection(
                async () => {
                  const selectedTasks = parsed.payload.preserveTaskSelection
                    ? await rootContext.tasks.list()
                    : undefined;
                  admission.assertOpen();
                  const preservedTaskId = selectedTasks ? effectiveTaskId(nextRoot.id, selectedTasks) : undefined;
                  const nextWorkspace = preservedTaskId ? rootContext.tasks.taskPath(preservedTaskId) : nextRoot.path;
                  const nextServices = await makeServices(nextWorkspace, nextRoot.id);
                  let nextWatch: SwitchedWatch | undefined;
                  try {
                    nextWatch = await prepareSwitchedWatch(nextServices.workspacePath, nextRoot.id);
                    const result = {
                      root: nextRoot,
                      workspace: nextServices.workspacePath,
                      projectName: nextRoot.alias,
                      tree:
                        parsed.payload.includeTree === false
                          ? []
                          : await nextServices.filesystem.listTree(parsed.payload.includeIgnored === true),
                      options: await nextServices.workspaceState.load(),
                    };
                    return { nextServices, nextWatch, result };
                  } catch (error) {
                    await nextServices.languages.dispose();
                    if (nextWatch) await closeSwitchedWatch(nextRoot.id, nextWatch);
                    throw error;
                  }
                },
                async ({ nextServices, nextWatch }) => {
                  admission.assertOpen();
                  await commitSwitchedWatch(nextRoot.id, nextWatch);
                  admission.assertOpen();
                  if (!parsed.payload.preserveTaskSelection) {
                    await selectRootWorkspace(rootContext.tasks);
                    taskPins.set(nextRoot.id, null);
                  }
                  admission.assertOpen();
                  selectedRoot = nextRoot;
                  liveRootSelections.select(socket, nextRoot.id);
                  servicesPromise = Promise.resolve(nextServices);
                  terminalWatchers.disconnect(socket);
                  terminalSubscriptions.set(socket, {
                    rootId: nextRoot.id,
                    workspace: nextServices.workspacePath,
                    terminalIds: new Set(),
                  });
                  trackCleanup(previousServices.languages.dispose());
                },
                async ({ nextServices, nextWatch }) => {
                  await nextServices.languages.dispose();
                  if (nextWatch) await closeSwitchedWatch(nextRoot.id, nextWatch);
                },
              );
            } catch (error) {
              liveRootSelections.cancelSelection(socket);
              throw error;
            }
            services = candidate.nextServices;
            rootSelectionResult = candidate.result;
          } else if (
            parsed.type === "tasks.switch" ||
            (parsed.type === "tasks.delete" &&
              effectiveTaskId(requestRoot.id, await rootContext.tasks.list()) === parsed.payload.taskId)
          ) {
            admission.assertOpen();
            const selected = await rootContext.tasks.select(
              parsed.type === "tasks.switch" ? parsed.payload.taskId : undefined,
            );
            taskPins.set(requestRoot.id, parsed.type === "tasks.switch" ? (parsed.payload.taskId ?? null) : null);
            trackCleanup(services.languages.dispose());
            servicesPromise = makeServices(selected.workspace);
            services = await servicesPromise!;
            terminalWatchers.disconnect(socket);
            terminalSubscriptions.set(socket, {
              rootId: selectedRoot.id,
              workspace: selected.workspace,
              terminalIds: new Set(),
            });
            await commitSwitchedWatch(selectedRoot.id, await prepareSwitchedWatch(selected.workspace));
          }
        } finally {
          release?.();
        }
        admission.assertOpen();
        if (parsed.type === "terminal.watch.ack" || parsed.type === "terminal.watch.detach") {
          const scope = { rootId: requestRoot.id, workspace: services.workspacePath };
          if (typeof parsed.payload.watchId !== "string")
            throw new CoreError("INVALID_REQUEST", "watchId must be a string");
          if (parsed.type === "terminal.watch.ack")
            terminalWatchers.acknowledge(socket, scope, parsed.payload.watchId, parsed.payload.sequence);
          else terminalWatchers.detach(socket, scope, parsed.payload.watchId);
          sendWebSocketData(socket, JSON.stringify({ id, ok: true, rootId: parsed.rootId, result: {} }));
          return;
        }
        let result =
          parsed.type === "workspace.selectRoot"
            ? rootSelectionResult!
            : parsed.type === "storage.scan"
              ? storage.scan()
              : parsed.type === "storage.status"
                ? storage.status()
                : parsed.type === "storage.cleanup"
                  ? storage.cleanup(parsed.payload)
                  : parsed.type === "core.update.check"
                    ? await updates.check(parsed.payload, false, updateCompatibility)
                    : parsed.type === "core.update.apply"
                      ? await updates.apply(parsed.payload, updateCompatibility)
                      : await handleRequest(
                          services,
                          rootContext.tasks,
                          acp,
                          rootContext.usefulFiles,
                          rootContext.agents,
                          rootContext.harnesses,
                          harnessRunner(requestRoot.id),
                          workflowApps,
                          terminalHost,
                          runConfigs,
                          aiTimers,
                          schedules,
                          triggers,
                          remoteTransfers,
                          requestRoot.path,
                          parsed,
                          rootWorkspace,
                        );
        if (
          parsed.type === "terminal.watch.attach" &&
          parsed.payload.follow === true &&
          (result as { state: string }).state === "available"
        ) {
          const watchId = terminalWatchers.attach(
            socket,
            { rootId: requestRoot.id, workspace: services.workspacePath },
            parsed.payload.terminalId,
          );
          result = { ...(result as object), watchId };
        }
        if (parsed.type === "tasks.list" || parsed.type === "tasks.switch" || parsed.type === "tasks.delete")
          result = withConnectionSelection(requestRoot.id, result);
        if (parsed.type === "git.commit") feed.push("commit-made", selectedRoot.id);
        if (
          [
            "tasks.create",
            "tasks.createFromPrompt",
            "tasks.status",
            "tasks.rename",
            "tasks.archive",
            "tasks.delete",
          ].includes(parsed.type)
        ) {
          recordTaskChanges(selectedRoot.id);
          const encoded = JSON.stringify({
            type: "tasks.changed",
            payload: { rootId: selectedRoot.id },
          } satisfies ServerEvent);
          for (const session of activeSessions) sendWebSocketData(session, encoded);
        }
        const terminalSubscription = terminalSubscriptions.get(socket);
        if (terminalSubscription && parsed.type === "terminal.create") {
          const terminalId = (result as { terminalId: string }).terminalId;
          terminalSubscription.terminalIds.add(terminalId);
          terminalOwners.set(terminalId, { socket, rootId: parsed.rootId, workspace: services.workspacePath });
        }
        if (
          terminalSubscription &&
          parsed.type === "terminal.attach" &&
          (result as { state: string }).state === "available"
        ) {
          terminalSubscription.terminalIds.add(parsed.payload.terminalId);
          terminalOwners.set(parsed.payload.terminalId, {
            socket,
            rootId: parsed.rootId,
            workspace: services.workspacePath,
          });
        }
        if (terminalSubscription && parsed.type === "terminal.close") {
          terminalSubscription.terminalIds.delete(parsed.payload.terminalId);
          terminalOwners.delete(parsed.payload.terminalId);
        }
        if (
          terminalSubscription &&
          (parsed.type === "runConfig.run" ||
            parsed.type === "runConfig.restart" ||
            parsed.type === "runConfig.openTerminal")
        ) {
          const terminalId = (result as { config: { terminalId?: string } }).config.terminalId;
          if (terminalId) terminalSubscription.terminalIds.add(terminalId);
        }
        if (parsed.type === "workspace.open") activeSessions.add(socket);
        sendWebSocketData(
          socket,
          JSON.stringify({
            id,
            ok: true,
            rootId: parsed.rootId,
            result: boundSessionsInResult(result, sessionMessageLimit),
          }),
        );
      } catch (error) {
        const coreError =
          error instanceof CoreError
            ? error
            : new CoreError("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid request");
        console.error(`[core] error ${id}: ${coreError.code} ${coreError.message}`);
        sendWebSocketData(
          socket,
          JSON.stringify({
            id,
            ok: false,
            error: { code: coreError.code, message: coreError.message },
          } satisfies Response),
        );
      } finally {
        releaseAdmission?.();
        inFlight -= 1;
        if (!inFlight) {
          for (const resolve of idleWaiters) resolve();
          idleWaiters.clear();
        }
      }
    });
    socket.on("close", () => {
      presence.delete(socket);
      activeSessions.delete(socket);
      liveRootSelections.disconnect(socket);
      terminalWatchers.disconnect(socket);
      terminalSubscriptions.delete(socket);
      for (const [id, owner] of terminalOwners) if (owner.socket === socket) terminalOwners.delete(id);
      const cleanup = (async () => {
        await Promise.all(
          [...switchedWatches].map(([rootId, subscription]) => closeSwitchedWatch(rootId, subscription)),
        );
        const services = await servicesPromise?.catch(() => undefined);
        await services?.languages.dispose();
      })();
      sessionCleanups.add(cleanup);
      void cleanup
        .finally(() => sessionCleanups.delete(cleanup))
        .catch((error) => console.error("[core] Session cleanup failed", error));
      console.log(`[core] disconnected: ${client}`);
    });
    socket.on("error", (error) => console.error(`[core] socket error: ${error.message}`));
  });
  try {
    await listening;
    await schedules.start();
    await triggers.start();
  } catch (error) {
    await shutdownCore(server).catch((cleanupError) => console.error("[core] Startup cleanup failed", cleanupError));
    throw error;
  }
  return server;
}

function parseRequest(data: RawData): Request {
  let value: unknown;
  try {
    value = JSON.parse(data.toString());
  } catch {
    throw new CoreError("INVALID_REQUEST", "Message must be valid JSON");
  }
  if (!value || typeof value !== "object") throw new CoreError("INVALID_REQUEST", "Request must be an object");
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.type !== "string" ||
    !("payload" in candidate) ||
    (candidate.type !== "protocol.handshake" && !requestTypes.includes(candidate.type as RequestType))
  ) {
    throw new CoreError("INVALID_REQUEST", "Request must contain a valid id, type, and payload");
  }
  return value as Request;
}

export function assertRequestRoot(request: Request, selectedRootId: string): void {
  if (request.type.startsWith("portTunnel.")) return;
  if (
    request.type === "protocol.maintenance" ||
    request.type === "core.update.check" ||
    request.type === "core.update.apply" ||
    request.type === "protocol.handshake" ||
    request.type === "protocol.keepAlive" ||
    request.type === "client.presence" ||
    request.type === "workspace.roots" ||
    request.type === "workspace.addRoot" ||
    request.type === "overview.summary" ||
    request.type === "overview.work" ||
    request.type === "overview.events"
  )
    return;
  if (!request.rootId) throw new CoreError("INVALID_REQUEST", `Request ${request.type} requires an explicit rootId`);
  if (request.type !== "workspace.selectRoot" && request.rootId !== selectedRootId)
    throw new CoreError("INVALID_REQUEST", `Request root ${request.rootId} is not the selected root ${selectedRootId}`);
}

export async function selectRootWorkspace(tasks: Pick<WorkspaceTaskStore, "select">): Promise<void> {
  await tasks.select(undefined);
}

export function rootRemovalBlocker(state: {
  tasks: number;
  openFiles: number;
  terminals: boolean;
  transfers: boolean;
}): string | undefined {
  if (state.tasks) return "Remove or relocate this root's task worktrees before unregistering it";
  if (state.openFiles) return "Close this root's persisted open files before unregistering it";
  if (state.terminals) return "Close this root's terminal sessions before unregistering it";
  if (state.transfers) return "Finish or cancel this root's file transfers before unregistering it";
  return undefined;
}

export {
  startWorkflow,
  workflowTurnInstructions,
  workflowCapturesSnapshots,
  workflowRunWorkspace,
  validateWorkflowBinding,
  resolveWorkflowBinding,
  validateWorkflowTarget,
  workflowFeatureOptions,
  workflowConfiguration,
  steerWorkflowSession,
  settleWorkflowSession,
  renameWorkspacePaths,
  permissionTargetWorkspace,
  assertWorkflowModelAvailable,
  assertSessionChangeAllowed,
} from "./request-support.js";
