import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access, chmod, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { consumeConnectionHandoff } from "./connection-handoff.js";

test("consumes a private handoff once and removes credentials from disk", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-handoff-"));
  const file = path.join(directory, `connection-${randomUUID()}.json`);
  try {
    await writeFile(
      file,
      JSON.stringify({
        schema: 1,
        expiresAt: Date.now() + 120_000,
        kind: "cloud",
        origin: "https://hub.example",
        coreId: "core-1",
        cookie: "session=PRIVATE",
        rootId: "root-1",
      }),
      { mode: 0o600 },
    );
    assert.equal((await consumeConnectionHandoff(file)).rootId, "root-1");
    await assert.rejects(access(file));
    await assert.rejects(consumeConnectionHandoff(file));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rejects expired and malformed target handoffs and removes the private file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-handoff-"));
  try {
    for (const override of [
      { expiresAt: Date.now() - 1 },
      { origin: "http://evil.example" },
      { origin: "https://user:secret@hub.example" },
      { cookie: "session=secret\r\nInjected: yes" },
    ]) {
      const file = path.join(directory, `connection-${randomUUID()}.json`);
      await writeFile(
        file,
        JSON.stringify({
          schema: 1,
          expiresAt: Date.now() + 120_000,
          kind: "cloud",
          origin: "https://hub.example",
          coreId: "core-1",
          cookie: "session=PRIVATE",
          ...override,
        }),
        { mode: 0o600 },
      );
      await assert.rejects(consumeConnectionHandoff(file));
      await assert.rejects(access(file));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test.skipIf(process.platform === "win32")(
  "rejects public permissions and symlinks without deleting their targets",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "desktop-handoff-"));
    const file = path.join(directory, `connection-${randomUUID()}.json`);
    const link = path.join(directory, `connection-${randomUUID()}.json`);
    try {
      await writeFile(file, "{}", { mode: 0o600 });
      await chmod(file, 0o644);
      await assert.rejects(consumeConnectionHandoff(file), /private/);
      await access(file);
      await chmod(file, 0o600);
      await symlink(file, link);
      await assert.rejects(consumeConnectionHandoff(link));
      await access(file);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
