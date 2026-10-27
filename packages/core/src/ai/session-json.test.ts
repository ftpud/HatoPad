import { expect, it, vi } from "vitest";
import type { AiSession } from "@hatopad/protocol";
import { SessionJson } from "./session-json.js";

it("captures saves before awaiting IO, reuses unchanged images and lets other work run between messages", async () => {
  const writer = new SessionJson();
  const session: AiSession = {
    id: "s",
    status: "in_progress",
    model: "auto",
    reasoning: "low",
    messages: Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      role: "activity",
      text: "Screenshot",
      timestamp: "now",
      content: [{ type: "image", mimeType: "image/png", data: "a".repeat(1_000_000) }],
    })),
  };
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    const first = writer.serialize(session);
    session.messages[0]!.text = "Changed while saving";
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    let serialized = "";
    try {
      for await (const chunk of first) serialized += chunk;
    } finally {
      clearInterval(timer);
    }
    expect(JSON.parse(serialized).messages[0].text).toBe("Screenshot");
    expect(ticks).toBeGreaterThan(0);
    stringify.mockClear();
    let updated = "";
    for await (const chunk of writer.serialize(session)) updated += chunk;
    expect(JSON.parse(updated)).toEqual(session);
    // One metadata object and one changed message; no repeated encoding of the other images.
    expect(stringify).toHaveBeenCalledTimes(2);
  } finally {
    stringify.mockRestore();
  }
});
