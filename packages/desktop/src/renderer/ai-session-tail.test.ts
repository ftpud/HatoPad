import { describe, expect, it } from "vitest";
import type { AiMessage, AiSession } from "@hatopad/protocol";
import { mergeAiSessionTail } from "./ai-session-tail";

const message = (id: string, text = id): AiMessage => ({ id, role: "assistant", text, timestamp: "now" });
const session = (messages: AiMessage[], extra: Partial<AiSession> = {}): AiSession => ({
  id: "s1",
  status: "in_progress",
  model: "auto",
  reasoning: "medium",
  messages,
  ...extra,
});

describe("mergeAiSessionTail", () => {
  it("replaces the shown transcript from the tail's first message onwards", () => {
    const shown = session([message("a"), message("b"), message("c", "partial")], { omittedMessages: 4 });
    const tail = session([message("c", "partial reply"), message("d")], { omittedMessages: 6, status: "idle" });
    const merged = mergeAiSessionTail(shown, tail)!;
    expect(merged.messages.map((item) => [item.id, item.text])).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["c", "partial reply"],
      ["d", "d"],
    ]);
    expect(merged.status).toBe("idle");
    expect(merged.omittedMessages).toBe(4);
  });

  it("uses a tail that already holds the whole transcript as is", () => {
    const tail = session([message("x")]);
    expect(mergeAiSessionTail(session([message("a")]), tail)).toBe(tail);
  });

  it("asks for a full reload when the tail cannot be anchored", () => {
    const shown = session([message("a"), message("b")]);
    expect(mergeAiSessionTail(shown, session([message("z")], { omittedMessages: 5 }))).toBeUndefined();
    expect(mergeAiSessionTail(shown, session([message("b")], { id: "s2", omittedMessages: 1 }))).toBeUndefined();
    expect(mergeAiSessionTail(shown, session([], { omittedMessages: 2 }))).toBeUndefined();
  });
});
