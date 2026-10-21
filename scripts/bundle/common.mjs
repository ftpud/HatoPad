import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const output = path.join(root, "artifacts");
export const json = async (file) => JSON.parse(await readFile(file, "utf8"));
export const writeJson = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
export function run(command, args, cwd = root, env = process.env) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...env };
    delete childEnv.npm_config_allow_scripts;
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: "inherit",
      shell: process.platform === "win32" && command === "npm",
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

// Install the lockfile's production closure in isolation; never ship the checkout,
// development dependencies, credentials, or host node_modules.
export async function stageWorkspace(destination, workspace) {
  await mkdir(destination, { recursive: true });
  for (const file of ["package.json", "package-lock.json", "LICENSE.md"])
    await cp(path.join(root, file), path.join(destination, file));
  for (const name of [
    "acp",
    "protocol",
    "client",
    "relay",
    "connector",
    "test-fixtures",
    "core",
    "desktop",
    "gateway",
  ]) {
    const target = path.join(destination, "packages", name);
    await mkdir(target, { recursive: true });
    await cp(path.join(root, "packages", name, "package.json"), path.join(target, "package.json"));
  }
  await run(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--workspace",
      `@hatopad/${workspace}`,
      "--include-workspace-root=false",
    ],
    destination,
  );
}

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Keep only a workspace's actual Node runtime closure, not renderer/build/provider tools. */
export async function pruneRuntimeDependencies(destination, dependencies) {
  const { realpath, readdir, rm } = await import("node:fs/promises");
  destination = await realpath(destination);
  const keep = new Set();
  const visited = new Set();
  async function visit(name, from, optional = false) {
    let cursor = from;
    let directory;
    while (cursor === destination || cursor.startsWith(`${destination}${path.sep}`)) {
      const candidate = path.join(cursor, "node_modules", name);
      try {
        await readFile(path.join(candidate, "package.json"));
        directory = candidate;
        break;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    if (!directory) {
      if (optional) return;
      throw new Error(`Missing runtime dependency: ${name}`);
    }
    keep.add(directory);
    directory = await realpath(directory);
    if (visited.has(directory)) return;
    visited.add(directory);
    const metadata = await json(path.join(directory, "package.json"));
    for (const dependency of Object.keys(metadata.dependencies ?? {}))
      await visit(dependency, directory, !!metadata.optionalDependencies?.[dependency]);
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) await visit(dependency, directory, true);
    for (const dependency of Object.keys(metadata.peerDependencies ?? {}))
      await visit(dependency, directory, !!metadata.peerDependenciesMeta?.[dependency]?.optional);
  }
  for (const name of dependencies) await visit(name, destination);
  async function prune(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        await prune(target);
        continue;
      }
      if (!keep.has(target)) await rm(target, { recursive: true, force: true });
    }
  }
  await prune(path.join(destination, "node_modules"));
}

/** Electron main imports protocol helpers at startup, including in the embedded Desktop. */
export async function prepareElectronRuntime(destination, source = root) {
  for (const name of ["acp", "protocol"]) {
    // Gateway's own dependency closure doesn't install Desktop's workspaces.
    // Materialize them explicitly, also supporting npm's existing workspace links.
    const dependency = path.join(destination, "node_modules/@hatopad", name);
    await mkdir(dependency, { recursive: true });
    await cp(path.join(source, "packages", name, "package.json"), path.join(dependency, "package.json"));
    await cp(path.join(source, "packages", name, "dist"), path.join(dependency, "dist"), { recursive: true });
  }
  await pruneRuntimeDependencies(destination, ["ws", "ssh2", "@hatopad/protocol"]);
}

/** Preserve framework links so the copied app stays relocatable. */
export async function copyBundledApplication(source, destination) {
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

/**
 * HatoPad's UI is English-only; Chromium's other UI translations add ~60 MB per
 * Electron copy. Runs on the extracted Electron before the app is signed.
 */
export async function pruneElectronLocales(buildPath, keep = ["en.lproj", "en-US.pak"]) {
  const { readdir, rm } = await import("node:fs/promises");
  const prune = async (directory, pattern) => {
    let entries;
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
    const removed = entries.filter((name) => pattern.test(name) && !keep.includes(name));
    await Promise.all(removed.map((name) => rm(path.join(directory, name), { recursive: true, force: true })));
    return removed.length;
  };
  let removed = await prune(path.join(buildPath, "locales"), /\.pak$/);
  for (const app of (await readdir(buildPath)).filter((name) => name.endsWith(".app"))) {
    removed += await prune(path.join(buildPath, app, "Contents/Resources"), /\.lproj$/);
    removed += await prune(
      path.join(buildPath, app, "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"),
      /\.lproj$/,
    );
  }
  if (!removed) throw new Error(`No Electron locales found to prune in ${buildPath}`);
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.|-|$)/i;

function licenseName(metadata) {
  const declared = metadata.license ?? metadata.licenses;
  if (!declared) return undefined;
  const names = [declared].flat().map((entry) => (typeof entry === "string" ? entry : entry?.type));
  return names.filter(Boolean).join(" OR ") || undefined;
}

/** Every package under the given node_modules directories, including nested copies. */
async function collectPackages(directories) {
  const packages = new Map();
  const visited = new Set();
  async function scan(modules) {
    let entries;
    try {
      modules = await realpath(modules);
      entries = await readdir(modules, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
      throw error;
    }
    if (visited.has(modules)) return;
    visited.add(modules);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(modules, entry.name);
      if (entry.name.startsWith("@")) await scan(target);
      else if (entry.isDirectory() || entry.isSymbolicLink()) await inspect(target);
    }
  }
  async function inspect(directory) {
    let metadata;
    try {
      metadata = await json(path.join(directory, "package.json"));
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
      throw error;
    }
    // HatoPad's own packages are covered by the licenses shipped at the application root.
    if (metadata.name && !metadata.name.startsWith("@hatopad/")) {
      const key = `${metadata.name}@${metadata.version}`;
      if (!packages.has(key)) packages.set(key, { metadata, directory });
    }
    await scan(path.join(directory, "node_modules"));
  }
  for (const directory of directories) await scan(directory);
  return [...packages.values()].sort((a, b) =>
    `${a.metadata.name}@${a.metadata.version}`.localeCompare(`${b.metadata.name}@${b.metadata.version}`),
  );
}

/**
 * Write THIRD-PARTY-NOTICES.md listing each package in the shipped dependency
 * trees with its license and license text, as MIT, ISC, BSD and OFL require when
 * redistributing. Fails if a package has neither a declared license nor a license file.
 */
export async function writeThirdPartyNotices(file, directories, title = "HatoPad") {
  const sections = [];
  const missing = [];
  for (const { metadata, directory } of await collectPackages(directories)) {
    const id = `${metadata.name}@${metadata.version}`;
    const name = licenseName(metadata);
    const texts = [];
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .filter((candidate) => candidate.isFile() && LICENSE_FILE.test(candidate.name))
      .sort((a, b) => a.name.localeCompare(b.name)))
      texts.push({ name: entry.name, text: (await readFile(path.join(directory, entry.name), "utf8")).trim() });
    if (!name && !texts.length) missing.push(id);
    const repository = typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
    sections.push(
      [
        `## ${id}`,
        "",
        `License: ${name ?? "see license text below"}`,
        ...(repository ? [`Source: ${repository}`] : []),
        ...texts.flatMap(({ name: fileName, text }) => ["", `${fileName}:`, "", "```text", text, "```"]),
      ].join("\n"),
    );
  }
  if (missing.length) throw new Error(`No license information for: ${missing.join(", ")}`);
  await writeFile(
    file,
    [
      `# Third-party notices for ${title}`,
      "",
      `${title} includes the following third-party software, provided under the licenses shown.`,
      "Electron's license and Chromium's license notices (LICENSE and LICENSES.chromium.html) are included with each application.",
      "",
      ...sections.flatMap((section) => [section, ""]),
    ].join("\n"),
  );
  return sections.length;
}
