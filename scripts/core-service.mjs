import { writeFileSync } from "node:fs";
import { compatibleCoreTags, protocolCompatibility } from "../packages/protocol/dist/index.js";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/comm", "hatopad-super");
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}

const exec = promisify(execFile);
const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const git = async (...args) =>
  (await exec("git", args, { cwd: repository, env, timeout: 30_000, maxBuffer: 64_000 })).stdout.trim();
const valid = (value) =>
  value &&
  value.type === "hatopad-core-update" &&
  ["dev", "main"].includes(value.branch) &&
  /^[a-f0-9]{40}$/.test(value.expectedCurrent) &&
  /^[a-f0-9]{40}$/.test(value.expectedLatest) &&
  (!value.compatibility ||
    (Number.isSafeInteger(value.compatibility.minimum) &&
      Number.isSafeInteger(value.compatibility.maximum) &&
      value.compatibility.minimum > 0 &&
      value.compatibility.maximum >= value.compatibility.minimum));
let active;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    active?.kill(signal);
  });
async function command(command, args, cwd) {
  if (stopping) throw new Error("Stopped");
  await new Promise((resolve, reject) => {
    active = spawn(command, args, { cwd, env, stdio: "ignore" });
    active.once("error", reject);
    active.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Installation step failed"))));
  });
}
const cleanup = async (directory) => {
  if (directory !== repository) {
    await git("worktree", "remove", "--force", directory).catch(() => {});
    await rm(path.dirname(directory), { recursive: true, force: true });
  }
};
let directory = repository;
let failed = false;
try {
  let revision = await git("rev-parse", "HEAD").catch(() => undefined);
  while (!stopping) {
    let request;
    const code = await new Promise((resolve, reject) => {
      active = spawn(
        process.execPath,
        [path.join(directory, "packages/core/dist/index.js"), ...process.argv.slice(2)],
        {
          cwd: repository,
          stdio: ["inherit", "inherit", "inherit", "ipc"],
          env: {
            ...env,
            HATOPAD_CORE_UPDATE_MANAGED: revision ? "1" : "0",
            HATOPAD_CORE_UPDATE_REPOSITORY: repository,
            HATOPAD_CORE_RUNNING_COMMIT: revision ?? "",
            HATOPAD_CORE_UPDATE_FAILED: failed ? "1" : "0",
          },
        },
      );
      active.on("message", (value) => {
        if (valid(value) && !request) request = value;
      });
      active.once("error", reject);
      active.once("exit", (code) => resolve(code));
    });
    if (stopping || !revision || code !== 75 || !request) {
      process.exitCode = code ?? 1;
      break;
    }
    let staged;
    try {
      if (
        (await git("rev-parse", "HEAD")) !== request.expectedCurrent ||
        (await git("symbolic-ref", "--short", "HEAD")) !== request.branch ||
        (await git("status", "--porcelain", "--untracked-files=normal"))
      )
        throw new Error("Installation changed");
      await git("fetch", "--tags", "origin", `${request.branch}:refs/remotes/origin/${request.branch}`);
      const tag = compatibleCoreTags(
        (await git("tag", "--merged", `refs/remotes/origin/${request.branch}`, "--list", "core-protocol-*-v*")).split(
          "\n",
        ),
        request.compatibility ?? protocolCompatibility,
      )[0];
      if (!tag || (await git("rev-parse", `refs/tags/${tag}^{commit}`)) !== request.expectedLatest)
        throw new Error("Update changed");
      await git("merge-base", "--is-ancestor", request.expectedCurrent, request.expectedLatest);
      staged = path.join(await mkdtemp(path.join(tmpdir(), "hatopad-core-update-")), "release");
      await git("worktree", "add", "--detach", staged, request.expectedLatest);
      const npm = process.env.npm_execpath;
      if (!npm) throw new Error("Start through npm run core");
      await command(process.execPath, [npm, "ci", "--no-audit", "--no-fund"], staged);
      for (const name of ["acp", "protocol", "relay", "connector", "test-fixtures", "core"])
        await command(process.execPath, [npm, "run", "build", "-w", `@hatopad/${name}`], staged);
      await command(
        process.execPath,
        ["--input-type=module", "-e", "await import('./packages/core/dist/server.js');"],
        staged,
      );
      if (
        (await git("rev-parse", "HEAD")) !== request.expectedCurrent ||
        (await git("symbolic-ref", "--short", "HEAD")) !== request.branch ||
        (await git("status", "--porcelain", "--untracked-files=normal"))
      )
        throw new Error("Installation changed");
      await git("merge", "--ff-only", request.expectedLatest);
      const previous = directory;
      directory = staged;
      revision = request.expectedLatest;
      failed = false;
      staged = undefined;
      await cleanup(previous);
    } catch {
      failed = true;
      if (staged) await cleanup(staged);
      console.error("[core] Update failed; restarting the previous Core.");
    }
  }
} catch {
  console.error("[core] Git Core launcher failed.");
  process.exitCode = 1;
} finally {
  if (directory !== repository) await cleanup(directory);
}
