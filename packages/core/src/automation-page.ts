import type { ScheduledAction, ScheduledActionSummary, ScheduleSummary, TriggerSummary, WorkspaceSchedule, WorkspaceTrigger } from "@hatopad/protocol";
import { automationPageLimits } from "@hatopad/protocol";
import { CoreError } from "./errors.js";
import { inventoryPage } from "./inventory-page.js";

const clip = (value: string | undefined, length: number) => value === undefined ? undefined : value.slice(0, length);

export function summarizeAction(action: ScheduledAction): ScheduledActionSummary {
  if (action.type === "workflow") return { type: "workflow", provider: action.provider, harnessId: action.harnessId.slice(0, 128), ...(action.startBlockId ? { startBlockId: action.startBlockId.slice(0, 128) } : {}) };
  return { type: "prompt", provider: action.provider, ...(action.newSession ? { newSession: true as const } : {}), ...(action.agent ? { agent: { scope: action.agent.scope, name: action.agent.name.slice(0, 180) } } : {}), ...(action.model ? { model: action.model.slice(0, 200) } : {}), ...(action.reasoning ? { reasoning: action.reasoning.slice(0, 100) } : {}) };
}

export function summarizeSchedule(item: WorkspaceSchedule): ScheduleSummary {
  return {
    id: item.id, revision: item.revision ?? "", rootId: item.rootId, name: item.name.slice(0, 180), enabled: item.enabled, dueAt: item.dueAt, ...(item.launching ? { launching: true } : {}),
    ...(item.intervalSeconds ? { intervalSeconds: item.intervalSeconds } : {}), ...(item.taskId ? { taskId: item.taskId } : {}),
    ...(item.lastRunAt ? { lastRunAt: item.lastRunAt } : {}), ...(item.lastError ? { lastError: clip(item.lastError, 400)! } : {}), ...(item.lastWorkflowRunId ? { lastWorkflowRunId: item.lastWorkflowRunId } : {}),
    action: summarizeAction(item.action)
  };
}

export function summarizeTrigger(item: WorkspaceTrigger): TriggerSummary {
  return {
    id: item.id, revision: item.revision ?? "", rootId: item.rootId, name: item.name.slice(0, 180), enabled: item.enabled,
    source: item.source.type === "file" ? { type: "file", path: item.source.path.slice(0, 1024), events: item.source.events } : { type: "fifo", path: item.source.path.slice(0, 1024) },
    ...(item.taskId ? { taskId: item.taskId } : {}), ...(item.debounceSeconds !== undefined ? { debounceSeconds: item.debounceSeconds } : {}), ...(item.maxFiresPerHour !== undefined ? { maxFiresPerHour: item.maxFiresPerHour } : {}),
    fireCount: item.fireCount, ...(item.recentFires !== undefined ? { recentFires: item.recentFires } : {}), ...(item.capResetsAt ? { capResetsAt: item.capResetsAt } : {}), ...(item.firing ? { firing: true } : {}),
    ...(item.lastFiredAt ? { lastFiredAt: item.lastFiredAt } : {}), ...(item.lastSkipped ? { lastSkipped: clip(item.lastSkipped, 400)! } : {}), ...(item.lastError ? { lastError: clip(item.lastError, 400)! } : {}),
    action: summarizeAction(item.action)
  };
}

/** Stable, revisioned page of definition summaries (no prompts). `kind` namespaces cursors; the root is part of the cursor scope. */
export function automationPage<T extends { id: string; name: string }>(kind: "schedules" | "triggers", rootId: string, items: T[], summarize: (item: T) => unknown, request: { limit?: unknown; cursor?: unknown; query?: unknown }) {
  const limit = request.limit ?? automationPageLimits.defaultItems;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > automationPageLimits.maxItems) throw new CoreError("INVALID_REQUEST", `limit must be an integer from 1 to ${automationPageLimits.maxItems}`);
  if (request.query !== undefined && (typeof request.query !== "string" || request.query.length > 100)) throw new CoreError("INVALID_REQUEST", "query must be a short string");
  const needle = (request.query ?? "").toLowerCase();
  const matching = items.filter(item => !needle || item.name.toLowerCase().includes(needle));
  const byId = new Map(matching.map(item => [item.id, item]));
  // The revision covers each item's own revision so concurrent edits restart paging instead of skipping rows.
  const rows = matching.map(item => ({ id: item.id, name: item.name, detail: String((item as { revision?: string }).revision ?? "") }));
  const page = inventoryPage(`${rootId}:${kind}:${needle}`, kind, rows, { limit, cursor: request.cursor, order: "name" });
  return { items: page.rows.map(row => summarize(byId.get(row.id)!)), total: page.total, revision: page.revision, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), ...(page.restarted ? { restarted: true as const } : {}) };
}
