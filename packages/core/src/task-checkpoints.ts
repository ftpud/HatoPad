import { metadataPage } from "./metadata-page.js";
import { stateHome } from "./state-home.js";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import type {
  AiProvider,
  TaskCheckpoint,
  TaskCheckpointFile,
  TaskCheckpointProvenance,
  TaskCheckpointSummary,
  TaskCheckpointApplyResult,
} from "@hatopad/protocol";
import { diffLines } from "diff";
import { CoreError } from "./errors.js";

const execFileAsync = promisify(execFile);
type SnapshotEntry = { hash: string; size: number; mode: number; symlink?: boolean; binary: boolean };
type StoredCheckpoint = Omit<TaskCheckpoint, "files"> & {
  before: Record<string, SnapshotEntry>;
  after?: Record<string, SnapshotEntry>;
};

/** Durable, Git-independent prompt snapshots. Blobs and manifests live in Core state, never in .git. */
export class TaskCheckpointStore {
  private readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();
  private secured?: Promise<void>;

  constructor(
    private readonly workspace: string,
    stateDirectory = process.env.HATOPAD_STATE_DIR ?? path.join(stateHome(), "workspaces"),
  ) {
    this.root = path.join(
      stateDirectory,
      `${crypto.createHash("sha256").update(path.resolve(workspace)).digest("hex")}-task-history`,
    );
  }

  begin(
    provider: AiProvider,
    prompt: string,
    sessionId?: string,
    promptId: string = crypto.randomUUID(),
    provenance?: TaskCheckpointProvenance,
  ): Promise<string> {
    return this.serial(async () => {
      const id = crypto.randomUUID();
      const checkpoint: StoredCheckpoint = {
        id,
        promptId,
        provider,
        prompt: redact(prompt).slice(0, 1_000),
        startedAt: new Date().toISOString(),
        status: "running",
        before: await this.capture(),
        ...(sessionId ? { sessionId } : {}),
        ...(provenance ? { provenance } : {}),
      };
      await this.write(checkpoint);
      await this.prune();
      return id;
    });
  }

  complete(
    id: string,
    status: "completed" | "interrupted" | "error",
    provenance?: Pick<TaskCheckpointProvenance, "usage">,
  ): Promise<void> {
    return this.serial(async () => {
      const checkpoint = await this.read(id);
      if (checkpoint.status !== "running") return;
      checkpoint.after = await this.capture();
      checkpoint.status = status;
      checkpoint.completedAt = new Date().toISOString();
      const commit = await this.head();
      checkpoint.provenance = { ...checkpoint.provenance, ...provenance, ...(commit ? { commit } : {}) };
      await this.write(checkpoint);
    });
  }

  /** A Core restart cannot resume an in-flight turn observer; close those points at startup. */
  recover(): Promise<void> {
    return this.serial(async () => {
      const running = (await this.all()).filter((item) => item.status === "running");
      if (running.length === 0) return;
      const after = await this.capture();
      for (const item of running) {
        item.after = after;
        item.status = "interrupted";
        item.completedAt = new Date().toISOString();
        await this.write(item);
      }
      await this.prune();
    });
  }

  async history(): Promise<TaskCheckpoint[]> {
    const checkpoints = await this.all();
    return checkpoints.map((item) => ({
      id: item.id,
      promptId: item.promptId,
      provider: item.provider,
      prompt: item.prompt,
      startedAt: item.startedAt,
      status: item.status,
      ...(item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(item.completedAt ? { completedAt: item.completedAt } : {}),
      ...(item.provenance ? { provenance: item.provenance } : {}),
      files: changes(item.before, item.after ?? item.before),
    }));
  }

  async summary(limit = 25, offset = 0): Promise<{ checkpoints: TaskCheckpointSummary[]; nextOffset?: number }> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10_000
    )
      throw new CoreError("INVALID_REQUEST", "Choose a valid checkpoint page");
    const all = await this.all();
    const checkpoints = await Promise.all(
      all.slice(offset, offset + limit).map(async (item) => {
        const files = changes(item.before, item.after ?? item.before);
        let additions = 0,
          deletions = 0,
          unknownCounts = 0;
        for (const file of files) {
          const before = item.before[file.originalPath ?? file.path],
            after = item.after?.[file.path];
          if (before?.binary || after?.binary || (before?.size ?? 0) + (after?.size ?? 0) > 512 * 1024) {
            unknownCounts++;
            continue;
          }
          const a = before ? (await this.blob(before.hash)).toString("utf8") : "";
          const b = after ? (await this.blob(after.hash)).toString("utf8") : "";
          const delta = diffLines(a, b, { timeout: 25, maxEditLength: 10_000 });
          if (!delta) {
            unknownCounts++;
            continue;
          }
          for (const part of delta) {
            if (part.added) additions += part.count;
            if (part.removed) deletions += part.count;
          }
        }
        return {
          id: item.id,
          promptId: item.promptId,
          provider: item.provider,
          ...(item.sessionId ? { sessionId: item.sessionId } : {}),
          startedAt: item.startedAt,
          ...(item.completedAt ? { completedAt: item.completedAt } : {}),
          status: item.status,
          fileCount: files.length,
          additions,
          deletions,
          unknownCounts,
        };
      }),
    );
    return { checkpoints, ...(offset + limit < all.length ? { nextOffset: offset + limit } : {}) };
  }

  async diff(
    id: string,
    filePath: string,
  ): Promise<{ originalContent: string; modifiedContent: string; binary: boolean; truncated: boolean }> {
    validatePath(filePath);
    const item = await this.read(id);
    const after = item.after ?? item.before;
    const change = changes(item.before, after).find((entry) => entry.path === filePath);
    if (!change) throw new CoreError("INVALID_REQUEST", "File is not part of that checkpoint");
    const beforeEntry = item.before[change.originalPath ?? filePath];
    const afterEntry = after[filePath];
    const binary = Boolean(beforeEntry?.binary || afterEntry?.binary);
    const originalContent = binary || !beforeEntry ? "" : (await this.blob(beforeEntry.hash)).toString("utf8");
    const modifiedContent = binary || !afterEntry ? "" : (await this.blob(afterEntry.hash)).toString("utf8");
    const limit = 256 * 1024;
    const truncated = originalContent.length > limit || modifiedContent.length > limit;
    return {
      originalContent: originalContent.slice(0, limit),
      modifiedContent: modifiedContent.slice(0, limit),
      binary,
      truncated,
    };
  }

  async files(
    id: string,
    direction: "apply" | "revert" = "apply",
    limit = 100,
    offset = 0,
  ): Promise<{ files: TaskCheckpointFile[]; totalFiles: number; nextOffset?: number }> {
    if (
      !["apply", "revert"].includes(direction) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1_000_000
    )
      throw new CoreError("INVALID_REQUEST", "Choose a valid checkpoint file page");
    const item = await this.read(id);
    const after = item.after ?? item.before;
    const files = direction === "revert" ? changes(after, item.before) : changes(item.before, after);
    const page = metadataPage(files, offset, limit);
    return {
      files: page.rows,
      totalFiles: files.length,
      ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
    };
  }

  /** Reverse only the captured changes; unrelated live edits are reported as conflicts. */
  revert(id: string, requestedPaths?: string[]): Promise<TaskCheckpointApplyResult> {
    return this.serial(async () => {
      const item = await this.read(id);
      if (!item.after) throw new CoreError("INVALID_REQUEST", "A running checkpoint cannot be reverted");
      const files = changes(item.after, item.before);
      if (
        requestedPaths !== undefined &&
        (!Array.isArray(requestedPaths) ||
          !requestedPaths.length ||
          requestedPaths.length > 100 ||
          requestedPaths.some((file) => typeof file !== "string"))
      )
        throw new CoreError("INVALID_REQUEST", "Select between one and 100 checkpoint files");
      const selected =
        requestedPaths === undefined ? files : files.filter((file) => requestedPaths.includes(file.path));
      if (requestedPaths && selected.length !== new Set(requestedPaths).size)
        throw new CoreError("INVALID_REQUEST", "A selected path is not part of that checkpoint");
      return this.applyAll(selected, item.after, item.before);
    });
  }

  /** Apply checkpoint changes safely. The Git index is intentionally never read or written. */
  review(
    id: string,
    requestedPaths: string[],
  ): Promise<{ applied: string[]; alreadyApplied: string[]; conflicts: { path: string; message: string }[] }> {
    return this.serial(async () => {
      const item = await this.read(id);
      if (!item.after) throw new CoreError("INVALID_REQUEST", "A running checkpoint cannot be restored");
      if (!Array.isArray(requestedPaths) || requestedPaths.length === 0 || requestedPaths.length > 100)
        throw new CoreError("INVALID_REQUEST", "Select between one and 100 checkpoint files");
      const changed = changes(item.before, item.after);
      const selected = changed.filter((change) => requestedPaths.includes(change.path));
      if (selected.length !== new Set(requestedPaths).size)
        throw new CoreError("INVALID_REQUEST", "A selected path is not part of that checkpoint");
      return this.applyAll(selected, item.before, item.after);
    });
  }

  restore(
    id: string,
  ): Promise<{ applied: string[]; alreadyApplied: string[]; conflicts: { path: string; message: string }[] }> {
    return this.serial(async () => {
      const item = await this.read(id);
      if (!item.after) throw new CoreError("INVALID_REQUEST", "A running checkpoint cannot be restored");
      return this.applyAll(changes(item.before, item.after), item.before, item.after);
    });
  }

  private async applyAll(
    selected: TaskCheckpointFile[],
    before: Record<string, SnapshotEntry>,
    after: Record<string, SnapshotEntry>,
  ) {
    const result = {
      applied: [] as string[],
      alreadyApplied: [] as string[],
      conflicts: [] as { path: string; message: string }[],
    };
    for (const change of selected) {
      try {
        await this.apply(change, before, after, result);
      } catch (error) {
        if (error instanceof CoreError && ["PATH_OUTSIDE_WORKSPACE", "CONFLICT"].includes(error.code))
          result.conflicts.push({
            path: change.path,
            message: "This path changed type or leaves the workspace; no changes were applied to it.",
          });
        else throw error;
      }
    }
    return result;
  }
  private async apply(
    change: TaskCheckpointFile,
    before: Record<string, SnapshotEntry>,
    after: Record<string, SnapshotEntry>,
    result: { applied: string[]; alreadyApplied: string[]; conflicts: { path: string; message: string }[] },
  ): Promise<void> {
    const oldPath = change.originalPath ?? change.path;
    const base = before[oldPath];
    const target = after[change.path];
    const current = await this.live(change.path);
    const oldCurrent = oldPath === change.path ? current : await this.live(oldPath);
    const equal = (a?: SnapshotEntry, b?: SnapshotEntry) =>
      a?.hash === b?.hash && a?.mode === b?.mode && a?.symlink === b?.symlink;
    const unavailable = () =>
      result.conflicts.push({
        path: change.path,
        message: "The checkpoint content for this file is unavailable; the current file was left unchanged.",
      });
    if (change.status === "R") {
      if (!equal(oldCurrent, base) || current) {
        result.conflicts.push({
          path: change.path,
          message: "The file was edited after this checkpoint; rename was not applied.",
        });
        return;
      }
      if (!(await this.writeEntry(change.path, target!))) return void unavailable();
      await rm(await this.checkedTarget(oldPath), { force: true });
      result.applied.push(change.path);
      return;
    }
    if (equal(current, target)) {
      result.alreadyApplied.push(change.path);
      return;
    }
    if (!equal(current, base)) {
      result.conflicts.push({
        path: change.path,
        message: "The file was edited after this checkpoint; review the three-way diff before resolving it.",
      });
      return;
    }
    if (target) {
      if (!(await this.writeEntry(change.path, target))) return void unavailable();
    } else await rm(await this.checkedTarget(change.path), { force: true });
    result.applied.push(change.path);
  }
  private async live(file: string): Promise<SnapshotEntry | undefined> {
    try {
      const full = await this.checkedTarget(file);
      const stat = await lstat(full);
      if (!stat.isFile() && !stat.isSymbolicLink()) throw new CoreError("CONFLICT", "Checkpoint path changed type");
      const content = stat.isSymbolicLink() ? Buffer.from(await readlink(full)) : await readFile(full);
      return {
        hash: crypto.createHash("sha256").update(content).digest("hex"),
        size: content.length,
        mode: stat.mode,
        ...(stat.isSymbolicLink() ? { symlink: true } : {}),
        binary: content.includes(0),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  /**
   * Publishes a snapshot entry only after its blob is read and verified; the replacement is staged beside the
   * destination and renamed over it, so a missing blob or failed write leaves the live file intact.
   * Returns false when the checkpoint content is unavailable.
   */
  private async writeEntry(file: string, entry: SnapshotEntry): Promise<boolean> {
    let content: Buffer;
    try {
      content = await this.blob(entry.hash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (crypto.createHash("sha256").update(content).digest("hex") !== entry.hash) return false;
    const destination = await this.checkedTarget(file);
    await mkdir(path.dirname(destination), { recursive: true });
    await this.checkedTarget(file);
    const staged = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.hatopad-${crypto.randomUUID()}`,
    );
    try {
      if (entry.symlink) await symlink(content.toString("utf8"), staged);
      else {
        await writeFile(staged, content, { flag: "wx", mode: 0o600 });
        await chmod(staged, entry.mode & 0o777);
      }
      await this.checkedTarget(file);
      await rename(staged, destination);
    } catch (error) {
      await rm(staged, { force: true }).catch(() => undefined);
      throw error;
    }
    return true;
  }

  private async capture(): Promise<Record<string, SnapshotEntry>> {
    const result: Record<string, SnapshotEntry> = {};
    for (const file of await this.managedPaths()) {
      try {
        const full = await this.checkedTarget(file);
        const stat = await lstat(full);
        if (!stat.isFile() && !stat.isSymbolicLink()) continue;
        const content = stat.isSymbolicLink() ? Buffer.from(await readlink(full)) : await readFile(full);
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        await this.directory("blobs");
        await writeFile(path.join(this.root, "blobs", hash), content, { flag: "wx", mode: 0o600 }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          },
        );
        result[file] = {
          hash,
          size: content.length,
          mode: stat.mode,
          ...(stat.isSymbolicLink() ? { symlink: true } : {}),
          binary: content.includes(0),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return result;
  }

  private async managedPaths(): Promise<string[]> {
    try {
      return (
        await execFileAsync(
          "git",
          ["-C", this.workspace, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        )
      ).stdout
        .split("\0")
        .filter(Boolean);
    } catch (error) {
      throw new CoreError(
        "GIT_FAILED",
        `Could not enumerate task files: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  private async head(): Promise<string | undefined> {
    try {
      return (
        await execFileAsync("git", ["-C", this.workspace, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" })
      ).stdout.trim();
    } catch {
      return undefined;
    }
  }
  private async checkedTarget(file: string): Promise<string> {
    const target = this.target(file),
      root = await realpath(this.workspace);
    let parent = path.dirname(target);
    for (;;) {
      try {
        const actual = await realpath(parent);
        if (actual !== root && !actual.startsWith(root + path.sep))
          throw new CoreError("PATH_OUTSIDE_WORKSPACE", "Checkpoint path leaves the workspace");
        return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const next = path.dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
  }
  private target(file: string): string {
    validatePath(file);
    const target = path.resolve(this.workspace, file);
    if (!target.startsWith(`${path.resolve(this.workspace)}${path.sep}`))
      throw new CoreError("INVALID_REQUEST", "Invalid checkpoint path");
    return target;
  }
  /**
   * Snapshot payloads can hold private workspace files, so history is owner-only regardless of the source mode
   * or umask. The first use also repairs state written by older Cores with default permissions.
   */
  private async directory(name: "blobs" | "checkpoints"): Promise<void> {
    this.secured ??= this.secure().catch((error: unknown) => {
      this.secured = undefined;
      throw error;
    });
    await this.secured;
    await mkdir(path.join(this.root, name), { recursive: true, mode: 0o700 });
  }
  private async secure(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    for (const name of ["blobs", "checkpoints"]) {
      const directory = path.join(this.root, name);
      let entries: string[];
      try {
        await chmod(directory, 0o700);
        entries = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) await chmod(path.join(directory, entry), 0o600).catch(() => undefined);
    }
  }
  private blob(hash: string): Promise<Buffer> {
    return readFile(path.join(this.root, "blobs", hash));
  }
  private file(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CoreError("INVALID_REQUEST", "Invalid checkpoint id");
    return path.join(this.root, "checkpoints", `${id}.json`);
  }
  private async read(id: string): Promise<StoredCheckpoint> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as StoredCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new CoreError("INVALID_REQUEST", "Checkpoint no longer exists");
      throw error;
    }
  }
  private async write(value: StoredCheckpoint): Promise<void> {
    await this.directory("checkpoints");
    await writeFile(this.file(value.id), JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  }
  private async all(): Promise<StoredCheckpoint[]> {
    try {
      const files = (await readdir(path.join(this.root, "checkpoints"))).filter((file) => file.endsWith(".json"));
      return (await Promise.all(files.map((file) => this.read(file.slice(0, -5))))).sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : Promise.reject(error);
    }
  }
  private async prune(): Promise<void> {
    const all = await this.all();
    const keep = new Set(
      [
        ...all.filter((item) => item.status === "running"),
        ...all.filter((item) => item.status !== "running").slice(0, 100),
      ].map((item) => item.id),
    );
    for (const item of all) if (!keep.has(item.id)) await rm(this.file(item.id), { force: true });
    const retained = all.filter((item) => keep.has(item.id));
    const hashes = new Set(
      retained.flatMap((item) =>
        [...Object.values(item.before), ...Object.values(item.after ?? {})].map((entry) => entry.hash),
      ),
    );
    try {
      for (const blob of await readdir(path.join(this.root, "blobs")))
        if (!hashes.has(blob)) await rm(path.join(this.root, "blobs", blob), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function changes(before: Record<string, SnapshotEntry>, after: Record<string, SnapshotEntry>): TaskCheckpointFile[] {
  const deleted = Object.entries(before).filter(([file, entry]) => !after[file] && entry);
  const added = Object.entries(after).filter(([file]) => !before[file]);
  const result: TaskCheckpointFile[] = [];
  const used = new Set<string>();
  for (const [oldPath, oldEntry] of deleted) {
    const renamed = added.find(([newPath, entry]) => !used.has(newPath) && entry.hash === oldEntry.hash);
    if (renamed) {
      used.add(renamed[0]);
      result.push({
        path: renamed[0],
        originalPath: oldPath,
        status: "R",
        binary: oldEntry.binary,
        size: oldEntry.size,
      });
    } else result.push({ path: oldPath, status: "D", binary: oldEntry.binary, size: oldEntry.size });
  }
  for (const [file, entry] of added)
    if (!used.has(file)) result.push({ path: file, status: "A", binary: entry.binary, size: entry.size });
  for (const [file, entry] of Object.entries(after))
    if (before[file] && (before[file]!.hash !== entry.hash || before[file]!.mode !== entry.mode))
      result.push({ path: file, status: "M", binary: entry.binary || before[file]!.binary, size: entry.size });
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function validatePath(file: string): void {
  if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
    throw new CoreError("INVALID_REQUEST", "Invalid checkpoint path");
}
function redact(value: string): string {
  return value
    .replace(/\b(?:sk|api|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]")
    .replace(/\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]");
}
