import { createHash } from "node:crypto";
import type { InventoryKind, InventoryRow } from "@hatopad/protocol";
import { CoreError } from "./errors.js";
export const inventoryKinds: InventoryKind[] = [
  "tasks",
  "workflows",
  "runs",
  "timers",
  "schedules",
  "triggers",
  "terminals",
  "runConfigs",
  "useful",
  "agents",
  "skills",
];
/** Content-free, revisioned inventory pages. Cursors cannot be reused across roots or list kinds. */
export function inventoryPage(
  rootId: string,
  kind: InventoryKind,
  rows: InventoryRow[],
  request: { limit?: unknown; cursor?: unknown; query?: unknown; state?: unknown; order?: "name" | "detail" },
  truncated = false,
) {
  const limit = request.limit ?? 50;
  if (
    !inventoryKinds.includes(kind) ||
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (request.query !== undefined && (typeof request.query !== "string" || request.query.length > 100))
  )
    throw new CoreError("INVALID_REQUEST", "Choose a valid inventory page");
  if (request.state !== undefined && (typeof request.state !== "string" || request.state.length > 100))
    throw new CoreError("INVALID_REQUEST", "Choose an inventory state");
  if (request.order !== undefined && !["name", "detail"].includes(request.order))
    throw new CoreError("INVALID_REQUEST", "Choose an inventory order");
  const query = typeof request.query === "string" ? request.query.toLowerCase() : "";
  const filtered = rows
    .filter(
      (row) =>
        (!request.state || row.state === request.state) &&
        (!query || `${row.name} ${row.state ?? ""} ${row.detail ?? ""}`.toLowerCase().includes(query)),
    )
    .sort(
      (a, b) =>
        (request.order
          ? (a[request.order] ?? "").localeCompare(b[request.order] ?? "")
          : kind === "runs"
            ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
            : 0) || a.id.localeCompare(b.id),
    );
  const revision = createHash("sha256")
    .update(JSON.stringify([rootId, kind, query, request.state, request.order, filtered]))
    .digest("hex")
    .slice(0, 16);
  let offset = 0,
    restarted = false;
  if (request.cursor !== undefined) {
    if (typeof request.cursor !== "string" || !/^[0-9a-f]{16}\.\d{1,9}$/.test(request.cursor))
      throw new CoreError("INVALID_REQUEST", "Invalid inventory cursor");
    const [previous, position] = request.cursor.split(".");
    if (previous === revision) offset = Number(position);
    else restarted = true;
  }
  return {
    rows: filtered.slice(offset, offset + limit).map((row) => ({
      ...row,
      name: row.name.slice(0, 180),
      ...(row.detail ? { detail: row.detail.slice(0, 400) } : {}),
    })),
    total: filtered.length,
    revision,
    truncated,
    ...(restarted ? { restarted: true } : {}),
    ...(offset + limit < filtered.length ? { nextCursor: `${revision}.${offset + limit}` } : {}),
  };
}
