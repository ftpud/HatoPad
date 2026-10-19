import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import type { AiSession, HarnessBlock, HarnessDefinition } from "@hatopad/protocol";
import { HarnessRunner } from "./harness-runner.js";
import { HarnessStore } from "./harnesses.js";
const fixtures: { directory: string; runner: HarnessRunner }[] = [];
afterEach(async () => {
  for (const { directory, runner } of fixtures.splice(0)) {
    await runner.suspend();
    await rm(directory, { recursive: true, force: true });
  }
});
const session = (text: string): AiSession => ({
  id: `session-${text}`,
  model: "test",
  reasoning: "",
  status: "done",
  messages: [{ id: "answer", role: "assistant", text, timestamp: new Date().toISOString() }],
});
const block = (id: string, type: HarnessBlock["type"] = "prompt"): HarnessBlock => ({
  id,
  type,
  label: id,
  prompt: "{{input}}",
  position: { x: 0, y: 0 },
});
async function fixture(blocks: HarnessBlock[], edges: HarnessDefinition["edges"]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workflow-controls-"));
  const store = new HarnessStore("/workspace", directory);
  const created = await store.create("Control test");
  const definition = await store.update({ ...created, blocks, edges });
  const runner = new HarnessRunner(store, () => undefined);
  fixtures.push({ directory, runner });
  return { store, definition, runner };
}
it("pauses new stages while allowing in-flight work to finish, then resumes without replay", async () => {
  const { store, definition, runner } = await fixture(
    [block("first"), block("second")],
    [{ id: "next", from: "first", to: "second" }],
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatch = vi.fn(async (item: HarnessBlock) => {
    if (item.id === "first") await gate;
    return session(item.id);
  });
  const run = await runner.start(definition.id, "request", dispatch);
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1), { timeout: 5000 });
  expect((await runner.setPaused(run.id, true)).paused).toBe(true);
  release();
  await vi.waitFor(async () => expect((await store.runs())[0]?.blocks[0]?.status).toBe("succeeded"), { timeout: 5000 });
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect((await store.runs())[0]?.paused).toBe(true);
  await runner.setPaused(run.id, false);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("succeeded"), { timeout: 5000 });
  expect(dispatch.mock.calls.map((call) => call[0].id)).toEqual(["first", "second"]);
  await expect(runner.setPaused(run.id, true)).rejects.toThrow("active");
});
it("retries only failed stages in the same run and continues their prior session", async () => {
  const { store, definition, runner } = await fixture(
    [block("first"), block("failed"), block("last")],
    [
      { id: "a", from: "first", to: "failed" },
      { id: "b", from: "failed", to: "last" },
    ],
  );
  const dispatch = vi.fn(
    async (item: HarnessBlock, _input: string, runtime: Parameters<Parameters<HarnessRunner["start"]>[2]>[2]) => {
      await runtime.started(`/session/${item.id}`);
      if (item.id === "failed") throw new Error("Synthetic provider failure");
      return session(item.id);
    },
  );
  const append = vi.fn(async (_block: HarnessBlock, _input: string) => session("continued"));
  const run = await runner.start(definition.id, "request", dispatch, "test", append);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("failed"), { timeout: 5000 });
  await vi.waitFor(() => expect(runner.isActive(run.id)).toBe(false), { timeout: 5000 });
  const prior = (await store.runs())[0]!;
  const firstOutput = prior.blocks[0]!.output;
  const resumed = await runner.retryFailedRun(run.id, dispatch, "test", append);
  expect(resumed.id).toBe(run.id);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("succeeded"), { timeout: 5000 });
  const final = (await store.runs())[0]!;
  expect(final.blocks[0]!.output).toBe(firstOutput);
  expect(dispatch.mock.calls.map((call) => call[0].id)).toEqual(["first", "failed", "last"]);
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0]?.[0].id).toBe("failed");
  expect(append.mock.calls[0]?.[1]).toContain("first");
  expect(final.operations!.length).toBeGreaterThan(prior.operations!.length);
  await expect(runner.retryFailedRun(run.id, dispatch, "test", append)).rejects.toThrow("failed workflow");
});
it("preserves completed typed-flow blocks when continuing a failed AI block", async () => {
  const { store, definition, runner } = await fixture(
    [{ ...block("start", "start_button"), prompt: "go" }, block("first", "ai"), block("failed", "ai")],
    [
      { id: "a", type: "follow", from: "start", to: "first" },
      { id: "b", type: "follow", from: "first", to: "failed" },
    ],
  );
  const dispatch = vi.fn(
    async (item: HarnessBlock, _input: string, runtime: Parameters<Parameters<HarnessRunner["start"]>[2]>[2]) => {
      await runtime.started(`/session/${item.id}`);
      if (item.id === "failed") throw new Error("Synthetic failure");
      return session("kept");
    },
  );
  const append = vi.fn(async (_block: HarnessBlock, _input: string) => session("continued"));
  const run = await runner.start(definition.id, "request", dispatch, "test", append);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("failed"), { timeout: 5000 });
  await vi.waitFor(() => expect(runner.isActive(run.id)).toBe(false), { timeout: 5000 });
  await runner.retryFailedRun(run.id, dispatch, "test", append);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("succeeded"), { timeout: 5000 });
  expect(dispatch.mock.calls.map((call) => call[0].id)).toEqual(["first", "failed"]);
  expect(append).toHaveBeenCalledOnce();
  expect((await store.runs())[0]!.blocks.find((item) => item.blockId === "first")!.output).toBe("kept");
});
it("rejects retries with an ambiguous mutation journal without dispatching anything", async () => {
  const { store, definition, runner } = await fixture([block("failed")], []);
  const dispatch = vi.fn(async () => {
    throw new Error("Synthetic failure");
  });
  const append = vi.fn(async () => session("unexpected"));
  const run = await runner.start(definition.id, "request", dispatch, "test", append);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("failed"), { timeout: 5000 });
  await vi.waitFor(() => expect(runner.isActive(run.id)).toBe(false), { timeout: 5000 });
  const saved = (await store.runs())[0]!;
  saved.operations!.push({
    id: "uncertain",
    idempotencyKey: "merge",
    kind: "merge",
    status: "intent",
    blockId: "failed",
    createdAt: "now",
    updatedAt: "now",
  });
  await store.saveRun(saved);
  await expect(runner.retryFailedRun(run.id, dispatch, "test", append)).rejects.toThrow("uncertain outcome");
  expect(dispatch).toHaveBeenCalledOnce();
  expect(append).not.toHaveBeenCalled();
  expect((await store.runs())[0]!.status).toBe("failed");
});
it("retries a failed stage beside an active watchdog without replacing its live state", async () => {
  const { store, definition, runner } = await fixture([{ ...block("watchdog"), watchdog: true }, block("failed")], []);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatch = vi.fn(
    async (item: HarnessBlock, _input: string, runtime: Parameters<Parameters<HarnessRunner["start"]>[2]>[2]) => {
      await runtime.started(`/session/${item.id}`);
      if (item.id === "watchdog") {
        await gate;
        return session("watchdog done");
      }
      throw new Error("Synthetic failure");
    },
  );
  const append = vi.fn(async () => session("continued"));
  const run = await runner.start(definition.id, "request", dispatch, "test", append);
  try {
    await vi.waitFor(
      async () =>
        expect((await store.runs())[0]?.blocks.find((item) => item.blockId === "failed")?.status).toBe("failed"),
      { timeout: 5000 },
    );
    await runner.retryFailedRun(run.id, dispatch, "test", append);
    await vi.waitFor(
      async () =>
        expect((await store.runs())[0]?.blocks.find((item) => item.blockId === "failed")?.status).toBe("succeeded"),
      { timeout: 5000 },
    );
    release();
    await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("succeeded"), { timeout: 5000 });
    expect((await store.runs())[0]?.blocks.find((item) => item.blockId === "watchdog")?.output).toBe("watchdog done");
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledOnce();
  } finally {
    release();
  }
});
it("refuses to replay a failed script even when its outcome is not journaled", async () => {
  const { store, definition, runner } = await fixture([{ ...block("script", "script"), command: "false" }], []);
  const dispatch = vi.fn(async () => {
    throw new Error("Synthetic script failure");
  });
  const run = await runner.start(definition.id, "request", dispatch);
  await vi.waitFor(async () => expect((await store.runs())[0]?.status).toBe("failed"), { timeout: 5000 });
  await vi.waitFor(() => expect(runner.isActive(run.id)).toBe(false), { timeout: 5000 });
  await expect(runner.retryFailedRun(run.id, dispatch, "test", async () => session("unexpected"))).rejects.toThrow(
    "uncertain outcome",
  );
  expect(dispatch).toHaveBeenCalledOnce();
});
