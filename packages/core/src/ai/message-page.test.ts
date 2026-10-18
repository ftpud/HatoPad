import { describe, expect, it } from "vitest";
import type { AiMessage } from "@hatopad/protocol";
import { pageMessages } from "./message-page.js";

const message = (index: number, text = `m${index}`): AiMessage => ({ id: `id${index}`, role: "assistant", text, timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text: "attached" } as never] });
const session = { messages: Array.from({ length: 10 }, (_, index) => message(index)) };

describe("pageMessages", () => {
  it("returns the newest page and walks backwards without gaps", () => {
    const newest = pageMessages(session, { limit: 4 });
    expect(newest.messages.map((m) => m.id)).toEqual(["id6", "id7", "id8", "id9"]);
    expect(newest.nextBefore).toBe("id6");
    const older = pageMessages(session, { limit: 4, before: newest.nextBefore });
    expect(older.messages.map((m) => m.id)).toEqual(["id2", "id3", "id4", "id5"]);
    const oldest = pageMessages(session, { limit: 4, before: older.nextBefore });
    expect(oldest.messages.map((m) => m.id)).toEqual(["id0", "id1"]);
    expect(oldest.nextBefore).toBeUndefined();
  });

  it("clips text, drops attachments and leaves the session untouched", () => {
    const long = { messages: [message(0, "x".repeat(50))] };
    const page = pageMessages(long, { maxTextLength: 10 });
    expect(page.messages[0]!.text).toHaveLength(10);
    expect(page.clipped).toEqual(["id0"]);
    expect("content" in page.messages[0]!).toBe(false);
    expect(long.messages[0]!.text).toHaveLength(50);
    expect(long.messages[0]!.content).toBeDefined();
  });

  it("rejects bad bounds and unknown cursors", () => {
    for (const limit of [0, 101, 1.5, "3"]) expect(() => pageMessages(session, { limit })).toThrow();
    for (const maxTextLength of [0, 20_001]) expect(() => pageMessages(session, { maxTextLength })).toThrow();
    expect(() => pageMessages(session, { before: "missing" })).toThrow(/not found/);
    expect(() => pageMessages(session, { before: 5 })).toThrow();
  });
});
