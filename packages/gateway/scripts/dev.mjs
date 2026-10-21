import { writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";
import { electronExecutable } from "../../../scripts/electron-runtime.mjs";

if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/comm", "hato-gate-dev");
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootBin = path.resolve(packageRoot, "../../node_modules/.bin");
const executable = (name) => path.join(rootBin, process.platform === "win32" ? `${name}.cmd` : name);
const compile = spawnSync(executable("tsc"), ["-p", "tsconfig.electron.json"], { cwd: packageRoot, stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const vite = spawn(
  process.execPath,
  [
    "--import",
    "data:text/javascript,if(process.platform%3D%3D%3D%22linux%22)%7Btry%7B(await%20import(%22node%3Afs%22)).writeFileSync(%22%2Fproc%2Fself%2Fcomm%22%2C%22hato-gate-vite%22)%3B%7Dcatch%7B%7D%7D",
    path.resolve(rootBin, "../vite/bin/vite.js"),
  ],
  { cwd: packageRoot, stdio: "inherit" },
);
await waitOn({ resources: ["tcp:5174"], timeout: 30_000 });
const electronRuntime = await electronExecutable({
  packageRoot,
  productName: "HatoPad Gateway",
  bundleId: "com.hatopad.gateway",
});
const desktopRuntime = await electronExecutable({
  packageRoot: path.resolve(packageRoot, "../desktop"),
  productName: "HatoPad",
  bundleId: "com.hatopad.desktop",
});
const electron = spawn(electronRuntime, [packageRoot], {
  cwd: packageRoot,
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://localhost:5174",
    HATOPAD_DESKTOP_EXECUTABLE: desktopRuntime,
    HATOPAD_NODE_EXECUTABLE: process.env.HATOPAD_NODE_EXECUTABLE || process.execPath,
    HATOPAD_DESKTOP_ICON: path.resolve(packageRoot, "../desktop/assets/app-icon.png"),
  },
  stdio: "inherit",
  shell: false,
});
const stop = (code = 0) => {
  vite.kill();
  electron.kill();
  setTimeout(() => process.exit(code), 100);
};
vite.on("exit", (code) => stop(code ?? 0));
electron.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
