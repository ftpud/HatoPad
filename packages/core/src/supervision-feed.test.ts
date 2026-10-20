import { expect, it } from "vitest";
import { SupervisionFeed } from "./supervision-feed.js";
it("keeps bounded metadata, deduplicates lifecycle notifications and restarts foreign cursors", () => {
  const feed = new SupervisionFeed();
  feed.push("task-finished", "root", { taskId: "task" }, "finish");
  feed.push("task-finished", "root", {}, "finish");
  feed.push("timer-fired", "other");
  const first = feed.page({ limit: 1 });
  expect(first.events).toHaveLength(1);
  expect(first.events[0]!.rootId).toBe("other");
  expect(feed.page({ cursor: first.nextCursor }).events).toHaveLength(1);
  expect(feed.page({ rootId: "root" }).events[0]!.taskId).toBe("task");
  expect(new SupervisionFeed().page({ cursor: first.nextCursor }).restarted).toBe(true);
  for (let i = 0; i < 201; i++) feed.push("trigger-fired", "root");
  expect(feed.page({ limit: 50 }).truncated).toBe(true);
  expect(() => feed.page({ limit: 51 })).toThrow();
  expect(() => feed.page({ cursor: "bad" })).toThrow();
});
