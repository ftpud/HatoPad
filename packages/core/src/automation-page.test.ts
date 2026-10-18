import { describe, expect, it } from "vitest";
import type { WorkspaceSchedule, WorkspaceTrigger } from "@hatopad/protocol";
import { automationPage, summarizeSchedule, summarizeTrigger } from "./automation-page.js";

const schedule = (index: number, extra: Partial<WorkspaceSchedule> = {}): WorkspaceSchedule => ({ id: `s${String(index).padStart(3, "0")}`, revision: `r${index}`, rootId: "root", name: `Schedule ${String(index).padStart(3, "0")}`, dueAt: "2026-10-19T00:00:00.000Z", createdAt: "t", enabled: true, action: { type: "prompt", provider: "codex", prompt: `PROMPT-${index}`.padEnd(60_000, "x") }, ...extra });

describe("automation pages", () => {
  it("summaries never carry prompt or workflow input text", () => {
    const summary = summarizeSchedule(schedule(1, { lastError: "e".repeat(900), action: { type: "prompt", provider: "codex", prompt: "SECRET", newSession: true, model: "m" } }));
    expect(JSON.stringify(summary)).not.toContain("SECRET");
    expect(summary.lastError).toHaveLength(400);
    expect(summary.action).toEqual({ type: "prompt", provider: "codex", newSession: true, model: "m" });
    const trigger = summarizeTrigger({ id: "t1", revision: "r", rootId: "root", name: "T", createdAt: "t", enabled: true, fireCount: 2, source: { type: "file", path: "docs", events: ["changed"] }, action: { type: "workflow", provider: "codex", harnessId: "h", input: "SECRET INPUT" } } as WorkspaceTrigger);
    expect(JSON.stringify(trigger)).not.toContain("SECRET");
    expect(trigger.action).toEqual({ type: "workflow", provider: "codex", harnessId: "h" });
  });

  it("pages by name with stable cursors, restarts when an item's revision changes and bounds the page size", () => {
    const items = Array.from({ length: 60 }, (_, index) => schedule(index));
    const first = automationPage("schedules", "root", items, summarizeSchedule, { limit: 25 });
    expect(first.items).toHaveLength(25); expect(first.total).toBe(60); expect(first.nextCursor).toBeTruthy();
    const second = automationPage("schedules", "root", items, summarizeSchedule, { limit: 25, cursor: first.nextCursor });
    expect((second.items as Array<{ id: string }>)[0]!.id).toBe("s025");
    const edited = items.map(item => item.id === "s030" ? { ...item, revision: "changed" } : item);
    expect(automationPage("schedules", "root", edited, summarizeSchedule, { limit: 25, cursor: first.nextCursor }).restarted).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(40_000);
    expect(() => automationPage("schedules", "root", items, summarizeSchedule, { limit: 26 })).toThrow(/limit/);
    expect(() => automationPage("schedules", "root", items, summarizeSchedule, { query: 5 })).toThrow(/query/);
  });

  it("filters by name and scopes cursors to the query and root", () => {
    const items = Array.from({ length: 30 }, (_, index) => schedule(index));
    const filtered = automationPage("schedules", "root", items, summarizeSchedule, { query: "schedule 02", limit: 5 });
    expect(filtered.total).toBe(10);
    const cursor = filtered.nextCursor!;
    expect(automationPage("schedules", "other", items, summarizeSchedule, { query: "schedule 02", limit: 5, cursor }).restarted).toBe(true);
    expect(automationPage("schedules", "root", items, summarizeSchedule, { query: "schedule 01", limit: 5, cursor }).restarted).toBe(true);
  });
});
