import { writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";
import { electronExecutable } from "../../../scripts/electron-runtime.mjs";

if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/comm", "hato-desk-dev");
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootBin = path.resolve(packageRoot, "../../node_modules/.bin");
const executable = (name) => path.join(rootBin, process.platform === "win32" ? `${name}.cmd` : name);

const compile = spawnSync(executable("tsc"), ["-p", "tsconfig.electron.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const vite = spawn(
  process.execPath,
  [
    "--import",
    "data:text/javascript,if(process.platform%3D%3D%3D%22linux%22)%7Btry%7B(await%20import(%22node%3Afs%22)).writeFileSync(%22%2Fproc%2Fself%2Fcomm%22%2C%22hato-desk-vite%22)%3B%7Dcatch%7B%7D%7D",
    path.resolve(rootBin, "../vite/bin/vite.js"),
  ],
  { cwd: packageRoot, stdio: "inherit" },
);
await waitOn({ resources: ["tcp:5173"], timeout: 30_000 });
const electronRuntime = await electronExecutable({
  packageRoot,
  productName: "HatoPad",
  bundleId: "com.hatopad.desktop",
});
const electron = spawn(electronRuntime, [packageRoot, ...process.argv.slice(2)], {
  cwd: packageRoot,
  env: { ...process.env, VITE_DEV_SERVER_URL: "http://localhost:5173" },
  stdio: "inherit",
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  vite.kill("SIGTERM");
  electron.kill("SIGTERM");
  setTimeout(() => process.exit(code), 100);
}

vite.on("exit", (code) => stop(code ?? 0));
electron.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
