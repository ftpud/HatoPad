import { useState } from "react";
import type { AgentFile, AgentFileScope, FileRevision, FileTreeNode, GitBranch as GitBranchInfo, GitDiffHunk, GitHistoryRewritePreview, GitStatusEntry, JavaTypeSuggestion, RootedJavaLspLocation, RunConfig, RunConfigScope, UsefulFile, UsefulFileScope, WorkspaceTask } from "@hatopad/protocol";
import { type EditorTab } from "./model";

export function useShellDialogs() {

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [storageOpen, setStorageOpen] = useState(false);

  const [aiProvidersOpen, setAiProvidersOpen] = useState(false);

  const [pluginsOpen, setPluginsOpen] = useState(false);

  const [toolsOpen, setToolsOpen] = useState(false);

  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);

  const [mergeDialog, setMergeDialog] = useState<WorkspaceTask>();

  const [runConfigDialog, setRunConfigDialog] = useState<{ scope: RunConfigScope }>();

  const [runConfigMenu, setRunConfigMenu] = useState<{ x: number; y: number; config: RunConfig }>();

  const [usefulDialog, setUsefulDialog] = useState<{ mode: "create" | "rename"; scope: UsefulFileScope; file?: UsefulFile }>();

  const [agentDialog, setAgentDialog] = useState<{ mode: "create" | "rename"; scope: Exclude<AgentFileScope, "workspace">; file?: AgentFile }>();

  const [workspaceRootDialogOpen, setWorkspaceRootDialogOpen] = useState(false);

  const [gitHunkDialog, setGitHunkDialog] = useState<{ x: number; y: number; path: string; hunk: GitDiffHunk; originalContent: string; modifiedContent: string; error?: string }>();

  const [branchMenu, setBranchMenu] = useState<{ branches: GitBranchInfo[]; selected?: string; loading: boolean }>();

  const [gitRollbackDialog, setGitRollbackDialog] = useState<GitStatusEntry[]>();

  const [gitRewriteDialog, setGitRewriteDialog] = useState<{ action: "amend" | "undo"; preview: GitHistoryRewritePreview }>();

  const [gitStashDialog, setGitStashDialog] = useState(false);

  const [gitPullDialog, setGitPullDialog] = useState<{ preview: import("@hatopad/protocol").GitPullPreview; error?: string }>();

  const [gitRebaseDialog, setGitRebaseDialog] = useState<{ preview: import("@hatopad/protocol").GitRebasePreview; error?: string }>();

  const [importChoices, setImportChoices] = useState<{ suggestions: JavaTypeSuggestion[]; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }>();

  const [javaUsages, setJavaUsages] = useState<RootedJavaLspLocation[]>();

  const [showRunConfigurationDialog, setShowRunConfigurationDialog] = useState(false);

  const [treeContextMenu, setTreeContextMenu] = useState<{ x: number; y: number; nodes: FileTreeNode[] }>();

  const [projectPathDialog, setProjectPathDialog] = useState<{ mode: "file" | "directory" | "rename"; node: FileTreeNode; parentPath: string }>();

  const [editorGitMenu, setEditorGitMenu] = useState<{ x: number; y: number; path: string; startLine?: number; endLine?: number; content?: string }>();

  const [gitRollbackMenu, setGitRollbackMenu] = useState<{ x: number; y: number; entry: GitStatusEntry; taskRef?: string }>();

  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tab: EditorTab }>();

  const [quickOpen, setQuickOpen] = useState(false);

  const [workspaceSymbolsOpen, setWorkspaceSymbolsOpen] = useState(false);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const [externalConflict, setExternalConflict] = useState<{ tabId: string; path: string; externalContent: string; externalRevision: FileRevision; error?: string }>();
  return {
    settingsOpen,
    setSettingsOpen,
    storageOpen,
    setStorageOpen,
    aiProvidersOpen,
    setAiProvidersOpen,
    pluginsOpen,
    setPluginsOpen,
    toolsOpen,
    setToolsOpen,
    showCreateTaskDialog,
    setShowCreateTaskDialog,
    mergeDialog,
    setMergeDialog,
    runConfigDialog,
    setRunConfigDialog,
    runConfigMenu,
    setRunConfigMenu,
    usefulDialog,
    setUsefulDialog,
    agentDialog,
    setAgentDialog,
    workspaceRootDialogOpen,
    setWorkspaceRootDialogOpen,
    gitHunkDialog,
    setGitHunkDialog,
    branchMenu,
    setBranchMenu,
    gitRollbackDialog,
    setGitRollbackDialog,
    gitRewriteDialog,
    setGitRewriteDialog,
    gitStashDialog,
    setGitStashDialog,
    gitPullDialog,
    setGitPullDialog,
    gitRebaseDialog,
    setGitRebaseDialog,
    importChoices,
    setImportChoices,
    javaUsages,
    setJavaUsages,
    showRunConfigurationDialog,
    setShowRunConfigurationDialog,
    treeContextMenu,
    setTreeContextMenu,
    projectPathDialog,
    setProjectPathDialog,
    editorGitMenu,
    setEditorGitMenu,
    gitRollbackMenu,
    setGitRollbackMenu,
    tabContextMenu,
    setTabContextMenu,
    quickOpen,
    setQuickOpen,
    workspaceSymbolsOpen,
    setWorkspaceSymbolsOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    externalConflict,
    setExternalConflict
  };
}
