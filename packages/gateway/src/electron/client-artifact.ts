import { access } from "node:fs/promises";
import path from "node:path";

export const clientArtifactVersion = "artifact-v3";
const runtimePackages = ["ws", "@hatopad/protocol", "@hatopad/acp"];

export async function validateClientRuntime(root: string): Promise<void> {
  for (const name of runtimePackages) {
    await access(path.join(root, "node_modules", name, "package.json"));
    if (name.startsWith("@hatopad/")) await access(path.join(root, "node_modules", name, "dist/index.js"));
  }
}

/** Dereference npm workspace links so the downloaded app is self-contained. */
export function clientArchiveCommand(): string {
  return `files="package.json compatibility.json dist-electron dist-renderer"; if [ -d assets ]; then files="$files assets"; fi; tar -chzf "$remote_archive" $files -C ../.. ${runtimePackages.map(name => `node_modules/${name}`).join(" ")}`;
}
