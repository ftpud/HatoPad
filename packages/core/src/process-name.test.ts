import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { namedNodeArgs } from "./ai/node-process.js";

const execute = promisify(execFile);
const argumentsToPreserve = ["--gateway-workspace-id", "test-workspace", "--workspace", "/tmp/name test"];
const report = `
import { readFileSync } from "node:fs";
console.log(JSON.stringify({
  name: readFileSync("/proc/self/comm", "utf8").trim(),
  command: readFileSync("/proc/self/cmdline", "utf8").split("\\0"),
  args: process.argv.slice(1),
  execArgs: process.execArgv,
}));`;

describe.skipIf(process.platform !== "linux")("Linux process names", () => {
  it.each([false, true])("preserves Gateway identity arguments (provider preload: %s)", async (provider) => {
    const name = provider ? "hatopad-codex" : "hatopad-core";
    const setup = provider
      ? ""
      : `import { setProcessName } from ${JSON.stringify(new URL("./process-name.ts", import.meta.url).href)}; setProcessName(${JSON.stringify(name)});`;
    const args = ["--import", "tsx", "--input-type=module", "-e", setup + report, "--", ...argumentsToPreserve];
    const { stdout } = await execute(process.execPath, provider ? namedNodeArgs(name, args) : args);
    const result = JSON.parse(stdout);
    expect(result.name).toBe(name);
    expect(result.args).toEqual(argumentsToPreserve);
    expect(result.command.slice(-5, -1)).toEqual(argumentsToPreserve);
    // A provider's own fork() must retain existing flags, but not the naming preload.
    expect(result.execArgs.slice(0, 2)).toEqual(["--import", "tsx"]);
  });
});
