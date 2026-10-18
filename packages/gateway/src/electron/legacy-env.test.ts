import assert from "node:assert/strict";
import test from "node:test";
import { applyLegacyEnvironment } from "./legacy-env.js";

test("maps pre-rename names without overriding explicit HATOPAD_ values", () => {
  const env: Record<string, string | undefined> = { REMOTE_IDE_STATE_DIR: "/old", REMOTE_IDE_TOOLS_DIR: "/tools", HATOPAD_TOOLS_DIR: "/new-tools", VIBE_WATCH_POLLING: "1" };
  assert.deepEqual(applyLegacyEnvironment(env), ["REMOTE_IDE_STATE_DIR", "VIBE_WATCH_POLLING"]);
  assert.equal(env.HATOPAD_STATE_DIR, "/old");
  assert.equal(env.HATOPAD_TOOLS_DIR, "/new-tools");
  assert.equal(env.HATOPAD_WATCH_POLLING, "1");
});

test("an explicitly empty canonical value is kept and executable overrides are mapped", () => {
  const env: Record<string, string | undefined> = { HATOPAD_SESSION_TOKEN: "", REMOTE_IDE_SESSION_TOKEN: "inherited", VIBE_DESKTOP_EXECUTABLE: "/opt/electron", VIBE_NODE_EXECUTABLE: "/opt/node" };
  assert.deepEqual(applyLegacyEnvironment(env), ["VIBE_DESKTOP_EXECUTABLE", "VIBE_NODE_EXECUTABLE"]);
  assert.equal(env.HATOPAD_SESSION_TOKEN, "");
  assert.equal(env.HATOPAD_DESKTOP_EXECUTABLE, "/opt/electron");
  assert.equal(env.HATOPAD_NODE_EXECUTABLE, "/opt/node");
});
