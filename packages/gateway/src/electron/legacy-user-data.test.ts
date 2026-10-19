import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { legacyUserDataPath } from "./legacy-user-data.js";
import assert from "node:assert/strict";
import test from "node:test";

test("keeps live legacy profiles in place and uses the new name for fresh installs", () => {
  const appData = mkdtempSync(path.join(os.tmpdir(), "hatopad-profile-"));
  try {
    const legacy = path.join(appData, "Vibe Editor"),
      current = path.join(appData, "HatoPad");
    assert.equal(legacyUserDataPath(appData, "Vibe Editor", "HatoPad"), current);
    mkdirSync(legacy);
    writeFileSync(path.join(legacy, "settings.json"), "settings");
    assert.equal(legacyUserDataPath(appData, "Vibe Editor", "HatoPad"), legacy);
    mkdirSync(current);
    assert.equal(legacyUserDataPath(appData, "Vibe Editor", "HatoPad"), legacy);
    assert.equal(readFileSync(path.join(legacy, "settings.json"), "utf8"), "settings");
    assert.equal(existsSync(current), true);
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});
