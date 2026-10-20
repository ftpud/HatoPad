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
    const run = (...args) =>
      execFileSync(process.execPath, ["scripts/protocol-tags.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const first = run("--channel", "dev");
    assert.match(first, /core-protocol-20-dev-v0\.1\.\d+/);
    assert.match(first, /client-protocol-19-20-dev-v0\.1\.\d+/);
    assert.equal(run("--channel", "dev"), first);
    assert.equal(git("tag", "--list").split("\n").length, 2);
    assert.equal(run("--channel", "dev", "--obsolete"), "");
    assert.throws(() => run());
    assert.throws(() => run("--channel", "feature"));

    await writeFile(path.join(root, "next.txt"), "next");
    git("add", ".");
    git("commit", "-m", "next");
    const mainTags = run("--channel", "main");
    assert.match(mainTags, /core-protocol-20-main-v0\.2\./);
    const second = run("--channel", "dev");
    assert.match(second, /v0\.2\./);
    // Only superseded tags of the same channel are removable; main's tags are untouched.
    assert.deepEqual(run("--channel", "dev", "--obsolete").split("\n").sort(), first.split("\n").sort());
    assert.equal(run("--channel", "main", "--obsolete"), "");
    // A different declaration never prunes another declaration's tags.
    await writeFile(
      path.join(root, "protocol-versions.json"),
      JSON.stringify({ server: 21, client: { minimum: 18, maximum: 20 } }),
    );
    assert.equal(run("--channel", "dev", "--obsolete"), "");
    // An older commit never removes tags created for something newer.
    git("checkout", "-q", "HEAD~1");
    await writeFile(
      path.join(root, "protocol-versions.json"),
      JSON.stringify({ server: 20, client: { minimum: 19, maximum: 20 } }),
    );
    assert.equal(run("--channel", "dev", "--obsolete"), "");
    git("checkout", "-q", "-");
    await writeFile(
      path.join(root, "protocol-versions.json"),
      JSON.stringify({ server: 20, client: { minimum: 21, maximum: 20 } }),
    );
    assert.throws(() => run("--channel", "dev"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
