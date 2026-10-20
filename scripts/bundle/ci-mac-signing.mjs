import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);

// execFile's default error includes its arguments, which can contain passwords.
// Never log or rethrow it, including stderr from credential-management commands.
export async function credentialCommand(command, args, executor = execute) {
  try {
    return await executor(command, args);
  } catch (error) {
    const status = Number.isInteger(error.code) ? ` (exit ${error.code})` : "";
    throw new Error(
      `${command} failed while configuring the CI signing Keychain${status} (credential details suppressed)`,
    );
  }
}

export function validateCiSigningEnvironment(env) {
  for (const name of [
    "RUNNER_TEMP",
    "MAC_CERTIFICATE_P12_BASE64",
    "MAC_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ])
    if (!env[name]?.trim()) throw new Error(`Missing CI signing secret or environment variable: ${name}`);
  if (env.GITHUB_ACTIONS !== "true") throw new Error("CI signing setup runs only in GitHub Actions");
}

async function setup(env) {
  validateCiSigningEnvironment(env);
  const keychain = path.join(env.RUNNER_TEMP, "hatopad-signing.keychain-db");
  const certificate = path.join(env.RUNNER_TEMP, "hatopad-signing.p12");
  const state = path.join(env.RUNNER_TEMP, "hatopad-keychains.json");
  const password = randomBytes(32).toString("hex");
  const { stdout } = await credentialCommand("security", ["list-keychains", "-d", "user"]);
  const keychains = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.trim()));
  await writeFile(state, JSON.stringify(keychains), { mode: 0o600 });
  try {
    await writeFile(certificate, Buffer.from(env.MAC_CERTIFICATE_P12_BASE64, "base64"), { mode: 0o600 });
    await credentialCommand("security", ["create-keychain", "-p", password, keychain]);
    await credentialCommand("security", ["set-keychain-settings", "-lut", "21600", keychain]);
    await credentialCommand("security", ["unlock-keychain", "-p", password, keychain]);
    await credentialCommand("security", [
      "import",
      certificate,
      "-k",
      keychain,
      "-P",
      env.MAC_CERTIFICATE_PASSWORD,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    await credentialCommand("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      password,
      keychain,
    ]);
    await credentialCommand("security", ["list-keychains", "-d", "user", "-s", keychain, ...keychains]);
    await credentialCommand("xcrun", [
      "notarytool",
      "store-credentials",
      "hatopad-ci-notary",
      // Authentication is required again by every notarization submission.
      // Saving a local profile should not depend on Apple's network service.
      "--no-validate",
      "--keychain",
      keychain,
      "--apple-id",
      env.APPLE_ID,
      "--team-id",
      env.APPLE_TEAM_ID,
      "--password",
      env.APPLE_APP_SPECIFIC_PASSWORD,
    ]);
    console.log("CI signing certificate and notarization credentials imported into a temporary Keychain");
  } finally {
    await rm(certificate, { force: true });
  }
}

async function cleanup(env) {
  if (!env.RUNNER_TEMP || env.GITHUB_ACTIONS !== "true") throw new Error("Cleanup requires a GitHub Actions runner");
  const state = path.join(env.RUNNER_TEMP, "hatopad-keychains.json");
  let keychains;
  try {
    keychains = JSON.parse(await readFile(state, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  try {
    await credentialCommand("security", ["delete-keychain", path.join(env.RUNNER_TEMP, "hatopad-signing.keychain-db")]);
  } finally {
    await credentialCommand("security", ["list-keychains", "-d", "user", "-s", ...keychains]);
    await rm(path.join(env.RUNNER_TEMP, "hatopad-signing.p12"), { force: true });
    await rm(state, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== "darwin") throw new Error("CI macOS signing requires macOS");
  if (process.argv[2] === "setup") await setup(process.env);
  else if (process.argv[2] === "cleanup") await cleanup(process.env);
  else throw new Error("Expected setup or cleanup");
}
