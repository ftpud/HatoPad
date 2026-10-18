import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { legacyUserDataPath } from "./legacy-user-data.js";
import { expect, it } from "vitest";

it("keeps live legacy profiles in place and uses the new name for fresh installs", () => {
  const appData = mkdtempSync(path.join(os.tmpdir(), "hatopad-profile-"));
  try {
    const legacy = path.join(appData, "Vibe Editor"), current = path.join(appData, "HatoPad");
    expect(legacyUserDataPath(appData, "Vibe Editor", "HatoPad")).toBe(current);
    mkdirSync(legacy); writeFileSync(path.join(legacy, "settings.json"), "settings");
    expect(legacyUserDataPath(appData, "Vibe Editor", "HatoPad")).toBe(legacy);
    mkdirSync(current);
    expect(legacyUserDataPath(appData, "Vibe Editor", "HatoPad")).toBe(legacy);
    expect(readFileSync(path.join(legacy, "settings.json"), "utf8")).toBe("settings");
    expect(existsSync(current)).toBe(true);
  } finally { rmSync(appData, { recursive: true, force: true }); }
});
