import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CoreUpdates, updateTarget } from "./core-update.js";

describe("installation updates", () => {
  it("rejects untrusted update arguments and unmanaged installs", async () => {
    for (const value of [
      null,
      [],
      { branch: "other" },
      { branch: "main", command: "x" },
      { branch: "main", expectedCurrent: "x", expectedLatest: "x" },
    ])
      expect(() => updateTarget(value, true)).toThrow();
    expect((await new CoreUpdates().check({ branch: "main" })).available).toBe(false);
    await expect(
      new CoreUpdates().apply({ branch: "main", expectedCurrent: "a".repeat(40), expectedLatest: "b".repeat(40) }),
    ).rejects.toThrow();
  });
  it("selects reachable compatible tags and rejects dirty, stale, wrong-branch and concurrent mutations", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-update-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const origin = join(root, "origin"),
        local = join(root, "local");
      git(root, "init", "-b", "main", origin);
      git(origin, "config", "user.email", "fixture@example.com");
      git(origin, "config", "user.name", "Fixture");
      await writeFile(join(origin, "source"), "first");
      git(origin, "add", ".");
      git(origin, "commit", "-m", "first");
      const first = git(origin, "rev-parse", "HEAD");
      git(root, "clone", origin, local);
      await writeFile(join(origin, "source"), "second");
      git(origin, "commit", "-am", "second");
      const second = git(origin, "rev-parse", "HEAD");
      git(origin, "tag", "core-protocol-19-v0.1.2");
      await writeFile(join(origin, "source"), "incompatible");
      git(origin, "commit", "-am", "incompatible");
      git(origin, "tag", "core-protocol-20-v99.0.0");
      const third = git(origin, "rev-parse", "HEAD");
      git(origin, "branch", "dev");
      const service = new CoreUpdates({ repository: local, runningCommit: first, restart: async () => {} });
      expect(await service.check({ branch: "main" })).toMatchObject({
        latest: second,
        canUpdate: true,
        tag: "core-protocol-19-v0.1.2",
      });
      expect(await service.check({ branch: "main" }, false, { minimum: 20, maximum: 20 })).toMatchObject({
        latest: third,
        canUpdate: true,
        tag: "core-protocol-20-v99.0.0",
      });
      expect((await service.check({ branch: "dev" })).canUpdate).toBe(false);
      await writeFile(join(local, "untracked"), "preserve");
      expect((await service.check({ branch: "main" })).canUpdate).toBe(false);
      await rm(join(local, "untracked"));
      await expect(
        service.apply({ branch: "main", expectedCurrent: first, expectedLatest: "a".repeat(40) }),
      ).rejects.toThrow();
      expect(await service.apply({ branch: "main", expectedCurrent: first, expectedLatest: second })).toEqual({
        accepted: true,
      });
      await expect(service.apply({ branch: "main", expectedCurrent: first, expectedLatest: second })).rejects.toThrow(
        /progress/,
      );
      expect(git(local, "rev-parse", "HEAD")).toBe(first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("switches divergent supervised releases but preserves in-place ancestry checks and management on Git failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-diverged-update-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const origin = join(root, "origin"),
        local = join(root, "local");
      git(root, "init", "-b", "dev", origin);
      git(origin, "config", "user.email", "fixture@example.com");
      git(origin, "config", "user.name", "Fixture");
      await writeFile(join(origin, "source"), "base");
      git(origin, "add", ".");
      git(origin, "commit", "-m", "base");
      git(origin, "branch", "release");
      await writeFile(join(origin, "source"), "running branch");
      git(origin, "commit", "-am", "running");
      const current = git(origin, "rev-parse", "HEAD");
      git(root, "clone", origin, local);
      git(origin, "checkout", "release");
      await writeFile(join(origin, "source"), "published branch");
      git(origin, "commit", "-am", "published");
      git(origin, "branch", "-f", "dev", "HEAD");
      git(origin, "tag", "core-protocol-19-v0.1.2");
      const latest = git(origin, "rev-parse", "HEAD");
      const options = { repository: local, runningCommit: current, restart: async () => {} };
      expect(await new CoreUpdates(options).check({ branch: "dev" })).toMatchObject({
        available: true,
        canUpdate: false,
        reason: "The installation has diverged from its update branch.",
      });
      git(local, "checkout", "--detach");
      const service = new CoreUpdates({ ...options, release: true });
      expect(await service.check({ branch: "dev" })).toMatchObject({ available: true, canUpdate: true, latest });
      await expect(
        service.apply({ branch: "dev", expectedCurrent: current, expectedLatest: "a".repeat(40) }),
      ).rejects.toThrow();
      git(local, "remote", "set-url", "origin", join(root, "missing-origin"));
      expect(await service.check({ branch: "dev" })).toMatchObject({
        available: true,
        canUpdate: false,
        reason: "Unable to check installation updates. Check Git access on the Core machine.",
      });
      expect(git(local, "rev-parse", "HEAD")).toBe(current);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("updates immutable release clones from a detached HEAD despite build artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-release-update-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const origin = join(root, "origin"),
        release = join(root, "release");
      git(root, "init", "-b", "dev", origin);
      git(origin, "config", "user.email", "fixture@example.com");
      git(origin, "config", "user.name", "Fixture");
      await writeFile(join(origin, "source"), "first");
      git(origin, "add", ".");
      git(origin, "commit", "-m", "first");
      const first = git(origin, "rev-parse", "HEAD");
      git(root, "clone", origin, release);
      git(release, "checkout", "--detach", first);
      await writeFile(join(release, ".hatopad-build"), "marker");
      await writeFile(join(origin, "source"), "second");
      git(origin, "commit", "-am", "second");
      const second = git(origin, "rev-parse", "HEAD");
      git(origin, "tag", "core-protocol-19-v0.1.2");
      const restarts: unknown[] = [];
      const releaseService = new CoreUpdates({
        repository: release,
        runningCommit: first,
        release: true,
        restart: async (target) => {
          restarts.push(target);
        },
      });
      expect(await releaseService.check({ branch: "dev" })).toMatchObject({ latest: second, canUpdate: true });
      expect(
        await new CoreUpdates({ repository: release, runningCommit: first, restart: async () => {} }).check({
          branch: "dev",
        }),
      ).toMatchObject({ canUpdate: false });
      expect(await releaseService.check({ branch: "dev" }, false, { minimum: 20, maximum: 20 })).toMatchObject({
        canUpdate: false,
      });
      git(release, "checkout", "--detach", second);
      expect(await releaseService.check({ branch: "dev" })).toMatchObject({
        canUpdate: false,
        reason: expect.stringContaining("Installation changed"),
      });
      git(release, "checkout", "--detach", first);
      expect(await releaseService.apply({ branch: "dev", expectedCurrent: first, expectedLatest: second })).toEqual({
        accepted: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
