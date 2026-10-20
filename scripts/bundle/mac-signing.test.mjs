import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { macSigningConfiguration, resolveMacSigning, macBinaries, notarizeMacFile } from "./mac-signing.mjs";
import { credentialCommand, validateCiSigningEnvironment } from "./ci-mac-signing.mjs";

test("credential command failures never expose passwords or subprocess output", async () => {
  const secret = "test-secret-that-must-not-appear";
  await assert.rejects(
    credentialCommand("security", ["import", "-P", secret], async () => {
      throw new Error(`Command failed: security import -P ${secret}\n${secret}`);
    }),
    (error) => !String(error.stack).includes(secret) && error.message.includes("credential details suppressed"),
  );
});

test("CI setup refuses missing credentials and local execution without revealing values", () => {
  assert.throws(() => validateCiSigningEnvironment({}), /RUNNER_TEMP/);
  const env = Object.fromEntries(
    [
      "RUNNER_TEMP",
      "MAC_CERTIFICATE_P12_BASE64",
      "MAC_CERTIFICATE_PASSWORD",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ].map((key) => [key, "fixture"]),
  );
  assert.throws(() => validateCiSigningEnvironment(env), /only in GitHub Actions/);
  assert.doesNotThrow(() => validateCiSigningEnvironment({ ...env, GITHUB_ACTIONS: "true" }));
});

test("signed builds require an explicit Developer ID and Keychain profile, with no unsigned fallback", () => {
  assert.equal(macSigningConfiguration([], {}, "darwin"), undefined);
  assert.throws(() => macSigningConfiguration(["--sign"], {}, "win32"), /only on macOS/);
  for (const identity of [undefined, "-", "Apple Development: Example", "Apple Distribution: Example"])
    assert.throws(
      () => macSigningConfiguration(["--sign"], { HATOPAD_MAC_SIGN_IDENTITY: identity }, "darwin"),
      /Developer ID/,
    );
  const env = { HATOPAD_MAC_SIGN_IDENTITY: "Developer ID Application: Example (TEAM)" };
  assert.throws(() => macSigningConfiguration(["--sign"], env, "darwin"), /Keychain profile/);
  assert.deepEqual(macSigningConfiguration(["--sign"], { ...env, HATOPAD_NOTARY_PROFILE: "test" }, "darwin"), {
    identity: env.HATOPAD_MAC_SIGN_IDENTITY,
    keychainProfile: "test",
  });
});

test("native discovery includes extensionless Mach-O files and ignores data, ELF and symlinks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hatopad-macho-"));
  try {
    await mkdir(path.join(directory, "bin"));
    await writeFile(path.join(directory, "bin/node"), Buffer.from("cffaedfe00000000", "hex"));
    await writeFile(path.join(directory, "pty.node"), Buffer.from("feedfacf00000000", "hex"));
    await writeFile(path.join(directory, "elf"), Buffer.from("7f454c46", "hex"));
    await writeFile(path.join(directory, "java.class"), Buffer.from("cafebabe00000041", "hex"));
    await writeFile(path.join(directory, "data"), "hello");
    await writeFile(path.join(directory, "empty"), "");
    if (process.platform !== "win32") await symlink("bin/node", path.join(directory, "link"));
    assert.deepEqual(
      (await macBinaries(directory)).sort(),
      [path.join(directory, "bin/node"), path.join(directory, "pty.node")].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("signing resolves a valid Developer ID name to its hash, including non-ASCII names", async () => {
  const signing = { identity: "Developer ID Application: Example Š (TEAM)", keychainProfile: "test" };
  const hash = "A".repeat(40);
  assert.equal(await resolveMacSigning(undefined), undefined);
  const result = await resolveMacSigning(signing, async () => ({
    stdout: `  1) ${hash} "${signing.identity}"\n 1 valid identities found`,
  }));
  assert.equal(result.identityHash, hash);
  await assert.rejects(
    resolveMacSigning(signing, async () => ({ stdout: "0 valid identities found" })),
    /exactly one/,
  );
});

test("notarization requires Accepted and preserves rejected submissions and Apple's log", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hatopad-notary-results-"));
  const report = path.join(directory, "report.json");
  const signing = { keychainProfile: "fixture-profile", keychain: "/tmp/fixture.keychain-db" };
  try {
    for (const status of ["Accepted", "Invalid"]) {
      const commands = [];
      const executor = async (_command, args) => {
        commands.push(args);
        assert.ok(args.includes(signing.keychain));
        return {
          stdout: JSON.stringify(
            args[1] === "submit"
              ? { id: "fixture-id" }
              : args[1] === "wait"
                ? { id: "fixture-id", status }
                : { issues: ["fixture rejection"] },
          ),
        };
      };
      const result = notarizeMacFile("fixture.zip", signing, report, executor);
      if (status === "Accepted") await result;
      else {
        await assert.rejects(result, /Apple notarization Invalid/);
        assert.deepEqual(JSON.parse(await readFile(`${report}.log.json`, "utf8")), { issues: ["fixture rejection"] });
      }
      assert.equal(JSON.parse(await readFile(report, "utf8")).status, status);
      assert.equal(commands[0][1], "submit");
      assert.equal(commands[1][1], "wait");
    }
    await assert.rejects(
      notarizeMacFile("fixture.zip", signing, report, async (_command, args) => {
        if (args[1] === "wait") throw new Error("fixture timeout");
        return { stdout: JSON.stringify({ id: "pending-id" }) };
      }),
      /fixture timeout/,
    );
    assert.equal(JSON.parse(await readFile(report, "utf8")).id, "pending-id");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
