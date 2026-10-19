import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { stateHome } from "./state-home.js";
it("selects existing legacy state without moving it, including when both directories exist", () => {
 const home = mkdtempSync(path.join(os.tmpdir(), "hatopad-home-"));
 try {
  expect(stateHome(home)).toBe(path.join(home, ".hatopad"));
  mkdirSync(path.join(home, ".remote-ide"));
  expect(stateHome(home)).toBe(path.join(home, ".remote-ide"));
  mkdirSync(path.join(home, ".hatopad"));
  expect(stateHome(home)).toBe(path.join(home, ".remote-ide"));
 } finally { rmSync(home, { recursive: true, force: true }); }
});
