import type { StorageSnapshot, StorageCleanup } from "../types/storage.js";

export type StorageOperations = {
  "storage.scan": { payload: Record<string, never>; result: StorageSnapshot };
  "storage.status": { payload: Record<string, never>; result: StorageSnapshot };
  "storage.cleanup": { payload: StorageCleanup; result: StorageSnapshot };
};
