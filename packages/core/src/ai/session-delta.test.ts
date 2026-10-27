import { describe, expect, it } from "vitest";
import type { AiMessage, AiSession } from "@hatopad/protocol";
import { SessionDeltas } from "./session-delta.js";
import { deferSessionImages } from "./session-images.js";

const message = (id: string, text = id): AiMessage => ({ id, text, role: "assistant", timestamp: "now" });
const session = (messages: AiMessage[]): AiSession => ({
  id: "s",
  status: "in_progress",
  model: "auto",
  reasoning: "low",
  messages,
});

describe("session cursors", () => {
  it("sends only appended and modified positions, even when timestamps and tool ids repeat", () => {
    const store = new SessionDeltas();
    const chat = session([message("tool"), message("reply"), message("tool")]);
    const first = store.get("workspace", chat);
    expect(first.updates).toBeUndefined();
    chat.messages[1]!.text += " streamed";
    chat.messages[2]!.text = "completed";
    chat.messages.push(message("next"));
    const next = store.get("workspace", chat, first.cursor);
    expect(next.session.messages).toEqual([]);
    expect(next.updates).toEqual([
      { index: 1, message: chat.messages[1] },
      { index: 2, message: chat.messages[2] },
      { index: 3, message: chat.messages[3] },
    ]);
    expect(next.messageCount).toBe(4);
    expect(store.get("workspace", chat, next.cursor).updates).toEqual([]);
    // A dropped response is recovered from the last acknowledged cursor.
    expect(store.get("workspace", chat, first.cursor).updates).toEqual(next.updates);
  });

  it("resends changes to content and metadata without resending older messages", () => {
    const store = new SessionDeltas();
    const chat = session([message("old"), message("new")]);
    const first = store.get("workspace", chat);
    chat.messages[0]!.content = [{ type: "text", text: "changed tool result" }];
    chat.status = "done";
    const next = store.get("workspace", chat, first.cursor);
    expect(next.updates?.map((item) => item.index)).toEqual([0]);
    expect(next.session.status).toBe("done");
    chat.messages = structuredClone(chat.messages);
    expect(store.get("workspace", chat, next.cursor).updates).toEqual([]);
  });

  it("falls back to full snapshots after a restart, session switch, history trim or eviction", () => {
    const store = new SessionDeltas();
    const chat = session([message("a"), message("b")]);
    const first = store.get("workspace", chat);
    expect(new SessionDeltas().get("workspace", chat, first.cursor).updates).toBeUndefined();
    expect(store.get("other", chat, first.cursor).updates).toBeUndefined();
    chat.id = "different";
    expect(store.get("workspace", chat, first.cursor).updates).toBeUndefined();
    const switched = store.get("workspace", chat);
    chat.messages.shift();
    expect(store.get("workspace", chat, switched.cursor).updates).toBeUndefined();
    for (let i = 0; i < 33; i++) store.get(`workspace-${i}`, chat);
    expect(store.get("workspace", chat, switched.cursor).updates).toBeUndefined();
  });

  it("keeps image bytes out of both initial and incremental responses without changing stored messages", () => {
    const store = new SessionDeltas();
    const chat = session([
      {
        ...message("screenshot"),
        content: [{ type: "image", data: "a".repeat(5_000_000), mimeType: "image/png" }],
      },
    ]);
    const first = store.get("workspace", chat);
    const bounded = deferSessionImages(first) as typeof first;
    expect(JSON.stringify(bounded).length).toBeLessThan(1000);
    const image = bounded.session.messages[0]!.content![0]!;
    expect(image).toMatchObject({ type: "image", data: "", deferred: expect.any(String) });
    expect(chat.messages[0]!.content![0]).toMatchObject({ data: "a".repeat(5_000_000) });
    chat.messages[0]!.text = "Screenshot complete";
    const changed = deferSessionImages(store.get("workspace", chat, first.cursor));
    expect(JSON.stringify(changed).length).toBeLessThan(1000);
    expect(deferSessionImages({ image: chat.messages[0]!.content![0] })).toEqual({
      image: chat.messages[0]!.content![0],
    });
  });
});
