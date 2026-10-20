import { access, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exists = (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

export type LegacyMigrationResult = { moved: boolean; conflict: boolean; from: string; to: string };

/**
 * Opt-in only (`HATOPAD_MIGRATE_LEGACY_STATE=1`, see index.ts; run with older apps stopped). Moves the pre-rename state directory (`~/.remote-ide`) to `~/.hatopad` when the new one does not exist yet.
 * Tokens, workspace state, provider runtimes, tools, plugins and the Hub pairing credential live under it,
 * so they move together and keep their private permissions. Nothing is ever deleted: when both directories
 * exist nothing moves and the conflict is reported so the operator can merge by hand.
 */
export async function migrateLegacyHome(
  home = os.homedir(),
  log: (message: string) => void = console.log,
): Promise<LegacyMigrationResult> {
  const from = path.join(home, ".remote-ide"),
    to = path.join(home, ".hatopad");
  if (!(await exists(from))) return { moved: false, conflict: false, from, to };
  if (await exists(to)) {
    log(`[core] Both ${from} and ${to} exist; no state was moved. Reconcile the directories before migrating.`);
    return { moved: false, conflict: true, from, to };
  }
  await rename(from, to);
  log(`[core] Moved ${from} to ${to}.`);
  return { moved: true, conflict: false, from, to };
}
