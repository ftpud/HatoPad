import { describe, expect, it } from "vitest";
import { projectBlockDetail, projectProgress } from "./harness-progress.js";

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

describe("projectBlockDetail", () => {
  const detailRun = { id: "r", harnessId: "h", status: "running", createdAt: "t", definition: { huge: true }, input: "SECRET INPUT", blocks: [
    { blockId: "chat", status: "running", prompt: "PROMPT", output: "0123456789".repeat(10), iterations: [{}, {}],
      chatMessages: Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", text: index === 4 ? "x".repeat(5000) : `text${index}`, timestamp: "t" })) }
  ] } as never;

  it("returns the newest output characters and a newest-first chat page without prompts or the definition", () => {
    const detail = projectBlockDetail(detailRun, "chat", { outputChars: 25, chatLimit: 2 });
    expect(detail.output).toBe("0123456789".repeat(10).slice(-25));
    expect(detail).toMatchObject({ outputChars: 100, outputTruncated: true, iterations: 2, chatNextBefore: "m3" });
    expect(detail.chatMessages.map((message) => message.id)).toEqual(["m3", "m4"]);
    expect(detail.chatMessages[1]).toMatchObject({ clipped: true });
    expect(detail.chatMessages[1]!.text).toHaveLength(4000);
    const text = JSON.stringify(detail);
    for (const leaked of ["SECRET INPUT", "PROMPT", "huge"]) expect(text).not.toContain(leaked);
  });

  it("pages backwards and validates every input", () => {
    const older = projectBlockDetail(detailRun, "chat", { chatLimit: 2, chatBefore: "m3" });
    expect(older.chatMessages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(older.chatNextBefore).toBe("m1");
    expect(projectBlockDetail(detailRun, "chat", { chatBefore: "m1" }).chatNextBefore).toBeUndefined();
    expect(() => projectBlockDetail(detailRun, "missing", {})).toThrow(/does not exist/);
    expect(() => projectBlockDetail(detailRun, "chat", { outputChars: 70_000 })).toThrow(/outputChars/);
    expect(() => projectBlockDetail(detailRun, "chat", { chatLimit: 0 })).toThrow(/chatLimit/);
    expect(() => projectBlockDetail(detailRun, "chat", { chatBefore: "nope" })).toThrow(/chatBefore/);
    expect(() => projectBlockDetail(detailRun, 5, {})).toThrow(/blockId/);
  });
});
