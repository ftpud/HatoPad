import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeDesktopHandoff } from "./desktop-handoff.js";

test("writes private, expiring launch data outside command-line arguments", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gateway-handoff-"));
  try {
    const file = await writeDesktopHandoff(path.join(directory, "connection-launches"), {
      kind: "cloud",
      cookie: "PRIVATE-COOKIE",
    });
    const value = JSON.parse(await readFile(file, "utf8"));
    assert.equal(value.schema, 1);
    assert.equal(value.cookie, "PRIVATE-COOKIE");
    assert.ok(value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 120_000);
    assert.match(path.basename(file), /^connection-[a-f0-9-]{36}\.json$/);
    if (process.platform !== "win32") {
      assert.equal((await stat(file)).mode & 0o077, 0);
      assert.equal((await stat(path.dirname(file))).mode & 0o077, 0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
