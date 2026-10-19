

export type StorageAge = "today" | "week" | "older";

export type StorageCategory = "tasks" | "sessions" | "workflows" | "checkpoints" | "logs" | "provider" | "runtime" | "other";

export type StorageUsage = { id: StorageCategory; label: string; description: string; bytes: number; count: number; segments: { id: string; label: string; bytes: number }[]; entries?: { path: string; label: string; bytes: number; state: string }[]; cleanable: { finished: number; week: number; older: number; inactive?: number; versions?: number } };

export type StorageSnapshot = { id: string; phase: "idle" | "scanning" | "cleaning" | "ready" | "error"; updatedAt: string; server: string; paths: string[]; categories: StorageUsage[]; totalBytes: number; scannedFiles: number; message: string; warnings: string[]; disk?: { total: number; available: number } };

export type StorageCleanup = { scanId: string; category: StorageCategory; age: "finished" | "older" | "week" | "inactive" | "versions"; closeOtherSessions?: boolean; discardChanges?: boolean };
