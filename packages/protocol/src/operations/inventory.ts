import type { InventoryKind, InventoryRow } from "../types/supervision.js";

export type InventoryOperations = {
  "inventory.page": { payload: { kind: InventoryKind; limit?: number; cursor?: string; query?: string; state?: string }; result: { rows: InventoryRow[]; total: number; revision: string; truncated: boolean; nextCursor?: string; restarted?: boolean } };
};
