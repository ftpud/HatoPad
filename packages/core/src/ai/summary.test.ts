import { describe, expect, it } from "vitest";
import type { AiSession } from "@hatopad/protocol";
import { summarizeAiSessions } from "./summary.js";

const session = (status: AiSession["status"], text: string, timestamp: string): AiSession => ({
  model: "test",
  reasoning: "medium",
  status,
  messages: [{ id: text, role: "assistant", text, timestamp }],
});

describe("summarizeAiSessions", () => {
  it("reports completed activity as done", () => {
    expect(summarizeAiSessions([session("done", "Finished work", "2026-08-26T10:00:00Z")])).toEqual({
      status: "done",
      preview: "Finished work",
      pendingPermission: false,
    });
  });

  it("keeps active status while previewing the latest response from any provider", () => {
    expect(
      summarizeAiSessions([
        session("in_progress", "Working", "2026-08-26T09:00:00Z"),
        session("done", "Previous work", "2026-08-26T10:00:00Z"),
      ]),
    ).toEqual({ status: "in_progress", preview: "Previous work", pendingPermission: false });
  });
  it("does not let newer user prompts or activity replace the latest provider response", () => {
    const older = session("in_progress", "Older response", "2026-08-26T09:00:00Z");
    older.messages.push({ id: "activity", role: "activity", text: "Working", timestamp: "2026-08-26T12:00:00Z" });
    const newer = session("done", "Latest response", "2026-08-26T10:00:00Z");
    newer.messages.push({ id: "prompt", role: "user", text: "Continue", timestamp: "2026-08-26T11:00:00Z" });
    expect(summarizeAiSessions([older, newer]).preview).toBe("Latest response");
    expect(summarizeAiSessions([newer, older]).preview).toBe("Latest response");
  });

  it("falls back to activity until a provider has responded", () => {
    const working = session("in_progress", "Starting", "2026-08-26T09:00:00Z");
    working.messages[0]!.role = "activity";
    expect(summarizeAiSessions([working]).preview).toBe("Starting");
    expect(summarizeAiSessions([]).preview).toBe("");
  });
});
