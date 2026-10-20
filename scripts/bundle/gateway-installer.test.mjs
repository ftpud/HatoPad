import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { smokeWindowsInstaller } from "./gateway-installer.mjs";

test("installer smoke cleanup preserves installation failures when no uninstaller exists", async () => {
  const failure = new Error("fixture installer extraction failed");
  let calls = 0;
  await assert.rejects(
    smokeWindowsInstaller(
      "fixture-setup.exe",
      async () => {
        assert.fail("An unsuccessful installation must not launch Gateway");
      },
      async () => {
        calls++;
        throw failure;
      },
    ),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});

test("installer smoke checks both installed entry points and uninstalls before removing files", async () => {
  const calls = [];
  let installed;
  await smokeWindowsInstaller(
    "fixture-setup.exe",
    async (executable, args) => {
      calls.push(args);
      await access(executable);
    },
    async (executable, args) => {
      if (executable === "fixture-setup.exe") {
        installed = args.at(-1).slice(3);
        await mkdir(installed, { recursive: true });
        await writeFile(path.join(installed, "HatoPad Gateway.exe"), "fixture");
        await writeFile(path.join(installed, "Uninstall.exe"), "fixture");
      } else {
        assert.equal(executable, path.join(installed, "Uninstall.exe"));
        await access(executable);
        assert.deepEqual(args, ["/S", `_?=${installed}`]);
        calls.push("uninstalled");
      }
    },
  );
  assert.deepEqual(calls, [[], ["--hatopad"], "uninstalled"]);
  await assert.rejects(access(installed), { code: "ENOENT" });
});
