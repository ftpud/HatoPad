import type { AiProvider } from "@hatopad/acp";

export type GitStatusEntry = {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  /** Separate Git areas represented by this row; a partially staged file has both index and worktree. */
  states: GitChangeState[];
};

export type GitChangeState = "index" | "worktree" | "untracked" | "conflict";

export type GitConflictOperationKind = "merge" | "rebase" | "cherry-pick" | "stash";

export type GitConflictFile = {
  path: string;
  /** Index stages may be absent for add/delete conflicts. */
  base?: string;
  ours?: string;
  theirs?: string;
  result?: string;
  resultDeleted: boolean;
};

export type GitConflictWorkspace = {
  operation: GitConflictOperationKind;
  files: GitConflictFile[];
  canContinue: boolean;
  canAbort: boolean;
  recovery: string;
};

/** The configured upstream and the last remote information Core successfully obtained. */
export type GitUpstreamStatus = { upstream: string; ahead: number; behind: number; lastFetch?: string };

export type GitPullStrategy = "merge" | "rebase";

export type GitPullPreview = {
  branch: string;
  upstream: string;
  head: string;
  upstreamHead: string;
  fetchedAt: string;
  ahead: number;
  behind: number;
  incoming: GitCommit[];
  incomingTruncated: boolean;
  blockers: GitStatusEntry[];
  recovery: string;
};

export type GitPullResult = {
  strategy: GitPullStrategy;
  branch: string;
  head: string;
  outcome: string;
  recovery: string;
};

export type GitRebaseAction = "pick" | "squash" | "fixup" | "reword" | "drop";

export type GitRebaseTodoItem = { action: GitRebaseAction; commit: GitCommit; message?: string };

/** Core-authoritative, bounded snapshot. Every identity is revalidated before history is changed. */
export type GitRebasePreview = {
  branch: string;
  upstream: string;
  base: string;
  head: string;
  upstreamHead: string;
  items: GitRebaseTodoItem[];
  truncated: boolean;
  blockers: string[];
  recovery: string;
};

export type GitRebaseResult = {
  state: "completed" | "conflicts";
  branch: string;
  head: string;
  outcome: string;
  recovery: string;
};

export type GitBranch = { name: string; current: boolean; remote: boolean };

export type GitBranchDeletePreview = {
  branch: string;
  remote: boolean;
  unmerged: GitCommit[];
  confirmationRequired: boolean;
};

/** A tag stored in this workspace's local Git repository. It is not a remote tag operation. */
export type GitTag = { name: string; target: string; annotated: boolean };

export type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  parents?: string[];
  refs?: string[];
  graph?: string;
  /** File histories: the file's path at this commit, and its previous path when the commit renamed it. */ path?: string;
  originalPath?: string;
};

export type GitMergeRef = { kind: "local-branch" | "remote-branch" | "tag"; name: string };

export type GitMergeOutcome = "already-merged" | "fast-forward" | "merge-commit";

/** A bounded, Core-authoritative local merge preview. The ref identity must be supplied unchanged when applying it. */
export type GitMergePreview = {
  source: GitMergeRef;
  fullRef: string;
  branch: string;
  head: string;
  refHead: string;
  mergeBase: string;
  outcome: GitMergeOutcome;
  incoming: GitCommit[];
  incomingTruncated: boolean;
  blockers: string[];
  recovery: string;
};

export type GitMergeResult = {
  state: "completed" | "conflicts";
  outcome: GitMergeOutcome;
  branch: string;
  head: string;
  message: string;
  recovery: string;
};

export type GitCommitFile = { path: string; status: string; originalPath?: string };

export type GitHistoryRewritePreview = {
  commit: GitCommit;
  commitFiles: GitCommitFile[];
  indexEntries: GitStatusEntry[];
  worktreeEntries: GitStatusEntry[];
  publication: "unpublished" | "published" | "unknown";
  confirmationRequired: boolean;
  canUndo: boolean;
  undoUnavailableReason?: string;
  recovery: string;
};

/** Inclusion is deliberately explicit because Git's default stash behavior excludes untracked and ignored files. */
export type GitStashInclusion = { staged: boolean; unstaged: boolean; untracked: boolean; ignored: boolean };

export type GitStash = { reference: string; hash: string; message: string; branch?: string; date?: string };

export type GitStashPreview = {
  stash: GitStash;
  files: GitCommitFile[];
  conflictRisk: "none" | "possible";
  blockers: string[];
  recovery: string;
};

/** Patch and version are opaque Core-issued values; they prevent applying a hunk after its source changed. */
export type GitDiffHunk = {
  originalStart: number;
  originalLines: number;
  modifiedStart: number;
  modifiedLines: number;
  source: "index" | "worktree";
  patch: string;
  version: string;
};

export type GitCommitPatch = {
  hash: string;
  indexVersion: string;
  files: { path: string; indexContent?: string; reason?: string; hunks: { id: string; content: string }[] }[];
};

export type GitRollbackFailure = { path: string; message: string };

export type TaskCheckpointFile = {
  path: string;
  status: "A" | "M" | "D" | "R";
  originalPath?: string;
  binary: boolean;
  size: number;
};

/** The result of comparing a checkpoint's before/after snapshots with the live worktree. */
export type TaskCheckpointApplyResult = {
  applied: string[];
  alreadyApplied: string[];
  conflicts: { path: string; message: string }[];
};

/** Compact, redacted turn metadata. It deliberately excludes prompt/attachment bodies and logs. */
export type TaskCheckpointProvenance = {
  model?: string;
  reasoning?: string;
  agent?: { name: string; fingerprint: string };
  attachments?: { name: string; mimeType?: string; kind: "image" | "resource" | "resource_link" | "text" }[];
  usage?: { total: number; input: number; output: number; thought?: number; cachedRead?: number; cachedWrite?: number };
  commit?: string;
};

export type TaskCheckpoint = {
  id: string;
  promptId: string;
  sessionId?: string;
  provider: AiProvider;
  prompt: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "interrupted" | "error";
  files: TaskCheckpointFile[];
  provenance?: TaskCheckpointProvenance;
};

/** Content-free bounded Git inventory. Null counts explicitly mean unavailable/binary. */
export type GitSummary = {
  branch: string;
  upstream?: GitUpstreamStatus;
  clean: boolean;
  totalFiles: number;
  conflicts: number;
  additions: number;
  deletions: number;
  unknownCounts: number;
  revision: string;
  nextOffset?: number;
  entries: (GitStatusEntry & {
    additions: number | null;
    deletions: number | null;
    group: "conflicted" | "untracked" | "staged" | "working-tree";
  })[];
};

export type TaskCheckpointSummary = Pick<
  TaskCheckpoint,
  "id" | "promptId" | "provider" | "sessionId" | "startedAt" | "completedAt" | "status"
> & { fileCount: number; additions: number; deletions: number; unknownCounts: number };
