import os from "node:os";
import { describe, expect, it } from "vitest";
import type { HarnessBlock } from "@hatopad/protocol";
import { executeFlowScript } from "./workflow-script.js";

const script = (command: string): HarnessBlock => ({
  id: "script",
  type: "script",
  label: "Script",
  prompt: "",
  command,
  position: { x: 0, y: 0 },
});
describe("workflow scripts", () => {
  it("provides input on stdin and in the environment, and returns stdout", async () => {
    const result = await executeFlowScript(
      script('read value; printf "%s|%s" "$value" "$HATOPAD_WORKFLOW_INPUT"'),
      "hello",
      os.tmpdir(),
      () => {},
    );
    expect(result.messages[0]?.text).toBe("hello|hello");
  });
  it("still exposes the pre-rename VIBE_WORKFLOW_INPUT name to saved scripts", async () => {
    const result = await executeFlowScript(
      script('printf "%s|%s" "$VIBE_WORKFLOW_INPUT" "$HATOPAD_WORKFLOW_INPUT"'),
      "hi",
      os.tmpdir(),
      () => {},
    );
    expect(result.messages[0]?.text).toBe("hi|hi");
  });
  it("reports nonzero exits with stderr", async () => {
    await expect(executeFlowScript(script("echo broken >&2; exit 7"), "", os.tmpdir(), () => {})).rejects.toThrow(
      /Script exited with 7:[\s\S]*broken/,
    );
  });
  it("stops a running script when its workflow is cancelled", async () => {
    let active = true;
    const result = executeFlowScript(script("exec sleep 30"), "", os.tmpdir(), () => {
      if (!active) throw new Error("Cancelled");
    });
    active = false;
    await expect(result).rejects.toThrow("Cancelled");
  });
});
