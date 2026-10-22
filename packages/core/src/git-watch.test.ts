import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { watchGitState } from "./git-watch.js";

describe("watchGitState", () => {
  it("returns an inert watcher for a directory that is not a Git repository", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "hatopad-plain-"));
    const watcher = await watchGitState(directory, () => {});
    expect(watcher.getWatched()).toEqual({});
    await watcher.close();
  });
});
