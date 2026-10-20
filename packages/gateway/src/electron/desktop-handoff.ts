import { mkdir, open, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Private, one-use handoff. Credentials never appear in argv or renderer URLs. */
export async function writeDesktopHandoff(directory: string, connection: Record<string, unknown>): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())))
  )
    throw new Error("Desktop connection handoff directory must be private and owned by this user.");
  const file = path.join(directory, `connection-${randomUUID()}.json`);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ ...connection, schema: 1, expiresAt: Date.now() + 120_000 }));
  } finally {
    await handle.close();
  }
  return file;
}
