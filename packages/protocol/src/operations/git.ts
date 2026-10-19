import type {
  GitSummary,
  GitStatusEntry,
  GitUpstreamStatus,
  GitDiffHunk,
  GitConflictWorkspace,
  GitBranch,
  GitTag,
  GitBranchDeletePreview,
  GitCommit,
  GitMergeRef,
  GitMergePreview,
  GitMergeResult,
  GitCommitFile,
  GitCommitPatch,
  GitRollbackFailure,
  GitHistoryRewritePreview,
  GitStash,
  GitStashInclusion,
  GitStashPreview,
  GitPullPreview,
  GitPullStrategy,
  GitPullResult,
  GitRebasePreview,
  GitRebaseTodoItem,
  GitRebaseResult,
} from "../types/git.js";
import type { FileRevision } from "../types/filesystem.js";

export type GitOperations = {
  "git.summary": { payload: { limit?: number; offset?: number }; result: GitSummary };
  "git.status": {
    payload: Record<string, never>;
    result: { branch: string; entries: GitStatusEntry[]; upstream?: GitUpstreamStatus };
  };
  "git.diff": {
    /** With `maxBytes` (1..2 MiB), a diff whose two sides exceed it returns `tooLarge` with empty contents and hunks. */
    payload: { path: string; maxBytes?: number };
    result: {
      path: string;
      originalContent: string;
      modifiedContent: string;
      hunks: GitDiffHunk[];
      tooLarge?: boolean;
    };
  };
  "git.stage": { payload: { path: string; hunk?: GitDiffHunk }; result: Record<string, never> };
  "git.unstage": { payload: { path: string; hunk?: GitDiffHunk }; result: Record<string, never> };
  "git.conflicts": { payload: Record<string, never>; result: GitConflictWorkspace };
  "git.resolveConflict": { payload: { path: string; result: string | null }; result: GitConflictWorkspace };
  "git.conflictAction": { payload: { action: "continue" | "abort" }; result: { outcome: string } };
  "git.branches": { payload: Record<string, never>; result: { branches: GitBranch[] } };
  "git.tags": { payload: Record<string, never>; result: { tags: GitTag[] } };
  "git.createTag": { payload: { name: string; target: string }; result: { tag: GitTag } };
  "git.deleteTag": { payload: { name: string }; result: Record<string, never> };
  "git.checkoutBranch": { payload: { branch: string; remote?: boolean }; result: { branch: string } };
  "git.renameBranch": { payload: { branch: string; newName: string }; result: { branch: string } };
  "git.createBranch": { payload: { name: string }; result: { branch: string } };
  "git.branchDeletePreview": { payload: { branch: string; remote: boolean }; result: GitBranchDeletePreview };
  "git.deleteBranch": {
    payload: { branch: string; remote: boolean; force: boolean; confirm: boolean };
    result: Record<string, never>;
  };
  "git.publishBranch": {
    payload: { branch: string; remote: string; force: boolean; confirm: boolean };
    result: Record<string, never>;
  };
  "git.setBranchUpstream": {
    payload: { branch: string; remote: string; upstream: string; confirm: boolean };
    result: Record<string, never>;
  };
  "git.log": {
    payload: { branch: string; limit?: number; /** Commits to skip, for loading further pages. */ skip?: number };
    result: { commits: GitCommit[]; hasMore: boolean };
  };
  "git.mergePreview": { payload: { source: GitMergeRef }; result: GitMergePreview };
  "git.merge": {
    payload: { source: GitMergeRef; expectedHead: string; expectedRefHead: string; expectedMergeBase: string };
    result: GitMergeResult;
  };
  "git.commitFiles": { payload: { hash: string }; result: { files: GitCommitFile[] } };
  "git.commitMessage": { payload: { hash: string }; result: { message: string } };
  "git.commitDiff": {
    payload: { hash: string; path: string; originalPath?: string };
    result: { originalContent: string; modifiedContent: string };
  };
  "git.cherryPick": { payload: { hash: string; commit: boolean }; result: { branch: string } };
  "git.saveCommitResults": {
    payload: { hash: string; indexVersion: string; files: { path: string; content: string | null }[] };
    result: { applied: number };
  };
  "git.saveCommitWorktreeResults": {
    payload: { hash: string; files: { path: string; content: string | null; expectedRevision?: FileRevision }[] };
    result: { applied: number };
  };
  "git.commitPatch": { payload: { hash: string }; result: GitCommitPatch };
  "git.applyCommitHunks": {
    payload: { hash: string; indexVersion: string; hunkIds: string[] };
    result: { applied: number };
  };
  "git.fileHistory": {
    payload: {
      path: string;
      startLine?: number;
      endLine?: number;
      /** Editor buffer the line range refers to; it is mapped onto committed lines. */ content?: string;
    };
    result: {
      commits: GitCommit[];
      /** Committed line range actually traced, when it differs from the request. */ range?: {
        startLine: number;
        endLine: number;
      };
      note?: string;
    };
  };
  /** Appends a path to the repository's root .gitignore. */
  "git.ignore": { payload: { path: string }; result: { file: string } };
  "git.compareFiles": { payload: { ref: string; path?: string }; result: { files: GitCommitFile[] } };
  "git.compareDiff": {
    payload: { ref: string; path: string; originalPath?: string };
    result: { originalContent: string; modifiedContent: string };
  };
  "git.rollback": { payload: { path: string }; result: Record<string, never> };
  "git.rollbackCompared": { payload: { ref: string; path: string }; result: Record<string, never> };
  "git.rollbackSelected": {
    payload: { paths: string[]; deleteUntracked: boolean };
    result: { rolledBack: string[]; failures: GitRollbackFailure[] };
  };
  "git.commit": { payload: { paths: string[]; message: string }; result: { hash: string } };
  "git.historyRewritePreview": { payload: Record<string, never>; result: GitHistoryRewritePreview };
  "git.amend": { payload: { confirmHistoryRewrite: boolean }; result: { hash: string } };
  "git.undoLastCommit": { payload: { confirmHistoryRewrite: boolean }; result: { undone: string } };
  "git.stashes": { payload: Record<string, never>; result: { stashes: GitStash[] } };
  "git.createStash": {
    payload: { message?: string; paths?: string[]; include: GitStashInclusion };
    result: { stash: GitStash };
  };
  "git.stashPreview": { payload: { reference: string }; result: GitStashPreview };
  "git.applyStash": {
    payload: { reference: string };
    result: { applied: boolean; stashRetained: boolean; outcome: string };
  };
  "git.popStash": {
    payload: { reference: string; confirm: boolean };
    result: { applied: boolean; stashRetained: boolean; outcome: string };
  };
  "git.dropStash": { payload: { reference: string; confirm: boolean }; result: Record<string, never> };
  "git.push": { payload: Record<string, never>; result: Record<string, never> };
  "git.fetch": { payload: Record<string, never>; result: { fetchedAt: string } };
  "git.cancelFetch": { payload: Record<string, never>; result: { cancelled: boolean } };
  "git.pullPreview": { payload: Record<string, never>; result: GitPullPreview };
  "git.pull": {
    payload: { strategy: GitPullStrategy; expectedHead: string; expectedUpstreamHead: string };
    result: GitPullResult;
  };
  "git.rebasePreview": { payload: Record<string, never>; result: GitRebasePreview };
  "git.rebaseStart": {
    payload: { expectedHead: string; expectedUpstreamHead: string; base: string; items: GitRebaseTodoItem[] };
    result: GitRebaseResult;
  };
  "git.rebaseAbort": { payload: Record<string, never>; result: { outcome: string; recovery: string } };
};
