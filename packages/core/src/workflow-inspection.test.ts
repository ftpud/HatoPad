import { expect, it } from "vitest";
import type { HarnessRun } from "@hatopad/protocol";
import { workflowOutputPage } from "./workflow-inspection.js";
it("pages one stored block output without returning prompts or the complete run", () => {
  const run = {
    id: "run",
    input: "PRIVATE USER INPUT",
    blocks: [{ blockId: "doc", status: "succeeded", output: "one two three", prompt: "PRIVATE PROMPT" }],
  } as HarnessRun;
  expect(workflowOutputPage(run, "doc", { maxChars: 4 })).toEqual({
    blockId: "doc",
    title: "doc",
    type: "text",
    status: "succeeded",
    content: "one ",
    totalChars: 13,
    nextOffset: 4,
  });
  expect(workflowOutputPage(run, "doc", { maxChars: 4, offset: 4 }).content).toBe("two ");
  expect(JSON.stringify(workflowOutputPage(run, "doc", {}))).not.toContain("PRIVATE");
  expect(() => workflowOutputPage(run, "other", {})).toThrow("unavailable");
  for (const options of [{ maxChars: 0 }, { maxChars: 32_001 }, { offset: -1 }, { offset: 0.5 }])
    expect(() => workflowOutputPage(run, "doc", options)).toThrow("page");
});
