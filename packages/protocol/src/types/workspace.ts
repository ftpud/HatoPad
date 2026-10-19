import type { JavaProjectOptions, JavaBreakpoint } from "./java.js";
import type { WorkspaceTerminalOptions } from "./terminal.js";

/** Stable, Core-issued identity for a remote directory in this workspace group. */
export type WorkspaceRootId = string;

export type WorkspaceRoot = { id: WorkspaceRootId; alias: string; path: string; primary: boolean };

export type WorkspaceOptions = {
  openFiles: string[];
  /** Pinned file paths, in their leading tab-strip order. */
  pinnedFiles?: string[];
  activeFile?: string;
  /** Open workflow documents; content remains in Core’s workflow run history. */
  workflowDocuments?: WorkspaceWorkflowDocument[];
  javaProject?: JavaProjectOptions;
  javaBreakpoints?: JavaBreakpoint[];
  terminal?: WorkspaceTerminalOptions;
  fileColors?: Record<string, FileColor>;
  gitCommitMessage?: string;
  searchQueries?: WorkspaceSearchQueries;
};

/** Compact Find in Files metadata. Search results and file contents are never persisted. */
export type WorkspaceSearchQuery = {
  query: string;
  path: string;
  matchCase?: boolean;
  include?: string;
  exclude?: string;
};

export type WorkspaceSearchQueries = { recent?: WorkspaceSearchQuery[]; saved?: WorkspaceSearchQuery[] };

export type FileColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

/** Durable terminal-tab metadata. The display name is UI state, not a PTY identity. */
export type WorkspaceWorkflowDocument = {
  runId: string;
  blockId: string;
  position: number;
  pinned?: boolean;
  markdownMode?: "edit" | "preview";
  active?: boolean;
};

export type WorkspaceTask = {
  id: string;
  name: string;
  branch: string;
  baseBranch: string;
  status: "active" | "finished";
  archived: boolean;
};

export type ManagedProcess = {
  id: string;
  pid: number;
  command: string;
  status: "running";
  workspace: string;
  rootWorkspace: string;
  taskId?: string;
  taskName?: string;
  workflowRunId?: string;
  workflowBlockId?: string;
  provider?: string;
  sessionId?: string;
  kind: "agent" | "command" | "workflow-app";
  appName?: string;
  parentPid?: number;
};

/** Bounded read of one block of one run: newest output characters and a newest-first page of chat messages. */
export const harnessBlockDetailLimits = {
  defaultOutput: 16_000,
  maxOutput: 64_000,
  defaultChat: 20,
  maxChat: 50,
  maxChatText: 4_000,
} as const;
