import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ManagedProcesses, type ProcessRow } from "./managed-processes.js";

const context = {
  workspace: "/project/tasks/a",
  rootWorkspace: "/project",
  provider: "neutral",
  sessionId: "session-a",
  kind: "agent" as const,
};
const children: ChildProcess[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const child of children.splice(0)) child.kill("SIGKILL");
});
const row = (pid: number, parentPid = 1, birth = `ticks-${pid}`): ProcessRow => ({
  pid,
  parentPid,
  birth,
  command: `cmd-${pid}`,
  state: "S",
});
function setup() {
  const rows = new Map([
    [10, row(10)],
    [11, row(11, 10)],
    [99, row(99)],
  ]);
  const inspect = vi.fn(async (pid: number) => rows.get(pid));
  const child = Object.assign(new EventEmitter(), { pid: 10 });
  const signal = vi.fn((pid: number) => {
    rows.delete(pid);
    if (pid === child.pid) child.emit("exit");
  });
  const descendants = vi.fn(async (pid: number) =>
    [...rows.values()].filter((item) => item.parentPid === pid).map((item) => item.pid),
  );
  const host = new ManagedProcesses(inspect, signal, descendants);
  const launch = host.prepare(context);
  host.track(child, context, launch.launchId);
  return { host, launch, child, rows, inspect, signal, descendants };
}

describe("event-driven managed process ownership", () => {
  it("records only the launched PID and does no further inspection for idle time or repeated listings", async () => {
    vi.useFakeTimers();
    const { host, inspect, descendants } = setup();
    expect((await host.list()).map((item) => item.pid)).toEqual([10]);
    await vi.advanceTimersByTimeAsync(60_000);
    for (let i = 0; i < 20; i++) {
      await host.list();
      await host.listApps();
    }
    expect(inspect.mock.calls).toEqual([[10]]);
    expect(descendants).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("publishes cached app metadata and removes it immediately on natural exit", async () => {
    const { host, child, launch } = setup();
    host.setWorkspaceContext(context.workspace, { kind: "workflow-app", appName: "Server", workflowRunId: "run" });
    expect(await host.listApps()).toMatchObject([{ name: "Server", pid: 10, workflowRunId: "run", processCount: 1 }]);
    const changed = vi.fn();
    host.on("changed", changed);
    child.emit("exit");
    expect(await host.listApps()).toEqual([]);
    expect(host.appSnapshot(launch.launchId)).toBeUndefined();
    expect(host.launchCount).toBe(0);
    expect(changed).toHaveBeenCalledOnce();
  });
  it("tracks delayed spawn and failed launches without leaving stale entries", async () => {
    const host = new ManagedProcesses(async (pid) => row(pid));
    const child = new EventEmitter() as ChildProcess;
    host.launch(context, () => child);
    expect(await host.list()).toEqual([]);
    Object.assign(child, { pid: 10 });
    child.emit("spawn");
    expect(await host.list()).toHaveLength(1);
    child.emit("exit");
    expect(host.launchCount).toBe(0);
    const failed = new EventEmitter() as ChildProcess;
    host.launch(context, () => failed);
    failed.emit("error", new Error("ENOENT"));
    expect(host.launchCount).toBe(0);
    expect(() =>
      host.launch(context, () => {
        throw new Error("spawn failed");
      }),
    ).toThrow("spawn failed");
    expect(host.launchCount).toBe(0);
  });
  it("cannot resurrect an entry when identity capture finishes after exit", async () => {
    let resolve!: (value: ProcessRow) => void;
    const host = new ManagedProcesses(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const launch = host.prepare(context);
    const child = Object.assign(new EventEmitter(), { pid: 10 });
    host.track(child, context, launch.launchId);
    child.emit("exit");
    resolve(row(10));
    expect(await host.list()).toEqual([]);
    expect(host.launchCount).toBe(0);
  });
  it("rejects another project's Stop before discovering or signalling descendants", async () => {
    const { host, inspect, descendants, signal } = setup();
    const [entry] = await host.list();
    inspect.mockClear();
    await expect(host.kill(entry!.id, async () => false)).rejects.toThrow("another project");
    expect(inspect).not.toHaveBeenCalled();
    expect(descendants).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  });
  it("checks PID birth identity before Stop and refuses a recycled PID", async () => {
    const { host, rows, signal, descendants } = setup();
    const [entry] = await host.list();
    rows.set(10, row(10, 1, "new-birth"));
    expect(await host.kill(entry!.id, async () => true)).toBe(false);
    expect(signal).not.toHaveBeenCalled();
    expect(descendants).not.toHaveBeenCalled();
    expect(await host.list()).toEqual([]);
  });
  it("discovers only the chosen launch's current tree on Stop and leaves unrelated processes alone", async () => {
    const { host, rows, signal, descendants } = setup();
    rows.set(12, row(12, 11));
    const [entry] = await host.list();
    expect(await host.kill(entry!.id, async () => true)).toBe(true);
    expect(signal.mock.calls.map(([pid]) => pid)).toEqual([10, 11, 12]);
    expect(descendants.mock.calls.map(([pid]) => pid)).toEqual([10, 11, 12]);
    expect(rows.has(99)).toBe(true);
  });
  it("revalidates each descendant immediately before signalling", async () => {
    const { host, rows, signal, descendants } = setup();
    descendants.mockImplementation(async (pid) => {
      if (pid === 11) rows.set(11, row(11, 1, "reused"));
      return pid === 10 ? [11] : [];
    });
    const [entry] = await host.list();
    await host.kill(entry!.id, async () => true);
    expect(signal.mock.calls.map(([pid]) => pid)).toEqual([10]);
  });
  it("fails closed when launch identity cannot be captured and reports signal permission failures", async () => {
    const { host, rows, signal } = setup();
    const [entry] = await host.list();
    signal.mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EPERM" });
    });
    await expect(host.kill(entry!.id, async () => true)).rejects.toThrow("Could not kill PID 10");
    const other = new ManagedProcesses(async () => undefined, signal);
    const launch = other.prepare(context);
    other.track(Object.assign(new EventEmitter(), { pid: 20 }), context, launch.launchId);
    await expect(other.kill((await other.list())[0]!.id, async () => true)).rejects.toThrow("Could not verify PID 20");
    expect(rows.has(10)).toBe(true);
  });
});

describe.skipIf(process.platform !== "linux")("real Linux subprocess lifecycle", () => {
  it("stops a recorded launcher and its current children without registering unrelated processes", async () => {
    const host = new ManagedProcesses();
    const directory = await mkdtemp(path.join(os.tmpdir(), "hatopad-process-test-"));
    let childPid: number | undefined;
    try {
      const marker = path.join(directory, "pid");
      const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));setInterval(()=>{},1000);`;
      const root = host.launch(context, (env) => spawn(process.execPath, ["-e", script], { env, stdio: "ignore" }));
      children.push(root);
      const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
      children.push(unrelated);
      for (let i = 0; i < 100; i++) {
        childPid = await readFile(marker, "utf8")
          .then(Number)
          .catch(() => undefined);
        if (childPid) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(childPid).toBeTruthy();
      const [entry] = await host.list();
      expect((await host.list()).map((item) => item.pid)).toEqual([root.pid]);
      const exited = once(root, "exit");
      await host.kill(entry!.id, async () => true);
      await exited;
      expect(await host.list()).toEqual([]);
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
      await vi.waitFor(async () => {
        const state = await readFile(`/proc/${childPid}/stat`, "utf8").catch(() => "");
        expect(!state || state.split(") ")[1]?.startsWith("Z")).toBe(true);
      });
    } finally {
      if (childPid) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {}
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
