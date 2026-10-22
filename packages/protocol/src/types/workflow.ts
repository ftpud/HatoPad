import type { AiProvider, AiConfiguration, AiTokenUsage, AiPermissionRequest } from "@hatopad/acp";
import type { AgentFileReference } from "./configuration.js";

export type HarnessDataSchema = {
  type: "string" | "number" | "boolean" | "object" | "array";
  properties?: Record<string, HarnessDataSchema>;
  required?: string[];
  items?: HarnessDataSchema;
};

export type HarnessReview = { revision: string; baseRevision?: string; correction?: HarnessCorrection };

/** A review can send its structured findings back to the block that owns the change. */
export type HarnessCorrection = { ownerBlockId: string; maxCycles?: number; verificationBlockId?: string };

export type HarnessReviewFinding = { id: string; message: string; ownerBlockId: string; revision: string };

export type HarnessCorrectionCycle = {
  reviewBlockId: string;
  ownerBlockId: string;
  verificationBlockId?: string;
  cycle: number;
  revision: string;
  findings: HarnessReviewFinding[];
  status: "requested" | "corrected" | "blocked";
  correctedRevision?: string;
  requestedAt: string;
  completedAt?: string;
  error?: string;
};

export type HarnessVerification = { command: string; revision?: string; workingDirectory?: string; timeoutMs?: number };

/** One explicitly registered Run App launch, including surviving descendants. */
export type ManagedWorkflowApp = {
  kind: "workflow-app";
  id: string;
  name: string;
  pid: number;
  launcherPid?: number;
  command: string;
  status: "running" | "descendants-running";
  processCount: number;
  workspace: string;
  rootWorkspace: string;
  taskId?: string;
  taskName?: string;
  workflowRunId?: string;
  workflowBlockId?: string;
};

/** Named long-lived shell apps are owned by Core and scoped to the execution workspace. */
export type HarnessAppAction = "start" | "status" | "kill" | "tail";

export type HarnessAppState = {
  name: string;
  status: "not_found" | "starting" | "running" | "descendants-running" | "exited";
  output: string;
  pid?: number;
  exitCode?: number | null;
  signal?: string | null;
};

export type HarnessAppOptions = {
  action?: HarnessAppAction;
  actions?: HarnessAppAction[];
  name: string;
  lines?: number;
};

export type HarnessBlock = {
  id: string;
  type:
    | "ai"
    | "chatbox"
    | "skill"
    | "mcp"
    | "task_controls"
    | "terminal_control"
    | "meeting"
    | "text"
    | "timer"
    | "user_prompt"
    | "yes_no_prompt"
    | "markdown"
    | "script"
    | "run_app"
    | "start_button"
    | "start_input"
    | "prompt"
    | "task"
    | "review"
    | "verification";
  seconds?: number;
  command?: string;
  app?: HarnessAppOptions;
  autopilot?: boolean;
  label: string;
  description?: string;
  skillId?: string;
  mcp?: { serverId: string; connectionId?: string };
  prompt: string;
  inputSchema?: HarnessDataSchema;
  outputSchema?: HarnessDataSchema;
  provider?: AiProvider;
  model?: string;
  reasoning?: string;
  /** Non-interactive provider feature switches; interactive ones are always off in workflows. */ options?: AiConfiguration;
  agent?: AgentFileReference;
  watchdog?: boolean;
  review?: HarnessReview;
  verification?: HarnessVerification;
  join?: "all" | "any";
  routing?: "all" | "ai";
  position: { x: number; y: number };
};

export type HarnessEdge = {
  timeoutMs?: number;
  type?: "use" | "follow" | "path";
  id: string;
  from: string;
  to: string;
  label?: string;
  loop?: boolean;
  execution?: "sync" | "async";
};

export type HarnessRetryPolicy = { maxAttempts?: number };

export type HarnessSettings = {
  concurrency?: number;
  maxActiveRuns?: number;
  maxBlockAttempts?: number;
  maxStackSize?: number;
  maxLoopCount?: number;
  maxChildTasks?: number;
  promptLimitChars?: number;
  contextBudgetChars?: number;
  retry?: HarnessRetryPolicy;
  outputLimitChars?: number;
  logLimitEntries?: number;
  maxRunDurationMs?: number;
  tokenBudget?: number;
};

export type HarnessDefinition = {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  settings?: HarnessSettings;
  blocks: HarnessBlock[];
  edges: HarnessEdge[];
};

export type HarnessStateDiagnostic = { source: "index.json" | "runs.json"; reason: string; detectedAt: string };

export type HarnessValidationIssue = {
  code:
    | "empty"
    | "duplicate-id"
    | "duplicate-edge-id"
    | "missing-endpoint"
    | "self-edge"
    | "duplicate-edge"
    | "cycle"
    | "route-label"
    | "empty-label"
    | "empty-prompt"
    | "unknown-template"
    | "missing-template-block"
    | "invalid-loop"
    | "invalid-schema"
    | "invalid-gate"
    | "invalid-watchdog"
    | "invalid-settings"
    | "unavailable-provider"
    | "unavailable-model"
    | "unavailable-agent";
  message: string;
  blockId?: string;
  edgeId?: string;
};

export type HarnessBlockIteration = {
  index: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  prompt?: string;
  output?: string;
  error?: string;
  sessionId?: string;
  workspace?: string;
};

export type HarnessLogEntry = {
  timestamp: string;
  kind: "lifecycle" | "prompt" | "response" | "error";
  message: string;
};

export type HarnessFailureReason =
  | "quota_exhausted"
  | "transient_transport"
  | "permission_required"
  | "user_input_required"
  | "schema_validation"
  | "recovery_orphaned"
  | "cancelled"
  | "permanent";

export type HarnessExecutionPlan = {
  version: 1;
  createdAt: string;
  definitionVersion: number;
  order: string[];
  blocks: { blockId: string; incoming: string[]; outgoing: string[] }[];
};

export type HarnessOperationKind =
  | "block_attempt"
  | "dependency_decision"
  | "route_selection"
  | "prompt_delivery"
  | "session_binding"
  | "timer_create"
  | "timer_fire"
  | "child_registration"
  | "task_create"
  | "tool_command"
  | "merge"
  | "review"
  | "verification"
  | "terminal_outcome";

export type HarnessOperationStatus = "intent" | "succeeded" | "failed";

export type HarnessOperation = {
  id: string;
  idempotencyKey: string;
  kind: HarnessOperationKind;
  status: HarnessOperationStatus;
  blockId?: string;
  attemptId?: string;
  createdAt: string;
  updatedAt: string;
  input?: unknown;
  result?: unknown;
  error?: string;
};

export type HarnessBlockAttempt = {
  id: string;
  index: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  operationId: string;
  sessionId?: string;
  workspace?: string;
  error?: string;
};

export type HarnessPauseStatus = "awaiting_permission" | "awaiting_user_input" | "waiting_timer" | "retry_scheduled";

export type HarnessBlockStatus =
  "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "waiting" | "skipped" | HarnessPauseStatus;

export type HarnessRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "waiting" | HarnessPauseStatus;

/** Per-run Chatbox settings. An empty model selects the provider default. */
export type HarnessChatSettings = Pick<HarnessBlock, "provider" | "model" | "autopilot" | "options">;

export type HarnessChatMessage = { id: string; role: "user" | "assistant"; text: string; timestamp: string };

/** Live workflow tool invocations, including reads that do not enter the durable operation journal. */
export type HarnessActiveToolCall = { id: string; blockId: string; action?: string; lines?: number };

export type HarnessAgentActivity = { id: string; timestamp: string; text: string };

/** Shared meeting transcript and independent participant read positions, scoped to one run. */
export type HarnessMeetingMessage = {
  sequence: number;
  blockId: string;
  author: string;
  provider?: AiProvider;
  model?: string;
  text: string;
  timestamp: string;
};

export type HarnessMeetingState = {
  sequence: number;
  messages: HarnessMeetingMessage[];
  cursors: Record<string, number>;
};

export type HarnessBlockRun = {
  blockId: string;
  activeToolCalls?: HarnessActiveToolCall[];
  meeting?: HarnessMeetingState;
  context?: import("@hatopad/acp").AiContextSnapshot;
  contextUsed?: number;
  contextLimit?: number;
  chatSettings?: HarnessChatSettings;
  deliveredContextChars?: number;
  autopilot?: boolean;
  agentActivity?: HarnessAgentActivity[];
  chatMessages?: HarnessChatMessage[];
  status: HarnessBlockStatus;
  startedAt?: string;
  completedAt?: string;
  prompt?: string;
  output?: string;
  structuredInput?: unknown;
  structuredOutput?: unknown;
  tokens?: AiTokenUsage;
  error?: string;
  failureReason?: HarnessFailureReason;
  retryAt?: string;
  retryStartedAt?: string;
  provider?: AiProvider;
  sessionId?: string;
  workspace?: string;
  selectedRoute?: string;
  plannedRuns?: number;
  iterations?: HarnessBlockIteration[];
  attempts?: HarnessBlockAttempt[];
  log?: HarnessLogEntry[];
  waitingUntil?: string;
  recoveryAttempts?: number;
  pendingPermission?: AiPermissionRequest;
  question?: string;
  pauseId?: string;
};

export type HarnessChildTask = {
  taskId: string;
  blockId: string;
  provider: AiProvider;
  workspace: string;
  recoveryAttempts: number;
  recoveryError?: string;
  failureReason?: HarnessFailureReason;
  retryAt?: string;
  retryStartedAt?: string;
};

export type HarnessFeatureStatus = "planned" | "dispatched" | "completed" | "blocked";

export type HarnessFeature = {
  id: string;
  prompt: string;
  prerequisites: string[];
  status: HarnessFeatureStatus;
  taskId?: string;
  commit?: string;
  blockedReason?: string;
};

export type HarnessConnectionTrace = {
  id: string;
  edgeId: string;
  direction: "forward" | "return";
  status: "active" | "succeeded" | "failed";
  startedAt: string;
  completedAt?: string;
  chars?: number;
};

/** The request envelope supplies rootId; an empty target explicitly selects that root. */
export type HarnessTaskTarget = { taskId?: string };

/** Core resolves this once. Continuations and reruns retain it regardless of selection. */
export type HarnessWorkspaceBinding = { rootWorkspace: string; workspace: string; taskId?: string; taskName?: string };

export type HarnessProgressBlock = {
  blockId: string;
  status: HarnessBlockStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  pauseId?: string;
  question?: string;
  /** Set when `question` was clipped: do not offer an answer from it. */ questionTruncated?: true;
  pendingPermission?: AiPermissionRequest;
  sessionId?: string;
  provider?: AiProvider;
  log: HarnessLogEntry[];
  logTruncated: boolean;
};

/** Content-free execution metadata from the exact stored run; optional on older Cores. */
export type HarnessBlockExecution = {
  attempts: number;
  recoveryAttempts: number;
  definitionVersion: number;
  provider?: AiProvider;
  model?: string;
  reasoning?: string;
  waitingUntil?: string;
  retryAt?: string;
};

export type HarnessBlockDetail = {
  execution?: HarnessBlockExecution;
  blockId: string;
  status: HarnessBlockStatus;
  output: string;
  outputChars: number;
  outputTruncated: boolean;
  iterations: number;
  chatMessages: { id: string; role: "user" | "assistant"; text: string; timestamp: string; clipped?: true }[];
  chatNextBefore?: string;
};

/** Connection traces contain metadata only; progress returns at most 128 and flags omissions. */
export type HarnessProgress = {
  connectionTraces?: HarnessConnectionTrace[];
  connectionTracesTruncated?: true;
  taskIds?: string[];
  paused?: boolean;
  id: string;
  harnessId: string;
  status: HarnessRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  blocks: HarnessProgressBlock[];
};

export type HarnessRun = {
  paused?: boolean;
  summary?: true;
  binding?: HarnessWorkspaceBinding;
  workspace?: string;
  connectionTraces?: HarnessConnectionTrace[];
  id: string;
  harnessId: string;
  harnessVersion: number;
  definition?: HarnessDefinition;
  executionPlan?: HarnessExecutionPlan;
  operations?: HarnessOperation[];
  children?: HarnessChildTask[];
  features?: HarnessFeature[];
  corrections?: HarnessCorrectionCycle[];
  input: string;
  status: HarnessRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  blocks: HarnessBlockRun[];
  error?: string;
  cleanupErrors?: string[];
};
