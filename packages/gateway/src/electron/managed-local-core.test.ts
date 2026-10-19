import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { matchLocalCloudCore } from "./managed-local-core.js";
const pairing = { hubUrl: "https://hub.example", coreId: "core-1", credential: "PRIVATE" };
test("a crashed local Core remains manageable from its saved pairing", () => {
  const selected = matchLocalCloudCore(pairing, "https://hub.example", "core-1", "saved-workspace", "linux-x64");
  assert.deepEqual(selected, { workspaceId: "saved-workspace", target: "linux-x64" });
  assert.equal(JSON.stringify(selected).includes("PRIVATE"), false);
});
test("only the exact cloud identity selects a saved local workspace", () => {
  for (const identity of [{ ...pairing, hubUrl: "https://other.example" }, { ...pairing, coreId: "other" }, null, []])
    assert.equal(
      matchLocalCloudCore(identity, "https://hub.example", "core-1", "saved-workspace", "linux-x64"),
      undefined,
    );
});
test("current release is detected for both source and portable runtime directories", () => {
  const release = "a".repeat(40) + "-node137-bundle-test";
  for (const root of [path.join("/cache", release), path.join("/cache", release, "linux-x64")])
    assert.equal(
      matchLocalCloudCore(
        pairing,
        "https://hub.example",
        "core-1",
        "saved-workspace",
        "linux-x64",
        path.join(root, "packages/core/dist/index.js"),
      )?.release,
      release,
    );
});
