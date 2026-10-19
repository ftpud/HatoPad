import { describe, expect, it } from "vitest";
import { watchSnapshot, watchSummary } from "./terminal-watch.js";

const session = (output: string) => ({ terminalId: "t1", status: "running" as const, output });

describe("terminal watch snapshots", () => {
  it("reports metadata without output", () => {
    expect(watchSummary({ ...session("héllo"), displayName: "dev" })).toEqual({
      terminalId: "t1",
      status: "running",
      displayName: "dev",
      outputBytes: 6,
    });
    expect(JSON.stringify(watchSummary(session("secret")))).not.toContain("secret");
  });
  it("returns whole output within the limit", () => {
    expect(watchSnapshot(session("abc"), 1024)).toMatchObject({ output: "abc", truncated: false, outputBytes: 3 });
  });
  it("keeps the newest bytes and never starts inside a multibyte character", () => {
    const text = "€".repeat(10); // 3 bytes each
    const snapshot = watchSnapshot(session(text), 10);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.output).toBe("€€€");
    expect(Buffer.byteLength(snapshot.output)).toBeLessThanOrEqual(10);
    expect(snapshot.outputBytes).toBe(30);
  });
});
