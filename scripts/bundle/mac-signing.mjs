import { execFile } from "node:child_process";
import { open, readdir, mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { run, writeJson } from "./common.mjs";

const execute = promisify(execFile);

export async function resolveMacSigning(signing, executor = execute) {
  if (!signing) return undefined;
  const { stdout } = await executor("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    ...(signing.keychain ? [signing.keychain] : []),
  ]);
  const matches = [...stdout.matchAll(/\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/g)].filter(
    (match) => match[2] === signing.identity,
  );
  if (matches.length !== 1) throw new Error("Expected exactly one valid matching Developer ID Application identity");
  // Hashes avoid locale-dependent codesign name matching for non-ASCII names.
  return { ...signing, identityHash: matches[0][1] };
}

export function macSigningConfiguration(argv = process.argv, env = process.env, platform = process.platform) {
  if (!argv.includes("--sign")) return undefined;
  if (platform !== "darwin") throw new Error("--sign is supported only on macOS");
  const identity = env.HATOPAD_MAC_SIGN_IDENTITY?.trim();
  if (!identity?.startsWith("Developer ID Application:"))
    throw new Error("Set HATOPAD_MAC_SIGN_IDENTITY to the full Developer ID Application certificate name");
  const keychainProfile = env.HATOPAD_NOTARY_PROFILE?.trim();
  if (!keychainProfile) throw new Error("Set HATOPAD_NOTARY_PROFILE to a notarytool Keychain profile");
  return {
    identity,
    keychainProfile,
    ...(env.HATOPAD_NOTARY_KEYCHAIN ? { keychain: env.HATOPAD_NOTARY_KEYCHAIN } : {}),
  };
}

// Use file headers rather than extensions: Node and spawn-helper have none, and
// dependencies can contain native code outside the usual .node/.dylib paths.
export async function macBinaries(directory) {
  const binaries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) binaries.push(...(await macBinaries(file)));
    else if (entry.isFile()) {
      const handle = await open(file, "r");
      try {
        const header = Buffer.alloc(8);
        const { bytesRead } = await handle.read(header, 0, 8, 0);
        const magic = header.subarray(0, 4).toString("hex");
        const thin = ["feedface", "cefaedfe", "feedfacf", "cffaedfe"].includes(magic);
        const fat = ["cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic);
        const architectures =
          magic === "bebafeca" || magic === "bfbafeca" ? header.readUInt32LE(4) : header.readUInt32BE(4);
        if (bytesRead >= 4 && (thin || (bytesRead === 8 && fat && architectures > 0 && architectures <= 32)))
          binaries.push(file);
      } finally {
        await handle.close();
      }
    }
  }
  return binaries;
}

export async function signMacCore(directory, signing) {
  const binaries = await macBinaries(directory);
  if (!binaries.includes(path.join(directory, "bin/node"))) throw new Error("Core Node binary is not Mach-O");
  for (const binary of binaries) {
    await run("codesign", [
      "--force",
      "--sign",
      signing.identityHash,
      "--timestamp",
      "--options",
      "runtime",
      "--entitlements",
      path.join(import.meta.dirname, "core-entitlements.plist"),
      binary,
    ]);
    await run("codesign", ["--verify", "--strict", binary]);
  }
}

// Keep Apple's response beside the artifact for diagnosing rejected submissions.
// A successful command exit alone does not imply an Accepted submission.
export async function notarizeMacFile(file, signing, report = `${file}.notarization.json`, executor = execute) {
  console.log(`Submitting ${path.basename(file)} to Apple for notarization`);
  const credentials = [
    "--keychain-profile",
    signing.keychainProfile,
    ...(signing.keychain ? ["--keychain", signing.keychain] : []),
  ];
  const submission = await executor("xcrun", ["notarytool", "submit", file, ...credentials, "--output-format", "json"]);
  const submitted = JSON.parse(submission.stdout);
  if (!submitted.id) throw new Error("Apple did not return a notarization submission ID");
  await writeJson(report, submitted);
  console.log(`Apple notarization submission: ${submitted.id}; waiting for acceptance`);
  const { stdout } = await executor(
    "xcrun",
    ["notarytool", "wait", submitted.id, ...credentials, "--timeout", "60m", "--output-format", "json"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  await writeJson(report, result);
  console.log(`Apple notarization ${result.id}: ${result.status}`);
  if (result.status !== "Accepted") {
    if (result.id && ["Invalid", "Rejected"].includes(result.status)) {
      const log = await executor("xcrun", [
        "notarytool",
        "log",
        result.id,
        "--keychain-profile",
        signing.keychainProfile,
        ...(signing.keychain ? ["--keychain", signing.keychain] : []),
        "--output-format",
        "json",
      ]);
      await writeJson(`${report}.log.json`, JSON.parse(log.stdout));
    }
    throw new Error(`Apple notarization ${result.status}; see ${report}`);
  }
}

export async function notarizeMacDirectory(directory, signing, report) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "hatopad-notary-"));
  try {
    const zip = path.join(temporary, "submission.zip");
    await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", directory, zip]);
    await notarizeMacFile(zip, signing, report);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function stapleMacFile(file) {
  await run("xcrun", ["stapler", "staple", file]);
  await run("xcrun", ["stapler", "validate", file]);
}
