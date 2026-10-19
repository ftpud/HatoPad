import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("CI creates immutable client/server protocol tags and reruns idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "protocol-tags-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    await mkdir(path.join(root, "scripts"));
    await copyFile(new URL("./protocol-tags.mjs", import.meta.url), path.join(root, "scripts/protocol-tags.mjs"));
    await writeFile(
      path.join(root, "protocol-versions.json"),
      JSON.stringify({ server: 20, client: { minimum: 19, maximum: 20 } }),
    );
    git("init");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.com");
    git("add", ".");
    git("commit", "-m", "fixture");
    const run = () =>
      execFileSync(process.execPath, ["scripts/protocol-tags.mjs"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const first = run();
    assert.match(first, /core-protocol-20-v0\.1\.\d+/);
    assert.match(first, /client-protocol-19-20-v0\.1\.\d+/);
    assert.equal(run(), first);
    assert.equal(git("tag", "--list").split("\n").length, 2);
    await writeFile(
      path.join(root, "protocol-versions.json"),
      JSON.stringify({ server: 20, client: { minimum: 21, maximum: 20 } }),
    );
    assert.throws(run);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
