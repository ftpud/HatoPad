import crypto from 'node:crypto';
import type { OverviewWorkPage, OverviewWorkRow } from '@hatopad/protocol';
import { CoreError } from './errors.js';
export type WorkTarget = { rootId: string; rootAlias: string; taskId?: string; name: string; branch?: string; status: 'root' | 'active' | 'finished'; archived: boolean; workspace: string };
export function workPage(targets: WorkTarget[], request: { limit?: unknown; cursor?: unknown; rootId?: unknown }, truncated: boolean) {
  const limit = request.limit ?? 20;
  if (!Number.isSafeInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > 25 || (request.rootId !== undefined && (typeof request.rootId !== 'string' || !request.rootId || request.rootId.length > 128))) throw new CoreError('INVALID_REQUEST', 'Choose a valid work overview page');
  const filtered = request.rootId === undefined ? targets : targets.filter(target => target.rootId === request.rootId);
  if (request.rootId !== undefined && !filtered.length) throw new CoreError('FILE_NOT_FOUND', 'Overview root is unavailable');
  const revision = crypto.createHash('sha256').update(JSON.stringify(filtered.map(({ workspace: _path, ...target }) => target))).digest('hex').slice(0, 16);
  let offset = 0, restarted = false;
  if (request.cursor !== undefined) {
    if (typeof request.cursor !== 'string' || !/^[0-9a-f]{16}\.\d{1,6}$/.test(request.cursor)) throw new CoreError('INVALID_REQUEST', 'Invalid work overview cursor');
    const [previous, position] = request.cursor.split('.');
    if (previous === revision) offset = Number(position); else restarted = true;
  }
  return { targets: filtered.slice(offset, offset + limit), result: { revision, observedAt: new Date().toISOString(), rows: [] as OverviewWorkRow[], totalTargets: filtered.length, truncated, ...(restarted ? { restarted: true as const } : {}), ...(offset + limit < filtered.length ? { nextCursor: `${revision}.${offset + limit}` } : {}) } satisfies OverviewWorkPage };
}
export const workText = (value: string | undefined, limit = 180) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
