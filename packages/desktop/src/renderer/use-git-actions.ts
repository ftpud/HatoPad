import type { GitPullPreview, GitPullStrategy, GitRebasePreview, GitRebaseTodoItem } from "@hatopad/protocol";
import {
  type GitStatusEntry,
  type GitDiffHunk,
  type WorkspaceTask,
  type GitHistoryRewritePreview,
} from "@hatopad/protocol";
import { isUntrackedGitEntry, executeRollbackSelection } from "./GitRollbackControls";
import { requestConfirm } from "./dialogs";
import { useEffect } from "react";
import { type CoreClient } from "./client";
import { type EditorTab } from "./model";
import { type StatusKind } from "./app-shared";

export interface GitActionsDeps {
  setGitRollbackMenu: React.Dispatch<
    React.SetStateAction<{ x: number; y: number; entry: GitStatusEntry; taskRef?: string } | undefined>
  >;
  gitOperationRunning: boolean;
  gitRollbackRunningRef: React.MutableRefObject<boolean>;
  setGitRollingBack: React.Dispatch<React.SetStateAction<boolean>>;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  refreshTaskGit: (task?: WorkspaceTask | undefined, client?: CoreClient | undefined) => Promise<void>;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
  showStatus: (message: string, kind: StatusKind) => void;
  setStatusMessage: (message: string) => void;
  selectedRollbackEntries: GitStatusEntry[];
  setGitRollbackDialog: React.Dispatch<React.SetStateAction<GitStatusEntry[] | undefined>>;
  gitRollbackDialog: GitStatusEntry[] | undefined;
  gitCommitting: boolean;
  gitPushing: boolean;
  setSelectedGitPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  gitCommitMessage: string;
  selectedGitPaths: Set<string>;
  setGitCommitting: React.Dispatch<React.SetStateAction<boolean>>;
  setGitRewriteDialog: React.Dispatch<
    React.SetStateAction<{ action: "amend" | "undo"; preview: GitHistoryRewritePreview } | undefined>
  >;
  gitRewriteDialog: { action: "amend" | "undo"; preview: GitHistoryRewritePreview } | undefined;
  setGitPushing: React.Dispatch<React.SetStateAction<boolean>>;
  gitFetching: boolean;
  setGitFetching: React.Dispatch<React.SetStateAction<boolean>>;
  setGitPullDialog: React.Dispatch<React.SetStateAction<{ preview: GitPullPreview; error?: string } | undefined>>;
  gitPullDialog: { preview: GitPullPreview; error?: string } | undefined;
  gitPulling: boolean;
  setGitPulling: React.Dispatch<React.SetStateAction<boolean>>;
  setGitRebasing: React.Dispatch<React.SetStateAction<boolean>>;
  setGitRebaseDialog: React.Dispatch<React.SetStateAction<{ preview: GitRebasePreview; error?: string } | undefined>>;
  gitRebaseDialog: { preview: GitRebasePreview; error?: string } | undefined;
  gitRebasing: boolean;
  setGitConflictPath: React.Dispatch<React.SetStateAction<string | undefined>>;
  setGitHunkDialog: React.Dispatch<
    React.SetStateAction<
      | {
          x: number;
          y: number;
          path: string;
          hunk: GitDiffHunk;
          originalContent: string;
          modifiedContent: string;
          error?: string;
        }
      | undefined
    >
  >;
  gitHunkDialog:
    | {
        x: number;
        y: number;
        path: string;
        hunk: GitDiffHunk;
        originalContent: string;
        modifiedContent: string;
        error?: string;
      }
    | undefined;
  selfWriteUntil: React.MutableRefObject<Map<string, number>>;
}

/** Moved from App; statement bodies are unchanged. */
/** Splits into lines that keep their terminators, so a missing or present final newline survives a rollback. */
const terminatedLines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

export function rollbackHunkContent(originalContent: string, modifiedContent: string, hunk: GitDiffHunk): string {
  const start = Math.max(0, hunk.originalStart - 1);
  const originalLines = terminatedLines(originalContent).slice(start, start + hunk.originalLines);
  const nextLines = terminatedLines(modifiedContent);
  nextLines.splice(Math.max(0, hunk.modifiedStart - 1), hunk.modifiedLines, ...originalLines);
  return nextLines.join("");
}

export function useGitActions(deps: GitActionsDeps) {
  const {
    setGitRollbackMenu,
    gitOperationRunning,
    gitRollbackRunningRef,
    setGitRollingBack,
    clientRef,
    updateGroup,
    refreshGit,
    refreshTaskGit,
    refreshTree,
    showStatus,
    setStatusMessage,
    selectedRollbackEntries,
    setGitRollbackDialog,
    gitRollbackDialog,
    gitCommitting,
    gitPushing,
    setSelectedGitPaths,
    gitCommitMessage,
    selectedGitPaths,
    setGitCommitting,
    setGitRewriteDialog,
    gitRewriteDialog,
    setGitPushing,
    gitFetching,
    setGitFetching,
    setGitPullDialog,
    gitPullDialog,
    gitPulling,
    setGitPulling,
    setGitRebasing,
    setGitRebaseDialog,
    gitRebaseDialog,
    gitRebasing,
    setGitConflictPath,
    setGitHunkDialog,
    gitHunkDialog,
    selfWriteUntil,
  } = deps;
  const rollbackFile = async (entry: GitStatusEntry, taskRef?: string) => {
    setGitRollbackMenu(undefined);
    const removesFile = isUntrackedGitEntry(entry) || (taskRef && entry.indexStatus === "A");
    const target = taskRef ?? "HEAD";
    const message = removesFile
      ? `Permanently delete ${entry.path}? This cannot be undone.`
      : `Rollback all staged and unstaged changes in ${entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path} to ${target}? This cannot be undone.`;
    if (
      gitOperationRunning ||
      gitRollbackRunningRef.current ||
      !(await requestConfirm({
        title: removesFile ? "Delete file?" : "Rollback file?",
        message,
        confirmLabel: removesFile ? "Delete" : "Rollback",
        danger: true,
      }))
    )
      return;
    gitRollbackRunningRef.current = true;
    setGitRollingBack(true);
    try {
      if (taskRef) await clientRef.current!.request("git.rollbackCompared", { ref: taskRef, path: entry.path });
      else await clientRef.current!.request("git.rollback", { path: entry.path });
      const paths = entry.originalPath ? [entry.originalPath, entry.path] : [entry.path];
      const restored = new Map<string, string>();
      for (const path of paths) {
        try {
          restored.set(path, (await clientRef.current!.request("filesystem.readFile", { path })).content);
        } catch {
          /* Added files and rename destinations are removed by rollback. */
        }
      }
      updateGroup((tabs, active) => {
        const next = tabs
          .filter(
            (tab) =>
              !(tab.type === "diff" && tab.diffRef === taskRef && paths.includes(tab.diffPath ?? tab.path)) &&
              (!paths.includes(tab.path) || (tab.type === "file" && restored.has(tab.path))),
          )
          .map((tab) =>
            paths.includes(tab.path) && tab.type === "file"
              ? {
                  ...tab,
                  content: restored.get(tab.path)!,
                  savedContent: restored.get(tab.path)!,
                  dirty: false,
                  error: undefined,
                }
              : tab,
          );
        return { tabs: next, activeTabId: next.some((tab) => tab.id === active) ? active : next.at(-1)?.id };
      });
      await Promise.all([refreshGit(), refreshTaskGit(), refreshTree()]);
      showStatus(`Rolled back ${entry.path}${taskRef ? ` to ${taskRef}` : ""}`, "success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not rollback file");
    } finally {
      gitRollbackRunningRef.current = false;
      setGitRollingBack(false);
    }
  };

  const openRollbackSelected = () => {
    if (gitOperationRunning || selectedRollbackEntries.length === 0) return;
    setGitRollbackDialog(selectedRollbackEntries);
  };

  const rollbackSelected = async (deleteUntracked: boolean) => {
    if (
      !clientRef.current ||
      !gitRollbackDialog?.length ||
      gitRollbackRunningRef.current ||
      gitCommitting ||
      gitPushing
    )
      return;
    gitRollbackRunningRef.current = true;
    setGitRollingBack(true);
    showStatus(
      `Rolling back ${gitRollbackDialog.length} selected change${gitRollbackDialog.length === 1 ? "" : "s"}...`,
      "progress",
    );
    const requestedEntries = gitRollbackDialog;
    try {
      const result = await executeRollbackSelection(
        requestedEntries,
        deleteUntracked,
        (paths, confirmed) => clientRef.current!.request("git.rollbackSelected", { paths, deleteUntracked: confirmed }),
        async (rollbackResult) => {
          const rolledBack = new Set(rollbackResult.rolledBack);
          const affectedPaths = new Set(
            requestedEntries
              .filter((entry) => rolledBack.has(entry.path))
              .flatMap((entry) =>
                entry.originalPath && (entry.indexStatus === "R" || entry.worktreeStatus === "R")
                  ? [entry.path, entry.originalPath]
                  : [entry.path],
              ),
          );
          const contents = new Map<string, string>();
          await Promise.all(
            [...affectedPaths].map(async (path) => {
              try {
                contents.set(path, (await clientRef.current!.request("filesystem.readFile", { path })).content);
              } catch {
                /* Deleted and renamed-away paths have no content to refresh. */
              }
            }),
          );
          updateGroup((tabs, active) => {
            const next = tabs
              .filter((tab) => !affectedPaths.has(tab.path) || (tab.type === "file" && contents.has(tab.path)))
              .map((tab) =>
                affectedPaths.has(tab.path) && tab.type === "file"
                  ? {
                      ...tab,
                      content: contents.get(tab.path)!,
                      savedContent: contents.get(tab.path)!,
                      dirty: false,
                      error: undefined,
                    }
                  : tab,
              );
            return { tabs: next, activeTabId: next.some((tab) => tab.id === active) ? active : next.at(-1)?.id };
          });
          await Promise.all([refreshGit(), refreshTaskGit(), refreshTree()]);
        },
      );
      const rolledBack = new Set(result.rolledBack);
      setSelectedGitPaths((current) => new Set([...current].filter((path) => !rolledBack.has(path))));
      setGitRollbackDialog(undefined);
      if (result.failures.length > 0) {
        const detail = result.failures
          .slice(0, 3)
          .map((failure) => `${failure.path}: ${failure.message}`)
          .join("; ");
        showStatus(
          `${result.rolledBack.length} rolled back; ${result.failures.length} failed. ${detail}${result.failures.length > 3 ? `; and ${result.failures.length - 3} more` : ""}`,
          "error",
        );
      } else
        showStatus(
          `Rolled back ${result.rolledBack.length} selected change${result.rolledBack.length === 1 ? "" : "s"}`,
          "success",
        );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not rollback selected changes");
    } finally {
      gitRollbackRunningRef.current = false;
      setGitRollingBack(false);
    }
  };

  const commitSelectedFiles = async (message = gitCommitMessage): Promise<boolean> => {
    if (!clientRef.current || gitOperationRunning || selectedGitPaths.size === 0 || !message.trim()) return false;
    setGitCommitting(true);
    showStatus("Committing selected changes...", "progress");
    try {
      await clientRef.current.request("git.commit", { paths: [...selectedGitPaths], message });
      setSelectedGitPaths(new Set());
      await Promise.all([refreshGit(), refreshTaskGit()]);
      showStatus("Changes committed successfully", "success");
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not commit selected files");
      return false;
    } finally {
      setGitCommitting(false);
    }
  };
  const commitAndPush = async (message: string) => {
    if (await commitSelectedFiles(message)) await pushGit();
  };
  const ignoreGitPath = async (entry: GitStatusEntry) => {
    setGitRollbackMenu(undefined);
    try {
      await clientRef.current!.request("git.ignore", { path: entry.path });
      await Promise.all([refreshGit(), refreshTree()]);
      showStatus(`Added ${entry.path} to .gitignore`, "success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not update .gitignore");
    }
  };
  const copyGitPath = (entry: GitStatusEntry) => {
    setGitRollbackMenu(undefined);
    void window.desktop
      ?.writeClipboard(entry.path)
      .then(() => showStatus("Path copied", "success"))
      .catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : "Could not copy path"));
  };

  const previewHistoryRewrite = async (action: "amend" | "undo") => {
    if (!clientRef.current || gitOperationRunning) return;
    try {
      setGitRewriteDialog({ action, preview: await clientRef.current.request("git.historyRewritePreview", {}) });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not inspect the last commit");
    }
  };

  const executeHistoryRewrite = async (confirmedRisk: boolean) => {
    if (!clientRef.current || !gitRewriteDialog) return;
    setGitCommitting(true);
    try {
      const { action } = gitRewriteDialog;
      await clientRef.current.request(action === "amend" ? "git.amend" : "git.undoLastCommit", {
        confirmHistoryRewrite: confirmedRisk,
      });
      setGitRewriteDialog(undefined);
      setSelectedGitPaths(new Set());
      await Promise.all([refreshGit(), refreshTaskGit()]);
      showStatus(action === "amend" ? "Last commit amended" : "Last commit undone; changes are unstaged", "success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not rewrite the last commit");
    } finally {
      setGitCommitting(false);
    }
  };

  const pushGit = async () => {
    if (!clientRef.current || gitOperationRunning) return;
    setGitPushing(true);
    showStatus("Pushing changes...", "progress");
    try {
      await clientRef.current.request("git.push", {});
      await refreshGit();
      showStatus("Changes pushed successfully", "success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not push");
    } finally {
      setGitPushing(false);
    }
  };

  const fetchGit = async () => {
    if (!clientRef.current) return;
    if (gitFetching) {
      await clientRef.current.request("git.cancelFetch", {});
      return;
    }
    if (gitOperationRunning) return;
    setGitFetching(true);
    showStatus("Fetching remote changes...", "progress");
    try {
      await clientRef.current.request("git.fetch", {});
      await refreshGit();
      showStatus("Remote changes fetched successfully", "success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not fetch remote changes");
    } finally {
      setGitFetching(false);
    }
  };

  const previewPull = async () => {
    if (!clientRef.current || gitOperationRunning) return;
    setGitFetching(true);
    showStatus("Fetching and preparing pull preview…", "progress");
    try {
      const preview = await clientRef.current.request("git.pullPreview", {});
      setGitPullDialog({ preview });
      await refreshGit();
      showStatus("Pull preview ready", "success");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Could not prepare pull preview", "error");
    } finally {
      setGitFetching(false);
    }
  };

  const executePull = async (strategy: GitPullStrategy) => {
    if (!clientRef.current || !gitPullDialog || gitPulling) return;
    setGitPulling(true);
    setGitPullDialog((current) => (current ? { preview: current.preview } : current));
    showStatus(`Fetching again, then pulling with ${strategy}…`, "progress");
    try {
      const result = await clientRef.current.request("git.pull", {
        strategy,
        expectedHead: gitPullDialog.preview.head,
        expectedUpstreamHead: gitPullDialog.preview.upstreamHead,
      });
      setGitPullDialog(undefined);
      await Promise.all([refreshGit(), refreshTree()]);
      showStatus(`${result.outcome} ${result.recovery}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not pull with ${strategy}`;
      setGitPullDialog((current) => (current ? { ...current, error: message } : current));
      await Promise.all([refreshGit(), refreshTree()]);
      showStatus(message, "error");
    } finally {
      setGitPulling(false);
    }
  };

  useEffect(() => {
    const listener = () => void previewPull();
    window.addEventListener("hatopad:git-pull", listener);
    return () => window.removeEventListener("hatopad:git-pull", listener);
  }, [gitOperationRunning]);

  const previewInteractiveRebase = async () => {
    if (!clientRef.current || gitOperationRunning) return;
    setGitRebasing(true);
    showStatus("Preparing interactive rebase preview…", "progress");
    try {
      const preview = await clientRef.current.request("git.rebasePreview", {});
      setGitRebaseDialog({ preview });
      showStatus("Interactive rebase preview ready", "success");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Could not prepare interactive rebase", "error");
    } finally {
      setGitRebasing(false);
    }
  };

  const executeInteractiveRebase = async (items: GitRebaseTodoItem[]) => {
    if (!clientRef.current || !gitRebaseDialog || gitRebasing) return;
    setGitRebasing(true);
    setGitRebaseDialog((current) => (current ? { preview: current.preview } : current));
    showStatus("Running interactive rebase…", "progress");
    try {
      const preview = gitRebaseDialog.preview;
      const result = await clientRef.current.request("git.rebaseStart", {
        expectedHead: preview.head,
        expectedUpstreamHead: preview.upstreamHead,
        base: preview.base,
        items,
      });
      setGitRebaseDialog(undefined);
      await Promise.all([refreshGit(), refreshTree()]);
      if (result.state === "conflicts") {
        const conflicts = await clientRef.current.request("git.conflicts", {});
        setGitConflictPath(conflicts.files[0]?.path ?? "");
        showStatus(`${result.outcome} Resolve the conflicts, then continue or abort.`, "error");
      } else showStatus(`${result.outcome} ${result.recovery}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Interactive rebase failed";
      setGitRebaseDialog((current) => (current ? { ...current, error: message } : current));
      await refreshGit();
      showStatus(message, "error");
    } finally {
      setGitRebasing(false);
    }
  };

  useEffect(() => {
    const listener = () => void previewInteractiveRebase();
    window.addEventListener("hatopad:git-rebase", listener);
    return () => window.removeEventListener("hatopad:git-rebase", listener);
  }, [gitOperationRunning]);

  const openGitHunkDialog = async (path: string, hunk: GitDiffHunk, x: number, y: number) => {
    if (!clientRef.current) return;
    try {
      const result = await clientRef.current.request("git.diff", { path });
      const current =
        result.hunks.find(
          (item) => item.originalStart === hunk.originalStart && item.modifiedStart === hunk.modifiedStart,
        ) ?? hunk;
      setGitHunkDialog({
        x: Math.min(x + 8, window.innerWidth - 430),
        y: Math.min(y, window.innerHeight - 300),
        path,
        hunk: current,
        originalContent: result.originalContent,
        modifiedContent: result.modifiedContent,
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not load change block");
    }
  };

  const rollbackGitHunk = async () => {
    if (
      !clientRef.current ||
      !gitHunkDialog ||
      !(await requestConfirm({
        title: "Rollback change block?",
        message: `Rollback this change block in ${gitHunkDialog.path}?`,
        confirmLabel: "Rollback",
        danger: true,
      }))
    )
      return;
    const { path, hunk, originalContent, modifiedContent } = gitHunkDialog;
    const content = rollbackHunkContent(originalContent, modifiedContent, hunk);
    try {
      selfWriteUntil.current.set(path, Date.now() + 1500);
      await clientRef.current.request("filesystem.writeFile", { path, content });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((tab) =>
          tab.type === "file" && tab.path === path
            ? { ...tab, content, savedContent: content, dirty: false, error: undefined }
            : tab,
        ),
        activeTabId: active,
      }));
      setGitHunkDialog(undefined);
      await Promise.all([refreshGit(), refreshTree()]);
    } catch (error) {
      setGitHunkDialog((current) =>
        current
          ? { ...current, error: error instanceof Error ? error.message : "Could not rollback change block" }
          : current,
      );
    }
  };

  const updateGitIndex = async (action: "stage" | "unstage", path: string, hunk?: GitDiffHunk) => {
    if (!clientRef.current || gitOperationRunning) return;
    try {
      await clientRef.current.request(
        action === "stage" ? "git.stage" : "git.unstage",
        hunk ? { path, hunk } : { path },
      );
      setGitHunkDialog(undefined);
      await Promise.all([refreshGit(), refreshTaskGit()]);
      showStatus(`${action === "stage" ? "Staged" : "Unstaged"} ${hunk ? "change block" : path}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not ${action} change`;
      if (hunk) setGitHunkDialog((current) => (current ? { ...current, error: message } : current));
      else setStatusMessage(message);
    }
  };
  return {
    rollbackFile,
    openRollbackSelected,
    rollbackSelected,
    commitSelectedFiles,
    commitAndPush,
    ignoreGitPath,
    copyGitPath,
    previewHistoryRewrite,
    executeHistoryRewrite,
    pushGit,
    fetchGit,
    previewPull,
    executePull,
    previewInteractiveRebase,
    executeInteractiveRebase,
    openGitHunkDialog,
    rollbackGitHunk,
    updateGitIndex,
  };
}
