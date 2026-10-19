import type { ProtocolOperations } from "../operations/index.js";
import type { WorkspaceRootId } from "./workspace.js";

/**
 * The wire contract is independently versioned from package releases so a cached
 * Desktop can prove it is safe to talk to a newly deployed Core.
 */
export type ProtocolCompatibility = { minimum: number; maximum: number };

/** Additive operations a Core advertises in its handshake; absent on older Cores, which reject the matching requests with INVALID_REQUEST. */
export const coreCapabilities = [
  "overview.summary",
  "ai.messages",
  "filesystem.readFile.maxBytes",
  "git.diff.maxBytes",
  "overview.workflowAttention",
  "harnesses.progress",
  "tasks.switch.includeTree",
  "ai.get.summary",
  "ai.sessions.paging",
  "session.responseLimit",
  "workspace.selectRoot.includeTree",
  "filesystem.listDirectory",
  "session.pendingBounds",
  "overview.activity",
  "workspace.open.includeTree",
  "pending.truncatedFlag",
  "tasks.lifecycle",
  "automation.management",
  "git.summary",
  "taskGit.summary",
  "tasks.commitMessage",
  "overview.counts",
  "terminal.watch",
  "harnesses.blockDetail",
  "terminal.watch.flowControl",
  "taskGit.files",
  "taskGit.revert",
  "triggers.history",
  "ai.configureNext",
  "overview.work",
  "attention.read",
  "harnesses.control",
  "harnesses.inspect",
  "harnesses.invoke",
  "inventory.page",
  "tasks.paging",
  "overview.events",
  "harnesses.templates",
  "useful.read.maxBytes",
  "automation.paging",
  "core.gitUpdate",
  "ports.tunnel",
  "client.presence",
] as const;

export type CoreCapability = (typeof coreCapabilities)[number];

export function protocolRangeIsValid(range: ProtocolCompatibility): boolean {
  return (
    Number.isInteger(range.minimum) &&
    Number.isInteger(range.maximum) &&
    range.minimum > 0 &&
    range.minimum <= range.maximum
  );
}

export function protocolRangesOverlap(left: ProtocolCompatibility, right: ProtocolCompatibility): boolean {
  return (
    protocolRangeIsValid(left) &&
    protocolRangeIsValid(right) &&
    left.minimum <= right.maximum &&
    right.minimum <= left.maximum
  );
}

export type CoreUpdateStatus = {
  branch: "dev" | "main";
  available: boolean;
  updateAvailable: boolean;
  canUpdate: boolean;
  phase: "idle" | "restarting";
  current?: string;
  latest?: string;
  tag?: string;
  reason?: string;
};

export type RequestType = keyof ProtocolOperations;

/** All nested relative paths and opaque root-owned references inherit this envelope root. */
export type Request<T extends RequestType = RequestType> = T extends RequestType
  ? { id: string; type: T; payload: ProtocolOperations[T]["payload"] } & (T extends
      | `portTunnel.${string}`
      | "protocol.maintenance"
      | "core.update.check"
      | "core.update.apply"
      | "protocol.handshake"
      | "protocol.keepAlive"
      | "client.presence"
      | "workspace.roots"
      | "workspace.addRoot"
      | "overview.summary"
      | "overview.work"
      | "overview.events"
      ? { rootId?: never }
      : { rootId: WorkspaceRootId })
  : never;

export type ErrorCode =
  | "INVALID_REQUEST"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_NOT_OPEN"
  | "PATH_OUTSIDE_WORKSPACE"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  /** Complete workspace snapshot exceeded a producer limit; narrow the workspace or adjust Core limits. */
  | "WORKSPACE_TREE_TOO_LARGE"
  | "BINARY_FILE"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "CONFLICT"
  | "FILE_CHANGED"
  | "TERMINAL_FAILED"
  | "RUN_CONFIG_NOT_FOUND"
  | "RUN_CONFIG_RUNNING"
  | "RUN_CONFIG_FAILED"
  | "GIT_NOT_REPOSITORY"
  | "GIT_FAILED"
  | "JAVA_NOT_CONFIGURED"
  | "MAVEN_PROJECT_INVALID"
  | "JAVA_PROCESS_FAILED";

export type ProtocolError = { code: ErrorCode; message: string };

export type Response<T extends RequestType = RequestType> =
  | ({ id: string; ok: true; result: ProtocolOperations[T]["result"] } & (T extends
      | `portTunnel.${string}`
      | "protocol.maintenance"
      | "core.update.check"
      | "core.update.apply"
      | "protocol.handshake"
      | "protocol.keepAlive"
      | "client.presence"
      | "workspace.roots"
      | "workspace.addRoot"
      | "overview.summary"
      | "overview.work"
      | "overview.events"
      ? { rootId?: never }
      : { rootId: WorkspaceRootId }))
  | { id: string; ok: false; error: ProtocolError };
