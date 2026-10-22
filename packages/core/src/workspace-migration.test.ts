import { WorkspaceRootRegistry } from "./workspace-roots.js";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink, readlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migrateWorkspace, previewWorkspaceMigration, listMigrationWorkspaces } from "./workspace-migration.js";
import { WorkspaceTaskStore } from "./tasks.js";
import { WorkspaceStateStore } from "./workspace-state.js";

const exec = promisify(execFile);
const key = (value: string) => createHash("sha256").update(value).digest("hex");
const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((file) => rm(file, { recursive: true, force: true })));
});
async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "hatopad-migration-"));
  fixtures.push(base);
  const source = path.join(base, "old project"),
    destination = path.join(base, "new project's home"),
    stateDirectory = path.join(base, "state");
  await mkdir(source);
  await mkdir(stateDirectory);
  const git = (...args: string[]) => exec("git", ["-C", source, ...args]);
  await git("init", "--quiet");
  await writeFile(path.join(source, "project.json"), '{"path":"must stay unchanged"}\n');
  await git("add", ".");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "Initial");
  return { source, destination, stateDirectory, home: base };
}
async function json(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

describe("offline workspace migration", () => {
  it("preserves real task worktrees, uncommitted files, sessions, checkpoints and local settings", async () => {
    const options = await fixture();
    const { source, destination, stateDirectory: state } = options;
    const store = new WorkspaceTaskStore(source, state);
    const task = await store.create("feature/migrate");
    const oldTask = store.taskPath(task.id);
    const external = path.join(path.dirname(source), "external-worktree");
    await exec("git", ["-C", source, "worktree", "add", "--quiet", "-b", "external", external, "HEAD"]);
    await writeFile(path.join(oldTask, "uncommitted.txt"), "still here");
    await mkdir(path.join(source, "dependencies"));
    await symlink(path.join(source, "dependencies"), path.join(oldTask, "linked-dependencies"));
    await new WorkspaceStateStore(source, state).save({ openFiles: ["project.json"] });
    await json(path.join(state, `${key(oldTask)}-codex.json`), {
      workspace: oldTask,
      sessionId: "native-session",
      messages: [{ text: source + "/keep-this-prose" }],
    });
    await json(path.join(state, "harnesses", key(source), "runs.json"), {
      runs: [{ binding: { workspace: oldTask, rootWorkspace: source } }],
    });
    await json(path.join(state, "mcp", key(source), "servers.json"), [{ cwd: source, name: "server" }]);
    await mkdir(path.join(state, "run-configs", "local", key(source)), { recursive: true });
    await writeFile(path.join(state, "run-configs", "local", key(source), "build.sh"), "npm run build\n", {
      mode: 0o700,
    });
    await mkdir(path.join(state, `${key(oldTask)}-task-history`, "blobs"), { recursive: true });
    await writeFile(path.join(state, `${key(oldTask)}-task-history`, "blobs", "raw"), source);
    const nestedRoot = path.join(source, "nested");
    await mkdir(nestedRoot);
    await json(path.join(state, `roots-${key(source).slice(0, 20)}.json`), {
      version: 1,
      roots: [{ id: `root_${key(nestedRoot).slice(0, 16)}`, path: nestedRoot, alias: "Nested", primary: false }],
    });
    const trashed = path.join(state, "trash", key(source), "deleted", "payload", "project.json");
    await json(trashed, { path: source });
    const unrelated = path.join(state, "unrelated.json");
    await writeFile(unrelated, source);
    const preview = await previewWorkspaceMigration(options);
    expect(preview.taskWorkspaces).toBe(1);
    await expect(access(source)).resolves.toBeUndefined();
    await expect(access(destination)).rejects.toThrow();
    await migrateWorkspace(options);
    const newStore = new WorkspaceTaskStore(destination, state);
    expect((await newStore.list()).tasks.map((item) => item.id)).toContain(task.id);
    const newTask = newStore.taskPath(task.id);
    expect((await exec("git", ["-C", external, "rev-parse", "--show-toplevel"])).stdout.trim()).toBe(external);
    expect(
      await readFile(path.join(state, "trash", key(destination), "deleted", "payload", "project.json"), "utf8"),
    ).toBe(JSON.stringify({ path: source }));
    expect((await exec("git", ["-C", newTask, "status", "--porcelain"])).stdout).toContain("uncommitted.txt");
    expect((await exec("git", ["-C", destination, "worktree", "list", "--porcelain"])).stdout).toContain(newTask);
    expect(await readFile(path.join(newTask, "uncommitted.txt"), "utf8")).toBe("still here");
    expect(await readlink(path.join(newTask, "linked-dependencies"))).toBe(path.join(destination, "dependencies"));
    expect((await new WorkspaceStateStore(destination, state).load()).openFiles).toEqual(["project.json"]);
    const session = JSON.parse(await readFile(path.join(state, `${key(newTask)}-codex.json`), "utf8"));
    expect(session.workspace).toBe(newTask);
    expect(session.sessionId).toBe("native-session");
    expect(session.messages[0].text).toBe(source + "/keep-this-prose");
    expect(await readFile(path.join(state, `${key(newTask)}-task-history`, "blobs", "raw"), "utf8")).toBe(source);
    const roots = JSON.parse(await readFile(path.join(state, `roots-${key(destination).slice(0, 20)}.json`), "utf8"));
    expect(roots.roots[0].path).toBe(path.join(destination, "nested"));
    expect(roots.roots[0].id).toBe(`root_${key(path.join(destination, "nested")).slice(0, 16)}`);
    expect(await readFile(unrelated, "utf8")).toBe(source);
    expect(await readFile(path.join(destination, "project.json"), "utf8")).toBe('{"path":"must stay unchanged"}\n');
    // Recover a lost success response without moving or merging anything a second time.
    expect((await migrateWorkspace(options)).completed).toBe(true);
    // A completed receipt must not prevent a later deliberate move back and forth.
    await migrateWorkspace({ ...options, source: destination, destination: source });
    await migrateWorkspace(options);
    expect((await exec("git", ["-C", newTask, "status", "--porcelain"])).stdout).toContain("uncommitted.txt");
  });

  it("migrates an additional workspace and updates its owning Core's registry and workflow references", async () => {
    const options = await fixture();
    const owner = options.source;
    const source = path.join(path.dirname(owner), "VibeHub");
    const destination = path.join(path.dirname(owner), "HatoHub");
    const sibling = path.join(path.dirname(owner), "VibeLand");
    await mkdir(source);
    await mkdir(sibling);
    await writeFile(path.join(source, "keep.txt"), "uncommitted project content");
    const registry = await WorkspaceRootRegistry.open(owner, options.stateDirectory);
    const root = await registry.add(source, "Hub");
    await registry.add(sibling, "Landing page");
    const nested = path.join(source, "nested");
    await mkdir(nested);
    await registry.add(nested, "Nested root");
    await new WorkspaceStateStore(nested, options.stateDirectory).save({ openFiles: ["nested.txt"] });
    const workflow = path.join(options.stateDirectory, "harnesses", key(owner), "runs.json");
    await json(workflow, { runs: [{ binding: { rootWorkspace: source, workspace: source }, rootId: root.id }] });
    const before = await listMigrationWorkspaces(owner, options.stateDirectory);
    expect(before.map((item) => item.path)).toContain(source);
    await migrateWorkspace({ ...options, source, destination, ownerWorkspace: owner });
    const after = await listMigrationWorkspaces(owner, options.stateDirectory);
    expect(after.find((item) => item.primary)?.path).toBe(owner);
    expect(after.find((item) => item.alias === "Hub")?.path).toBe(destination);
    expect(after.find((item) => item.alias === "Hub")?.id).not.toBe(root.id);
    expect(after.find((item) => item.alias === "Landing page")?.path).toBe(sibling);
    expect(after.find((item) => item.alias === "Nested root")?.path).toBe(path.join(destination, "nested"));
    expect(
      (await new WorkspaceStateStore(path.join(destination, "nested"), options.stateDirectory).load()).openFiles,
    ).toEqual(["nested.txt"]);
    expect(await readFile(path.join(destination, "keep.txt"), "utf8")).toBe("uncommitted project content");
    const saved = JSON.parse(await readFile(workflow, "utf8"));
    expect(saved.runs[0].binding.workspace).toBe(destination);
    expect(saved.runs[0].rootId).toBe(`root_${key(destination).slice(0, 16)}`);
    expect((await exec("git", ["-C", owner, "status", "--porcelain"])).stdout).toBe("");
  });

  it("restores the owning Core registry if a later Git repair fails", async () => {
    const options = await fixture();
    const child = await fixture();
    const registry = await WorkspaceRootRegistry.open(options.source, options.stateDirectory);
    await registry.add(child.source, "Child");
    const task = await new WorkspaceTaskStore(child.source, options.stateDirectory).create("child-task");
    const pointer = path.join(new WorkspaceTaskStore(child.source, options.stateDirectory).taskPath(task.id), ".git");
    await writeFile(pointer, "broken Git pointer");
    await expect(
      migrateWorkspace({
        ...options,
        source: child.source,
        destination: child.destination,
        ownerWorkspace: options.source,
      }),
    ).rejects.toThrow("original project and state were restored");
    const restored = await listMigrationWorkspaces(options.source, options.stateDirectory);
    expect(restored.find((root) => root.alias === "Child")?.path).toBe(child.source);
    expect(await readFile(pointer, "utf8")).toBe("broken Git pointer");
    await expect(access(child.destination)).rejects.toThrow();
  });

  it("rejects migration of a folder that is not registered with the selected owning Core", async () => {
    const options = await fixture();
    const owner = path.join(path.dirname(options.source), "owner");
    await mkdir(owner);
    await expect(migrateWorkspace({ ...options, ownerWorkspace: owner })).rejects.toThrow("no longer registered");
    await expect(access(options.source)).resolves.toBeUndefined();
    await expect(access(options.destination)).rejects.toThrow();
  });

  it("moves bridge responses and user-owned JSON verbatim rather than parsing them as metadata", async () => {
    const options = await fixture();
    const state = options.stateDirectory;
    const sourceKey = key(options.source),
      destinationKey = key(options.destination);
    const opaque = '{"ok":true}\n {"another":"record"}\n';
    const relativeFiles = [
      `${sourceKey}-responses/old-response.json`,
      `${sourceKey}-commands/old-command.json`,
      `${sourceKey}-events/old-event.json`,
      `${sourceKey}-unknown-store/data.json`,
      `skills/local/${sourceKey}/my-skill/reference.json`,
      `useful-files/local/${sourceKey}/notes.json`,
      `harnesses/${sourceKey}/quarantine/runs.json.broken.json`,
    ];
    for (const relative of relativeFiles) {
      const file = path.join(state, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, opaque);
    }
    await new WorkspaceStateStore(options.source, state).save({ openFiles: ["project.json"] });
    await migrateWorkspace(options);
    for (const relative of relativeFiles) {
      expect(await readFile(path.join(state, relative.replace(sourceKey, destinationKey)), "utf8")).toBe(opaque);
    }
    expect((await new WorkspaceStateStore(options.destination, state).load()).openFiles).toEqual(["project.json"]);
  });

  it("rolls back the directory and all state changes if metadata cannot be migrated", async () => {
    const options = await fixture();
    const file = path.join(options.stateDirectory, `${key(options.source)}.json`);
    await json(file, { openFiles: [path.join(options.source, "project.json")] });
    const original = await readFile(file, "utf8");
    const badFile = path.join(options.stateDirectory, "harnesses", key(options.source), "runs.json");
    await mkdir(path.dirname(badFile), { recursive: true });
    await writeFile(badFile, "corrupt metadata");
    const failure = await migrateWorkspace(options).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("original project and state were restored");
    expect((failure as Error).message).toContain(badFile);
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readFile(badFile, "utf8")).toBe("corrupt metadata");
    await expect(access(path.join(options.source, "project.json"))).resolves.toBeUndefined();
    await expect(access(options.destination)).rejects.toThrow();
    await json(badFile, { runs: [] });
    await migrateWorkspace(options);
    await expect(access(options.destination)).resolves.toBeUndefined();
  });

  it("rejects occupied destinations and conflicting saved state without moving files", async () => {
    const options = await fixture();
    await mkdir(options.destination);
    await writeFile(path.join(options.destination, "keep.txt"), "precious");
    await expect(migrateWorkspace(options)).rejects.toThrow("already exists");
    expect(await readFile(path.join(options.destination, "keep.txt"), "utf8")).toBe("precious");
    await rm(options.destination, { recursive: true });
    await json(path.join(options.stateDirectory, `${key(options.source)}.json`), {});
    await json(path.join(options.stateDirectory, `${key(options.destination)}.json`), {});
    await expect(migrateWorkspace(options)).rejects.toThrow("Saved state already exists");
    await rm(path.join(options.stateDirectory, `${key(options.source)}.json`));
    await expect(migrateWorkspace(options)).rejects.toThrow("Saved state already exists");
    await expect(access(options.source)).resolves.toBeUndefined();
    await expect(
      previewWorkspaceMigration({ ...options, destination: path.join(options.source, "inside") }),
    ).rejects.toThrow("outside");
  });
});
