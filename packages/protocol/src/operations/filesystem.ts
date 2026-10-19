import type { FileTreeNode, FilesystemSnapshotEntry, DirectoryEntry, FileRevision, FilesystemTransferKind, FilesystemTransferRequest, FilesystemTransferPreflight, FilesystemTransferResult, RemoteTransferDirection, RemoteTransferTicket, FilesystemDeletePreview, FilesystemDeleteResult, SearchResult, SearchReplacePreview, SearchReplaceApplyResult } from "../types/filesystem.js";
import type { WorkspaceRootId } from "../types/workspace.js";

export type FilesystemOperations = {
  "filesystem.listTree": {
    payload: { includeIgnored?: boolean };
    result: { tree: FileTreeNode[] };
  };
  "filesystem.snapshot": {
    payload: { paths: string[] };
    result: { entries: FilesystemSnapshotEntry[] };
  };
  /** Non-recursive, paged listing of one directory (`path` "" or omitted = workspace root; `limit` 1..100, default 50). Directories sort first; `nextCursor` is opaque; `truncated` means the directory had more entries than Core scans. */
  "filesystem.listDirectory": { payload: { path?: string; limit?: number; cursor?: string }; result: { entries: DirectoryEntry[]; nextCursor?: string; truncated?: boolean } };
  "filesystem.readFile": {
    /** `maxBytes` (1..2 MiB) rejects larger files with FILE_TOO_LARGE before reading; Desktop omits it. */
    payload: { path: string; maxBytes?: number };
    result: { path: string; content: string; revision: FileRevision };
  };
  "filesystem.writeFile": {
    payload: { path: string; content: string; expectedRevision?: FileRevision; force?: boolean; create?: boolean };
    result: { path: string; bytesWritten: number; revision: FileRevision };
  };
  "filesystem.createFile": {
    payload: { path: string };
    result: { path: string };
  };
  "filesystem.createDirectory": {
    payload: { path: string };
    result: { path: string };
  };
  "filesystem.rename": {
    payload: { path: string; newPath: string };
    result: { path: string };
  };
  "filesystem.transferPreflight": {
    payload: { kind: FilesystemTransferKind; items: FilesystemTransferRequest[]; overwritePaths?: string[]; openFiles?: string[]; dirtyFiles?: string[] };
    result: FilesystemTransferPreflight;
  };
  "filesystem.transferApply": {
    payload: { kind: FilesystemTransferKind; items: FilesystemTransferRequest[]; overwritePaths?: string[]; openFiles?: string[]; dirtyFiles?: string[]; confirmed: boolean };
    result: FilesystemTransferResult;
  };
  /** Creates a short-lived ticket for the separate binary transfer channel. File bodies never use this JSON operation. */
  "filesystem.remoteTransferBegin": {
    payload: { direction: RemoteTransferDirection; path: string; size?: number; overwrite?: boolean; mode?: number };
    result: RemoteTransferTicket;
  };
  "filesystem.remoteTransferCancel": { payload: { token: string }; result: { cancelled: boolean } };
  "filesystem.previewDelete": {
    payload: { path: string };
    result: FilesystemDeletePreview;
  };
  "filesystem.delete": {
    payload: { path: string; permanent?: boolean };
    result: FilesystemDeleteResult;
  };
  "filesystem.restore": {
    payload: { recoveryId: string };
    result: { path: string };
  };
  "filesystem.search": {
    payload: { query: string; path: string; matchCase: boolean; include?: string; exclude?: string; filesOnly?: boolean };
    result: { matches: SearchResult[]; truncated: boolean };
  };
  "filesystem.searchRoots": {
    payload: { rootIds: WorkspaceRootId[]; query: string; path: string; matchCase: boolean; include?: string; exclude?: string };
    result: { matches: SearchResult[]; truncated: boolean };
  };
  "filesystem.readRootFile": {
    payload: { targetRootId: WorkspaceRootId; path: string };
    result: { rootId: WorkspaceRootId; path: string; content: string; revision: FileRevision };
  };
  "filesystem.replacePreview": {
    payload: { query: string; replacement: string; path: string; matchCase: boolean; include?: string; exclude?: string };
    result: SearchReplacePreview;
  };
  "filesystem.replaceApply": {
    payload: { previewId: string; confirmed: boolean };
    result: SearchReplaceApplyResult;
  };
};
