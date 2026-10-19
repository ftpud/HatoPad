import type { WorkspaceRootId } from "./workspace.js";
import type { AiProvider, AiStatus, AiFailure } from "@hatopad/acp";
import type { GitUpstreamStatus } from "./git.js";

/** Stable address of one pending provider request; enough to resolve it without selecting the task. */
export type AttentionTarget = { rootId: WorkspaceRootId; /** Absent for the root workspace itself. */ taskId?: string; provider: AiProvider; sessionId?: string; requestId: string };

/** Workflow items also carry the block address; resolve them with `harnesses.permission.resolve` / `harnesses.answer`, never `ai.*`. For a workflow question, `target.requestId` is the pause id. */
export type AttentionWorkflow = { runId: string; blockId: string; pauseId: string };

export type AttentionItem = { kind: "permission" | "question" | "workflow-permission" | "workflow-question"; target: AttentionTarget; workflow?: AttentionWorkflow; title: string; preview: string; status: AiStatus };

/** Inventory counts for one root; counts only, never names or content. Present when the Core advertises `overview.counts`. */
export type OverviewRootCounts = { tasks: number; finishedTasks: number; schedules: number; triggers: number; workflowsActive: number };

export type OverviewRoot = { id: WorkspaceRootId; alias: string; running: number; attention: number; counts?: OverviewRootCounts };

/** How long one `client.presence` report keeps a client counted as present. Clients report well within this. */
export const presenceLeaseMs = 60_000;

/** Limits applied by `overview.summary`. */
/** Most recent conversation per root/task/provider, newest first. Ephemeral; clipped like attention items. */
export type ActivityItem = { target: Omit<AttentionTarget, "requestId">; updatedAt: string; status: AiStatus; preview: string };

export const overviewLimits = { defaultItems: 50, maxItems: 100, maxTasksPerRoot: 200, maxTextLength: 180, maxWorkflowRunsPerRoot: 20, maxRoots: 50, maxActivity: 20 } as const;

export type InventoryKind = 'tasks' | 'workflows' | 'runs' | 'timers' | 'schedules' | 'triggers' | 'terminals' | 'runConfigs' | 'useful' | 'agents' | 'skills';

export type InventoryRow = { harnessId?: string; createdAt?: string; startedAt?: string; completedAt?: string; id: string; name: string; state?: string; detail?: string; taskId?: string; runId?: string; terminalId?: string };

export type OverviewWorkIssue = { kind: "task-error" | "quota" | "provider-setup" | "merge-conflict" | "workflow-failed" | "trigger-capped" | "trigger-error" | "trigger-busy" | "schedule-failed" | "timer-overdue"; id: string; title: string; at?: string; provider?: string; runId?: string; triggerId?: string; scheduleId?: string; timerId?: string };

export type OverviewWorkRow = { rootId: WorkspaceRootId; rootAlias: string; taskId?: string; name: string; branch?: string; status: "root" | "active" | "finished"; archived: boolean; sessions: { provider: AiProvider; sessionId?: string; status: AiStatus; preview: string; updatedAt?: string; pendingQuestion: boolean; pendingPermission: boolean; failure?: AiFailure }[]; git?: { additions: number; deletions: number; unknownCounts: number; totalFiles: number; conflicts: number; branch: string; upstream?: GitUpstreamStatus }; gitUnavailable?: boolean; terminals: number; workflowsActive: number; workflowRunIds: string[]; schedules: number; triggers: number; timers: { id: string; provider: AiProvider; dueAt: string; workflowRunId?: string; workflowBlockId?: string }[]; timerCount: number; issues: OverviewWorkIssue[] };

export type OverviewWorkPage = { revision: string; observedAt: string; rows: OverviewWorkRow[]; totalTargets: number; truncated: boolean; nextCursor?: string; restarted?: boolean };
