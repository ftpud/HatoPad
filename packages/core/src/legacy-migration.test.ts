import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLegacyHome } from "./legacy-migration.js";

describe("legacy home migration", () => {
  it("moves the old state directory with its contents and permissions", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "legacy-home-"));
    await mkdir(path.join(home, ".remote-ide", "core-tokens"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(home, ".remote-ide", "core-tokens", "7331.token"), "secret", { mode: 0o600 });
    const messages: string[] = [];
    const result = await migrateLegacyHome(home, (message) => messages.push(message));
    expect(result).toMatchObject({ moved: true, conflict: false });
    expect(await readFile(path.join(home, ".hatopad", "core-tokens", "7331.token"), "utf8")).toBe("secret");
    expect((await stat(path.join(home, ".hatopad", "core-tokens", "7331.token"))).mode & 0o777).toBe(0o600);
    await expect(stat(path.join(home, ".remote-ide"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(messages).toHaveLength(1);
    expect((await migrateLegacyHome(home, (message) => messages.push(message))).moved).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it("never overwrites an existing new directory and reports the conflict", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "legacy-home-"));
    await mkdir(path.join(home, ".remote-ide"));
    await mkdir(path.join(home, ".hatopad"));
    await writeFile(path.join(home, ".remote-ide", "old.txt"), "old");
    await writeFile(path.join(home, ".hatopad", "new.txt"), "new");
    const messages: string[] = [];
    expect(await migrateLegacyHome(home, (message) => messages.push(message))).toMatchObject({
      moved: false,
      conflict: true,
    });
    expect(await readFile(path.join(home, ".remote-ide", "old.txt"), "utf8")).toBe("old");
    expect(await readFile(path.join(home, ".hatopad", "new.txt"), "utf8")).toBe("new");
    expect(messages[0]).toContain("Both");
  });

  it("does nothing on a fresh machine", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "legacy-home-"));
    expect(
      await migrateLegacyHome(home, () => {
        throw new Error("should not log");
      }),
    ).toMatchObject({ moved: false, conflict: false });
  });
});
