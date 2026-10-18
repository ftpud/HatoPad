import { createHash } from "node:crypto";
import { overviewLimits, type ActivityItem, type HarnessRun, type AiProvider, type AiSession, type AttentionItem, type OverviewRoot, type OverviewRootCounts } from "@hatopad/protocol";
import { CoreError } from "./errors.js";

export interface OverviewSource {
  rootId: string;
  alias: string;
  /** Undefined for the root workspace. */
  taskId?: string;
  sessions: { provider: AiProvider; session: AiSession }[];
}

export interface WorkflowSource {
  rootId: string;
  alias: string;
  run: HarnessRun;
}

export interface OverviewSnapshot {
  roots: OverviewRoot[];
  items: AttentionItem[];
  activity: ActivityItem[];
  truncated: boolean;
}

const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, overviewLimits.maxTextLength);

/** Pure aggregation over already-read sessions. Output order is deterministic so cursors stay valid until `revision` changes. */
export function buildOverview(sources: OverviewSource[], truncated: boolean, workflows: WorkflowSource[] = [], counts: ReadonlyMap<string, OverviewRootCounts> = new Map()): OverviewSnapshot {
  const roots = new Map<string, OverviewRoot>();
  const items: AttentionItem[] = [];
  const activity: ActivityItem[] = [];
  for (const source of sources) {
    const root = roots.get(source.rootId) ?? { id: source.rootId, alias: source.alias, running: 0, attention: 0 };
    roots.set(source.rootId, root);
    if (source.sessions.some(({ session }) => session.status === "in_progress")) root.running += 1;
    for (const { provider, session } of source.sessions) {
      const last = session.messages.at(-1);
      const updatedAt = last?.timestamp ?? session.updatedAt;
      if (last && updatedAt) {
        const text = [...session.messages].reverse().find((message) => message.role === "assistant" || message.role === "activity") ?? last;
        activity.push({ target: { rootId: source.rootId, ...(source.taskId ? { taskId: source.taskId } : {}), provider, ...(session.id ? { sessionId: session.id } : {}) }, updatedAt, status: session.status, preview: clip(text.text) });
      }
      const base = { rootId: source.rootId, ...(source.taskId ? { taskId: source.taskId } : {}), provider, ...(session.id ? { sessionId: session.id } : {}) };
      if (session.pendingPermission) {
        items.push({ kind: "permission", target: { ...base, requestId: session.pendingPermission.id }, title: clip(session.pendingPermission.title), preview: clip(session.pendingPermission.details ?? ""), status: session.status });
        root.attention += 1;
      }
      if (session.pendingQuestion) {
        items.push({ kind: "question", target: { ...base, requestId: session.pendingQuestion.id }, title: clip(session.pendingQuestion.message), preview: "", status: session.status });
        root.attention += 1;
      }
    }
  }
  for (const { rootId, alias, run } of workflows) {
    const root = roots.get(rootId) ?? { id: rootId, alias, running: 0, attention: 0 };
    roots.set(rootId, root);
    const taskId = run.binding?.taskId;
    for (const block of run.blocks) {
      if (!block.pauseId) continue;
      const base = { rootId, ...(taskId ? { taskId } : {}), provider: block.provider ?? "", ...(block.sessionId ? { sessionId: block.sessionId } : {}) };
      const workflow = { runId: run.id, blockId: block.blockId, pauseId: block.pauseId };
      if (block.status === "awaiting_permission" && block.pendingPermission) {
        items.push({ kind: "workflow-permission", target: { ...base, requestId: block.pendingPermission.id }, workflow, title: clip(block.pendingPermission.title), preview: clip(block.pendingPermission.details ?? ""), status: "user_prompt" });
        root.attention += 1;
      } else if (block.status === "awaiting_user_input") {
        items.push({ kind: "workflow-question", target: { ...base, requestId: block.pauseId }, workflow, title: clip(block.question ?? "Workflow needs input"), preview: "", status: "user_prompt" });
        root.attention += 1;
      }
    }
  }
  const order = (item: AttentionItem) => [item.target.rootId, item.target.taskId ?? "", item.target.provider, item.target.requestId, item.kind, item.workflow?.runId ?? "", item.workflow?.blockId ?? ""].join("\u0000");
  items.sort((left, right) => order(left).localeCompare(order(right)));
  activity.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || `${left.target.rootId}\0${left.target.taskId ?? ""}\0${left.target.provider}`.localeCompare(`${right.target.rootId}\0${right.target.taskId ?? ""}\0${right.target.provider}`));
  for (const root of roots.values()) { const rootCounts = counts.get(root.id); if (rootCounts) root.counts = rootCounts; }
  return { roots: [...roots.values()], items, activity: activity.slice(0, overviewLimits.maxActivity), truncated };
}

export function overviewRevision(snapshot: OverviewSnapshot, withActivity = true): string {
  const digest = createHash("sha256");
  // Inventory counts change with ordinary activity; they must not restart attention paging.
  const roots = withActivity ? snapshot.roots : snapshot.roots.map(({ counts: _counts, ...root }) => root);
  digest.update(JSON.stringify([snapshot.truncated, roots, withActivity ? snapshot.activity : null, snapshot.items.map((item) => [item.kind, item.target, item.workflow, item.status])]));
  return digest.digest("hex").slice(0, 16);
}

export function pageOverview(snapshot: OverviewSnapshot, request: { limit?: unknown; cursor?: unknown }): { revision: string; roots: OverviewRoot[]; items: AttentionItem[]; activity: ActivityItem[]; nextCursor?: string; restarted?: boolean; truncated: boolean } {
  const limit = request.limit ?? overviewLimits.defaultItems;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > overviewLimits.maxItems) throw new CoreError("INVALID_REQUEST", `limit must be an integer from 1 to ${overviewLimits.maxItems}`);
  if (request.cursor !== undefined && (typeof request.cursor !== "string" || request.cursor.length > 64)) throw new CoreError("INVALID_REQUEST", "cursor must be a short string");
  const revision = overviewRevision(snapshot);
  // Pages are tied to the attention items, not to chat activity, so a busy conversation does not restart paging.
  const pageRevision = overviewRevision(snapshot, false);
  let offset = 0;
  let restarted: boolean | undefined;
  if (request.cursor !== undefined) {
    const match = /^([0-9a-f]{16})\.(\d{1,6})$/.exec(request.cursor);
    if (!match) throw new CoreError("INVALID_REQUEST", "cursor is not valid");
    if (match[1] === pageRevision) offset = Number(match[2]);
    else restarted = true;
  }
  const items = snapshot.items.slice(offset, offset + limit);
  const next = offset + items.length;
  return { revision, roots: snapshot.roots, items, activity: snapshot.activity, ...(next < snapshot.items.length ? { nextCursor: `${pageRevision}.${next}` } : {}), ...(restarted ? { restarted } : {}), truncated: snapshot.truncated };
}
