import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { stateHome } from "./state-home.js";

export type WorkspaceMigrationOptions = { source: string; destination: string; stateDirectory?: string; home?: string };
export type WorkspaceMigrationPreview = {
  source: string;
  destination: string;
  stateEntries: number;
  taskWorkspaces: number;
  completed?: boolean;
};
class RestoredMigrationError extends Error {
  readonly restored = true;
}
type Move = { from: string; to: string; metadata?: boolean };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const exists = async (file: string) => {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
};
const names = async (directory: string) => {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};
const within = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);

function parseMetadataJson(content: string, file: string): any {
  try {
    return JSON.parse(content);
  } catch {
    throw Error(
      `Cannot parse HatoPad metadata file ${file}. Fix its JSON or restore the file before retrying migration.`,
    );
  }
}

async function planMigration(options: WorkspaceMigrationOptions): Promise<{
  source: string;
  destination: string;
  state: string;
  receipt: string;
  moves: Move[];
  paths: Move[];
  preview: WorkspaceMigrationPreview;
}> {
  if (
    !path.isAbsolute(options.source) ||
    !path.isAbsolute(options.destination) ||
    /[\0\r\n]/.test(options.source + options.destination)
  )
    throw Error("Use absolute directory paths without line breaks.");
  const source = path.resolve(options.source);
  const destination = path.join(await realpath(path.dirname(options.destination)), path.basename(options.destination));
  if (within(source, destination) || within(destination, source))
    throw Error("Choose a destination outside the current project directory.");
  const home = stateHome(options.home);
  const state = path.resolve(options.stateDirectory ?? process.env.HATOPAD_STATE_DIR ?? path.join(home, "workspaces"));
  if (within(home, destination) || within(state, destination))
    throw Error("Choose a destination outside HatoPad’s state directory.");
  const receipt = path.join(state, "migrations", hash(source + "\0" + destination));
  if (!(await exists(source)) && (await exists(path.join(receipt, "complete.json")))) {
    const result = JSON.parse(await readFile(path.join(receipt, "complete.json"), "utf8")) as WorkspaceMigrationPreview;
    if (result.source !== source || result.destination !== destination || !(await exists(destination)))
      throw Error("The previous migration needs manual recovery; its destination is unavailable.");
    return {
      source,
      destination,
      state,
      receipt,
      moves: [] as Move[],
      paths: [] as Move[],
      preview: { ...result, completed: true },
    };
  }
  if ((await exists(receipt)) && !(await exists(path.join(receipt, "complete.json"))))
    throw Error(`An earlier migration needs recovery. Inspect ${receipt}/journal.json before retrying.`);
  if ((await lstat(source)).isSymbolicLink() || (await realpath(source)) !== source)
    throw Error("Migrate the real project directory rather than a symbolic link.");
  if (!(await stat(source)).isDirectory()) throw Error("The project directory is unavailable.");
  if (await exists(destination))
    throw Error("The destination already exists. Choose a new directory name; existing folders are never overwritten.");
  if ((await stat(source)).dev !== (await stat(path.dirname(destination))).dev)
    throw Error("Choose a destination on the same filesystem. Moving projects between disks is not supported yet.");
  if (within(source, state) || within(source, home))
    throw Error("The project cannot contain HatoPad's state directory.");
  if ((await exists(path.join(source, ".git"))) && !(await lstat(path.join(source, ".git"))).isDirectory())
    throw Error("This project is a linked Git worktree or submodule. Migrate its main repository instead.");

  if (within(state, source) || within(home, source))
    throw Error("Projects inside HatoPad's state directory cannot be migrated.");
  const paths: Move[] = [{ from: source, to: destination }];
  const groups = options.stateDirectory || process.env.HATOPAD_STATE_DIR ? state : path.join(home, "workspace-groups");
  const groupFile = path.join(groups, `roots-${hash(source).slice(0, 20)}.json`);
  if (await exists(groupFile)) {
    const group = parseMetadataJson(await readFile(groupFile, "utf8"), groupFile);
    for (const root of group.roots ?? []) {
      if (typeof root.path === "string" && root.path !== source && within(source, root.path))
        paths.push({ from: root.path, to: destination + root.path.slice(source.length) });
    }
  }
  let taskWorkspaces = 0;
  // Each moved root has its own tasks and per-task sessions/checkpoints.
  for (const root of [...paths]) {
    const from = path.join(state, `${hash(root.from)}-tasks`),
      to = path.join(state, `${hash(root.to)}-tasks`);
    paths.push({ from, to });
    const workspaces = (await names(from))
      .filter((id) => id !== "integrations")
      .map((id) => path.join(id, "workspace"));
    for (const id of await names(path.join(from, "integrations")))
      workspaces.push(path.join("integrations", id, "workspace"));
    for (const relative of workspaces) {
      const workspace = path.join(from, relative);
      if (await exists(workspace)) {
        paths.push({ from: workspace, to: path.join(to, relative) });
        taskWorkspaces++;
      }
    }
  }
  const moves: Move[] = [];
  const containers = [
    state,
    ...["agents/local", "skills/local", "useful-files/local", "run-configs/local", "harnesses", "mcp", "trash"].map(
      (name) => path.join(state, name),
    ),
  ];
  for (const container of containers) {
    for (const name of await names(container)) {
      for (const entry of paths) {
        const destinationKey = hash(entry.to);
        if (name === destinationKey || name.startsWith(destinationKey + "-") || name.startsWith(destinationKey + "."))
          throw Error(`Saved state already exists for the destination: ${path.join(container, name)}`);
        const key = hash(entry.from);
        if (name !== key && !name.startsWith(key + "-") && !name.startsWith(key + ".")) continue;
        const move = {
          from: path.join(container, name),
          to: path.join(container, hash(entry.to) + name.slice(key.length)),
          // Bridge traffic, user files and unknown stores move verbatim, even when named .json.
          metadata:
            container === state
              ? /\.json(?:\.bak)?$/.test(name) || /-(sessions|tasks|task-history)$/.test(name)
              : container === path.join(state, "harnesses") || container === path.join(state, "mcp"),
        };
        if (await exists(move.to)) throw Error(`Saved state already exists for the destination: ${move.to}`);
        moves.push(move);
        break;
      }
    }
  }
  const destinationGroupFile = path.join(groups, `roots-${hash(destination).slice(0, 20)}.json`);
  if (await exists(destinationGroupFile))
    throw Error(`Saved state already exists for the destination: ${destinationGroupFile}`);
  if (await exists(groupFile)) moves.push({ from: groupFile, to: destinationGroupFile, metadata: true });
  for (const move of moves)
    if (await exists(move.to)) throw Error(`Saved state already exists for the destination: ${move.to}`);
  return {
    source,
    destination,
    state,
    receipt,
    paths,
    moves,
    preview: { source, destination, stateEntries: moves.length, taskWorkspaces },
  };
}

/** Read-only validation. Gateway stops Core before invoking the move itself. */
export async function previewWorkspaceMigration(
  options: WorkspaceMigrationOptions,
): Promise<WorkspaceMigrationPreview> {
  return (await planMigration(options)).preview;
}

/** Offline migration: rename on one filesystem, rekey owned state, and retain a recovery journal. */
export async function migrateWorkspace(options: WorkspaceMigrationOptions): Promise<WorkspaceMigrationPreview> {
  const plan = await planMigration(options);
  if (plan.preview.completed) return plan.preview;
  const { source, destination, moves, paths, receipt } = plan;
  await mkdir(path.dirname(receipt), { recursive: true, mode: 0o700 });
  // Moving back and forth is allowed; retain each completed move's original backups.
  if (await exists(receipt)) await rename(receipt, `${receipt}.previous-${randomUUID()}`);
  await mkdir(receipt, { mode: 0o700 }); // Exclusive; also prevents replay of an interrupted transaction.
  const moved: Move[] = [];
  const edits: { file: string; backup?: string; link?: string }[] = [];
  const journal = async (phase: string) =>
    writeFile(
      path.join(receipt, "journal.json"),
      JSON.stringify({ phase, source, destination, moved, edits }, null, 2),
      { mode: 0o600 },
    );
  const mapping = [...paths].sort((a, b) => b.from.length - a.from.length);
  const remap = (value: string): string => {
    for (const entry of mapping) {
      if (within(entry.from, value)) return entry.to + value.slice(entry.from.length);
      if (value === `root_${hash(entry.from).slice(0, 16)}`) return `root_${hash(entry.to).slice(0, 16)}`;
    }
    return value;
  };
  const pathFields = new Set([
    "path",
    "workspace",
    "rootWorkspace",
    "cwd",
    "directory",
    "integrationWorkspace",
    "openFiles",
    "pinnedFiles",
    "activeFile",
    "rootId",
    "selectedRootId",
    "id",
  ]);
  const rewrite = (value: unknown, field = ""): unknown => {
    if (typeof value === "string") return pathFields.has(field) ? remap(value) : value;
    if (Array.isArray(value)) return value.map((item) => rewrite(item, field));
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [remap(key), rewrite(item, key)]));
    return value;
  };
  const edit = async (file: string, content: string) => {
    if ((await readFile(file, "utf8")) === content) return;
    const backup = path.join(receipt, `file-${edits.length}`);
    await copyFile(file, backup);
    edits.push({ file, backup });
    await journal("updating-state");
    await writeFile(file, content);
  };
  // Only metadata is rewritten. Project files, checkpoint blobs and conversation prose stay byte-for-byte intact.
  const metadata = async (target: string) => {
    const info = await lstat(target);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of await names(target)) {
        if (["workspace", "blobs", "objects", ".git", "quarantine"].includes(name)) continue;
        await metadata(path.join(target, name));
      }
    } else if (info.isFile() && /\.json(?:\.bak)?$/.test(target)) {
      const original = await readFile(target, "utf8");
      const owner = moves.find((move) => within(move.to, target));
      const originalPath = owner ? owner.from + target.slice(owner.to.length) : target;
      const parsed = parseMetadataJson(original, originalPath);
      const updated = rewrite(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(updated))
        await edit(target, JSON.stringify(updated, null, 2) + "\n");
    }
  };
  const gitPointers = async (repository: string) => {
    const administrative = path.join(repository, ".git", "worktrees");
    for (const id of await names(administrative)) {
      const file = path.join(administrative, id, "gitdir");
      const value = (await readFile(file, "utf8")).trim();
      const pointerFile = remap(value);
      await edit(file, pointerFile + "\n");
      // Linked worktrees can live outside HatoPad's task store; repair their forward pointers too.
      if (await exists(pointerFile)) {
        const pointer = await readFile(pointerFile, "utf8");
        if (!pointer.startsWith("gitdir: ")) throw Error(`Invalid Git worktree pointer: ${pointerFile}`);
        await edit(pointerFile, `gitdir: ${remap(pointer.slice(8).trim())}\n`);
      }
    }
  };
  try {
    await journal("moving");
    for (const move of [{ from: source, to: destination }, ...moves]) {
      // Record intent before renaming so even process interruption leaves a usable journal.
      moved.push(move);
      await journal("moving");
      try {
        await rename(move.from, move.to);
      } catch (error) {
        moved.pop();
        throw error;
      }
    }
    for (const move of moves) if (move.metadata) await metadata(move.to);
    for (const root of paths.filter((entry) => within(source, entry.from))) await gitPointers(root.to);
    for (const entry of paths.filter(
      (entry) => entry.from.endsWith(path.sep + "workspace") && !within(source, entry.from),
    )) {
      const git = path.join(entry.to, ".git");
      if ((await exists(git)) && (await lstat(git)).isFile()) {
        const pointer = await readFile(git, "utf8");
        if (!pointer.startsWith("gitdir: ")) throw Error(`Invalid task Git pointer: ${git}`);
        await edit(git, `gitdir: ${remap(pointer.slice(8).trim())}\n`);
      }
      // Repair absolute dependency links in task workspaces without changing project files.
      for (const name of await names(entry.to)) {
        const link = path.join(entry.to, name);
        if (!(await lstat(link)).isSymbolicLink()) continue;
        const previous = await readlink(link),
          next = remap(previous);
        if (previous === next) continue;
        edits.push({ file: link, link: previous });
        await journal("updating-state");
        await unlink(link);
        await symlink(next, link);
      }
    }
    await writeFile(path.join(receipt, "complete.json"), JSON.stringify(plan.preview), { mode: 0o600 });
    await journal("complete");
    return plan.preview;
  } catch (error) {
    const failures: unknown[] = [];
    for (const item of [...edits].reverse()) {
      try {
        if (item.backup) await copyFile(item.backup, item.file);
        else {
          await rm(item.file, { force: true });
          await symlink(item.link!, item.file);
        }
      } catch (failure) {
        failures.push(failure);
      }
    }
    for (const move of [...moved].reverse()) {
      try {
        await rename(move.to, move.from);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      await journal("recovery-required");
      throw Error(
        `Migration failed and needs recovery. Keep the backup at ${receipt}. Original error: ${String(error)}`,
      );
    }
    await rm(receipt, { recursive: true, force: true });
    throw new RestoredMigrationError(
      `Migration cancelled; the original project and state were restored. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
