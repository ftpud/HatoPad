import type { AiProvider } from "@hatopad/acp";
import type { AgentFileReference } from "./configuration.js";
import type { WorkspaceRootId } from "./workspace.js";
import type { TriggerFileEvent } from "./events.js";

export type ScheduledAction =
  | {
      type: "prompt";
      provider: AiProvider;
      prompt: string;
      agent?: AgentFileReference;
      /** Start a context-empty session instead of continuing the current one; agent, model and reasoning only apply then. */ newSession?: boolean;
      /** Overrides the session's model for this prompt. */ model?: string;
      /** Overrides the session's reasoning effort for this prompt. */ reasoning?: string;
    }
  | { type: "workflow"; provider: AiProvider; harnessId: string; input: string; startBlockId?: string };

export type ScheduleInput = {
  name: string;
  dueAt: string;
  intervalSeconds?: number;
  taskId?: string;
  action: ScheduledAction;
};

/** Content-free action summary: no prompt or workflow input text. */
export type ScheduledActionSummary =
  | {
      type: "prompt";
      provider: AiProvider;
      newSession?: boolean;
      agent?: AgentFileReference;
      model?: string;
      reasoning?: string;
    }
  | { type: "workflow"; provider: AiProvider; harnessId: string; startBlockId?: string };

export type ScheduleSummary = {
  launching?: boolean;
  id: string;
  revision: string;
  rootId: WorkspaceRootId;
  name: string;
  enabled: boolean;
  dueAt: string;
  intervalSeconds?: number;
  taskId?: string;
  lastRunAt?: string;
  lastError?: string;
  lastWorkflowRunId?: string;
  action: ScheduledActionSummary;
};

export type TriggerSummary = {
  id: string;
  revision: string;
  rootId: WorkspaceRootId;
  name: string;
  enabled: boolean;
  source: TriggerSource;
  taskId?: string;
  debounceSeconds?: number;
  maxFiresPerHour?: number;
  fireCount: number;
  recentFires?: number;
  capResetsAt?: string;
  firing?: boolean;
  lastFiredAt?: string;
  lastSkipped?: string;
  lastError?: string;
  action: ScheduledActionSummary;
};

/** Page limits for schedule/trigger summaries; definitions are read one at a time. */
export const automationPageLimits = { defaultItems: 25, maxItems: 25 } as const;

export type WorkspaceSchedule = ScheduleInput & {
  launching?: boolean;
  revision?: string;
  id: string;
  rootId: WorkspaceRootId;
  createdAt: string;
  enabled: boolean;
  lastRunAt?: string;
  lastError?: string;
  lastWorkflowRunId?: string;
};

/** What a trigger watches: a file/directory (polled for changes) or a named pipe (FIFO) whose incoming data fires it. */
export type TriggerSource = { type: "file"; path: string; events: TriggerFileEvent[] } | { type: "fifo"; path: string };

export type TriggerInput = {
  name: string;
  source: TriggerSource;
  taskId?: string;
  action: ScheduledAction;
  debounceSeconds?: number;
  maxFiresPerHour?: number;
};

export type TriggerFireRecord = {
  id: string;
  at: string;
  event: string;
  status: "started" | "skipped-busy" | "capped" | "failed";
  reason?: string;
};

export type WorkspaceTrigger = TriggerInput & {
  recentFires?: number;
  capResetsAt?: string;
  firing?: boolean;
  revision?: string;
  id: string;
  rootId: WorkspaceRootId;
  createdAt: string;
  enabled: boolean;
  fireCount: number;
  lastFiredAt?: string;
  lastEvent?: string;
  lastSkipped?: string;
  lastError?: string;
  lastWorkflowRunId?: string;
};

export type AiContinuationTimer = {
  taskId?: string;
  id: string;
  workspace: string;
  provider: AiProvider;
  prompt: string;
  dueAt: string;
  createdAt: string;
  workflowRunId?: string;
  workflowBlockId?: string;
  workflowFlow?: boolean;
  /** Failed delivery attempts so far; a definitely-unsent prompt is retried with backoff, moving `dueAt`. */
  deliveryAttempts?: number;
  deliveryError?: string;
  /** Delivery stopped (retries exhausted or outcome uncertain); the timer is not armed until run manually. */
  deliveryFailed?: boolean;
};
