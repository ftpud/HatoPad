import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { WorkspaceFileSystem } from "../filesystem.js";
import { TerminalSessionHost } from "../process-manager.js";
import { GitService } from "../git.js";
import { WorkspaceStateStore } from "../workspace-state.js";
import { WorkspaceSearch } from "../search.js";
import { LanguageSessions } from "../language/registry.js";
import { JavaLanguageService } from "../plugins/builtin.js";
import type { PluginStatus } from "@hatopad/protocol";
import { WorkspaceTaskStore } from "../tasks.js";
import { UsefulFilesStore } from "../useful-files.js";
import { AgentsStore } from "../agents.js";
import { HarnessStore } from "../harnesses.js";
import { WorkflowAppService } from "../workflow-app.js";
import { HarnessRunner } from "../harness-runner.js";
import { RunConfigService } from "../run-configs.js";
import { type AcpRegistry } from "../ai/index.js";
import { ScheduleService } from "../schedules.js";
import { TriggerService } from "../triggers.js";
import { AiTimerService } from "../ai-timers.js";
import { TaskCheckpointStore } from "../task-checkpoints.js";
import { RemoteTransferService } from "../remote-transfer.js";
import type { ScheduledAction } from "@hatopad/protocol";

export type SessionServices = {
  workspacePath: string;
  filesystem: WorkspaceFileSystem;
  search: WorkspaceSearch;
  git: GitService;
  languages: LanguageSessions;
  plugins: PluginStatus[];
  workspaceState: WorkspaceStateStore;
  checkpoints: TaskCheckpointStore;
};

export function createRequestContext(services: SessionServices, tasks: WorkspaceTaskStore, acp: AcpRegistry, usefulFiles: UsefulFilesStore, agents: AgentsStore, harnesses: HarnessStore, harnessRunner: HarnessRunner, workflowApps: WorkflowAppService, terminalHost: TerminalSessionHost, runConfigs: RunConfigService, aiTimers: AiTimerService, schedules: ScheduleService, triggers: TriggerService, remoteTransfers: RemoteTransferService, rootWorkspace: string, request: Request, bridgeWorkspace = rootWorkspace) {
  const validateActionTarget = async (payload: { taskId?: string; action: ScheduledAction }): Promise<void> => {
    const task = payload.taskId ? (await tasks.list()).tasks.find((item) => item.id === payload.taskId) : undefined;
    if (payload.taskId && (!task || task.archived || task.status === "finished")) throw new CoreError("INVALID_REQUEST", "Choose an active task");
    acp.get(payload.action.provider);
    if (payload.action.type === "workflow") {
      const action = payload.action;
      const workflow = await harnesses.read(action.harnessId);
      const starts = workflow.blocks.filter((block) => block.type === "start_button" || block.type === "start_input");
      if (starts.length > 1 && !action.startBlockId) throw new CoreError("INVALID_REQUEST", "Choose a workflow start block");
      if (action.startBlockId && !starts.some((block) => block.id === action.startBlockId)) throw new CoreError("INVALID_REQUEST", "Workflow start block no longer exists");
    }
    if (payload.action.type === "prompt" && payload.action.agent) {
      const preset = payload.action.agent;
      if (!(await agents.list(task ? tasks.taskPath(task.id) : rootWorkspace)).some((item) => item.scope === preset.scope && item.name === preset.name)) throw new CoreError("FILE_NOT_FOUND", "Agent preset does not exist in the selected task");
    }
  };
  const assertAutomationOwner = (kind: "schedule" | "trigger", id: string) => {
    const item = kind === "schedule" ? schedules.list().find(item => item.id === id) : triggers.list().find(item => item.id === id);
    if (!item || item.rootId !== request.rootId) throw new CoreError("FILE_NOT_FOUND", "Automation no longer exists in this root");
  };
  const ownedTimers = async () => {
    const workspaces = new Set([path.resolve(rootWorkspace), ...(await tasks.list()).tasks.map(task => path.resolve(tasks.taskPath(task.id)))]);
    const workflowIds = new Set((await harnesses.summaries()).map(run => run.id));
    return (await aiTimers.list()).filter(timer => workspaces.has(path.resolve(timer.workspace)) || (timer.workflowRunId !== undefined && workflowIds.has(timer.workflowRunId)));
  };
  const assertTimerOwner = async (id: string) => {
    if (!(await ownedTimers()).some(timer => timer.id === id)) throw new CoreError("FILE_NOT_FOUND", "Timer no longer exists in this root");
  };
  const automationInput = (input: unknown, kind: "schedule" | "trigger") => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new CoreError("INVALID_REQUEST", "Automation input must be an object");
    const keys = kind === "schedule" ? ["name", "dueAt", "intervalSeconds", "taskId", "action"] : ["name", "source", "taskId", "action", "debounceSeconds", "maxFiresPerHour"];
    if (Object.keys(input).some(key => !keys.includes(key))) throw new CoreError("INVALID_REQUEST", "Unknown automation input field");
  };
  if (["timers.list", "timers.cancel", "timers.fire"].includes(request.type)) {
    const scoped = (request.payload as { rootScoped?: unknown }).rootScoped;
    if (scoped !== undefined && typeof scoped !== "boolean") throw new CoreError("INVALID_REQUEST", "rootScoped must be boolean");
  }
  const { filesystem, search, git, workspaceState, workspacePath, checkpoints } = services;
  // Legacy java.* requests resolve the Java service through the registry; language.* is the generic path.
  const javaOf = () => services.languages.get("java") as JavaLanguageService;

  return { services, tasks, acp, usefulFiles, agents, harnesses, harnessRunner, workflowApps, terminalHost, runConfigs, aiTimers, schedules, triggers, remoteTransfers, rootWorkspace, bridgeWorkspace, validateActionTarget, assertAutomationOwner, ownedTimers, assertTimerOwner, automationInput, filesystem, search, git, workspaceState, workspacePath, checkpoints, javaOf };
}

export type RequestContext = ReturnType<typeof createRequestContext>;
