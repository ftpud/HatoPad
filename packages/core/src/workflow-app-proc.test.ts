import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessBlock } from "@hatopad/protocol";
import { WorkflowAppService } from "./workflow-app.js";
import { managedProcesses } from "./managed-processes.js";
import { listProjectApps, killProjectApp } from "./project-processes.js";

const services: WorkflowAppService[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.closeAll()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function setup() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "workflow-proc-"));
  directories.push(workspace);
  const service = new WorkflowAppService();
  services.push(service);
  const tasks = { list: async () => ({ tasks: [] }), taskPath: () => workspace };
  const block: HarnessBlock = {
    id: "app",
    type: "run_app",
    label: "Server",
    prompt: "",
    position: { x: 0, y: 0 },
    app: { name: "Server", actions: ["start", "kill", "status"] },
    command: "sleep 300 & sleep 300 & wait",
  };
  const execute = async (action: "start" | "kill" | "status", command = block.command!) => {
    const result = await service.execute({ ...block, command }, JSON.stringify({ action }), workspace, () => {}, {
      rootWorkspace: workspace,
      workflowRunId: "run",
      workflowBlockId: "app",
    });
    return JSON.parse(result.messages[0]!.text) as { pid: number; status: string };
  };
  return {
    workspace,
    service,
    execute,
    list: () => listProjectApps(workspace, tasks),
    stop: (id: string) => killProjectApp(workspace, id),
  };
}
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("App lifecycle did not settle");
}

describe.skipIf(process.platform !== "linux")("workflow app Proc lifecycle", () => {
  it("counts a process tree once and repeated concurrent starts/stops do not accumulate apps", async () => {
    const { workspace, execute, list, stop } = await setup();
    const baseline = managedProcesses.launchCount;
    let previousId: string | undefined;
    for (let cycle = 0; cycle < 4; cycle++) {
      const starts = await Promise.all([execute("start"), execute("start"), execute("start")]);
      expect(new Set(starts.map((result) => result.pid)).size).toBe(1);
      await eventually(async () => (await list())[0]?.processCount === 1);
      const apps = await list();
      expect(apps).toHaveLength(1);
      expect(apps[0]!.id).not.toBe(previousId);
      previousId = apps[0]!.id;
      if (cycle % 2) await execute("kill");
      else await stop(apps[0]!.id);
      expect(await list()).toEqual([]);
      expect((await managedProcesses.list()).filter((item) => item.workspace === workspace)).toEqual([]);
      expect(await stop(apps[0]!.id)).toBe(false);
      expect((await execute("status")).status).toBe("exited");
    }
    expect(managedProcesses.launchCount).toBeLessThanOrEqual(baseline);
  }, 15_000);
  it("removes natural exits, and a fresh start has a fresh launch identity", async () => {
    const { execute, list } = await setup();
    await execute("start", "sleep 1");
    const first = (await list())[0]!;
    expect(first).toBeDefined();
    await eventually(async () => (await list()).length === 0);
    expect((await execute("status")).status).toBe("exited");
    await execute("start");
    expect((await list())[0]!.id).not.toBe(first.id);
  });
  it("removes an exited launcher without discovering detached host processes", async () => {
    const { workspace, execute, list } = await setup();
    const marker = path.join(workspace, "pid");
    const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));child.unref();`;
    const command = `${JSON.stringify(process.execPath)} -e '${code.replace(/'/g, "'\\''")}'`;
    let pid: number | undefined;
    try {
      await execute("start", command);
      await eventually(async () => (await execute("status")).status === "exited");
      pid = Number(await readFile(marker, "utf8"));
      expect(() => process.kill(pid!, 0)).not.toThrow();
      expect(await list()).toEqual([]);
      expect((await managedProcesses.list()).some((entry) => entry.pid === pid)).toBe(false);
    } finally {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  });
});
