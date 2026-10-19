import assert from "node:assert/strict";
import test from "node:test";
import { legacyRemoteMigrationCommand, parseDiscoveredWorkspaceDirectories, parseValidatedWorkspaceDirectory, quoteWorkspaceShellArgument, validateWorkspaceDirectoryInput, workspaceDiscoveryCommand, workspaceRegistrationCommand, workspaceUnregistrationCommand, workspaceValidationCommand } from "./workspace-path.js";

test("workspace discovery includes direct home folders and is bounded", () => {
  const command = workspaceDiscoveryCommand();
  assert.match(command, /\.hatopad\/gateway-workspaces/);
  assert.match(command, /while IFS= read -r child/);
  assert.match(command, /for name in projects Projects workspace workspaces code Code src repos repositories/);
  assert.match(command, /for child in \"\$HOME\"\/\*/);
  assert.match(command, /-d \"\$child\"/);
  assert.match(command, /count.*64/);
  assert.doesNotMatch(command, /find |maxdepth [2-9]|\*\*|\/etc/);
});

test("workspace registry commands safely add and remove exact paths", () => {
  const register = workspaceRegistrationCommand("/home/dev/project's api");
  const unregister = workspaceUnregistrationCommand("/home/dev/project's api");
  assert.match(register, /\.hatopad\/gateway-workspaces/);
  assert.match(register, /grep -Fqx/);
  assert.match(unregister, /temporary=/);
  assert.match(unregister, /mv --/);
  assert.doesNotMatch(register, /project's api/);
  assert.doesNotMatch(unregister, /project's api/);
});

test("manual workspace paths must be safe absolute paths", () => {
  assert.equal(validateWorkspaceDirectoryInput(" /home/dev/project/ "), "/home/dev/project/");
  assert.throws(() => validateWorkspaceDirectoryInput("project"), /absolute path/);
  assert.throws(() => validateWorkspaceDirectoryInput("/home/dev/\nproject"), /control characters/);
  assert.match(workspaceValidationCommand("/home/dev/project"), /cd --/);
});

test("workspace validation shell-quotes apostrophes for both shell layers", () => {
  assert.equal(quoteWorkspaceShellArgument("/tmp/dev's app"), `'/tmp/dev'"'"'s app'`);
  assert.match(workspaceValidationCommand("/tmp/dev's app"), /directory=/);
});

test("remote directory results are strictly parsed and bounded", () => {
  assert.deepEqual(parseDiscoveredWorkspaceDirectories("/home/dev\n/home/dev/projects/api\nrelative\n/home/dev/projects/api\n"), ["/home/dev", "/home/dev/projects/api"]);
  assert.equal(parseValidatedWorkspaceDirectory("/srv/project\n"), "/srv/project");
  assert.throws(() => parseValidatedWorkspaceDirectory("/srv/a\n/srv/b\n"), /Could not validate/);
});

test("remote preparation creates nested directories and treats shell syntax as path text", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, realpath, rm, stat, readFile, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const execute = promisify(execFile);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gateway-remote-workspace-"));
  try {
    const directory = path.join(temporary, "new parent", "dev's $(echo injected) project");
    const result = await execute("/bin/bash", ["-c", workspaceValidationCommand(directory)]);
    assert.equal(parseValidatedWorkspaceDirectory(result.stdout), await realpath(directory));
    assert.ok((await stat(directory)).isDirectory());
    assert.match(await readFile(path.join(directory, ".git", "HEAD"), "utf8"), /^ref: refs\/heads\//);
    const file = path.join(directory, "keep.txt");
    await writeFile(file, "keep");
    await execute("/bin/bash", ["-c", workspaceValidationCommand(directory)]);
    assert.equal(await readFile(file, "utf8"), "keep");
    await assert.rejects(execute("/bin/bash", ["-c", workspaceValidationCommand(file)]));
    await assert.rejects(execute("/bin/bash", ["-c", workspaceValidationCommand(path.join(file, "child"))]));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});


test("remote preparation leaves nonempty folders and inherited Git repositories intact", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const execute = promisify(execFile);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gateway-remote-git-"));
  try {
    const existing = path.join(temporary, "existing");
    await mkdir(existing);
    await writeFile(path.join(existing, "keep.txt"), "keep");
    await execute("bash", ["-c", workspaceValidationCommand(existing)]);
    await assert.rejects(access(path.join(existing, ".git")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(existing, "keep.txt"), "utf8"), "keep");
    const repository = path.join(temporary, "repository");
    await execute("git", ["init", "--quiet", repository]);
    const child = path.join(repository, "new child");
    await execute("bash", ["-c", workspaceValidationCommand(child)]);
    await assert.rejects(access(path.join(child, ".git")), { code: "ENOENT" });
    assert.equal((await execute("git", ["-C", child, "rev-parse", "--show-toplevel"])).stdout.trim(), await realpath(repository));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("pre-rename remote files move without overwriting and the registry is copied", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const os = await import("node:os"); const path = await import("node:path");
  const home = mkdtempSync(path.join(os.tmpdir(), "legacy-remote-"));
  writeFileSync(path.join(home, ".vibe-server-abc.release"), "release-1"); writeFileSync(path.join(home, ".vibe-server-abc.pid"), "123");
  writeFileSync(path.join(home, ".vibe-server-keep.release"), "old"); writeFileSync(path.join(home, ".hatopad-server-keep.release"), "new");
  mkdirSync(path.join(home, ".vibe-deploy/releases/r1"), { recursive: true });
  mkdirSync(path.join(home, ".remote-ide/workspaces"), { recursive: true }); writeFileSync(path.join(home, ".remote-ide/workspaces/state.json"), "{}");
  mkdirSync(path.join(home, ".vibe")); writeFileSync(path.join(home, ".vibe/workspaces"), "/srv/a\n");
  const run = () => execFileSync("bash", ["-c", legacyRemoteMigrationCommand().replace(/^bash -lc '/, "").slice(0, -1)], { env: { ...process.env, HOME: home } });
  run(); run();
  assert.equal(readFileSync(path.join(home, ".hatopad-server-abc.release"), "utf8"), "release-1");
  assert.equal(readFileSync(path.join(home, ".hatopad-server-abc.pid"), "utf8"), "123");
  assert.equal(readFileSync(path.join(home, ".hatopad-server-keep.release"), "utf8"), "new");
  assert.equal(readFileSync(path.join(home, ".vibe-server-keep.release"), "utf8"), "old");
  // A running pre-rename server keeps its release tree and state directory; neither is moved.
  assert.ok(existsSync(path.join(home, ".vibe-deploy/releases/r1")) && !existsSync(path.join(home, ".hatopad-deploy")));
  assert.ok(existsSync(path.join(home, ".remote-ide/workspaces/state.json")));
  assert.equal(readFileSync(path.join(home, ".hatopad/gateway-workspaces"), "utf8"), "/srv/a\n");
  assert.equal(readFileSync(path.join(home, ".vibe/workspaces"), "utf8"), "/srv/a\n");
});
