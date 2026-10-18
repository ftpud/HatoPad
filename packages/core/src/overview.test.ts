import { describe, expect, it } from "vitest";
import type { AiSession } from "@hatopad/protocol";
import { buildOverview, pageOverview, type OverviewSource } from "./overview.js";

const session = (extra: Partial<AiSession>): AiSession => ({ model: "m", reasoning: "r", status: "user_prompt", messages: [], ...extra });
const permission = (id: string, title = "Run tests") => ({ id, title, toolCallId: "t", options: [] });

function sources(count: number): OverviewSource[] {
  return Array.from({ length: count }, (_, index) => ({
    rootId: "root-a", alias: "A", taskId: `task-${String(index).padStart(3, "0")}`,
    sessions: [{ provider: "claude", session: session({ id: `s${index}`, pendingPermission: permission(`p${index}`) }) }]
  }));
}

describe("overview summary", () => {
  it("lists stable targets for permissions and questions and counts per root", () => {
    const snapshot = buildOverview([
      { rootId: "r1", alias: "One", sessions: [{ provider: "claude", session: session({ id: "s0", pendingQuestion: { id: "q1", message: "Pick\n  one", fields: [] } }) }] },
      { rootId: "r1", alias: "One", taskId: "t1", sessions: [{ provider: "codex", session: session({ id: "s1", status: "in_progress", pendingPermission: permission("p1", "x".repeat(500)) }) }] },
      { rootId: "r2", alias: "Two", sessions: [{ provider: "claude", session: session({ status: "idle" }) }] }
    ], false);
    expect(snapshot.roots).toEqual([{ id: "r1", alias: "One", running: 1, attention: 2 }, { id: "r2", alias: "Two", running: 0, attention: 0 }]);
    expect(snapshot.items.map((item) => item.target)).toEqual([
      { rootId: "r1", provider: "claude", sessionId: "s0", requestId: "q1" },
      { rootId: "r1", taskId: "t1", provider: "codex", sessionId: "s1", requestId: "p1" }
    ]);
    expect(snapshot.items[0]!.title).toBe("Pick one");
    expect(snapshot.items[1]!.title).toHaveLength(180);
  });

  it("pages deterministically and restarts when the revision changes", () => {
    const snapshot = buildOverview(sources(5), false);
    const first = pageOverview(snapshot, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = pageOverview(snapshot, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.target.requestId)).toEqual(["p2", "p3"]);
    const last = pageOverview(snapshot, { limit: 2, cursor: second.nextCursor });
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeUndefined();

    const changed = pageOverview(buildOverview(sources(6), false), { limit: 2, cursor: second.nextCursor });
    expect(changed.restarted).toBe(true);
    expect(changed.items.map((item) => item.target.requestId)).toEqual(["p0", "p1"]);
  });

  it("rejects bad limits and cursors", () => {
    const snapshot = buildOverview(sources(1), false);
    for (const limit of [0, 101, 1.5, "5"]) expect(() => pageOverview(snapshot, { limit })).toThrow();
    for (const cursor of ["x", 7, "0".repeat(65), "abcdefabcdefabcd.-1"]) expect(() => pageOverview(snapshot, { cursor })).toThrow();
  });
});

describe("workflow attention", () => {
  const run = (blocks: Record<string, unknown>[], binding?: Record<string, unknown>) => ({ id: "run1", harnessId: "h", harnessVersion: 1, input: "", status: "awaiting_permission", createdAt: "2026-01-01T00:00:00Z", blocks, binding } as never);

  it("surfaces paused workflow blocks with their run/block/pause address", () => {
    const snapshot = buildOverview([], false, [{ rootId: "r1", alias: "One", run: run([
      { blockId: "b1", status: "awaiting_permission", pauseId: "pause1", provider: "claude", sessionId: "s1", pendingPermission: permission("perm1", "Edit file") },
      { blockId: "b2", status: "awaiting_user_input", pauseId: "pause2", question: "Which branch?" },
      { blockId: "b3", status: "running" },
      { blockId: "b4", status: "awaiting_user_input", question: "no pause id is not actionable" }
    ], { taskId: "t9" }) }]);
    expect(snapshot.roots).toEqual([{ id: "r1", alias: "One", running: 0, attention: 2 }]);
    expect(snapshot.items).toEqual([
      { kind: "workflow-permission", target: { rootId: "r1", taskId: "t9", provider: "claude", sessionId: "s1", requestId: "perm1" }, workflow: { runId: "run1", blockId: "b1", pauseId: "pause1" }, title: "Edit file", preview: "", status: "user_prompt" },
      { kind: "workflow-question", target: { rootId: "r1", taskId: "t9", provider: "", requestId: "pause2" }, workflow: { runId: "run1", blockId: "b2", pauseId: "pause2" }, title: "Which branch?", preview: "", status: "user_prompt" }
    ]);
  });
});

describe("recent activity", () => {
  const message = (timestamp: string, text: string, role: "assistant" | "user" = "assistant") => ({ id: timestamp, role, text, timestamp });

  it("lists the newest conversations first, clipped and capped, without affecting paging", () => {
    const stamp = (index: number) => `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`;
    const conversation = (index: number) => [message(stamp(index), `reply ${index} ${"x".repeat(400)}`), ...(index === 29 ? [message("2026-01-01T00:00:59Z", "ignored user", "user")] : [])];
    const sources: OverviewSource[] = Array.from({ length: 30 }, (_, index) => ({ rootId: "r1", alias: "One", taskId: `t${index}`, sessions: [{ provider: "claude", session: session({ id: `s${index}`, status: "idle", messages: conversation(index) }) }] }));
    sources.push({ rootId: "r1", alias: "One", taskId: "empty", sessions: [{ provider: "claude", session: session({ id: "empty", status: "idle" }) }] });
    const snapshot = buildOverview(sources, false);
    expect(snapshot.activity).toHaveLength(20);
    expect(snapshot.activity[0]!.target.taskId).toBe("t29");
    expect(snapshot.activity[0]!.preview.startsWith("reply 29")).toBe(true);
    expect(snapshot.activity[0]!.preview).toHaveLength(180);
    expect(snapshot.activity.every((item, index, all) => index === 0 || all[index - 1]!.updatedAt >= item.updatedAt)).toBe(true);
    expect(snapshot.activity.some((item) => item.target.taskId === "empty")).toBe(false);

    const withPending = buildOverview([...sources, { rootId: "r2", alias: "Two", sessions: [{ provider: "claude", session: session({ id: "p", pendingPermission: permission("p1"), pendingQuestion: { id: "q1", message: "?", fields: [] } }) }] }], false);
    const first = pageOverview(withPending, { limit: 1 });
    expect(first.nextCursor).toBeDefined();
    const newer = { ...withPending, activity: [{ ...withPending.activity[0]!, updatedAt: "2099-01-01T00:00:00Z" }, ...withPending.activity.slice(1)] };
    expect(pageOverview(newer, { limit: 1 }).revision).not.toBe(first.revision);
    expect(pageOverview(newer, { limit: 1, cursor: first.nextCursor }).restarted).toBeUndefined();
  });
});
