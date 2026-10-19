import { describe, expect, it } from "vitest";
import type { AiSession } from "@hatopad/protocol";
import { boundSessionsInResult, limitSessionMessages, pageSessions, validSessionMessageLimit } from "./session-bounds.js";

const session = (id: string, count = 3): AiSession => ({ id, model: "m", reasoning: "r", status: "idle", messages: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, role: "assistant", text: "t", timestamp: "x" })) });

describe("session bounds", () => {
  it("keeps the newest messages and reports omissions without mutating", () => {
    const original = session("a", 5);
    const limited = limitSessionMessages(original, 2);
    expect(limited.messages.map((m) => m.id)).toEqual(["a-3", "a-4"]);
    expect(limited.omittedMessages).toBe(3);
    expect(original.messages).toHaveLength(5);
    expect(limitSessionMessages(original, 0).messages).toEqual([]);
    expect(limitSessionMessages(session("b", 2), 5).omittedMessages).toBeUndefined();
  });

  it("bounds session and sessions in a result and ignores other results", () => {
    expect(boundSessionsInResult({ session: session("a", 4) }, 1)).toMatchObject({ session: { messages: [{ id: "a-3" }], omittedMessages: 3 } });
    const many = boundSessionsInResult({ sessions: [session("a", 4), session("b", 1)], nextBefore: "z" }, 0) as { sessions: AiSession[]; nextBefore: string };
    expect(many.sessions.map((s) => s.messages.length)).toEqual([0, 0]);
    expect(many.nextBefore).toBe("z");
    const other = { tasks: [] };
    expect(boundSessionsInResult(other, 0)).toBe(other);
    expect(boundSessionsInResult({ session: session("a") }, undefined)).toEqual({ session: session("a") });
  });

  it("validates the connection limit", () => {
    expect(validSessionMessageLimit(undefined)).toBeUndefined();
    expect(validSessionMessageLimit(0)).toBe(0);
    for (const bad of [-1, 101, 1.5, "0"]) expect(() => validSessionMessageLimit(bad)).toThrow();
  });

  it("pages session metadata and leaves the legacy shape untouched", () => {
    const sessions = ["a", "b", "c", "d", "e"].map((id) => session(id));
    expect(pageSessions(sessions, {}).sessions).toBe(sessions);
    const first = pageSessions(sessions, { summary: true, limit: 2 });
    expect(first.sessions.map((s) => [s.id, s.messages.length])).toEqual([["a", 0], ["b", 0]]);
    expect(first.nextBefore).toBe("b");
    const second = pageSessions(sessions, { summary: true, limit: 2, before: first.nextBefore });
    expect(second.sessions.map((s) => s.id)).toEqual(["c", "d"]);
    const last = pageSessions(sessions, { limit: 2, before: second.nextBefore });
    expect(last.sessions.map((s) => s.id)).toEqual(["e"]);
    expect(last.nextBefore).toBeUndefined();
    expect(last.sessions[0]!.messages).toHaveLength(3);
    for (const bad of [{ limit: 0 }, { limit: 101 }, { before: "nope" }, { summary: "yes" }]) expect(() => pageSessions(sessions, bad)).toThrow();
  });
});

describe("pending request bounds", () => {
  it("clips display text but never identities, options' ids or choice values", async () => {
    const { boundPending: bound } = await import("./session-bounds.js");
    const boundPending = (value: Pick<AiSession, "pendingPermission" | "pendingQuestion">) => bound(value);
    const big = "y".repeat(5000);
    const bounded = boundPending({
      pendingPermission: { id: "perm", toolCallId: "tool", title: big, details: big, options: Array.from({ length: 30 }, (_, index) => ({ optionId: `o${index}`, name: big, kind: "allow_once" as const })) },
      pendingQuestion: { id: "q", message: big, fields: Array.from({ length: 40 }, (_, index) => ({ id: `f${index}`, type: "choice" as const, title: big, choices: Array.from({ length: 60 }, (_, choice) => ({ value: `v${choice}-${big}`, label: big, description: big })) })) }
    });
    expect(bounded.pendingPermission!.id).toBe("perm");
    expect(bounded.pendingPermission!.toolCallId).toBe("tool");
    expect(bounded.pendingPermission!.title).toHaveLength(200);
    expect(bounded.pendingPermission!.details).toHaveLength(2000);
    expect(bounded.pendingPermission!.options).toHaveLength(20);
    expect(bounded.pendingPermission!.options[0]).toMatchObject({ optionId: "o0", kind: "allow_once" });
    expect(bounded.pendingPermission!.options[0]!.name).toHaveLength(200);
    expect(bounded.pendingQuestion!.id).toBe("q");
    expect(bounded.pendingQuestion!.message).toHaveLength(1000);
    expect(bounded.pendingQuestion!.fields).toHaveLength(30);
    const choices = bounded.pendingQuestion!.fields[0]!.choices!;
    expect(choices).toHaveLength(50);
    expect(choices[0]!.value).toBe(`v0-${big}`);
    expect(choices[0]!.label).toHaveLength(300);
    expect(bounded.pendingPermission!.truncated).toBe(true);
    expect(bounded.pendingQuestion!.truncated).toBe(true);
    const small = boundPending({ pendingPermission: { id: "p", toolCallId: "t", title: "ok", details: "d", options: [{ optionId: "o", name: "Allow", kind: "allow_once" as const }] }, pendingQuestion: { id: "q", message: "m", fields: [{ id: "f", type: "choice" as const, title: "T", choices: [{ value: "v", label: "L" }] }] } });
    expect(small.pendingPermission!.truncated).toBeUndefined();
    expect(small.pendingQuestion!.truncated).toBeUndefined();
    for (const [field, value] of [["title", "x".repeat(201)], ["details", "x".repeat(2001)]] as const) {
      expect(boundPending({ pendingPermission: { id: "p", toolCallId: "t", title: "ok", options: [], [field]: value } }).pendingPermission!.truncated).toBe(true);
    }
    expect(boundPending({ pendingQuestion: { id: "q", message: "m", fields: [{ id: "f", type: "choice" as const, choices: [{ value: "v", label: "L".repeat(301) }] }] } }).pendingQuestion!.truncated).toBe(true);
    const bare = { pendingPermission: undefined };
    expect(boundPending(bare)).toBe(bare);
  });

  it("applies to summary and limited sessions", () => {
    const session = { id: "a", model: "m", reasoning: "r", status: "user_prompt", messages: [], pendingPermission: { id: "p", toolCallId: "t", title: "z".repeat(900), options: [] } } as AiSession;
    expect(limitSessionMessages(session, 0).pendingPermission!.title).toHaveLength(200);
  });
});
