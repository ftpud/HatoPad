import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Directory that holds Core state (tokens, workspace state, provider runtimes, tools, plugins, Hub pairing).
 * An existing pre-rename `~/.remote-ide` is used in place, even when `~/.hatopad` also exists: older apps may still
 * be running against it, so it is never moved or split by default (migration is the explicit opt-in in `index.ts`).
 * Fresh machines get `~/.hatopad`. Every default path must come through here.
 */
export function stateHome(home: string = os.homedir()): string {
  const legacy = path.join(home, ".remote-ide");
  return existsSync(legacy) ? legacy : path.join(home, ".hatopad");
}
