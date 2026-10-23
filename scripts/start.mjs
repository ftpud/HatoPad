import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(script));
const target = process.argv[2];
if (process.platform === "linux") {
  try {
    writeFileSync(
      "/proc/self/comm",
      `hato-${target === "desktop" ? "desk" : target === "gateway" ? "gate" : "core"}-start`,
    );
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}
if (!["core", "desktop", "gateway"].includes(target)) throw new Error("Expected core, desktop or gateway");
const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
const npm = process.env.npm_execpath;
let active;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    active?.kill(signal);
  });
async function run(command, args, options = {}) {
  if (stopping) throw new Error("Startup cancelled");
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit", ...options });
    active = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      active = undefined;
      if (code === 0) resolve();
      else {
        process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
        reject(new Error(`${target} exited ${signal ?? code}`));
      }
    });
  });
}
async function runNpm(args) {
  if (npm) return run(process.execPath, [npm, ...args]);
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, { shell: process.platform === "win32" });
}
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    console.log(`[startup] Node ${process.versions.node} is too old; selecting Node 24.22.1 through npm.`);
    await runNpm(["exec", "--yes", "--package=node@24.22.1", "--", "node", script, ...process.argv.slice(2)]);
  } else {
    // Compile source on every launch, so deleted or stale dist trees cannot
    // silently run an older version. Gateway also launches Core and Desktop.
    const packages =
      target === "gateway"
        ? ["acp", "protocol", "client", "relay", "connector", "test-fixtures", "core", "desktop", "gateway"]
        : target === "core"
          ? ["acp", "protocol", "relay", "connector", "test-fixtures", "core"]
          : ["acp", "protocol", "client", target];
    for (const name of packages) await runNpm(["run", "build", "-w", `@hatopad/${name}`]);
    if (target === "core")
      await run(process.execPath, [path.join(root, "scripts/core-service.mjs"), ...process.argv.slice(3)]);
    else await run(process.execPath, [path.join(root, "scripts/start-electron.mjs"), target, ...process.argv.slice(3)]);
  }
} catch (error) {
  if (!stopping) console.error(`[startup] ${error instanceof Error ? error.message : error}`);
  process.exitCode ||= 1;
}
