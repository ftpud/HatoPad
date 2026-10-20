import type { WorkspaceRootId } from "./workspace.js";

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

/** A bounded, Core-authoritative view of paths affected by a watcher burst. */
export type FilesystemSnapshotEntry = { path: string; type?: "file" | "directory" };

/** Opaque Core-issued file identity and content revision used for conditional saves. */
export type FileRevision = { identity: string; version: string };

export type FilesystemDeletePreview = {
  path: string;
  type: "file" | "directory";
  children: string[];
  childCount: number;
  recoverable: boolean;
};

export type FilesystemDeleteResult = { path: string; recoveryId?: string; permanentlyDeleted: boolean };

export type FilesystemTransferKind = "copy" | "move";

export type FilesystemTransferRequest = { source: string; destination: string };

export type FilesystemTransferItem = FilesystemTransferRequest & {
  type: "file" | "directory";
  collision: boolean;
  overwrite: boolean;
  caseOnlyRename: boolean;
  crossDevice: boolean;
  openFiles: string[];
  dirtyFiles: string[];
};

export type FilesystemTransferPreflight = {
  kind: FilesystemTransferKind;
  items: FilesystemTransferItem[];
  skipped: { source: string; reason: string }[];
  collisions: number;
  overwrites: number;
  caseOnlyRenames: number;
  crossDeviceMoves: number;
  openFiles: string[];
  dirtyFiles: string[];
  confirmationRequired: boolean;
};

export type FilesystemTransferResult = {
  completed: FilesystemTransferRequest[];
  failures: (FilesystemTransferRequest & { message: string })[];
};

export const remoteTransferDefaultLimit = 512 * 1024 * 1024;

export type RemoteTransferDirection = "upload" | "download";

export type RemoteTransferTicket = {
  token: string;
  direction: RemoteTransferDirection;
  name: string;
  size: number;
  maxBytes: number;
  expiresAt: string;
};

export type DirectoryEntry = { name: string; path: string; type: "file" | "directory" };

export type SearchContextLine = { line: number; text: string; truncated: boolean };

export type SearchMatchContext = {
  before: SearchContextLine[];
  after: SearchContextLine[];
  truncatedBefore: boolean;
  truncatedAfter: boolean;
};

export type SearchResult = {
  rootId: WorkspaceRootId;
  path: string;
  line: number;
  column: number;
  preview: string;
  previewTruncated?: boolean;
  context?: SearchMatchContext;
};

export type SearchReplacePreviewFile = {
  path: string;
  revision: FileRevision;
  occurrences: { line: number; column: number; before: string; after: string }[];
};

export type SearchReplacePreview = { id: string; files: SearchReplacePreviewFile[]; truncated: boolean };

export type SearchReplaceApplyResult = {
  applied: { path: string; revision: FileRevision }[];
  failures: { path: string; code: string; message: string }[];
};
