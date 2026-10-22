// Core owns the migration. Gateway only invokes the installed Core's offline entry point.
export type MigrationPreview = {
  source: string;
  destination: string;
  stateEntries: number;
  taskWorkspaces: number;
  completed?: boolean;
};
export function migrationScript(source: string, destination: string, migrate: boolean, port?: number): string {
  return `try {
${
  migrate && port
    ? `const { createConnection } = await import('node:net');
await new Promise((resolve, reject) => {
 const socket = createConnection({ host: '127.0.0.1', port: ${port} });
 socket.setTimeout(2000);
 socket.once('connect', () => { socket.destroy(); reject(Error('Core is still running on the workspace port. Stop it before migrating.')); });
 socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(error); });
 socket.once('timeout', () => { socket.destroy(); reject(Error('Could not verify that Core has stopped.')); });
});`
    : ""
}
const { ${migrate ? "migrateWorkspace" : "previewWorkspaceMigration"}: run } = await import('./packages/core/dist/workspace-migration.js').catch(() => { throw Error('Update Core to a version that supports project migration, then try again.'); });
const result = await run(${JSON.stringify({ source, destination })});
console.log('HATOPAD_MIGRATION:' + JSON.stringify(result));
} catch (error) {
 console.error('HATOPAD_MIGRATION_ERROR:' + JSON.stringify({ message: error.message, restored: error.restored === true }));
 process.exitCode = 1;
}`;
}
export function parseMigrationResult(output: string): MigrationPreview {
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith("HATOPAD_MIGRATION:"));
  if (!line)
    throw Error("Core did not confirm the migration result. Retry with the same destination to recover its status.");
  const result = JSON.parse(line.slice("HATOPAD_MIGRATION:".length));
  if (
    typeof result.source !== "string" ||
    typeof result.destination !== "string" ||
    !Number.isInteger(result.stateEntries) ||
    !Number.isInteger(result.taskWorkspaces)
  )
    throw Error("Core returned an invalid migration result.");
  return result;
}

export function parseWorkspaceMigrations(value: unknown): Record<string, { source: string; destination: string }> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid saved project migrations");
  for (const [id, entry] of Object.entries(value)) {
    const item = entry as { source?: unknown; destination?: unknown } | null;
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
      !item ||
      typeof item.source !== "string" ||
      typeof item.destination !== "string"
    )
      throw Error("Invalid saved project migration. Restore the Gateway state backup before starting projects.");
  }
  return value as Record<string, { source: string; destination: string }>;
}

export function migrationFailure(reason: unknown): Error & { restored?: boolean } {
  const error = reason as { message?: string; stderr?: string };
  const output = `${error?.stderr ?? ""}\n${error?.message ?? String(reason)}`;
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith("HATOPAD_MIGRATION_ERROR:")) continue;
    try {
      const result = JSON.parse(line.slice("HATOPAD_MIGRATION_ERROR:".length));
      if (typeof result.message === "string")
        return Object.assign(new Error(result.message), { restored: result.restored === true });
    } catch {
      /* An interrupted response retains the SSH diagnostic and pending migration. */
    }
  }
  return reason instanceof Error ? reason : new Error(String(reason));
}
