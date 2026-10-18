import { describe, expect, it } from "vitest";
import { projectProgress } from "./harness-progress.js";

const run = {
  id: "r", harnessId: "h", harnessVersion: 1, input: "SECRET INPUT", status: "running", createdAt: "t", definition: { huge: true }, error: "e".repeat(900),
  blocks: [{
    blockId: "b", status: "running", prompt: "PROMPT", output: "OUTPUT", chatMessages: [{ text: "chat" }],
    log: Array.from({ length: 30 }, (_, index) => ({ timestamp: "t", kind: "lifecycle", message: `m${index}`.padEnd(900, "x") }))
  }]
} as never;

describe("projectProgress", () => {
  it("returns only bounded progress fields", () => {
    const progress = projectProgress(run, 5);
    expect(progress.error).toHaveLength(500);
    expect(progress.blocks[0]!.log.map((entry) => entry.message.slice(0, 3))).toEqual(["m25", "m26", "m27", "m28", "m29"]);
    expect(progress.blocks[0]!.log.every((entry) => entry.message.length === 500)).toBe(true);
    expect(progress.blocks[0]!.logTruncated).toBe(true);
    const text = JSON.stringify(progress);
    for (const leaked of ["SECRET INPUT", "PROMPT", "OUTPUT", "chat", "huge"]) expect(text).not.toContain(leaked);
  });

  it("bounds pending permissions, flags clipped questions and refuses oversized projections", () => {
    const big = "p".repeat(5000);
    const paused = { ...(run as object), blocks: [{ blockId: "b", status: "awaiting_permission", pauseId: "x", question: "q".repeat(501), pendingPermission: { id: "perm", toolCallId: "t", title: big, details: big, options: [] } }, { blockId: "c", status: "awaiting_user_input", pauseId: "y", question: "short" }] } as never;
    const progress = projectProgress(paused, 1);
    expect(progress.blocks[0]!.pendingPermission).toMatchObject({ id: "perm", truncated: true });
    expect(progress.blocks[0]!.pendingPermission!.details).toHaveLength(2000);
    expect(progress.blocks[0]!.questionTruncated).toBe(true);
    expect(progress.blocks[1]!.questionTruncated).toBeUndefined();
    const many = { ...(run as object), blocks: Array.from({ length: 201 }, (_, index) => ({ blockId: `b${index}`, status: "queued" })) } as never;
    expect(() => projectProgress(many, 1)).toThrow(/more than 200 blocks/);
    const heavy = { ...(run as object), blocks: Array.from({ length: 200 }, (_, index) => ({ blockId: `b${index}`, status: "running", error: "e".repeat(500), question: "q".repeat(500), log: Array.from({ length: 100 }, () => ({ timestamp: "t", kind: "lifecycle", message: "m".repeat(500) })) })) } as never;
    expect(() => projectProgress(heavy, 100)).toThrow(/too large/);
  });

  it("rejects out-of-range log limits", () => {
    for (const limit of [0, 101, 2.5, "5"]) expect(() => projectProgress(run, limit)).toThrow();
    expect(projectProgress(run, undefined).blocks[0]!.log).toHaveLength(20);
  });
});
