// Core owns the migration. Gateway only invokes the installed Core's offline entry point.
export type MigrationPreview = {
  source: string;
  destination: string;
  stateEntries: number;
  taskWorkspaces: number;
  completed?: boolean;
};
export function migrationScript(
  source: string,
  destination: string,
  migrate: boolean,
  port?: number,
  ownerWorkspace?: string,
): string {
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
const result = await run(${JSON.stringify({ source, destination, ...(ownerWorkspace ? { ownerWorkspace } : {}) })});
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

export function workspaceRootsScript(workspace: string): string {
  return `try {
const helper = await import('./packages/core/dist/workspace-migration.js');
if (typeof helper.listMigrationWorkspaces !== 'function') throw Error('Update this Core to show and migrate its additional workspaces in Gateway.');
console.log('HATOPAD_WORKSPACES:' + JSON.stringify(await helper.listMigrationWorkspaces(${JSON.stringify(workspace)})));
} catch (error) {
console.error('HATOPAD_MIGRATION_ERROR:' + JSON.stringify({ message: error.message, restored: false })); process.exitCode = 1;
}`;
}
export type ManagedWorkspaceRoot = { id: string; alias: string; path: string; primary: boolean };
export function parseWorkspaceRoots(output: string): ManagedWorkspaceRoot[] {
  const line = output.split(/\r?\n/).find((line) => line.startsWith("HATOPAD_WORKSPACES:"));
  if (!line) throw Error("Core did not return its registered workspaces.");
  const roots: unknown = JSON.parse(line.slice("HATOPAD_WORKSPACES:".length));
  if (
    !Array.isArray(roots) ||
    roots.some(
      (root) =>
        !root ||
        typeof root.id !== "string" ||
        typeof root.alias !== "string" ||
        typeof root.path !== "string" ||
        typeof root.primary !== "boolean",
    )
  )
    throw Error("Core returned an invalid workspace list.");
  return roots;
}

export function workspacePortScript(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid Core port");
  return `const { createConnection } = await import('node:net');
await new Promise((resolve, reject) => {
 const socket = createConnection({ host: '127.0.0.1', port: ${port} });
 socket.setTimeout(3000);
 socket.once('connect', () => { socket.destroy(); console.log('HATOPAD_CORE_PORT:open'); resolve(); });
 socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED') { console.log('HATOPAD_CORE_PORT:closed'); resolve(); } else reject(error); });
 socket.once('timeout', () => { socket.destroy(); reject(Error('Could not check the Core port.')); });
});`;
}
export async function openRegisteredWorkspace(
  rootId: string | undefined,
  roots: ManagedWorkspaceRoot[],
  actions: {
    portOpen(): Promise<boolean>;
    startCore(): Promise<void>;
    openClient(rootId?: string): Promise<void>;
  },
): Promise<void> {
  if (rootId !== undefined && (typeof rootId !== "string" || !roots.some((root) => root.id === rootId)))
    throw Error("This workspace is no longer registered. Refresh the workspace list.");
  if (!(await actions.portOpen())) await actions.startCore();
  await actions.openClient(rootId);
}
