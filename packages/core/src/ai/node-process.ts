/** Name only this Node invocation, preserving provider arguments and child naming. */
export function namedNodeArgs(title: string, args: string[]): string[] {
  const preload = `if (process.platform === "linux") {
  try { (await import("node:fs")).writeFileSync("/proc/self/comm", ${JSON.stringify(title)}); } catch {}
}
const index = process.execArgv.findIndex((arg, i, args) => arg === "--import" && args[i + 1] === import.meta.url);
if (index >= 0) process.execArgv.splice(index, 2);`;
  return ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, ...args];
}
