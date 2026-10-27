import { expect, it } from "vitest";
import type { AiMessage, AiSession } from "@hatopad/protocol";
import { mergeAiSessionDelta } from "./ai-session-delta";

const message = (id: string, text = id): AiMessage => ({ id, text, role: "assistant", timestamp: "now" });
const session = (messages: AiMessage[]): AiSession => ({
  id: "s",
  model: "auto",
  reasoning: "low",
  status: "in_progress",
  messages,
});

it("updates existing positions and appends new messages while preserving untouched objects", () => {
  const previous = session([message("tool"), message("reply"), message("tool")]);
  const result = mergeAiSessionDelta(previous, {
    session: { ...previous, status: "done", messages: [] },
    messageCount: 4,
    updates: [
      { index: 2, message: message("tool", "finished") },
      { index: 3, message: message("new") },
    ],
  })!;
  expect(result.messages.map((item) => item.text)).toEqual(["tool", "reply", "finished", "new"]);
  expect(result.messages[0]).toBe(previous.messages[0]);
  expect(previous.messages).toHaveLength(3);
  expect(result.status).toBe("done");
});

it("accepts full recovery snapshots and asks for recovery on a missing baseline or gap", () => {
  const previous = session([message("a")]);
  const full = session([message("b")]);
  expect(mergeAiSessionDelta(previous, { session: full })).toBe(full);
  expect(mergeAiSessionDelta(previous, { session: full, updates: [], messageCount: 1 })).toEqual(previous);
  expect(
    mergeAiSessionDelta(previous, { session: { ...full, id: "other" }, updates: [], messageCount: 1 }),
  ).toBeUndefined();
  expect(
    mergeAiSessionDelta(previous, { session: full, updates: [{ index: 2, message: message("gap") }], messageCount: 3 }),
  ).toBeUndefined();
  expect(mergeAiSessionDelta(previous, { session: full, updates: [], messageCount: 2 })).toBeUndefined();
});
