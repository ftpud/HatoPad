import { stateHome } from "./state-home.js";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants, openSync, statSync, type Stats } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TriggerFireRecord, TriggerFileEvent, TriggerInput, WorkspaceTrigger } from "@hatopad/protocol";
import { CoreError } from "./errors.js";
import { serializedStateMutation } from "./root-mutation.js";
import { validateScheduledAction } from "./schedules.js";

const execFileAsync = promisify(execFile);
const FILE_EVENTS: readonly TriggerFileEvent[] = ["created", "changed", "deleted"];
const DEFAULT_DEBOUNCE_SECONDS = 2;
const DEFAULT_MAX_FIRES_PER_HOUR = 20;
const MAX_EVENT_DATA = 8_000;
const POLL_INTERVAL_MS = 1_000;

export type TriggerEvent = { description: string; data?: string };
/** `skipped` means the target was busy: nothing was started and the trigger stays armed. */
export type TriggerDelivery = { workflowRunId?: string; skipped?: string };

export function validateTrigger(input: TriggerInput): void {
  if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 180)
    throw new CoreError("INVALID_REQUEST", "A trigger needs a name of at most 180 characters");
  const source = input.source;
  if (!source || !["file", "fifo"].includes(source.type))
    throw new CoreError("INVALID_REQUEST", "Choose a file or pipe to watch");
  if (typeof source.path !== "string" || !source.path.trim() || source.path.length > 4096 || source.path.includes("\0"))
    throw new CoreError("INVALID_REQUEST", "Enter the path to watch");
  if (
    source.type === "file" &&
    (!Array.isArray(source.events) ||
      !source.events.length ||
      source.events.some((event) => !FILE_EVENTS.includes(event)))
  )
    throw new CoreError("INVALID_REQUEST", "Choose at least one file event");
  if (input.taskId !== undefined && (typeof input.taskId !== "string" || !input.taskId))
    throw new CoreError("INVALID_REQUEST", "Choose a valid task");
  if (
    input.debounceSeconds !== undefined &&
    (!Number.isInteger(input.debounceSeconds) || input.debounceSeconds < 0 || input.debounceSeconds > 3600)
  )
    throw new CoreError("INVALID_REQUEST", "Quiet period must be between 0 and 3600 seconds");
  if (
    input.maxFiresPerHour !== undefined &&
    (!Number.isInteger(input.maxFiresPerHour) || input.maxFiresPerHour < 1 || input.maxFiresPerHour > 1000)
  )
    throw new CoreError("INVALID_REQUEST", "Hourly limit must be between 1 and 1000");
  validateScheduledAction(input.action);
}

function revision(value: object): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type StoredTrigger = WorkspaceTrigger & { history?: TriggerFireRecord[]; recentFireTimes?: number[] };
type TriggerFile = { triggers: StoredTrigger[] };

/**
 * Reactive counterpart of the schedule service: instead of a due time, a trigger fires when a watched
 * file changes or when data arrives on a named pipe. Quiet-period debouncing, a no-overlap rule and an
 * hourly fire cap keep an agent that edits the file it is triggered by from looping forever.
 */
export class TriggerService {
  private readonly file: string;
  private triggers: StoredTrigger[] = [];
  private readonly disarmers = new Map<string, () => void>();
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; event: TriggerEvent }>();
  private readonly running = new Set<string>();
  private readonly fireTimes = new Map<string, number[]>();
  private readonly epochs = new Map<string, number>();
  private readonly pendingFires = new Set<Promise<boolean>>();
  private writes: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    rootWorkspace: string,
    private readonly deliver: (
      trigger: WorkspaceTrigger,
      event: TriggerEvent,
      active: () => boolean,
    ) => Promise<TriggerDelivery>,
    private readonly changed: () => void,
    stateDirectory = process.env.HATOPAD_STATE_DIR ?? stateHome(),
  ) {
    this.file = path.join(
      stateDirectory,
      `${crypto.createHash("sha256").update(rootWorkspace).digest("hex")}-triggers.json`,
    );
  }

  async start(): Promise<void> {
    this.assertOpen();
    this.triggers = await this.read();
    for (const trigger of this.triggers) {
      this.fireTimes.set(
        trigger.id,
        (trigger.recentFireTimes ?? []).filter((time) => Date.now() - time < 3_600_000),
      );
      void this.arm(trigger);
    }
  }

  list(includeRevision = false): WorkspaceTrigger[] {
    return this.triggers
      .map((trigger) => {
        const { history: _history, recentFireTimes: _times, ...record } = trigger;
        const recent = (this.fireTimes.get(trigger.id) ?? []).filter((time) => Date.now() - time < 3_600_000);
        return structuredClone({
          ...record,
          ...(includeRevision
            ? {
                revision: revision(trigger),
                recentFires: recent.length,
                firing: this.running.has(trigger.id),
                ...(recent[0] !== undefined ? { capResetsAt: new Date(recent[0] + 3_600_000).toISOString() } : {}),
              }
            : {}),
        });
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async history(
    id: string,
    limit = 25,
    before?: string,
  ): Promise<{ entries: TriggerFireRecord[]; nextBefore?: string }> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (before !== undefined && (typeof before !== "string" || before.length > 128))
    )
      throw new CoreError("INVALID_REQUEST", "Choose a valid trigger history page");
    const trigger = (await this.read()).find((item) => item.id === id);
    if (!trigger) throw new CoreError("FILE_NOT_FOUND", "Trigger no longer exists");
    const records = trigger.history ?? [];
    const end = before === undefined ? records.length : records.findIndex((item) => item.id === before);
    if (end < 0) throw new CoreError("INVALID_REQUEST", "Trigger history changed; refresh the latest page");
    const start = Math.max(0, end - limit);
    return { entries: records.slice(start, end).reverse(), ...(start > 0 ? { nextBefore: records[start]!.id } : {}) };
  }

  /** `input.source.path` must already be absolute. */
  async create(rootId: string, input: TriggerInput): Promise<WorkspaceTrigger> {
    this.assertOpen();
    if (typeof rootId !== "string" || !rootId.trim())
      throw new CoreError("INVALID_REQUEST", "Trigger root must be a nonempty ID");
    validateTrigger(input);
    if (!path.isAbsolute(input.source.path)) throw new CoreError("INVALID_REQUEST", "Trigger paths must be absolute");
    if (input.source.type === "fifo") await ensureFifo(input.source.path);
    const trigger: WorkspaceTrigger = {
      ...structuredClone(input),
      name: input.name.trim(),
      id: crypto.randomUUID(),
      rootId,
      enabled: true,
      createdAt: new Date().toISOString(),
      fireCount: 0,
    };
    await this.mutate((items) => [...items, trigger]);
    void this.arm(trigger);
    return structuredClone(trigger);
  }

  /** Replaces a trigger's definition (used by the configuration interface); counters and history are kept. */
  async update(
    id: string,
    input: TriggerInput,
    enabled: boolean,
    expectedRevision?: string,
    rootId?: string,
  ): Promise<WorkspaceTrigger> {
    this.assertOpen();
    validateTrigger(input);
    if (!path.isAbsolute(input.source.path)) throw new CoreError("INVALID_REQUEST", "Trigger paths must be absolute");
    if (!this.triggers.some((item) => item.id === id))
      throw new CoreError("FILE_NOT_FOUND", "Trigger no longer exists");
    if (input.source.type === "fifo") await ensureFifo(input.source.path);
    if (typeof enabled !== "boolean") throw new CoreError("INVALID_REQUEST", "Enabled must be a boolean");
    await this.mutate((items) => {
      const previous = items.find((item) => item.id === id && (rootId === undefined || item.rootId === rootId));
      if (!previous) throw new CoreError("FILE_NOT_FOUND", "Trigger no longer exists in this root");
      if ((expectedRevision !== undefined && revision(previous) !== expectedRevision) || this.running.has(id))
        throw new CoreError("INVALID_REQUEST", "Trigger changed or is firing; refresh before editing");
      return items.map((item) =>
        item.id === id
          ? {
              ...structuredClone(input),
              name: input.name.trim(),
              id,
              rootId: item.rootId,
              createdAt: item.createdAt,
              fireCount: item.fireCount,
              ...(item.history ? { history: item.history } : {}),
              ...(item.recentFireTimes ? { recentFireTimes: item.recentFireTimes } : {}),
              enabled,
              ...(item.lastFiredAt ? { lastFiredAt: item.lastFiredAt } : {}),
              ...(item.lastEvent ? { lastEvent: item.lastEvent } : {}),
              ...(item.lastWorkflowRunId ? { lastWorkflowRunId: item.lastWorkflowRunId } : {}),
            }
          : item,
      );
    });
    const trigger = this.triggers.find((item) => item.id === id);
    if (!trigger) throw new CoreError("FILE_NOT_FOUND", "Trigger no longer exists");
    this.cancel(id);
    void this.arm(trigger);
    return this.list(true).find((item) => item.id === id)!;
  }

  async setEnabled(id: string, enabled: boolean): Promise<WorkspaceTrigger> {
    this.assertOpen();
    if (typeof enabled !== "boolean") throw new CoreError("INVALID_REQUEST", "Enabled must be a boolean");
    this.cancel(id);
    await this.mutate((items) =>
      items.map((item) => (item.id === id ? { ...item, enabled, lastError: undefined } : item)),
    );
    const trigger = this.triggers.find((item) => item.id === id);
    if (!trigger) throw new CoreError("FILE_NOT_FOUND", "Trigger no longer exists");
    if (enabled && trigger.source.type === "fifo") await ensureFifo(trigger.source.path);
    void this.arm(trigger);
    return structuredClone(trigger);
  }

  async delete(id: string): Promise<boolean> {
    this.assertOpen();
    this.cancel(id);
    let exists = false;
    await this.mutate((items) => {
      exists = items.some((item) => item.id === id);
      return items.filter((item) => item.id !== id);
    });
    this.fireTimes.delete(id);
    return exists;
  }

  /** Runs the action now regardless of the quiet period and hourly cap (used for "Run now"). */
  fire(id: string): Promise<boolean> {
    return this.track(this.fireNow(id, { description: "manual run" }, true));
  }

  close(): Promise<void> {
    this.closed = true;
    for (const id of [...this.disarmers.keys()]) this.cancel(id);
    for (const id of [...this.pending.keys()]) this.cancel(id);
    return (async () => {
      const results = await Promise.allSettled([...this.pendingFires, this.writes]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          "Trigger work could not be drained",
        );
    })();
  }

  private assertOpen(): void {
    if (this.closed) throw new CoreError("INVALID_REQUEST", "Triggers are shutting down");
  }
  private track(fire: Promise<boolean>): Promise<boolean> {
    this.pendingFires.add(fire);
    void fire.finally(() => this.pendingFires.delete(fire)).catch(() => undefined);
    return fire;
  }

  /** Stops watching and discards any event still waiting out its quiet period. */
  private cancel(id: string): void {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    this.disarmers.get(id)?.();
    this.disarmers.delete(id);
    const waiting = this.pending.get(id);
    if (waiting) clearTimeout(waiting.timer);
    this.pending.delete(id);
  }

  private async arm(trigger: WorkspaceTrigger): Promise<void> {
    if (this.closed || !trigger.enabled) return;
    this.disarmers.get(trigger.id)?.();
    try {
      this.disarmers.set(
        trigger.id,
        trigger.source.type === "file" ? this.watchPath(trigger, trigger.source.events) : this.watchPipe(trigger),
      );
    } catch (error) {
      await this.mutate((items) =>
        items.map((item) =>
          item.id === trigger.id
            ? {
                ...item,
                enabled: false,
                lastError: `Could not watch ${trigger.source.path}: ${error instanceof Error ? error.message : String(error)}`,
              }
            : item,
        ),
      ).catch(() => undefined);
    }
  }

  /** Polls with an explicit baseline taken now, so a file that appears right after arming is never missed. */
  private watchPath(trigger: WorkspaceTrigger, events: TriggerFileEvent[]): () => void {
    const target = trigger.source.path;
    type Snapshot = { mtimeMs: number; size: number; ino: number } | undefined;
    const snapshot = (stats: Stats | undefined): Snapshot =>
      stats && { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino };
    let previous: Snapshot;
    try {
      previous = snapshot(statSync(target));
    } catch {
      previous = undefined;
    }
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void stat(target)
        .catch(() => undefined)
        .then((stats) => {
          const current = snapshot(stats);
          const event: TriggerFileEvent | undefined =
            !previous && current
              ? "created"
              : previous && !current
                ? "deleted"
                : previous &&
                    current &&
                    (current.mtimeMs !== previous.mtimeMs ||
                      current.size !== previous.size ||
                      current.ino !== previous.ino)
                  ? "changed"
                  : undefined;
          previous = current;
          if (event && events.includes(event)) this.queue(trigger.id, { description: `${event}: ${target}` });
        })
        .finally(() => {
          polling = false;
        });
    }, POLL_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** O_RDWR keeps the pipe open without a writer, so opening never blocks and readers never see EOF between writers. */
  private watchPipe(trigger: WorkspaceTrigger): () => void {
    const fd = openSync(trigger.source.path, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);
    const socket = new net.Socket({ fd, readable: true, writable: false });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) =>
      this.queue(trigger.id, { description: `data received on ${trigger.source.path}`, data: chunk }),
    );
    socket.on("error", (error) => {
      this.disarmers.delete(trigger.id);
      void this.mutate((items) =>
        items.map((item) =>
          item.id === trigger.id
            ? { ...item, enabled: false, lastError: `Pipe ${trigger.source.path} failed: ${error.message}` }
            : item,
        ),
      ).catch(() => undefined);
    });
    return () => socket.destroy();
  }

  private queue(id: string, event: TriggerEvent): void {
    const trigger = this.triggers.find((item) => item.id === id);
    if (this.closed || !trigger?.enabled) return;
    const waiting = this.pending.get(id);
    if (waiting) clearTimeout(waiting.timer);
    const merged: TriggerEvent = {
      description: event.description,
      ...(waiting?.event.data || event.data
        ? { data: `${waiting?.event.data ?? ""}${event.data ?? ""}`.slice(-MAX_EVENT_DATA) }
        : {}),
    };
    const timer = setTimeout(
      () => {
        this.pending.delete(id);
        void this.track(this.fireNow(id, merged, false)).catch((error) =>
          console.error("[core] trigger failed", error),
        );
      },
      (trigger.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS) * 1000,
    );
    timer.unref();
    this.pending.set(id, { timer, event: merged });
  }

  private async fireNow(id: string, event: TriggerEvent, manual: boolean): Promise<boolean> {
    const trigger = this.triggers.find((item) => item.id === id);
    if (this.closed || !trigger || (!manual && !trigger.enabled)) return false;
    if (this.running.has(id)) {
      if (!manual)
        await this.record(id, { lastSkipped: "Previous run is still being started" }, false, {
          event: event.description,
          status: "skipped-busy",
          reason: "Previous run is still being started",
        });
      return false;
    }
    if (!manual) {
      const now = Date.now();
      const limit = trigger.maxFiresPerHour ?? DEFAULT_MAX_FIRES_PER_HOUR;
      const recent = (this.fireTimes.get(id) ?? []).filter((time) => now - time < 3_600_000);
      this.fireTimes.set(id, recent);
      if (recent.length >= limit) {
        this.cancel(id);
        await this.record(
          id,
          {
            enabled: false,
            lastError: `Disabled: fired ${recent.length} times within an hour (limit ${limit}). Check for a feedback loop, then resume.`,
          },
          false,
          { event: event.description, status: "capped", reason: "Hourly cap reached" },
        );
        return false;
      }
    }
    const epoch = this.epochs.get(id) ?? 0;
    const active = () =>
      !this.closed && (manual || (this.epochs.get(id) ?? 0) === epoch) && this.triggers.some((item) => item.id === id);
    this.running.add(id);
    let result: TriggerDelivery;
    try {
      result = await this.deliver(structuredClone(trigger), event, active);
    } catch (error) {
      this.running.delete(id);
      await this.record(
        id,
        { lastError: error instanceof Error ? error.message : String(error), lastSkipped: undefined },
        false,
        { event: event.description, status: "failed", reason: "Delivery failed; inspect the current trigger state" },
      );
      return false;
    }
    // Release before bookkeeping so an event arriving while state is saved is not mistaken for an overlap.
    this.running.delete(id);
    if (result.skipped) {
      await this.record(id, { lastSkipped: result.skipped }, false, {
        event: event.description,
        status: "skipped-busy",
        reason: result.skipped,
      });
      return false;
    }
    if (!active()) return false;
    this.fireTimes.set(id, [...(this.fireTimes.get(id) ?? []), Date.now()]);
    await this.record(
      id,
      {
        lastFiredAt: new Date().toISOString(),
        lastEvent: event.description,
        lastSkipped: undefined,
        lastError: undefined,
        ...(result.workflowRunId ? { lastWorkflowRunId: result.workflowRunId } : {}),
      },
      true,
      { event: event.description, status: "started" },
    );
    return true;
  }

  private async record(
    id: string,
    patch: Partial<WorkspaceTrigger>,
    fired = false,
    history?: Pick<TriggerFireRecord, "event" | "status" | "reason">,
  ): Promise<void> {
    await this.mutate((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              ...(fired
                ? {
                    fireCount: item.fireCount + 1,
                    recentFireTimes: [
                      ...(item.recentFireTimes ?? []).filter((time) => Date.now() - time < 3_600_000),
                      Date.now(),
                    ].slice(-1000),
                  }
                : {}),
              ...(history
                ? {
                    history: [
                      ...(item.history ?? []),
                      {
                        id: crypto.randomUUID(),
                        at: new Date().toISOString(),
                        event: history.event.slice(0, 400),
                        status: history.status,
                        ...(history.reason ? { reason: history.reason.slice(0, 160) } : {}),
                      },
                    ].slice(-100),
                  }
                : {}),
            }
          : item,
      ),
    ).catch((error) => console.error("[core] could not save trigger state", error));
  }

  private async read(): Promise<StoredTrigger[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new CoreError(
        "READ_FAILED",
        `Could not read trigger state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const value = JSON.parse(text) as Partial<TriggerFile>;
      if (!value || !Array.isArray(value.triggers)) throw new Error("triggers must be an array");
      this.validateStored(value.triggers);
      return value.triggers;
    } catch (error) {
      throw new CoreError(
        "READ_FAILED",
        `Invalid trigger state in ${this.file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private validateStored(triggers: StoredTrigger[]): void {
    const ids = new Set<string>();
    for (const trigger of triggers) {
      if (!trigger || typeof trigger !== "object") throw new Error("trigger record must be an object");
      validateTrigger(trigger);
      if (
        typeof trigger.id !== "string" ||
        !trigger.id.trim() ||
        ids.has(trigger.id) ||
        typeof trigger.rootId !== "string" ||
        typeof trigger.enabled !== "boolean" ||
        !Number.isInteger(trigger.fireCount)
      )
        throw new Error("saved trigger identity, root, enabled or fireCount is invalid");
      if (
        trigger.history !== undefined &&
        (!Array.isArray(trigger.history) ||
          trigger.history.length > 100 ||
          trigger.history.some(
            (record) =>
              !record ||
              typeof record.id !== "string" ||
              typeof record.at !== "string" ||
              !Number.isFinite(Date.parse(record.at)) ||
              typeof record.event !== "string" ||
              record.event.length > 400 ||
              !["started", "skipped-busy", "capped", "failed"].includes(record.status) ||
              (record.reason !== undefined && (typeof record.reason !== "string" || record.reason.length > 160)),
          ))
      )
        throw new Error("saved trigger history is invalid");
      if (
        trigger.recentFireTimes !== undefined &&
        (!Array.isArray(trigger.recentFireTimes) ||
          trigger.recentFireTimes.length > 1000 ||
          trigger.recentFireTimes.some((time) => !Number.isSafeInteger(time) || time < 0))
      )
        throw new Error("saved trigger fire times are invalid");
      ids.add(trigger.id);
    }
  }

  private async mutate(update: (items: StoredTrigger[]) => StoredTrigger[]): Promise<void> {
    const write = this.writes
      .catch(() => undefined)
      .then(() =>
        serializedStateMutation(this.file, async () => {
          const items = update(await this.read());
          this.validateStored(items);
          await mkdir(path.dirname(this.file), { recursive: true });
          const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
          const handle = await open(temporary, "wx", 0o600);
          try {
            await handle.writeFile(`${JSON.stringify({ triggers: items }, null, 2)}\n`, "utf8");
            await handle.sync();
          } finally {
            await handle.close().catch(() => undefined);
          }
          try {
            await rename(temporary, this.file);
          } finally {
            await unlink(temporary).catch(() => undefined);
          }
          this.triggers = items;
          this.changed();
        }),
      );
    // Rejected optimistic edits are handled requests, not failed shutdown work.
    this.writes = write.catch((error) => {
      if (error instanceof CoreError && ["INVALID_REQUEST", "FILE_NOT_FOUND"].includes(error.code)) return;
      throw error;
    });
    void this.writes.catch(() => undefined);
    await write;
  }
}

/** Creates the named pipe when absent; refuses to reuse a path that is not one. */
async function ensureFifo(target: string): Promise<void> {
  if (process.platform === "win32")
    throw new CoreError("INVALID_REQUEST", "Named pipes (FIFO) are not supported on Windows");
  const existing = await stat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw new CoreError("READ_FAILED", `Could not inspect ${target}: ${error.message}`);
  });
  if (existing) {
    if (!existing.isFIFO()) throw new CoreError("INVALID_REQUEST", `${target} exists and is not a named pipe`);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await execFileAsync("mkfifo", ["-m", "600", target]);
  } catch (error) {
    throw new CoreError(
      "WRITE_FAILED",
      `Could not create named pipe ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
