import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrationScript,
  parseMigrationResult,
  parseWorkspaceMigrations,
  migrationFailure,
} from "./workspace-migration.js";

test("migration results require explicit confirmation and preserve the confirmed destination", () => {
  const result = { source: "/old", destination: "/new", taskWorkspaces: 2, stateEntries: 10 };
  assert.deepEqual(parseMigrationResult(`log line\nHATOPAD_MIGRATION:${JSON.stringify(result)}\n`), result);
  assert.throws(() => parseMigrationResult("log without confirmation"), /did not confirm/);
  assert.throws(() => parseMigrationResult('HATOPAD_MIGRATION:{"source":"old"}'), /invalid/);
});
test("unfinished migrations survive state decoding and invalid markers fail closed", () => {
  const value = { project: { source: "/old", destination: "/new" } };
  assert.deepEqual(parseWorkspaceMigrations(value), value);
  assert.deepEqual(parseWorkspaceMigrations(undefined), {});
  assert.throws(() => parseWorkspaceMigrations({ project: { destination: 1 } }), /Invalid saved/);
});
test("offline commands encode hostile paths as data and check the Core port before moving", () => {
  const script = migrationScript("/projects/$(touch nope)", "/projects/new's home", true, 7331);
  assert.ok(script.includes('"source":"/projects/$(touch nope)"'));
  assert.ok(script.includes("port: 7331"));
  assert.ok(script.indexOf("createConnection") < script.indexOf("await run("));
  assert.ok(!migrationScript("/old", "/new", false).includes("createConnection"));
});

test("migration errors show the Core message and only clear pending state after confirmed rollback", () => {
  const error = migrationFailure(
    Object.assign(new Error("Command failed: node --input-type=module -e internal source"), {
      stderr: 'HATOPAD_MIGRATION_ERROR:{"message":"Original project restored","restored":true}\n',
    }),
  );
  assert.equal(error.message, "Original project restored");
  assert.equal(error.restored, true);
  assert.equal(migrationFailure(new Error("SSH interrupted")).restored, undefined);
});
