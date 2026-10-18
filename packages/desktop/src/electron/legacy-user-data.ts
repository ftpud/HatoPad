import { existsSync } from "node:fs";
import path from "node:path";

/** Keep existing profiles in place: they may be open in another process or contain absolute paths. */
export function legacyUserDataPath(appData: string, legacyName: string, currentName: string): string {
  const legacy = path.join(appData, legacyName);
  return existsSync(legacy) ? legacy : path.join(appData, currentName);
}
