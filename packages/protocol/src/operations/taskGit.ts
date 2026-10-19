import type { TaskCheckpointFile, TaskCheckpointApplyResult, TaskCheckpointSummary, TaskCheckpoint } from "../types/git.js";

export type TaskGitOperations = {
  "taskGit.files": { payload: { checkpointId: string; direction?: "apply" | "revert"; limit?: number; offset?: number }; result: { files: TaskCheckpointFile[]; totalFiles: number; nextOffset?: number } };
  "taskGit.revert": { payload: { checkpointId: string; paths?: string[] }; result: TaskCheckpointApplyResult };
  "taskGit.summary": { payload: { limit?: number; offset?: number }; result: { checkpoints: TaskCheckpointSummary[]; nextOffset?: number } };
  "taskGit.history": { payload: Record<string, never>; result: { checkpoints: TaskCheckpoint[] } };
  /** Text bodies are capped by Core; callers must not use this as bulk file retrieval. */
  "taskGit.diff": { payload: { checkpointId: string; path: string }; result: { originalContent: string; modifiedContent: string; binary: boolean; truncated: boolean } };
  /** Applies selected checkpoint files only when a three-way comparison has no conflict. Git's index is untouched. */
  "taskGit.review": { payload: { checkpointId: string; paths: string[] }; result: TaskCheckpointApplyResult };
  "taskGit.restore": { payload: { checkpointId: string }; result: TaskCheckpointApplyResult };
};
