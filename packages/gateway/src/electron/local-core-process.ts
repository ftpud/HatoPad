import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export type ProcessTools = {
  output(command: string, args: string[]): Promise<string>;
  kill(pid: number): void;
  alive(pid: number): boolean;
  sleep(ms: number): Promise<void>;
};
export const systemProcessTools: ProcessTools = {
  output: async (command, args) =>
    (
      await run(command, args, { timeout: 10_000, maxBuffer: 1_000_000 }).catch((error: { stdout?: string }) => ({
        stdout: error.stdout ?? "",
      }))
    ).stdout,
  kill: (pid) => process.kill(pid, "SIGTERM"),
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * A local Core is detached and outlives the Gateway that started it, so a new Gateway session has no handle on it.
 * Starting another Core on its port would fail while the health check reached the old one. Stop only a process that
 * listens on this workspace's port and is provably this workspace's Core; refuse anything else.
 */
export async function stopOrphanedLocalCore(
  port: number,
  workspace: string,
  tools: ProcessTools = systemProcessTools,
  timeoutMs = 35_000,
): Promise<boolean> {
  if (process.platform === "win32" && tools === systemProcessTools) return false;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local Core port");
  const pids = [
    ...new Set(
      (await tools.output("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]))
        .split(/\s+/)
        .filter((value) => /^[0-9]+$/.test(value))
        .map(Number),
    ),
  ];
  if (!pids.length) return false;
  for (const pid of pids) {
    const command = (await tools.output("ps", ["-p", String(pid), "-o", "args="])).trim();
    const isCore =
      /(?:packages\/core\/dist\/index\.js|scripts\/core-release-service\.mjs)/.test(command) &&
      command.includes(`--port ${port}`) &&
      command.includes(`--workspace ${workspace}`);
    if (!isCore)
      throw new Error(`Port ${port} is in use by another process. Stop it or choose another local port, then retry.`);
  }
  for (const pid of pids) tools.kill(pid);
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (!pids.some((pid) => tools.alive(pid))) return true;
    await tools.sleep(100);
  }
  throw new Error("The previous local Core is still stopping; retry after shutdown completes");
}
