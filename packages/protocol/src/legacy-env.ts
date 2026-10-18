/**
 * Environment variables used before the HatoPad rename. Each legacy name is still honored when the
 * HATOPAD_* name is unset, so existing service files, shell profiles and CI settings keep working.
 */
const LEGACY_PREFIX = "REMOTE_IDE_";
const CURRENT_PREFIX = "HATOPAD_";
/** Pre-rename tuning variables that did not use the REMOTE_IDE_ prefix. */
const LEGACY_EXACT: Readonly<Record<string, string>> = {
  VIBE_TREE_MAX_NODES: "HATOPAD_TREE_MAX_NODES",
  VIBE_TREE_MAX_PATH_BYTES: "HATOPAD_TREE_MAX_PATH_BYTES",
  VIBE_TREE_MAX_DEPTH: "HATOPAD_TREE_MAX_DEPTH",
  VIBE_WATCH_POLLING: "HATOPAD_WATCH_POLLING",
  VIBE_NODE_EXECUTABLE: "HATOPAD_NODE_EXECUTABLE",
  VIBE_DESKTOP_EXECUTABLE: "HATOPAD_DESKTOP_EXECUTABLE",
  VIBE_MAKENSIS: "HATOPAD_MAKENSIS",
  VIBE_DESKTOP_ICON: "HATOPAD_DESKTOP_ICON"
};

/** Copies legacy variables to their HATOPAD_* names when the new name is unset; returns the legacy names that were used. */
export function applyLegacyEnvironment(env: Record<string, string | undefined> = process.env): string[] {
  const used: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const current = name.startsWith(LEGACY_PREFIX) ? CURRENT_PREFIX + name.slice(LEGACY_PREFIX.length) : name.startsWith("VIBE_EDITOR_") ? CURRENT_PREFIX + name.slice("VIBE_EDITOR_".length) : LEGACY_EXACT[name];
    if (current === undefined || env[current] !== undefined) continue;
    env[current] = value;
    used.push(name);
  }
  return used.sort();
}

/** Same as `applyLegacyEnvironment`, then warns once so operators can rename the variables. */
export function applyLegacyEnvironmentWithWarning(env: Record<string, string | undefined> = process.env, warn: (message: string) => void = console.warn): string[] {
  const used = applyLegacyEnvironment(env);
  if (used.length) warn(`[hatopad] Deprecated environment variables in use: ${used.join(", ")}. Rename them to the HATOPAD_ prefix.`);
  return used;
}
