import { afterEach, expect, it, vi } from "vitest";
import { MetadataHintBatcher } from "./metadata-hints.js";
afterEach(() => vi.useRealTimers());
it("coalesces journal update bursts while retaining distinct roots and runs", () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const batcher = new MetadataHintBatcher(sent);
  for (let i = 0; i < 1000; i++) {
    batcher.enqueue({ type: "harness.changed", payload: { rootId: "a", runId: "one" } });
    batcher.enqueue({ type: "tasks.changed", payload: { rootId: "a" } });
  }
  batcher.enqueue({ type: "harness.changed", payload: { rootId: "a", runId: "two" } });
  batcher.enqueue({ type: "harness.changed", payload: { rootId: "b", runId: "one" } });
  expect(sent).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(sent).toHaveBeenCalledTimes(4);
  expect(sent).toHaveBeenCalledWith({ type: "harness.changed", payload: { rootId: "b", runId: "one" } });
  vi.advanceTimersByTime(100);
  expect(sent).toHaveBeenCalledTimes(4);
  batcher.dispose();
});
it("has a finite pending inventory and drops scheduled hints after disposal", () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const batcher = new MetadataHintBatcher(sent);
  for (let i = 0; i < 300; i++)
    batcher.enqueue({ type: "harness.changed", payload: { rootId: "root", runId: `run-${i}` } });
  expect(sent).toHaveBeenCalledTimes(256);
  batcher.dispose();
  vi.runAllTimers();
  expect(sent).toHaveBeenCalledTimes(256);
  batcher.enqueue({ type: "tasks.changed", payload: { rootId: "root" } });
  vi.runAllTimers();
  expect(sent).toHaveBeenCalledTimes(256);
});
