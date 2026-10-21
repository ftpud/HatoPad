import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electronExecutable, macFinderLaunch } from "./electron-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (process.platform === "linux") {
  try {
    writeFileSync(
      "/proc/self/comm",
      `hato-${target === "desktop" ? "desk" : target === "gateway" ? "gate" : "core"}-app`,
    );
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}
const config =
  target === "desktop"
    ? { packageRoot: path.join(root, "packages/desktop"), productName: "HatoPad", bundleId: "com.hatopad.desktop" }
    : target === "gateway"
      ? {
          packageRoot: path.join(root, "packages/gateway"),
          productName: "HatoPad Gateway",
          bundleId: "com.hatopad.gateway",
        }
      : undefined;
if (!config) throw new Error("Expected desktop or gateway");
const executable = await electronExecutable(config);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
// Pre-rename override still honored.
if (env.HATOPAD_NODE_EXECUTABLE === undefined && env.VIBE_NODE_EXECUTABLE)
  env.HATOPAD_NODE_EXECUTABLE = env.VIBE_NODE_EXECUTABLE;
env.HATOPAD_NODE_EXECUTABLE ??= process.execPath;
if (target === "gateway") {
  env.HATOPAD_DESKTOP_ICON = path.join(root, "packages/desktop/assets/app-icon.png");
  env.HATOPAD_DESKTOP_EXECUTABLE = await electronExecutable({
    packageRoot: path.join(root, "packages/desktop"),
    productName: "HatoPad",
    bundleId: "com.hatopad.desktop",
  });
}
const launchArgs = process.argv.slice(3);
const finder = launchArgs.includes("--finder");
if (finder && (process.platform !== "darwin" || target !== "gateway"))
  throw new Error("--finder is available for Gateway on macOS");
const launch = finder
  ? macFinderLaunch(
      executable,
      config.packageRoot,
      launchArgs.filter((arg) => arg !== "--finder"),
      env,
    )
  : { command: executable, args: [config.packageRoot, ...launchArgs] };
if (finder)
  console.log(
    "[startup] Opening Gateway through macOS LaunchServices for Bluetooth passkeys. Close Gateway from its window when finished.",
  );
const child = spawn(launch.command, launch.args, {
  cwd: config.packageRoot,
  stdio: "inherit",
  env,
  shell: false,
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal ? 143 : 0);
});
child.on("error", (error) => {
  console.error(`[startup] ${error.message}`);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
