import { describe, expect, it, vi } from "vitest";
import type { HarnessBlock, HarnessBlockRun, HarnessRun } from "@hatopad/protocol";
import { MeetingUpdates, useMeeting, publishMeetingStatusChanges } from "./workflow-meeting.js";

const agent = (id: string): HarnessBlock => ({ id, label: id, type: "ai", provider: "claude", model: "sonnet", prompt: "", position: { x: 0, y: 0 } });
const room = (): HarnessBlockRun => ({ blockId: "meeting", status: "queued" });

describe("Meeting transcript", () => {
  it("broadcasts updates only to matching subscribers and cleans up timeouts and cancellation", async () => {
    vi.useFakeTimers();
    try {
      const updates = new MeetingUpdates();
      const first = updates.wait("run", "room", 1000);
      const second = updates.wait("run", "room", 1000);
      const otherRoom = updates.wait("run", "other", 1000);
      const otherRun = updates.wait("other", "room", 1000);
      updates.publish("run", "room");
      await expect(first).resolves.toBe("updated");
      await expect(second).resolves.toBe("updated");
      expect(vi.getTimerCount()).toBe(2);
      updates.cancel("run");
      await expect(otherRoom).resolves.toBe("cancelled");
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(otherRun).resolves.toBe("timed_out");
      const shutdown = updates.wait("last", "room", 1000);
      updates.cancel();
      await expect(shutdown).resolves.toBe("cancelled");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("keeps independent cursors, supports replay and recent tails, and survives serialization", () => {
    const state = room();
    const publish = (text: string) => useMeeting(state, agent("a"), { action: "publish", message: text });
    publish("First"); publish("Second"); publish("Third");
    expect(useMeeting(state, agent("a"), { action: "diff", lines: 1 })).toMatchObject({ messages: [{ sequence: 1, author: "a", model: "sonnet", text: "First" }], cursor: 1, hasMore: true });
    expect(useMeeting(state, agent("b"), { action: "diff", lines: 2 })).toMatchObject({ messages: [{ sequence: 1 }, { sequence: 2 }], cursor: 2 });
    const restored = JSON.parse(JSON.stringify(state));
    expect(useMeeting(restored, agent("a"), {})).toMatchObject({ messages: [{ sequence: 2 }, { sequence: 3 }], cursor: 3, hasMore: false });
    expect(useMeeting(restored, agent("a"), {})).toMatchObject({ messages: [], hasMore: false });
    expect(useMeeting(restored, agent("a"), { action: "diff", after: 0, lines: 1 })).toMatchObject({ messages: [{ sequence: 1 }], hasMore: true });
    expect(restored.meeting.cursors.a).toBe(3);
    expect(useMeeting(state, agent("b"), { action: "tail", lines: 1 })).toMatchObject({ messages: [{ sequence: 3 }], cursor: 3 });
    expect(useMeeting(room(), agent("a"), {})).toMatchObject({ messages: [], latestSequence: 0 });
  });

  it("bounds pages without skipping unread messages and reports expired history", () => {
    const state = room();
    for (let i = 0; i < 1002; i++) useMeeting(state, agent("a"), { action: "publish", input: `Message ${i}` });
    expect(state.meeting?.messages).toHaveLength(1000);
    expect(useMeeting(state, agent("b"), { action: "diff", lines: 1 })).toMatchObject({ messages: [{ sequence: 3 }], historyTruncated: true, hasMore: true });
    const large = room();
    for (let i = 0; i < 3; i++) useMeeting(large, agent("a"), { action: "publish", message: "x".repeat(9000) });
    const first = useMeeting(large, agent("b"), {});
    expect(first).toMatchObject({ messages: [{ sequence: 1 }], cursor: 1, hasMore: true });
    expect(JSON.stringify(first).length).toBeLessThan(20000);
    expect(useMeeting(large, agent("b"), {})).toMatchObject({ messages: [{ sequence: 2 }] });
    expect(useMeeting(large, agent("c"), { action: "tail" })).toMatchObject({ messages: [{ sequence: 3 }], cursor: 3 });
  });

  it("validates actions and limits before changing the transcript", () => {
    const state = room();
    for (const args of [{ action: "erase" }, { action: "publish", message: " " }, { action: "publish", message: "x".repeat(10001) }, { action: "publish", message: "\u0000".repeat(10000) }, { lines: 0 }, { lines: 51 }, { after: -1 }, { after: 1 }, { action: "tail", after: 0 }]) expect(() => useMeeting(state, agent("a"), args)).toThrow();
    expect(state.meeting).toBeUndefined();
    useMeeting(state, agent("__proto__"), { action: "publish", message: "Hello" });
    expect(useMeeting(state, agent("__proto__"), {})).toMatchObject({ cursor: 1 });
    expect(Object.getPrototypeOf(state.meeting?.cursors)).toBe(Object.prototype);
  });
});

describe("Meeting participant status notices", () => {
  it("publishes concise transitions to connected rooms once and makes them readable through diff", async () => {
    const run: HarnessRun = {
      id: "run", harnessId: "flow", harnessVersion: 1, input: "work", status: "running", createdAt: "now",
      definition: { id: "flow", name: "Flow", version: 1, createdAt: "now", updatedAt: "now", blocks: [agent("a"), agent("b"), { ...agent("chat"), type: "chatbox" }, { ...agent("meeting"), type: "meeting" }, { ...agent("other"), type: "meeting" }], edges: [
        { id: "a-room", from: "a", to: "meeting", type: "use" },
        { id: "a-room-duplicate", from: "a", to: "meeting", type: "use" },
        { id: "b-room", from: "b", to: "meeting", type: "use" },
        { id: "chat-room", from: "chat", to: "meeting" },
      ] },
      blocks: ["a", "b", "chat", "meeting", "other"].map((blockId) => ({ blockId, status: "queued" })),
    };
    const previous = new Map<string, string>();
    expect(publishMeetingStatusChanges(run, previous)).toEqual([]);
    const participant = run.blocks[0]!;
    const meeting = run.blocks[3]!;
    const updates = new MeetingUpdates();
    for (const status of ["running", "waiting_timer", "running", "succeeded", "running", "failed", "cancelled"] as const) {
      participant.status = status;
      const waiting = updates.wait(run.id, "meeting", 1000);
      const changed = publishMeetingStatusChanges(run, previous);
      expect(changed).toEqual(["meeting"]);
      changed.forEach((id) => updates.publish(run.id, id));
      await expect(waiting).resolves.toBe("updated");
      expect(publishMeetingStatusChanges(run, previous)).toEqual([]);
    }
    expect(meeting.meeting?.messages.map((message) => message.text)).toEqual([
      "[Status] a started activity.", "[Status] a is waiting for a timer.", "[Status] a started activity.",
      "[Status] a is idle.", "[Status] a started activity.", "[Status] a stopped with an error.", "[Status] a was stopped.",
    ]);
    expect(useMeeting(meeting, agent("b"), { action: "diff" }).messages).toHaveLength(7);
    expect(useMeeting(meeting, agent("b"), { action: "diff" }).messages).toHaveLength(0);
    expect(run.blocks[4]!.meeting).toBeUndefined();
    run.blocks[2]!.status = "running";
    expect(publishMeetingStatusChanges(run, previous)).toEqual(["meeting"]);
    expect(meeting.meeting?.messages.at(-1)?.text).toBe("[Status] chat started activity.");
    expect(meeting.output).toContain("[Status] chat started activity.");
  });
});
