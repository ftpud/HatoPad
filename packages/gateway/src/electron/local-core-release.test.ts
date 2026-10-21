import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { LocalCoreReleases } from "./local-core-release.js";

test("local Git installer ignores incompatible HEAD, refuses stale approval, and preserves running artifacts on build failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gateway-core-release-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const oldEnv = { ...process.env };
  try {
    const origin = path.join(root, "origin");
    git(root, "init", "-b", "main", origin);
    git(origin, "config", "user.name", "Fixture");
    git(origin, "config", "user.email", "fixture@example.com");
    await mkdir(path.join(origin, "packages/protocol/dist"), { recursive: true });
    await mkdir(path.join(origin, "packages/core/dist"), { recursive: true });
    await writeFile(path.join(origin, "package.json"), '{"type":"module"}');
    await writeFile(path.join(origin, "packages/protocol/dist/index.js"), "export const serverProtocolVersion=19;");
    await writeFile(path.join(origin, "packages/core/dist/server.js"), "export const ready=true;");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "compatible");
    git(origin, "tag", "core-protocol-19-v0.1.1");
    const compatible = git(origin, "rev-parse", "HEAD");
    await writeFile(path.join(origin, "incompatible"), "next");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "incompatible");
    git(origin, "tag", "core-protocol-20-v99.0.0");
    git(origin, "tag", "v0.1.0");
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = `url.${origin}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = "https://fixture.invalid/core";
    const releases = new LocalCoreReleases(path.join(root, "cache"));
    const settings = { repository: "https://fixture.invalid/core", branch: "main", autoUpdate: true };
    assert.equal((await releases.check(settings)).commit, compatible);
    assert.deepEqual(
      await Promise.all([releases.check(settings), releases.check(settings)]).then((results) =>
        results.map((item) => item.commit),
      ),
      [compatible, compatible],
    );
    assert.equal((await releases.check(settings, { minimum: 20, maximum: 20 })).tag, "core-protocol-20-v99.0.0");
    await assert.rejects(releases.check(settings, { minimum: 21, maximum: 21 }), /No protocol-compatible/);
    const npm = path.join(root, "npm.mjs");
    await writeFile(npm, "process.exit(process.env.FIXTURE_BUILD_FAIL ? 23 : 0);");
    const tools = { node: process.execPath, npm, env: process.env };
    await assert.rejects(releases.prepare(settings, "a".repeat(40), tools), /release changed/);
    const installed = await releases.prepare(settings, compatible, tools);
    assert.equal(await releases.installed(compatible, tools.node, tools.env), installed);
    assert.equal(await releases.prepare(settings, compatible, tools), installed);
    assert.equal(git(installed, "config", "--get", "remote.origin.url"), settings.repository);
    git(installed, "remote", "set-url", "origin", path.join(root, "cache"));
    await releases.pointOriginAtRepository(installed, settings);
    assert.equal(git(installed, "config", "--get", "remote.origin.url"), settings.repository);
    // Rewritten branch history and a moved app tag must not block Core discovery.
    git(origin, "reset", "--hard", compatible);
    git(origin, "tag", "--force", "v0.1.0");
    await writeFile(path.join(origin, "source"), "new compatible");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "new compatible");
    git(origin, "tag", "core-protocol-19-v0.1.2");
    const newer = git(origin, "rev-parse", "HEAD");
    assert.equal((await releases.check(settings)).commit, newer);
    await assert.rejects(
      releases.prepare(settings, newer, { ...tools, env: { ...process.env, FIXTURE_BUILD_FAIL: "1" } }),
      /previous Core remains/,
    );
    assert.equal(
      (await readdir(path.join(root, "cache"))).some((name) => name.includes(".staging-")),
      false,
    );
    assert.equal(await readdir(installed).then((entries) => entries.includes(".complete")), true);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    await rm(root, { recursive: true, force: true });
  }
});
