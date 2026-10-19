import { useState } from "react";
import type { GitDiffHunk, GitStatusEntry, GitUpstreamStatus, TaskCheckpoint } from "@hatopad/protocol";

export function useGitPanelState() {

  /** Bumped on every repository change, including commits/pushes made outside HatoPad. */
  const [gitRevision, setGitRevision] = useState(0);

  const [activeGitHunks, setActiveGitHunks] = useState<GitDiffHunk[]>([]);

  const [gitBranch, setGitBranch] = useState("HEAD");

  const [gitEntries, setGitEntries] = useState<GitStatusEntry[]>([]);

  const [gitUpstream, setGitUpstream] = useState<GitUpstreamStatus>();

  const [selectedGitPaths, setSelectedGitPaths] = useState<Set<string>>(new Set());

  const [gitCommitMessage, setGitCommitMessage] = useState("");

  const [gitCommitting, setGitCommitting] = useState(false);

  const [gitPushing, setGitPushing] = useState(false);

  const [gitFetching, setGitFetching] = useState(false);

  const [gitRollingBack, setGitRollingBack] = useState(false);

  const [gitConflictPath, setGitConflictPath] = useState<string>();

  const [gitPulling, setGitPulling] = useState(false);

  const [gitRebasing, setGitRebasing] = useState(false);

  const [taskGitEntries, setTaskGitEntries] = useState<GitStatusEntry[]>([]);

  const [taskCheckpoints, setTaskCheckpoints] = useState<TaskCheckpoint[]>([]);

  const [taskGitError, setTaskGitError] = useState("");

  const [gitError, setGitError] = useState("");

  const [gitLogHeight, setGitLogHeight] = useState(360);

  const [gitHistory, setGitHistory] = useState<{ path: string; startLine?: number; endLine?: number; content?: string }>();
  return {
    gitRevision,
    setGitRevision,
    activeGitHunks,
    setActiveGitHunks,
    gitBranch,
    setGitBranch,
    gitEntries,
    setGitEntries,
    gitUpstream,
    setGitUpstream,
    selectedGitPaths,
    setSelectedGitPaths,
    gitCommitMessage,
    setGitCommitMessage,
    gitCommitting,
    setGitCommitting,
    gitPushing,
    setGitPushing,
    gitFetching,
    setGitFetching,
    gitRollingBack,
    setGitRollingBack,
    gitConflictPath,
    setGitConflictPath,
    gitPulling,
    setGitPulling,
    gitRebasing,
    setGitRebasing,
    taskGitEntries,
    setTaskGitEntries,
    taskCheckpoints,
    setTaskCheckpoints,
    taskGitError,
    setTaskGitError,
    gitError,
    setGitError,
    gitLogHeight,
    setGitLogHeight,
    gitHistory,
    setGitHistory
  };
}
