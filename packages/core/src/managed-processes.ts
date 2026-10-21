import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { ManagedProcess, ManagedWorkflowApp } from "@hatopad/protocol";

const exec = promisify(execFile);
export type ProcessRow = {
  pid: number;
  parentPid: number;
  birth: string;
  command: string;
  state: string;
};
export type ProcessContext = Pick<
  ManagedProcess,
  "workspace" | "rootWorkspace" | "provider" | "sessionId" | "kind" | "workflowRunId" | "workflowBlockId" | "appName"
> & { command?: string };
type Launch = {
  context: ProcessContext;
  pid?: number;
  identity?: ProcessRow;
  ready?: Promise<void>;
  exited: Promise<void>;
  finish: () => void;
};

/** Records only children explicitly launched by Core. Listings use the cache;
 * lifecycle events remove entries. Descendants are inspected only on Stop.
 */
export class ManagedProcesses extends EventEmitter {
  private readonly launches = new Map<string, Launch>();
  constructor(
    private readonly inspect: (pid: number) => Promise<ProcessRow | undefined> = inspectProcess,
    private readonly signal: (pid: number) => void = (pid) => process.kill(pid, "SIGKILL"),
    private readonly children: (pid: number) => Promise<number[]> = childPids,
  ) {
    super();
  }

  prepare(context: ProcessContext): { launchId: string; env: NodeJS.ProcessEnv } {
    const launchId = crypto.randomUUID();
    let finish!: () => void;
    const exited = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.launches.set(launchId, { context, exited, finish });
    return { launchId, env: { ...process.env } };
  }
  launch<T extends ChildProcess>(context: ProcessContext, create: (env: NodeJS.ProcessEnv) => T): T {
    return this.launchWithIdentity(context, create).child;
  }
  launchWithIdentity<T extends ChildProcess>(
    context: ProcessContext,
    create: (env: NodeJS.ProcessEnv) => T,
  ): { child: T; launchId: string } {
    const launch = this.prepare(context);
    try {
      const child = create(launch.env);
      this.track(child, context, launch.launchId);
      return { child, launchId: launch.launchId };
    } catch (error) {
      this.abandon(launch.launchId);
      throw error;
    }
  }
  abandon(launchId: string): void {
    const launch = this.launches.get(launchId);
    if (this.launches.delete(launchId)) {
      launch?.finish();
      this.emit("changed");
    }
  }
  get launchCount(): number {
    return this.launches.size;
  }
  track(
    child: { pid?: number; once(event: "exit" | "error" | "spawn", listener: () => void): unknown },
    context: ProcessContext,
    launchId: string,
  ): void {
    const launch = this.launches.get(launchId);
    if (!launch) return;
    launch.context = context;
    const register = () => {
      if (!child.pid || this.launches.get(launchId) !== launch) return;
      launch.pid = child.pid;
      // Capture birth identity once, while this child is owned and alive. A PID
      // whose identity could not be captured is visible but cannot be signalled.
      launch.ready = this.inspect(child.pid)
        .then((row) => {
          if (this.launches.get(launchId) === launch) launch.identity = row;
        })
        .catch(() => {});
      this.emit("changed");
    };
    child.once("exit", () => this.abandon(launchId));
    child.once("error", () => this.abandon(launchId));
    if (child.pid) register();
    else child.once("spawn", register);
  }
  setWorkspaceContext(workspace: string, context: Partial<ProcessContext>): void {
    for (const launch of this.launches.values())
      if (launch.context.workspace === workspace) Object.assign(launch.context, context);
    this.emit("changed");
  }
  setSession(pid: number | undefined, sessionId: string): void {
    if (pid === undefined) return;
    for (const launch of this.launches.values()) if (launch.pid === pid) launch.context.sessionId = sessionId;
    this.emit("changed");
  }
  async list(): Promise<ManagedProcess[]> {
    await this.ready();
    return [...this.launches].flatMap(([id, launch]) =>
      launch.pid === undefined
        ? []
        : [
            {
              ...launch.context,
              id: `${launch.pid}:${id}`,
              pid: launch.pid,
              parentPid: launch.identity?.parentPid,
              command: launch.context.command ?? launch.identity?.command ?? "",
              status: "running" as const,
            },
          ],
    );
  }
  appSnapshot(launchId: string): ManagedWorkflowApp | undefined {
    const launch = this.launches.get(launchId);
    if (!launch || launch.context.kind !== "workflow-app" || launch.pid === undefined) return undefined;
    const context = launch.context;
    return {
      kind: "workflow-app",
      id: `app:${launchId}`,
      name: context.appName ?? "Workflow app",
      pid: launch.pid,
      launcherPid: launch.pid,
      command: context.command ?? launch.identity?.command ?? "",
      status: "running",
      processCount: 1,
      workspace: context.workspace,
      rootWorkspace: context.rootWorkspace,
      workflowRunId: context.workflowRunId,
      workflowBlockId: context.workflowBlockId,
    };
  }
  async listApps(): Promise<ManagedWorkflowApp[]> {
    await this.ready();
    return [...this.launches.keys()].flatMap((id) => this.appSnapshot(id) ?? []);
  }
  private async ready(): Promise<void> {
    await Promise.all([...this.launches.values()].map((launch) => launch.ready));
  }
  async kill(
    id: string,
    allowed: (context: ProcessContext) => Promise<boolean>,
    stopLauncher?: () => void,
  ): Promise<boolean> {
    if (typeof id !== "string") throw new Error("Choose a managed process to kill");
    const selected = [...this.launches].find(([launchId, launch]) =>
      id.startsWith("app:")
        ? id === `app:${launchId}` && launch.context.kind === "workflow-app"
        : id === `${launch.pid}:${launchId}`,
    );
    if (!selected) return false;
    const [launchId, launch] = selected;
    if (!(await allowed(launch.context))) throw new Error("Process belongs to another project");
    await launch.ready;
    if (this.launches.get(launchId) !== launch || launch.pid === undefined) return false;
    if (!launch.identity) throw new Error(`Could not verify PID ${launch.pid}; it has not been stopped`);
    const current = await this.inspect(launch.pid);
    if (!sameProcess(current, launch.identity)) {
      this.abandon(launchId);
      return false;
    }
    const tree: ProcessRow[] = [current!];
    const seen = new Set([launch.pid]);
    for (let index = 0; index < tree.length; index++) {
      const parent = tree[index]!;
      if (!sameProcess(await this.inspect(parent.pid), parent)) continue;
      const childIds = await this.children(parent.pid);
      if (!sameProcess(await this.inspect(parent.pid), parent)) continue;
      for (const pid of childIds) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const row = await this.inspect(pid);
        if (row && row.parentPid === parent.pid && row.state !== "Z") tree.push(row);
      }
    }
    if (!sameProcess(await this.inspect(launch.pid), launch.identity)) {
      this.abandon(launchId);
      return false;
    }
    // Recheck after discovery and stop the launcher first, so it cannot keep
    // spawning children while its captured descendants are being stopped.
    for (const row of tree) {
      try {
        if (sameProcess(await this.inspect(row.pid), row)) {
          if (row.pid === launch.pid && stopLauncher) stopLauncher();
          else this.signal(row.pid);
        }
      } catch (error) {
        if (!["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw new Error(`Could not kill PID ${row.pid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.launches.get(launchId) === launch) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          launch.exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 1500);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (sameProcess(await this.inspect(launch.pid), launch.identity))
        throw new Error(`PID ${launch.pid} is still exiting. Refresh processes and retry Stop.`);
      this.abandon(launchId);
    }
    return true;
  }
}

function sameProcess(current: ProcessRow | undefined, expected: ProcessRow): boolean {
  return !!current && current.birth === expected.birth && current.state !== "Z";
}
async function inspectProcess(pid: number): Promise<ProcessRow | undefined> {
  try {
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(")");
      const fields = stat.slice(end + 2).split(" ");
      if (!fields[19] || !fields[0]) return undefined;
      return {
        pid,
        parentPid: Number(fields[1]),
        birth: fields[19],
        state: fields[0],
        command: stat.slice(stat.indexOf("(") + 1, end),
      };
    }
    const { stdout } = await exec("ps", ["-p", String(pid), "-o", "ppid=,lstart=,stat=,comm="], {
      env: { ...process.env, LC_ALL: "C" },
    });
    const match = stdout.match(/^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.*)/);
    return match
      ? { pid, parentPid: Number(match[1]), birth: match[2]!, state: match[3]!, command: match[4]! }
      : undefined;
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "") ||
      (error as { code?: number }).code === 1
    )
      return undefined;
    throw error;
  }
}
async function childPids(pid: number): Promise<number[]> {
  try {
    if (process.platform === "linux") {
      // Threads can spawn children too; visit only this process's own task IDs.
      const tasks = await readdir(`/proc/${pid}/task`);
      const children = await Promise.all(
        tasks.map((tid) =>
          readFile(`/proc/${pid}/task/${tid}/children`, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT" || error.code === "ESRCH") return "";
            throw error;
          }),
        ),
      );
      return [...new Set(children.flatMap((value) => value.trim().split(/\s+/).filter(Boolean).map(Number)))];
    }
    const { stdout } = await exec("pgrep", ["-P", String(pid)]);
    return stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "") ||
      (error as { code?: number }).code === 1
    )
      return [];
    throw error;
  }
}
export const managedProcesses = new ManagedProcesses();
