import { writeFileSync } from "node:fs";

/** Preserve argv: Gateway verifies it before stopping a Core or supervisor. */
export function setProcessName(name: string): void {
  if (process.platform !== "linux") return;
  try {
    writeFileSync("/proc/self/comm", name);
  } catch {
    // Process naming is optional on hosts with restricted or unavailable procfs.
  }
}
