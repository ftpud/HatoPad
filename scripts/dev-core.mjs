import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/comm", "hato-core-dev");
  } catch {
    /* Naming is optional on restricted hosts. */
  }
}

// Vite Desktop sends an HTTP Origin even inside Electron. Allow only the
// development server's exact local origins; the session token is still required.
const origins = new Set([
  ...(process.env.HATOPAD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const child = spawn(
  process.execPath,
  [
    "--import",
    "data:text/javascript,if(process.platform%3D%3D%3D%22linux%22)%7Btry%7B(await%20import(%22node%3Afs%22)).writeFileSync(%22%2Fproc%2Fself%2Fcomm%22%2C%22hato-core-watch%22)%3B%7Dcatch%7B%7D%7D",
    fileURLToPath(import.meta.resolve("tsx/cli")),
    "watch",
    "src/index.ts",
    ...process.argv.slice(2),
  ],
  {
    cwd: fileURLToPath(new URL("../packages/core/", import.meta.url)),
    stdio: "inherit",
    env: { ...process.env, HATOPAD_ALLOWED_ORIGINS: [...origins].join(",") },
  },
);
child.on("error", (error) => {
  console.error(`[core] failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
