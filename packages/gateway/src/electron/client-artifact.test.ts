import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clientArchiveCommand, validateClientRuntime } from "./client-artifact.js";

test("downloaded client includes standalone workspace dependencies", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "hatopad-client-"));
  try {
    const source = path.join(temporary, "source");
    const desktop = path.join(source, "packages/desktop");
    const destination = path.join(temporary, "client");
    await mkdir(desktop, { recursive: true });
    await mkdir(destination);
    await mkdir(path.join(source, "node_modules/@hatopad"), { recursive: true });
    for (const name of ["protocol", "acp"]) {
      const root = path.join(source, "packages", name);
      await mkdir(path.join(root, "dist"), { recursive: true });
      await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", exports: "./dist/index.js" }));
      await writeFile(path.join(root, "dist/index.js"), name === "protocol" ? 'export { ready } from "@hatopad/acp";' : 'export const ready = true;');
      await symlink(`../../packages/${name}`, path.join(source, "node_modules/@hatopad", name));
    }
    for (const name of ["ws", "ssh2", "asn1", "bcrypt-pbkdf", "tweetnacl", "safer-buffer"]) {
      const packageFile = createRequire(import.meta.url).resolve(`${name}/package.json`);
      await cp(path.dirname(packageFile), path.join(source, "node_modules", name), { recursive: true });
    }
    for (const file of ["package.json", "compatibility.json"]) await writeFile(path.join(desktop, file), "{}");
    for (const directory of ["dist-electron", "dist-renderer"]) await mkdir(path.join(desktop, directory));
    execFileSync("bash", ["-ec", clientArchiveCommand()], { cwd: desktop, env: { ...process.env, remote_archive: path.join(temporary, "client.tar.gz") } });
    execFileSync("tar", ["-xzf", path.join(temporary, "client.tar.gz"), "-C", destination]);
    await rm(source, { recursive: true });
    await validateClientRuntime(destination);
    execFileSync(process.execPath, ["--input-type=module", "-e", 'import { ready } from "@hatopad/protocol"; import {Client} from "ssh2"; if (!ready || typeof Client !== "function") process.exit(1);'], { cwd: destination });
    await rm(path.join(destination, "node_modules/@hatopad/protocol"), { recursive: true });
    await assert.rejects(validateClientRuntime(destination));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
