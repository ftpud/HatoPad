import { useShellDialogs } from "./use-shell-dialogs";
import { useGitPanelState } from "./use-git-panel-state";
import { useProjectPanelState } from "./use-project-panel-state";
import { useEditorState } from "./use-editor-state";
import { useConfigurationPanels } from "./use-configuration-panels";
import { useLanguagePanelState } from "./use-language-panel-state";
import { useProcessesState } from "./use-processes-state";
import { useAiSessionState } from "./use-ai-session-state";
import { useWorkspaceTasks } from "./use-workspace-tasks";
import { usePanelLayout } from "./use-panel-layout";
import { TaskCheckpointHistory } from "./TaskCheckpointHistory";
import { TaskRow, formatAiStatus } from "./TaskRow";
import { ResizablePanelStack } from "./ResizablePanelStack";
import { QuickFilter } from "./QuickFilter";
import { JavaProjectTree } from "./JavaProjectTree";
import { ExternalChangeConflict, ProjectPathDialog, WorkspaceRootDialog, RunConfigDialog } from "./WorkspaceDialogs";
import { MergeTaskDialog, CreateTaskDialog } from "./TaskDialogs";
import { AgentsPanel, AgentPicker, AgentDialog, agentKey } from "./AgentsPanel";
import { UsefulFileSection, UsefulFileDialog } from "./UsefulFileSection";
import { GitChangesView } from "./GitChangesPanel";
import { ConnectionScreen, ConnectionStatus } from "./ConnectionScreen";
import {
  keyboardResize,
  selectedLineRange,
  gitHunkDecorations,
  ParsedHttpRequest,
  parseHttpRequests,
} from "./editor-helpers";
import { AuthenticationClientContext } from "./AiAuthentication";
import { flushSync } from "react-dom";
import { SidebarExtentButton } from "./SidebarExtentButton";
import { FocusDock } from "./FocusDock";
import { FocusModeButton } from "./FocusModeButton";
import { openWorkflowEditor } from "./workflow-tabs";
import { ContextMenu } from "./ContextMenu";
import { BranchPicker } from "./BranchPicker";
import { ConnectionMenu } from "./ConnectionMenu";
import { startBackgroundLoading } from "./background-loading";
import { javaConfigurationPath, resolveSkillIds, skillAllowedForAgent } from "@hatopad/protocol";
import { DiffEditor, type Monaco } from "@monaco-editor/react";
import {
  Bookmark,
  GraduationCap,
  Sparkles,
  History,
  Minus,
  RotateCcw,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  ClipboardCopy,
  Zap,
  Coffee,
  Columns2,
  Eye,
  EyeOff,
  File,
  FileDiff,
  FileText,
  Folder,
  GitBranch,
  GitCompareArrows,
  ListTodo,
  ListTree,
  LoaderCircle,
  Package,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Square,
  SquareTerminal,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AgentFile,
  AiConfiguration,
  AiProvider,
  AiSession,
  FileColor,
  FileTreeNode,
  GitBranch as GitBranchInfo,
  GitDiffHunk,
  GitStatusEntry,
  HarnessDefinition,
  HarnessRun,
  JavaApplyChangesResult,
  LanguageDebugCommand,
  JavaProjectOptions,
  JavaTypeSuggestion,
  RootedJavaDiagnostic,
  RootedJavaLspLocation,
  RootedWorkspaceSymbol,
  RunConfig,
  RunConfigScope,
  SearchResult,
  TaskCheckpoint,
  TaskCheckpointFile,
  UsefulFile,
  WorkspaceOptions,
  WorkspaceTask,
} from "@hatopad/protocol";
import type { editor } from "monaco-editor";

import { mergeWorkflowHistory, workflowRunsForContext } from "./workflow-context";
import { InvalidationRefreshes } from "./invalidation-refreshes";
import { CoalescedAsyncAction, CoreClient } from "./client";
import { startPresenceReporting } from "./presence";
import {
  ConnectionRecovery,
  recoveryFailureFeedback,
  reconnectWorkspace,
  restoreTerminal,
  type RecoverySelection,
} from "./connection-recovery";
import { recoverEditorGroups, workspaceRestorationGuard } from "./workspace-recovery";
import { remoteUploadDestination, treeContainsPath } from "./remote-transfer";
import {
  hasWorkspaceSetting,
  readSetting,
  readSettingNumber,
  readWorkspaceSetting,
  resetWorkspaceSetting,
  workspaceSettingKey,
  writeSetting,
  writeWorkspaceSetting,
} from "./settings";
import { SettingsMenu, type DesktopSettings } from "./SettingsMenu";
import { AiProvidersPanel } from "./AiProvidersPanel";
import { ToolsPanel } from "./ToolsPanel";
import { DialogHost, gitRefNameError, requestConfirm, requestFields, requestText } from "./dialogs";
import { StoragePanel } from "./StoragePanel";
import { PluginsPanel } from "./PluginsPanel";
import { readAiPromptDraft, writeAiPromptDraft } from "./ai-prompt-drafts";
import { editorTabLabel, initialLayout, type EditorTab, type LayoutModel, type Panel } from "./model";
import { TerminalPanel } from "./TerminalPanel";
import { clearViewedTerminalActivity, markTerminalActivity } from "./terminal-activity";
import { JavaConfigurationDialog } from "./plugins/languages/java";
import { languageClient, loadJavaProjectTree } from "./language-client";
import { attachDebugEditor } from "./debug-editor";
import { RunConfigurationToolbar } from "./RunConfigurationToolbar";
import { projectRegistration, runProject, type RunProjectProcess } from "./run-projects";
import { GenericProjectConfigurationDialog } from "./GenericProjectConfigurationDialog";
import { projectConfigurationEditors } from "./plugins/languages/configuration-editors";
import { JavaPanel } from "./plugins/languages/java";
import { ProblemsPanel } from "./ProblemsPanel";
import { GitLogPanel } from "./GitLogPanel";
import { GitHistoryDialog } from "./GitHistoryDialog";
import { DiffNavigation } from "./DiffNavigation";
import {
  GitToolbarActions,
  RollbackSelectedDialog,
  executeRollbackSelection,
  isUntrackedGitEntry,
  selectedGitEntries,
  shouldApplyGitStatus,
} from "./GitRollbackControls";
import { GitCommitPanel } from "./GitCommitPanel";
import { GitHistoryRewriteDialog } from "./GitHistoryRewriteDialog";
import { GitStashDialog } from "./GitStashDialog";
import { GitPullDialog } from "./GitPullDialog";
import { GitRebaseDialog } from "./GitRebaseDialog";
import { GitChangesView as KeyboardGitChangesView } from "./GitChangesView";
import { GitConflictWorkspaceDialog } from "./GitConflictWorkspace";
import { SkillsPanel, type SkillsActions } from "./SkillsPanel";
import { AiPanel, type AiAttachment } from "./AiPanel";
import { ProcessesPanel } from "./ProcessesPanel";
import { TimersPanel } from "./TimersPanel";
import { TriggersPanel } from "./TriggersPanel";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import { workflowDocumentOptions, restoreWorkflowDocuments } from "./workflow-documents";
import { HarnessPanel } from "./HarnessPanel";
import type { PermissionRequestOwner } from "./PermissionRequestActions";
import { openTaskFromSummary } from "./permission-navigation";
import { functionStartDecorations, navigationFunctionStarts } from "./function-markers";
import { configureMonacoThemes, monacoTheme, type HighlightTheme } from "./theme";
import { CURSOR_POSITIONS_SETTING, CursorPositionStore, validateCursorPosition } from "./cursor-state";
import { MarkdownPreview } from "./MarkdownPreview";
import { FindInFilesDialog } from "./FindInFilesDialog";
import {
  restoredFocusedLeftPanels,
  initialTaskPanel,
  switchedTaskPanel,
  taskPanelPreferenceKey,
  type ClassicTaskPanel,
} from "./task-panel-state";
import { ProjectTree } from "./ProjectTree";

import { menuPosition } from "./menu-position";
import { projectTreeActions, type ProjectTreeAction } from "./project-tree-actions";
import { copyProjectTreeActions } from "./project-context-menu";
import { QuickOpenDialog, workspaceFiles } from "./QuickOpenDialog";
import { CommandPalette } from "./CommandPalette";
import { WorkspaceSymbolDialog } from "./WorkspaceSymbolDialog";
import {
  languageCommands,
  commandEnabled,
  defaultShortcutBindings,
  desktopPlatform,
  shortcutMatches,
  type Command,
  type CommandContext,
  type CommandId,
} from "./command-registry";
import {
  KEYBOARD_SHORTCUTS_SETTING,
  migrateShortcutSetting,
  parseShortcutSetting,
  serializeShortcutSetting,
  updateShortcut,
} from "./keyboard-shortcuts";
import { EditorStatusBar, type EditorStatusBarHandle } from "./EditorStatusBar";
import { adjacentEditorTabId, editorShortcutEligible, editorTabShortcut } from "./editor-shortcuts";
import { orderPinnedTabs, pinnedFilePaths, togglePinnedTab } from "./pinned-tabs";
import { EditorViewStateStore } from "./editor-view-state";
import { StableEditor } from "./StableEditor";
import { reconcileProjectTree } from "./project-tree-reconciliation";
import { NavigationHistory, type EditorLocation } from "./navigation-history";
import { ModalFocusManager } from "./accessibility";
import {
  aiAgentTaskKey,
  aiProviderTaskKey,
  fileColorChoices,
  languageByExtension,
  reviewOutcome,
  type AiSnapshotToken,
  type BottomPanelType,
  type StatusKind,
} from "./app-shared";
import { useHarnessActions } from "./use-harness-actions";
import { useGitActions } from "./use-git-actions";
import { useEditorTabActions } from "./use-editor-tab-actions";
import { useAiActions } from "./use-ai-actions";
import { useTaskActions } from "./use-task-actions";
import { useFileOpeners } from "./use-file-openers";
import { useNoteAndAgentFiles } from "./use-note-and-agent-files";

export function App() {
  const workspaceKeyRef = useRef("");
  const workspaceDefaultsRef = useRef(new Set<keyof DesktopSettings>());
  const wsSave = (key: string, value: string) => {
    if (workspaceDefaultsRef.current.has(key as keyof DesktopSettings)) writeSetting(key, value);
    else writeWorkspaceSetting(workspaceKeyRef.current, key, value);
  };
  const [theme, setTheme] = useState<"dark" | "light">(() => (readSetting("theme") === "dark" ? "dark" : "light"));
  const [highlightTheme, setHighlightTheme] = useState<HighlightTheme>(() => {
    const value = readSetting("highlightTheme");
    return value === "ftpud" || value === "ftpud-dark" ? "ftpud" : "default";
  });
  const [uiFontFamily, setUiFontFamily] = useState<"jetbrains" | "inter">(() =>
    readSetting("uiFontFamily") === "jetbrains" ? "jetbrains" : "inter",
  );
  const [uiFontWeight, setUiFontWeight] = useState(() => readSettingNumber("uiFontWeight", 450, 350, 600));
  const [uiFontSize, setUiFontSize] = useState(() => readSettingNumber("uiFontSize", 13, 10, 20));
  const [uiLineHeight, setUiLineHeight] = useState(() => readSettingNumber("uiLineHeight", 1.2, 1, 2));
  const {
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
    setExternalConflict,
  } = useShellDialogs();
  const {
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
    setGitHistory,
  } = useGitPanelState();
  const platform = useMemo(desktopPlatform, []);
  const [shortcutBindings, setShortcutBindings] = useState(() => {
    const stored = readSetting(KEYBOARD_SHORTCUTS_SETTING);
    const migrated = migrateShortcutSetting(stored, desktopPlatform());
    if (migrated) writeSetting(KEYBOARD_SHORTCUTS_SETTING, migrated);
    return parseShortcutSetting(stored, desktopPlatform());
  });
  const changeShortcut = (id: CommandId, shortcut?: string) =>
    setShortcutBindings((current) => {
      const next = updateShortcut(current, id, shortcut);
      writeSetting(KEYBOARD_SHORTCUTS_SETTING, serializeShortcutSetting(next));
      return next;
    });
  const resetShortcuts = () => {
    const next = defaultShortcutBindings(platform);
    setShortcutBindings(next);
    writeSetting(KEYBOARD_SHORTCUTS_SETTING, serializeShortcutSetting(next));
  };
  const [, setSettingsRevision] = useState(0);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.desktop?.setWindowTheme?.(theme);
    document.documentElement.style.colorScheme = theme;
    wsSave("theme", theme);
  }, [theme]);
  useEffect(() => {
    wsSave("highlightTheme", highlightTheme);
  }, [highlightTheme]);
  useEffect(() => {
    const value = uiFontFamily === "jetbrains" ? '"JetBrains Mono Variable"' : '"Inter Variable"';
    document.documentElement.style.setProperty("--ui-font-family", value);
    wsSave("uiFontFamily", uiFontFamily);
  }, [uiFontFamily]);
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-weight", String(uiFontWeight));
    wsSave("uiFontWeight", String(uiFontWeight));
  }, [uiFontWeight]);
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
    wsSave("uiFontSize", String(uiFontSize));
  }, [uiFontSize]);
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-line-height", String(uiLineHeight));
    wsSave("uiLineHeight", String(uiLineHeight));
  }, [uiLineHeight]);
  const saved = useMemo(() => {
    try {
      return JSON.parse(readSetting("connection") ?? "{}") as Partial<{ host: string; port: string }>;
    } catch {
      return {};
    }
  }, []);
  const launchConfig = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      host: params.get("host") ?? undefined,
      port: params.get("port") ?? undefined,
      rootId: params.get("rootId") ?? undefined,
      cloudOrigin: params.get("cloudOrigin") ?? undefined,
    };
  }, []);
  const [host, setHost] = useState(launchConfig.host ?? saved.host ?? "127.0.0.1");
  const [port, setPort] = useState(launchConfig.port ?? saved.port ?? "7331");
  const cloudConnection = Boolean(
    launchConfig.cloudOrigin && host.trim() === launchConfig.host && port === launchConfig.port,
  );
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [statusMessage, setStatusMessageState] = useState("");
  const [statusKind, setStatusKind] = useState<StatusKind>("error");
  const [lastDeleted, setLastDeleted] = useState<{ recoveryId: string; path: string }>();
  const setStatusMessage = useCallback(
    (message: string) => {
      if (cloudConnection && message.endsWith("[workspace.saveOptions]")) return;
      setStatusKind("error");
      setStatusMessageState(message);
    },
    [cloudConnection],
  );
  const showStatus = useCallback((message: string, kind: StatusKind) => {
    setStatusKind(kind);
    setStatusMessageState(message);
  }, []);
  const {
    tree,
    setTree,
    projectFilter,
    setProjectFilter,
    projectContentFilter,
    setProjectContentFilter,
    projectContentPaths,
    setProjectContentPaths,
    projectContentFilterLoading,
    setProjectContentFilterLoading,
    showIgnored,
    setShowIgnored,
    activeWorkspace,
    setActiveWorkspace,
    projectName,
    setProjectName,
    workspaceRoots,
    setWorkspaceRoots,
    selectedRootId,
    setSelectedRootId,
    projectSelection,
    setProjectSelection,
    projectTransfer,
    setProjectTransfer,
  } = useProjectPanelState();
  const showIgnoredRef = useRef(showIgnored);
  const {
    layout,
    setLayout,
    terminalHeight,
    setTerminalHeight,
    fileColors,
    setFileColors,
    httpResult,
    setHttpResult,
    workspaceOptionsReady,
    setWorkspaceOptionsReady,
    draggedTabId,
    setDraggedTabId,
    searchScope,
    setSearchScope,
    searchQueries,
    setSearchQueries,
    pendingNavigation,
    setPendingNavigation,
  } = useEditorState();
  const [focusMode, setFocusMode] = useState(() => readSetting("focusMode") === "true");
  const changeFocusMode = (active: boolean) => {
    const update = () => {
      writeSetting("focusMode", String(active));
      setFocusMode(active);
      setSettingsOpen(false);
      setBranchMenu(undefined);
    };
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const transition = document.startViewTransition(() => flushSync(update));
      void transition.ready.catch(() => undefined);
      void transition.finished.catch(() => undefined);
    } else update();
  };
  const {
    sideLayout,
    setSideLayout,
    leftSidebarExtended,
    setLeftSidebarExtended,
    rightSidebarExtended,
    setRightSidebarExtended,
    leftSidebarWidth,
    setLeftSidebarWidth,
    rightSidebarWidth,
    setRightSidebarWidth,
    workflowPanelMode,
    setWorkflowPanelMode,
    leftPanels,
    setLeftPanels,
    rightPanels,
    setRightPanels,
    classicSideView,
    setClassicSideView,
    classicLeftWidth,
    setClassicLeftWidth,
    classicRightWidth,
    setClassicRightWidth,
    classicTasksOpen,
    setClassicTasksOpen,
    classicAiOpen,
    setClassicAiOpen,
    classicSplit,
    setClassicSplit,
  } = usePanelLayout(workspaceKeyRef);
  const {
    tasks,
    setTasks,
    taskFilter,
    setTaskFilter,
    taskLifecycleFilter,
    setTaskLifecycleFilter,
    selectedTaskId,
    setSelectedTaskId,
    activeTaskRef,
    selectedTaskIdRef,
    taskSwitching,
    setTaskSwitching,
    taskSwitchSequence,
    taskSwitchActive,
    queuedTaskSwitch,
    switchTaskRef,
  } = useWorkspaceTasks();
  const {
    usefulFiles,
    setUsefulFiles,
    runConfigs,
    setRunConfigs,
    agents,
    setAgents,
    harnesses,
    setHarnesses,
    harnessRuns,
    setHarnessRuns,
    harnessDiagnostics,
    setHarnessDiagnostics,
    selectedAgentKey,
    setSelectedAgentKey,
    harnessesLoading,
    setHarnessesLoading,
    harnessRunsLoading,
    setHarnessRunsLoading,
  } = useConfigurationPanels();
  useEffect(() => {
    const listener = (event: Event) => setRunConfigDialog({ scope: (event as CustomEvent<RunConfigScope>).detail });
    window.addEventListener("hatopad:create-run-config", listener);
    return () => window.removeEventListener("hatopad:create-run-config", listener);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("hatopad:run-configs", { detail: runConfigs }));
  }, [runConfigs]);
  useEffect(() => {
    const listener = () => window.dispatchEvent(new CustomEvent("hatopad:run-configs", { detail: runConfigs }));
    window.addEventListener("hatopad:request-run-configs", listener);
    return () => window.removeEventListener("hatopad:request-run-configs", listener);
  }, [runConfigs]);
  const harnessRunsRef = useRef(harnessRuns);
  harnessRunsRef.current = harnessRuns;
  const selectedRootIdRef = useRef("");
  const selectWorkspaceRootRef = useRef<(rootId: string) => Promise<void>>(async () => undefined);
  const {
    aiSession,
    setAiSession,
    skillCatalog,
    setSkillCatalog,
    aiSessions,
    setAiSessions,
    aiProvider,
    setAiProvider,
    aiModels,
    setAiModels,
    aiModelsLoading,
    setAiModelsLoading,
    aiProviders,
    setAiProviders,
    aiUsage,
    setAiUsage,
    aiAttachments,
    setAiAttachments,
    emptyAiSummary,
    aiStatuses,
    setAiStatuses,
    schedules,
    setSchedules,
    triggers,
    setTriggers,
    activeTimers,
    setActiveTimers,
    aiStatusesRequested,
    aiStatusesApplied,
    aiSessionRequested,
    aiSessionApplied,
  } = useAiSessionState();
  const gitStatusRequested = useRef(0);
  const {
    languages,
    setLanguages,
    runProjects,
    setRunProjects,
    runProjectProcesses,
    setRunProjectProcesses,
    runProjectBusy,
    setRunProjectBusy,
    selectedLanguage,
    setSelectedLanguage,
    javaOptions,
    setJavaOptions,
    javaTree,
    setJavaTree,
    javaLog,
    setJavaLog,
    javaRunning,
    setJavaRunning,
    javaDebugState,
    setJavaDebugState,
    javaBreakpoints,
    setJavaBreakpoints,
    javaPanelHeight,
    setJavaPanelHeight,
    problemsHeight,
    setProblemsHeight,
    javaDiagnostics,
    setJavaDiagnostics,
    javaChecking,
    setJavaChecking,
  } = useLanguagePanelState();
  const [runConfigurationEditor, setRunConfigurationEditor] = useState<string>();
  const runProjectGeneration = useRef(0);
  const openRunConfigurations = (language?: string) => {
    const projectLanguage = language ?? selectedLanguage ?? runProjects[0]?.language;
    if (projectLanguage) {
      setSelectedLanguage(projectLanguage);
      setRunConfigurationEditor(projectLanguage);
    }
  };
  const debugEditorRef = useRef<ReturnType<typeof attachDebugEditor>>();
  const javaDebugStateRef = useRef(javaDebugState);
  javaDebugStateRef.current = javaDebugState;
  useEffect(
    () =>
      window.desktop?.onProjectTransferProgress((progress) =>
        setProjectTransfer((current) => {
          if (!current || current.operationId !== progress.operationId) return current;
          if (progress.error) {
            showStatus(progress.error, "error");
            return undefined;
          }
          if (progress.done) {
            setStatusMessage(`${current.label} complete`);
            void refreshTree();
            return undefined;
          }
          showStatus(
            `${current.label}: ${Math.floor((progress.bytes / Math.max(1, progress.total)) * 100)}%`,
            "progress",
          );
          return { ...current, bytes: progress.bytes };
        }),
      ),
    [],
  );

  const uploadToWorkspace = async (node: FileTreeNode) => {
    if (!window.desktop || !clientRef.current) return showStatus("Uploads require the Electron desktop app", "error");
    try {
      const local = await window.desktop.chooseUpload();
      if (!local) return;
      const destination = remoteUploadDestination(node, local.name);
      const overwrite = treeContainsPath(tree, destination);
      if (overwrite && !window.confirm(`${local.name} already exists in this workspace. Replace it?`)) return;
      const ticket = await clientRef.current.request("filesystem.remoteTransferBegin", {
        direction: "upload",
        path: destination,
        size: local.size,
        overwrite,
        mode: 0o644,
      });
      const started = await window.desktop.startProjectTransfer({
        localId: local.id,
        token: ticket.token,
        host,
        port: Number(port),
        direction: "upload",
        size: ticket.size,
      });
      setProjectTransfer({
        operationId: started.operationId,
        token: ticket.token,
        label: `Uploading ${ticket.name}`,
        bytes: 0,
        total: ticket.size,
      });
      showStatus(`Uploading ${ticket.name}: 0%`, "progress");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Could not upload file", "error");
    }
  };
  const downloadFromWorkspace = async (node: FileTreeNode) => {
    if (!window.desktop || !clientRef.current || node.type !== "file")
      return showStatus("Downloads require a workspace file in the Electron desktop app", "error");
    try {
      const ticket = await clientRef.current.request("filesystem.remoteTransferBegin", {
        direction: "download",
        path: node.path,
      });
      const local = await window.desktop.chooseDownload(ticket.name);
      if (!local) {
        await clientRef.current.request("filesystem.remoteTransferCancel", { token: ticket.token });
        return;
      }
      const started = await window.desktop.startProjectTransfer({
        localId: local.id,
        token: ticket.token,
        host,
        port: Number(port),
        direction: "download",
        size: ticket.size,
      });
      setProjectTransfer({
        operationId: started.operationId,
        token: ticket.token,
        label: `Downloading ${ticket.name}`,
        bytes: 0,
        total: ticket.size,
      });
      showStatus(`Downloading ${ticket.name}: 0%`, "progress");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Could not download file", "error");
    }
  };
  const cancelProjectTransfer = async () => {
    const current = projectTransfer;
    if (!current || !window.desktop || !clientRef.current) return;
    await Promise.allSettled([
      window.desktop.cancelProjectTransfer(current.operationId),
      clientRef.current.request("filesystem.remoteTransferCancel", { token: current.token }),
    ]);
    setProjectTransfer(undefined);
    setStatusMessage("Transfer cancelled");
  };
  const clientRef = useRef<CoreClient>();
  useEffect(() => startPresenceReporting(() => clientRef.current), []);
  const recoveryRef = useRef<ConnectionRecovery>();
  const invalidationRefreshes = useRef<InvalidationRefreshes>();
  const {
    managedProcessList,
    setManagedProcessList,
    processLoading,
    setProcessLoading,
    processError,
    setProcessError,
  } = useProcessesState();
  const processSequence = useRef(0);
  const processLoadedRoot = useRef<string>();
  const refreshProcesses = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client || !client.isConnected() || !canApply()) return;
    const root = client.getRoot();
    const sequence = ++processSequence.current;
    const current = () =>
      canApply() && clientRef.current === client && client.isConnected() && root === client.getRoot();
    setProcessLoading(processLoadedRoot.current !== root);
    try {
      const result = await client.request("processes.list", {});
      if (sequence === processSequence.current && current()) {
        processLoadedRoot.current = root;
        setManagedProcessList(result.processes);
        setProcessError("");
      }
    } catch (error) {
      if (sequence === processSequence.current && current())
        setProcessError(error instanceof Error ? error.message : "Could not load processes. Refresh to retry.");
    } finally {
      if (sequence === processSequence.current && current()) setProcessLoading(false);
    }
  }, []);
  useEffect(() => {
    processLoadedRoot.current = undefined;
    ++processSequence.current;
    setManagedProcessList([]);
    setProcessError("");
    void refreshProcesses();
  }, [selectedRootId, refreshProcesses]);
  const projectContentFilterVersion = useRef(0);
  const gitRollbackRunningRef = useRef(false);
  const aiProviderRef = useRef<AiProvider>(readSetting("aiProvider") ?? "");
  const didAutoConnect = useRef(false);
  const layoutRef = useRef(layout);
  const navigationHistory = useRef(new NavigationHistory());
  const treeRefreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const gitRefreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const javaRefreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const javaCheckTimer = useRef<ReturnType<typeof setTimeout>>();
  const selfWriteUntil = useRef(new Map<string, number>());
  const terminalWriters = useRef(new Map<string, (data: string, replay?: boolean) => void>());
  const terminalBuffers = useRef(new Map<string, string>());
  const markdownBlockTerminals = useRef(new Map<string, string>());
  const monacoEditorRef = useRef<editor.IStandaloneCodeEditor>();
  const editorViewStatesRef = useRef<EditorViewStateStore>();
  const editorViewStates = (editorViewStatesRef.current ??= new EditorViewStateStore());
  const monacoDiffEditorRef = useRef<editor.IStandaloneDiffEditor>();
  const editorStatusBarRef = useRef<EditorStatusBarHandle>(null);
  const monacoRef = useRef<Monaco>();
  const breakpointDecorationsRef = useRef<string[]>([]);
  const gitDecorationsRef = useRef<string[]>([]);
  const activeGitHunksRef = useRef<GitDiffHunk[]>([]);
  const diffRollbackTimer = useRef<ReturnType<typeof setTimeout>>();
  const refreshJavaSemanticRef = useRef<(() => void) | undefined>();
  const javaLanguageDisposables = useRef<{ dispose(): void }[]>([]);
  const cursorPositionsRef = useRef<CursorPositionStore>();
  const cursorPositions = (cursorPositionsRef.current ??= new CursorPositionStore({
    read: (workspace) => readSetting(workspaceSettingKey(workspace, CURSOR_POSITIONS_SETTING)),
    write: (workspace, value) => writeSetting(workspaceSettingKey(workspace, CURSOR_POSITIONS_SETTING), value),
  }));

  useEffect(() => {
    if (status !== "connected" || !workspaceOptionsReady || !workspaceKeyRef.current) return;
    const activePanel = layout.panels.find((panel): panel is Panel & { type: BottomPanelType } =>
      ["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
    );
    writeWorkspaceSetting(workspaceKeyRef.current, "bottom.activePanel", activePanel?.type ?? "");
  }, [layout.panels, status, workspaceOptionsReady]);
  useEffect(() => {
    if (workspaceOptionsReady && workspaceKeyRef.current)
      writeWorkspaceSetting(workspaceKeyRef.current, "bottom.terminalHeight", String(terminalHeight));
  }, [terminalHeight, workspaceOptionsReady]);
  useEffect(() => {
    if (workspaceOptionsReady && workspaceKeyRef.current)
      writeWorkspaceSetting(workspaceKeyRef.current, "bottom.javaHeight", String(javaPanelHeight));
  }, [javaPanelHeight, workspaceOptionsReady]);
  useEffect(() => {
    if (workspaceOptionsReady && workspaceKeyRef.current)
      writeWorkspaceSetting(workspaceKeyRef.current, "bottom.problemsHeight", String(problemsHeight));
  }, [problemsHeight, workspaceOptionsReady]);
  useEffect(() => {
    if (workspaceOptionsReady && workspaceKeyRef.current)
      writeWorkspaceSetting(workspaceKeyRef.current, "bottom.gitLogHeight", String(gitLogHeight));
  }, [gitLogHeight, workspaceOptionsReady]);
  useEffect(() => {
    if (status !== "connected" || !statusMessage || statusKind === "error" || statusKind === "progress") return;
    const timer = window.setTimeout(() => setStatusMessageState(""), 4500);
    return () => window.clearTimeout(timer);
  }, [status, statusKind, statusMessage]);
  const javaOptionsRef = useRef<JavaProjectOptions>();
  const activeWorkspaceRef = useRef("");
  const group = layout.editorGroups[0]!;
  const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId);
  const hasDirtyTabs = group.tabs.some((tab) => tab.dirty);
  const projectGitStatuses = useMemo(
    () =>
      Object.fromEntries(
        gitEntries.map(
          (entry) => [entry.path, entry.indexStatus === "?" || entry.indexStatus === "A" ? "C" : "M"] as const,
        ),
      ),
    [gitEntries],
  );

  useEffect(() => {
    const connected = status === "connected";
    const taskName = tasks.find((task) => task.id === selectedTaskId)?.name;
    const titleParts = [
      connected && activeTab?.type === "file" ? editorTabLabel(activeTab) : undefined,
      connected ? taskName || projectName : undefined,
      connected && gitBranch !== "HEAD" ? gitBranch : undefined,
      "HatoPad",
    ];
    document.title = titleParts.filter(Boolean).join(" — ");
  }, [activeTab?.id, activeTab?.path, activeTab?.title, gitBranch, projectName, selectedTaskId, status, tasks]);
  useEffect(() => {
    const version = ++projectContentFilterVersion.current;
    const searchQuery = projectFilter.trim();
    if (!projectContentFilter || !searchQuery || status !== "connected") {
      setProjectContentPaths(undefined);
      setProjectContentFilterLoading(false);
      return;
    }
    const client = clientRef.current;
    if (!client) return;
    const rootId = client.getRoot();
    setProjectContentFilterLoading(true);
    const timer = window.setTimeout(() => {
      void client
        .request("filesystem.search", { query: searchQuery, path: "", matchCase: false, filesOnly: true })
        .then((result) => {
          if (
            version === projectContentFilterVersion.current &&
            clientRef.current === client &&
            client.getRoot() === rootId
          )
            setProjectContentPaths(new Set(result.matches.map((match) => match.path)));
        })
        .catch((filterError: unknown) => {
          if (version === projectContentFilterVersion.current) {
            setProjectContentPaths(new Set());
            setStatusMessage(filterError instanceof Error ? filterError.message : "Could not filter file contents");
          }
        })
        .finally(() => {
          if (version === projectContentFilterVersion.current) setProjectContentFilterLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [projectContentFilter, projectFilter, selectedRootId, selectedTaskId, status, setStatusMessage]);
  useEffect(() => {
    window.desktop?.setDirtyState(hasDirtyTabs);
  }, [hasDirtyTabs]);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    javaOptionsRef.current = javaOptions;
  }, [javaOptions]);
  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);
  useEffect(() => {
    selectedRootIdRef.current = selectedRootId;
  }, [selectedRootId]);
  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);
  useEffect(() => {
    activeGitHunksRef.current = activeGitHunks;
  }, [activeGitHunks]);
  useEffect(() => {
    if (!pendingNavigation || activeTab?.path !== pendingNavigation.result.path || !monacoEditorRef.current) return;
    const { result, matchLength } = pendingNavigation;
    monacoEditorRef.current.setSelection({
      startLineNumber: result.line,
      startColumn: result.column,
      endLineNumber: result.line,
      endColumn: result.column + matchLength,
    });
    monacoEditorRef.current.revealLineInCenter(result.line);
    monacoEditorRef.current.focus();
    setPendingNavigation(undefined);
  }, [activeTab?.path, pendingNavigation]);
  useEffect(
    () => () => {
      invalidationRefreshes.current?.dispose();
      recoveryRef.current?.stop();
      clientRef.current?.disconnect();
      clientRef.current = undefined;
      if (treeRefreshTimer.current) clearTimeout(treeRefreshTimer.current);
      if (gitRefreshTimer.current) clearTimeout(gitRefreshTimer.current);
      if (javaRefreshTimer.current) clearTimeout(javaRefreshTimer.current);
      if (javaCheckTimer.current) clearTimeout(javaCheckTimer.current);
      if (diffRollbackTimer.current) clearTimeout(diffRollbackTimer.current);
      cursorPositions.dispose();
      for (const disposable of javaLanguageDisposables.current) disposable.dispose();
    },
    [],
  );

  const updateGroup = useCallback(
    (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => {
      setLayout((current) => ({
        ...current,
        editorGroups: current.editorGroups.map((item, index) => {
          if (index !== 0) return item;
          const next = update(item.tabs, item.activeTabId);
          if (next.activeTabId !== item.activeTabId) editorViewStates.capture(monacoEditorRef.current);
          return { ...item, ...next };
        }),
      }));
    },
    [editorViewStates],
  );

  const updateTerminalGroup = useCallback(
    (update: (group: LayoutModel["terminalGroup"]) => LayoutModel["terminalGroup"]) => {
      setLayout((current) => ({ ...current, terminalGroup: update(current.terminalGroup) }));
    },
    [],
  );

  const checkJava = useCallback(async () => {
    if (!clientRef.current || !javaOptionsRef.current) return;
    const requestedRoot = clientRef.current.getRoot();
    setJavaChecking(true);
    try {
      const diagnostics = (await clientRef.current.request("language.check", { language: "java" })).diagnostics;
      if (requestedRoot === selectedRootIdRef.current) setJavaDiagnostics(diagnostics);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Java checks failed");
    } finally {
      setJavaChecking(false);
    }
  }, []);

  const scheduleJavaCheck = useCallback(() => {
    if (javaCheckTimer.current) clearTimeout(javaCheckTimer.current);
    javaCheckTimer.current = setTimeout(() => {
      void checkJava();
    }, 700);
  }, [checkJava]);

  const registerTerminalWriter = useCallback(
    (terminalId: string, writer?: (data: string, replay?: boolean) => void) => {
      if (!writer) {
        terminalWriters.current.delete(terminalId);
        return;
      }
      terminalWriters.current.set(terminalId, writer);
      const buffered = terminalBuffers.current.get(terminalId);
      if (buffered) writer(buffered, true);
    },
    [],
  );
  const markUnreadTerminalOutput = useCallback((terminalId: string) => {
    setLayout((current) => markTerminalActivity(current, terminalId));
  }, []);

  const refreshGit = useCallback(async (client = clientRef.current) => {
    if (!client) return;
    const requestId = ++gitStatusRequested.current;
    const requestedWorkspace = activeWorkspaceRef.current;
    const requestedRoot = client.getRoot();
    try {
      const result = await client.request("git.status", {});
      if (
        !shouldApplyGitStatus(requestId, gitStatusRequested.current, requestedWorkspace, activeWorkspaceRef.current) ||
        clientRef.current !== client ||
        client.getRoot() !== requestedRoot
      )
        return;
      setGitBranch(result.branch);
      setGitEntries(result.entries);
      setGitUpstream(result.upstream);
      setGitError("");
    } catch (error) {
      if (
        !shouldApplyGitStatus(requestId, gitStatusRequested.current, requestedWorkspace, activeWorkspaceRef.current) ||
        clientRef.current !== client ||
        client.getRoot() !== requestedRoot
      )
        return;
      setGitEntries([]);
      setGitUpstream(undefined);
      setGitError(error instanceof Error ? error.message : "Could not read Git status");
    }
  }, []);

  const refreshTaskGit = useCallback(async (task = activeTaskRef.current, client = clientRef.current) => {
    if (!client || !task) {
      setTaskGitEntries([]);
      setTaskCheckpoints([]);
      setTaskGitError("");
      return;
    }
    const requestedRoot = client.getRoot();
    try {
      const [result, history] = await Promise.all([
        client.request("git.compareFiles", { ref: task.baseBranch }),
        client.request("taskGit.history", {}),
      ]);
      if (clientRef.current !== client || client.getRoot() !== requestedRoot || activeTaskRef.current?.id !== task.id)
        return;
      setTaskGitEntries(
        result.files.map((file) => ({
          path: file.path,
          ...(file.originalPath ? { originalPath: file.originalPath } : {}),
          indexStatus: file.status === "?" ? "?" : (file.status[0] ?? "M"),
          worktreeStatus: file.status === "?" ? "?" : " ",
          states: [file.status === "?" ? "untracked" : "index"],
        })),
      );
      setTaskCheckpoints(history.checkpoints);
      setTaskGitError("");
    } catch (error) {
      if (clientRef.current !== client || client.getRoot() !== requestedRoot || activeTaskRef.current?.id !== task.id)
        return;
      setTaskGitEntries([]);
      setTaskCheckpoints([]);
      setTaskGitError(error instanceof Error ? error.message : "Could not load Task Git");
    }
  }, []);

  // Several ai.statuses requests can be in flight at once (AI activity emits a burst of ai.changed
  // events) and the backend answers them concurrently, so responses can arrive out of order. Without
  // this guard an older snapshot overwrites a newer one and the task rows keep showing stale progress.
  const refreshAiStatuses = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const sequence = ++aiStatusesRequested.current;
    const requestedRoot = client.getRoot();
    const [statuses, timerResult, scheduleResult, triggerResult] = await Promise.all([
      client.request("ai.statuses", {}),
      client.request("timers.list", {}),
      client.request("schedules.list", {}),
      client.request("triggers.list", {}),
    ]);
    if (!canApply() || sequence <= aiStatusesApplied.current || client.getRoot() !== requestedRoot) return;
    aiStatusesApplied.current = sequence;
    setAiStatuses(statuses);
    setActiveTimers(timerResult.timers);
    void refreshProcesses();
    setSchedules(scheduleResult.schedules);
    setTriggers(triggerResult.triggers);
  }, []);
  const loadActionModels = useCallback(async (provider: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Backend is disconnected");
    return (await client.request("ai.models", { provider: provider as AiProvider })).models;
  }, []);
  const loadScheduleAgents = useCallback(async (taskId?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Backend is disconnected");
    return (await client.request("schedules.agents", { taskId })).agents;
  }, []);
  const refreshTasks = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const requestedRoot = client.getRoot();
    const result = await client.request("tasks.list", {});
    if (!canApply() || clientRef.current !== client || !client.isConnected() || client.getRoot() !== requestedRoot)
      return;
    setTasks(result.tasks);
    setSelectedTaskId(result.selectedTaskId);
    selectedTaskIdRef.current = result.selectedTaskId;
    activeTaskRef.current = result.tasks.find((task) => task.id === result.selectedTaskId);
  }, []);
  // The transcript has the same problem, and it is worse there: a reply that was requested for the
  // previous task or provider would drop that conversation into the panel, so the next prompt looks
  // like it was prepended to a transcript it does not belong to. Every session snapshot therefore
  // carries the workspace, provider and request order it was asked for, and stale ones are dropped.
  const aiToken = useCallback(
    (): AiSnapshotToken => ({
      sequence: ++aiSessionRequested.current,
      workspace: activeWorkspaceRef.current,
      provider: aiProviderRef.current,
    }),
    [],
  );
  const applyAiSession = useCallback((session: AiSession, token: AiSnapshotToken): boolean => {
    if (token.workspace !== activeWorkspaceRef.current || token.provider !== aiProviderRef.current) return false;
    if (token.sequence <= aiSessionApplied.current) return false;
    aiSessionApplied.current = token.sequence;
    setAiSession(session);
    return true;
  }, []);
  const refreshAi = useCallback(
    async (client = clientRef.current, canApply: () => boolean = () => true) => {
      if (!client) return;
      const token = aiToken();
      const [session] = await Promise.all([
        client.request("ai.get", { provider: aiProviderRef.current }),
        refreshAiStatuses(client, canApply),
      ]);
      if (!canApply()) return;
      applyAiSession(session.session, token);
    },
    [aiToken, applyAiSession, refreshAiStatuses],
  );
  const refreshAiRef = useRef(refreshAi);
  const refreshAiStatusesRef = useRef(refreshAiStatuses);
  refreshAiRef.current = refreshAi;
  refreshAiStatusesRef.current = refreshAiStatuses;
  const streamedAiRefresh = useRef<CoalescedAsyncAction>();
  streamedAiRefresh.current ??= new CoalescedAsyncAction(async () => {
    await refreshAiRef.current(clientRef.current);
  });
  const backgroundAiRefresh = useRef<CoalescedAsyncAction>();
  backgroundAiRefresh.current ??= new CoalescedAsyncAction(async () => {
    await refreshAiStatusesRef.current(clientRef.current);
  });
  // The listing only changes when a conversation starts, is switched or is removed, so it is kept
  // out of `refreshAi`, which also runs for every chunk the agent streams.
  const refreshAiSessions = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const provider = aiProviderRef.current;
    const workspace = activeWorkspaceRef.current;
    const sessions = (await client.request("ai.sessions", { provider })).sessions;
    if (
      canApply() &&
      clientRef.current === client &&
      provider === aiProviderRef.current &&
      workspace === activeWorkspaceRef.current
    )
      setAiSessions(sessions);
  }, []);
  const refreshUsefulFiles = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const rootId = client.getRoot();
    const files = (await client.request("useful.list", {})).files;
    if (canApply() && clientRef.current === client && client.isConnected() && client.getRoot() === rootId)
      setUsefulFiles(files);
  }, []);
  const refreshRunConfigs = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const rootId = client.getRoot();
    const configs = (await client.request("runConfig.list", {})).configs;
    if (canApply() && client.getRoot() === rootId) setRunConfigs(configs);
  }, []);
  const refreshSkills = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const workspace = activeWorkspaceRef.current;
    const root = client.getRoot();
    const taskId = selectedTaskIdRef.current;
    const catalog = await client.request("skills.list", {});
    if (
      canApply() &&
      clientRef.current === client &&
      client.isConnected() &&
      client.getRoot() === root &&
      workspace === activeWorkspaceRef.current &&
      taskId === selectedTaskIdRef.current
    )
      setSkillCatalog(catalog);
  }, []);
  const selectSkills = useCallback(
    async (ids: string[]) => {
      const client = clientRef.current;
      if (!client || !aiSession.id) return;
      const token = aiToken();
      const preset = agents.find((file) => agentKey(file) === selectedAgentKey);
      const { session } = await client.request("ai.skills", {
        provider: token.provider,
        ids,
        sessionId: aiSession.id,
        agentPreset: preset ? { scope: preset.scope, name: preset.name } : null,
      });
      applyAiSession(session, token);
    },
    [agents, selectedAgentKey, aiSession.id, aiToken, applyAiSession],
  );
  const skillActions: SkillsActions = {
    movePolicyToLocal: async () => {
      if (!clientRef.current) throw new Error("Backend is disconnected");
      await clientRef.current.request("skills.policy.moveToLocal", {});
      await refreshSkills();
    },
    write: async (id, content) => {
      if (!clientRef.current) throw new Error("Backend is disconnected");
      await clientRef.current.request("skills.write", { id, content });
      await refreshSkills();
    },
    delete: async (id) => {
      if (!clientRef.current) throw new Error("Backend is disconnected");
      await clientRef.current.request("skills.delete", { id });
      updateGroup((tabs, active) => {
        const next = tabs.filter((tab) => tab.type !== "skill" || tab.skillId !== id);
        return { tabs: next, activeTabId: next.some((tab) => tab.id === active) ? active : next.at(-1)?.id };
      });
      await refreshSkills();
    },
    policy: async (policy) => {
      if (!clientRef.current) throw new Error("Backend is disconnected");
      await clientRef.current.request("skills.policy", policy);
      await refreshSkills();
    },
  };
  const refreshAgents = useCallback(
    async (client = clientRef.current, taskId = selectedTaskIdRef.current, canApply: () => boolean = () => true) => {
      if (!client) return;
      const rootId = client.getRoot();
      await refreshSkills(client, canApply);
      if (!canApply() || clientRef.current !== client || !client.isConnected() || client.getRoot() !== rootId) return;
      const next = (await client.request("agents.list", {})).agents;
      if (!canApply() || clientRef.current !== client || !client.isConnected() || client.getRoot() !== rootId) return;
      setAgents(next);
      const saved = workspaceKeyRef.current
        ? (readSetting(workspaceSettingKey(workspaceKeyRef.current, aiAgentTaskKey(taskId))) ?? "")
        : "";
      setSelectedAgentKey(next.some((agent) => agentKey(agent) === saved) ? saved : "");
    },
    [refreshSkills],
  );
  const {
    refreshHarnesses,
    refreshHarnessRuns,
    pendingHarnessDetails,
    readHarnessRun,
    createHarness,
    readHarness,
    saveHarness,
    deleteHarness,
    testHarnessBlock,
    readHarnessApp,
    killHarnessApp,
    runHarness,
    chatHarness,
    steerHarnessChat,
    setHarnessAutopilot,
    appendHarnessRun,
    resolveHarnessPermission,
    answerHarnessQuestion,
    resumeHarnessPause,
    retryHarnessPause,
    cancelHarnessPause,
    cancelHarnessRun,
    deleteHarnessRun,
    loadHarnessModels,
    validateHarnessDefinition,
  } = useHarnessActions({
    clientRef,
    setHarnesses,
    setHarnessDiagnostics,
    setHarnessesLoading,
    harnessRunsRef,
    setHarnessRuns,
    setHarnessRunsLoading,
    aiProviderRef,
    selectedTaskIdRef,
  });

  const restoreWorkspaceOptions = useCallback(
    async (
      options: WorkspaceOptions,
      client: CoreClient,
      rootId = client.getRoot() ?? "legacy",
      recovery = false,
      signal?: AbortSignal,
    ) => {
      const current = workspaceRestorationGuard(
        client,
        rootId,
        activeWorkspaceRef.current,
        () => clientRef.current,
        () => activeWorkspaceRef.current,
        signal,
      );
      const ensureCurrent = () => {
        if (!current()) throw new Error("Obsolete workspace restoration");
      };
      ensureCurrent();
      try {
        const java = await client.request("java.getOptions", {});
        ensureCurrent();
        setJavaOptions(java.options);
        javaOptionsRef.current = java.options;
      } catch (error) {
        ensureCurrent();
        setStatusMessage(error instanceof Error ? error.message : "Could not load Java configuration");
      }
      if (!recovery) {
        setJavaBreakpoints(options.javaBreakpoints ?? []);
        setFileColors(options.fileColors ?? {});
        setGitCommitMessage(options.gitCommitMessage ?? "");
        setSearchQueries(options.searchQueries ?? {});
        setSelectedGitPaths(new Set());
      }
      const pinnedFiles = new Set(options.pinnedFiles ?? []);
      let tabs = orderPinnedTabs(
        await Promise.all(
          options.openFiles.map(async (filePath): Promise<EditorTab> => {
            const title = filePath.split("/").pop() ?? filePath;
            try {
              const result = await client.request("filesystem.readFile", { path: filePath });
              return {
                id: crypto.randomUUID(),
                type: "file",
                rootId,
                title,
                path: filePath,
                pinned: pinnedFiles.has(filePath),
                dirty: false,
                content: result.content,
                savedContent: result.content,
                revision: result.revision,
                loading: false,
                markdownMode: /\.md$/i.test(filePath) ? "preview" : undefined,
              };
            } catch (error) {
              return {
                id: crypto.randomUUID(),
                type: "file",
                rootId,
                title,
                path: filePath,
                pinned: pinnedFiles.has(filePath),
                dirty: false,
                content: "",
                savedContent: "",
                loading: false,
                markdownMode: /\.md$/i.test(filePath) ? "preview" : undefined,
                error: error instanceof Error ? error.message : "Could not restore file",
              };
            }
          }),
        ),
      );
      ensureCurrent();
      let activeDocumentId: string | undefined;
      const existingGroup = layoutRef.current.editorGroups[0];
      const carriedDocuments =
        existingGroup?.tabs.filter(
          (tab) => tab.type === "workflowDocument" && (!tab.rootId || tab.rootId === rootId),
        ) ?? [];
      if (options.workflowDocuments?.length || carriedDocuments.length) {
        try {
          const runIds = [
            ...new Set([
              ...(options.workflowDocuments ?? []).map((document) => document.runId),
              ...carriedDocuments.flatMap((tab) => (tab.workflowRunId ? [tab.workflowRunId] : [])),
            ]),
          ];
          const runs = (await Promise.all(runIds.map((runId) => client.request("harnesses.runs", { runId })))).flatMap(
            (result) => result.runs,
          );
          ensureCurrent();
          const restored = restoreWorkflowDocuments(
            tabs,
            options.workflowDocuments,
            runs,
            rootId,
            existingGroup?.tabs,
            existingGroup?.activeTabId,
          );
          tabs = orderPinnedTabs(restored.tabs);
          activeDocumentId = restored.activeTabId;
        } catch (error) {
          ensureCurrent();
          tabs = orderPinnedTabs([...tabs, ...carriedDocuments]);
          activeDocumentId = carriedDocuments.find((tab) => tab.id === existingGroup?.activeTabId)?.id;
          setStatusMessage(error instanceof Error ? error.message : "Could not restore workflow documents");
        }
      }
      const workflowTabs = existingGroup?.tabs.filter((tab) => tab.type === "workflow" && tab.rootId === rootId) ?? [];
      tabs.push(...workflowTabs);
      const activeTabId =
        workflowTabs.find(
          (tab) => tab.id === existingGroup?.activeTabId && tab.workflowTaskId === selectedTaskIdRef.current,
        )?.id ??
        activeDocumentId ??
        tabs.find((tab) => tab.type === "file" && tab.path === options.activeFile)?.id ??
        tabs[0]?.id;
      const discovered = (await client.request("terminal.list", {})).terminals.filter((session) => session.displayName);
      ensureCurrent();
      const savedTerminals = [...(options.terminal?.tabs ?? [])];
      for (const session of discovered)
        if (!savedTerminals.some((tab) => tab.terminalId === session.terminalId))
          savedTerminals.push({ terminalId: session.terminalId, displayName: session.displayName! });
      const restoredTerminals = await Promise.all(
        savedTerminals.map(async (saved, index) => {
          try {
            const { session, reattached } = await restoreTerminal(client, saved.terminalId, recovery);
            ensureCurrent();
            const terminalRecovery = reattached
              ? session.status === "running"
                ? ("reattached" as const)
                : undefined
              : ("recreated" as const);
            terminalBuffers.current.set(
              session.terminalId,
              `${session.output}${session.status === "exited" ? `\r\n[process exited${session.exitCode === undefined ? "" : ` with code ${session.exitCode}`}]\r\n` : ""}`,
            );
            return {
              index,
              tab: {
                id: crypto.randomUUID(),
                rootId,
                terminalId: session.terminalId,
                title: saved.displayName,
                status: session.status,
                ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
                recovery: terminalRecovery,
              },
            };
          } catch {
            ensureCurrent();
            const terminalId = saved.terminalId ?? crypto.randomUUID();
            terminalBuffers.current.set(
              terminalId,
              "\r\n[terminal recovery failed; no replacement shell was started]\r\n",
            );
            return {
              index,
              tab: {
                id: crypto.randomUUID(),
                rootId,
                terminalId,
                title: saved.displayName,
                status: "unavailable" as const,
              },
            };
          }
        }),
      );
      ensureCurrent();
      const activeTerminal =
        restoredTerminals.find((item) => item.index === options.terminal?.activeTabIndex)?.tab ??
        restoredTerminals[0]?.tab;
      const legacyBottomPanel = workspaceKeyRef.current
        ? readWorkspaceSetting(workspaceKeyRef.current, "bottom.activePanel")
        : null;
      const savedBottomPanel = legacyBottomPanel === "java" ? "languageOutput" : legacyBottomPanel;
      const validBottomPanel =
        savedBottomPanel === "gitlog" ||
        (savedBottomPanel === "terminal" && restoredTerminals.length > 0) ||
        ((savedBottomPanel === "languageOutput" || savedBottomPanel === "problems") && Boolean(options.javaProject));
      const bottomPanel: BottomPanelType | undefined = validBottomPanel
        ? (savedBottomPanel as BottomPanelType)
        : savedBottomPanel === null &&
            (options.terminal?.panelOpen || discovered.length > 0) &&
            restoredTerminals.length > 0
          ? "terminal"
          : undefined;
      setLayout((layout) =>
        current()
          ? {
              ...layout,
              panels: recovery
                ? layout.panels
                : [
                    ...layout.panels.filter(
                      (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
                    ),
                    ...(bottomPanel ? [{ id: bottomPanel, type: bottomPanel }] : []),
                  ],
              editorGroups: recovery
                ? recoverEditorGroups(layout.editorGroups, tabs, activeTabId, rootId, current)
                : layout.editorGroups.map((item, index) => (index === 0 ? { ...item, tabs, activeTabId } : item)),
              terminalGroup: {
                ...layout.terminalGroup,
                tabs: restoredTerminals.map((item) => item.tab),
                activeTabId: activeTerminal?.id,
              },
            }
          : layout,
      );
      if (!recovery) setWorkspaceOptionsReady(true);
    },
    [],
  );

  const connect = async () => {
    invalidationRefreshes.current?.dispose();
    recoveryRef.current?.stop();
    clientRef.current?.disconnect();
    clientRef.current = undefined;
    setWorkspaceOptionsReady(false);
    setHarnesses([]);
    setHarnessRuns([]);
    setHarnessesLoading(true);
    setHarnessRunsLoading(true);
    setAgents([]);
    setSelectedAgentKey("");
    setUsefulFiles([]);
    setRunConfigs([]);
    setSkillCatalog({ skills: [], policy: { allowed: [], defaults: [] } });
    setAiStatuses({ root: emptyAiSummary, tasks: {} });
    setActiveTimers([]);
    setSchedules([]);
    setTriggers([]);
    setStatus("connecting");
    setStatusMessage(`Opening connection to ${host.trim()}:${port}…`);
    const client = new CoreClient();
    if (launchConfig.rootId && host.trim() === launchConfig.host && port === launchConfig.port)
      client.setRoot(launchConfig.rootId);
    clientRef.current = client;
    client.onConnectionProgress = (message) => {
      if (clientRef.current === client) setStatusMessage(message);
    };
    let connectionReady = false;
    let recoverySelection: RecoverySelection | undefined;
    const recovery = new ConnectionRecovery(
      async (signal) => {
        const expected = recoverySelection!;
        const stillCurrent = workspaceRestorationGuard(
          client,
          expected.rootId,
          expected.workspace,
          () => clientRef.current,
          () => activeWorkspaceRef.current,
          signal,
        );
        const ensureCurrent = () => {
          if (!stillCurrent()) throw new Error("Recovery cancelled or selection changed");
        };
        ensureCurrent();
        const { roots: rootRegistry, workspace: result } = await reconnectWorkspace(
          client,
          host.trim(),
          Number(port),
          showIgnoredRef.current,
          signal,
          expected,
        );
        ensureCurrent();
        setWorkspaceRoots(rootRegistry.roots);
        setSelectedRootId(rootRegistry.selectedRootId);
        setActiveWorkspace(result.workspace);
        activeWorkspaceRef.current = result.workspace;
        workspaceKeyRef.current = result.workspace;
        cursorPositions.setWorkspace(result.workspace);
        setProjectName(result.projectName);
        setTree(result.tree);
        setJavaOptions(result.options.javaProject);
        await restoreWorkspaceOptions(result.options, client, client.getRoot(), true, signal);
        ensureCurrent();
        await Promise.all([
          refreshTasks(client, stillCurrent),
          refreshGit(client),
          refreshAi(client, stillCurrent),
          refreshUsefulFiles(client, stillCurrent),
          refreshRunConfigs(client, stillCurrent),
          refreshAgents(client, expected.taskId, stillCurrent),
          refreshHarnesses(client, stillCurrent),
        ]);
        ensureCurrent();
        if (!client.isConnected()) throw new Error("Connection lost during recovery");
        if (selectedTaskIdRef.current !== expected.taskId)
          throw new Error("Saved task selection changed during recovery");
        setWorkspaceOptionsReady(true);
        setStatus("connected");
        recoverySelection = undefined;
        showStatus("Backend connection restored", "success");
        startBackgroundLoading(
          [() => refreshAiSessions(client, stillCurrent), () => refreshHarnessRuns(client, stillCurrent)],
          stillCurrent,
          () => showStatus("Session history could not load. Refresh the panel to retry.", "error"),
        );
      },
      (error) => {
        if (clientRef.current !== client) return;
        if (
          recoverySelection &&
          (client.getRoot() !== recoverySelection.rootId || activeWorkspaceRef.current !== recoverySelection.workspace)
        ) {
          recovery.stop();
          recoverySelection = undefined;
          return;
        }
        invalidationRefreshes.current?.reset();
        const feedback = recoveryFailureFeedback(error);
        if (feedback.retry) client.disconnect();
        else {
          setStatus("disconnected");
          setWorkspaceOptionsReady(false);
        }
        showStatus(feedback.message, feedback.kind);
      },
    );
    recoveryRef.current = recovery;
    client.onDisconnected = (message) => {
      if (!connectionReady || clientRef.current !== client) return;
      invalidationRefreshes.current?.reset();
      taskSwitchSequence.current += 1;
      taskSwitchActive.current = false;
      setTaskSwitching(false);
      setStatus("disconnected");
      setWorkspaceOptionsReady(false);
      recoverySelection ??= {
        rootId: client.getRoot()!,
        workspace: activeWorkspaceRef.current,
        taskId: selectedTaskIdRef.current,
      };
      showStatus(`${message}; reconnecting…`, "progress");
      recovery.start();
    };
    const invalidations = new InvalidationRefreshes(
      () => {
        const rootId = client.getRoot();
        return clientRef.current === client && client.isConnected() && rootId
          ? { rootId, workspace: activeWorkspaceRef.current, revision: taskSwitchSequence.current }
          : undefined;
      },
      {
        configuration: [
          (canApply) => refreshAgents(client, selectedTaskIdRef.current, canApply),
          (canApply) => refreshUsefulFiles(client, canApply),
          (canApply) => refreshHarnesses(client, canApply),
          (canApply) => refreshTasks(client, canApply),
        ],
        processes: (canApply) => refreshProcesses(client, canApply),
        configurationFailed: (error) =>
          setStatusMessage(error instanceof Error ? error.message : "Could not refresh configuration"),
      },
    );
    invalidationRefreshes.current = invalidations;
    const pendingWorkflowRuns = new Set<string>();
    const workflowRefresh = new CoalescedAsyncAction(async (canApply) => {
      const rootId = client.getRoot();
      const runIds = [...pendingWorkflowRuns];
      pendingWorkflowRuns.clear();
      for (const runId of runIds) {
        const summary =
          harnessRunsRef.current.find((run) => run.id === runId)?.summary !== undefined ||
          !harnessRunsRef.current.some((run) => run.id === runId);
        const { runs } = await client.request("harnesses.runs", { runId, summary });
        if (!canApply() || clientRef.current !== client || client.getRoot() !== rootId) return;
        if (runs[0]?.summary && harnessRunsRef.current.some((run) => run.id === runId && !run.summary)) {
          pendingWorkflowRuns.add(runId);
          workflowRefresh.trigger();
          continue;
        }
        setHarnessRuns((current) => [
          ...runs,
          ...current.filter((run) => !runs.some((updated) => updated.id === run.id)),
        ]);
      }
    });
    client.onServerEvent = (event) => {
      if (event.type === "configuration.changed" || event.type === "processes.changed") {
        invalidations.handle(event);
        return;
      }
      if (event.type === "timers.changed") {
        backgroundAiRefresh.current!.trigger();
        return;
      }
      if (event.payload.rootId !== client.getRoot() && event.type === "filesystem.changed") {
        const changed = new Set(event.payload.paths);
        updateGroup((tabs, active) => ({
          tabs: tabs.map((tab) =>
            tab.rootId === event.payload.rootId &&
            tab.type === "file" &&
            (event.payload.overflow || changed.has(tab.path))
              ? { ...tab, error: "Changed in its remote root; activate this tab to reconcile" }
              : tab,
          ),
          activeTabId: active,
        }));
        return;
      }
      if (
        event.payload.rootId !== client.getRoot() &&
        event.type !== "terminal.output" &&
        event.type !== "terminal.exit"
      )
        return;
      if (event.type === "terminal.opened") {
        if (event.payload.workspace === activeWorkspaceRef.current && event.payload.session.displayName)
          void openTerminalReference(event.payload.session.terminalId, event.payload.session.displayName).catch(
            (error: unknown) =>
              setStatusMessage(error instanceof Error ? error.message : "Could not open workflow terminal"),
          );
        return;
      }
      if (event.type === "terminal.output") {
        terminalBuffers.current.set(
          event.payload.terminalId,
          ((terminalBuffers.current.get(event.payload.terminalId) ?? "") + event.payload.data).slice(-1_000_000),
        );
        const writer = terminalWriters.current.get(event.payload.terminalId);
        if (writer) writer(event.payload.data);
        return;
      }
      if (event.type === "terminal.exit") {
        const exitMessage = `\r\n[process exited with code ${event.payload.exitCode}]\r\n`;
        terminalBuffers.current.set(
          event.payload.terminalId,
          ((terminalBuffers.current.get(event.payload.terminalId) ?? "") + exitMessage).slice(-1_000_000),
        );
        const writer = terminalWriters.current.get(event.payload.terminalId);
        writer?.(exitMessage);
        updateTerminalGroup((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.terminalId === event.payload.terminalId
              ? { ...tab, status: "exited", exitCode: event.payload.exitCode }
              : tab,
          ),
        }));
        markUnreadTerminalOutput(event.payload.terminalId);
        return;
      }
      if (event.type === "language.semantic.changed") {
        if (event.payload.language === "java") refreshJavaSemanticRef.current?.();
        return;
      }
      if (event.type === "language.output") {
        if (event.payload.language !== "java") return;
        setJavaLog((current) => (current + event.payload.data).slice(-1_000_000));
        return;
      }
      if (event.type === "language.exit") {
        if (event.payload.language !== "java") return;
        setJavaRunning(false);
        setJavaLog(
          (current) =>
            `${current}\nProcess exited${event.payload.exitCode === null ? "" : ` with code ${event.payload.exitCode}`}${event.payload.signal ? ` (${event.payload.signal})` : ""}.\n`,
        );
        return;
      }
      if (event.type === "java.debug.state") {
        setJavaDebugState(event.payload);
        if (event.payload.status === "paused")
          setLayout((current) => ({
            ...current,
            panels: [
              ...current.panels.filter(
                (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
              ),
              { id: "languageOutput", type: "languageOutput" },
            ],
          }));
        return;
      }
      if (event.type === "ai.changed") {
        streamedAiRefresh.current!.trigger();
        return;
      }
      if (event.type === "workflow.document") {
        if (event.payload.rootId !== client.getRoot()) return;
        const { rootId, runId, blockId, title, content } = event.payload;
        const id = `workflow-document:${rootId}:${runId}:${blockId}`;
        updateGroup((tabs) => ({
          tabs: [
            ...tabs.filter((tab) => tab.id !== id),
            {
              id,
              type: "workflowDocument",
              workflowRunId: runId,
              workflowBlockId: blockId,
              rootId,
              title,
              path: title,
              content,
              savedContent: content,
              dirty: false,
              loading: false,
              markdownMode: "preview",
            },
          ],
          activeTabId: id,
        }));
        return;
      }
      if (event.type === "harness.changed") {
        pendingWorkflowRuns.add(event.payload.runId);
        workflowRefresh.trigger();
        return;
      }
      if (event.type === "tasks.changed") {
        void Promise.all([refreshTasks(client), refreshAiStatuses(client)]).catch(() => undefined);
        return;
      }
      if (event.type === "runConfig.changed") {
        setRunConfigs(event.payload.configs);
        return;
      }
      if (event.type === "commit-message.changed") {
        if (event.payload.workspace && event.payload.workspace !== activeWorkspaceRef.current) return;
        setGitCommitMessage(event.payload.message);
        return;
      }
      if (event.type === "taskGit.changed") {
        void refreshTaskGit(activeTaskRef.current, client);
        return;
      }
      if (gitRefreshTimer.current) clearTimeout(gitRefreshTimer.current);
      gitRefreshTimer.current = setTimeout(() => {
        void refreshGit(client);
        void refreshTaskGit(activeTaskRef.current, client);
        void refreshAiStatuses(client).catch(() => undefined);
      }, 200);
      const refreshDiffs = (changedPath?: string) => {
        const diffTabs =
          layoutRef.current.editorGroups[0]?.tabs.filter(
            (tab) => tab.type === "diff" && (!changedPath || (tab.diffPath ?? tab.path) === changedPath),
          ) ?? [];
        for (const tab of diffTabs)
          void (
            tab.diffRef
              ? client.request("git.compareDiff", {
                  ref: tab.diffRef,
                  path: tab.diffPath ?? tab.path,
                  ...(tab.diffOriginalPath ? { originalPath: tab.diffOriginalPath } : {}),
                })
              : client.request("git.diff", { path: tab.path })
          )
            .then((result) => {
              updateGroup((tabs, active) => ({
                tabs: tabs.map((item) =>
                  item.id === tab.id
                    ? {
                        ...item,
                        originalContent: result.originalContent,
                        content: result.modifiedContent,
                        error: undefined,
                      }
                    : item,
                ),
                activeTabId: active,
              }));
            })
            .catch(() => undefined);
      };
      if (event.type === "git.changed") {
        refreshDiffs();
        setGitRevision((revision) => revision + 1);
        return;
      }
      if (event.type !== "filesystem.changed") return;
      const changedPaths = event.payload.paths;
      if (changedPaths.includes(javaConfigurationPath) || event.payload.overflow) {
        const rootId = client.getRoot();
        void client
          .request("java.getOptions", {})
          .then((result) => {
            if (client.getRoot() !== rootId) return;
            setJavaOptions(result.options);
            javaOptionsRef.current = result.options;
          })
          .catch((error: unknown) =>
            setStatusMessage(error instanceof Error ? error.message : "Could not load Java configuration"),
          );
      }
      refreshDiffs(changedPaths.length === 1 ? changedPaths[0] : undefined);
      if (javaOptionsRef.current && changedPaths.some((changedPath) => changedPath.endsWith(".java"))) {
        if (javaRefreshTimer.current) clearTimeout(javaRefreshTimer.current);
        javaRefreshTimer.current = setTimeout(() => {
          void loadJavaProjectTree(client)
            .then(setJavaTree)
            .catch(() => undefined);
        }, 200);
      }
      if (event.payload.health === "degraded")
        showStatus(event.payload.message ?? "Filesystem watcher degraded; synchronization may be incomplete.", "error");
      if (!changedPaths.length) return;
      void client
        .request("filesystem.snapshot", { paths: changedPaths })
        .then(async ({ entries }) => {
          setTree((current) => reconcileProjectTree(current, entries));
          const existing = new Set(entries.filter((entry) => entry.type === "file").map((entry) => entry.path));
          for (const openTab of layoutRef.current.editorGroups[0]?.tabs.filter(
            (tab) => tab.type === "file" && changedPaths.includes(tab.path),
          ) ?? []) {
            if (!existing.has(openTab.path)) {
              updateGroup((tabs, active) => ({
                tabs: tabs.map((tab) =>
                  tab.id === openTab.id ? { ...tab, error: "File was deleted outside the editor" } : tab,
                ),
                activeTabId: active,
              }));
              continue;
            }
            if ((selfWriteUntil.current.get(openTab.path) ?? 0) > Date.now()) continue;
            try {
              const result = await client.request("filesystem.readFile", { path: openTab.path });
              if (openTab.dirty)
                setExternalConflict({
                  tabId: openTab.id,
                  path: openTab.path,
                  externalContent: result.content,
                  externalRevision: result.revision,
                });
              else
                updateGroup((tabs, active) => ({
                  tabs: tabs.map((tab) =>
                    tab.id === openTab.id && !tab.dirty
                      ? {
                          ...tab,
                          content: result.content,
                          savedContent: result.content,
                          revision: result.revision,
                          error: undefined,
                        }
                      : tab,
                  ),
                  activeTabId: active,
                }));
            } catch (error) {
              updateGroup((tabs, active) => ({
                tabs: tabs.map((tab) =>
                  tab.id === openTab.id
                    ? { ...tab, error: error instanceof Error ? error.message : "Automatic reload failed" }
                    : tab,
                ),
                activeTabId: active,
              }));
            }
          }
        })
        .catch((error: unknown) =>
          setStatusMessage(error instanceof Error ? error.message : "Automatic synchronization failed"),
        );
    };
    try {
      await client.connect(host.trim(), Number(port));
      if (clientRef.current !== client) return;
      try {
        setStatusMessage("Loading workspace roots…");
        const rootRegistry = await client.request("workspace.roots", {});
        client.setRoot(rootRegistry.selectedRootId);
        setWorkspaceRoots(rootRegistry.roots);
        setSelectedRootId(rootRegistry.selectedRootId);
        setStatusMessage("Opening workspace and reading files…");
        const result = await client.request("workspace.open", { includeIgnored: showIgnoredRef.current });
        if (clientRef.current !== client) return;
        setActiveWorkspace(result.workspace);
        activeWorkspaceRef.current = result.workspace;
        setProjectName(result.projectName);
        // Load workspace-specific settings
        const key = result.workspace;
        workspaceKeyRef.current = key;
        cursorPositions.setWorkspace(result.workspace);
        const setting = (name: string) => readWorkspaceSetting(key, name);
        const wsTheme = setting("theme");
        if (wsTheme === "light" || wsTheme === "dark") setTheme(wsTheme);
        const wsHighlight = setting("highlightTheme");
        if (wsHighlight === "ftpud" || wsHighlight === "ftpud-dark") setHighlightTheme("ftpud");
        else if (wsHighlight === "default") setHighlightTheme("default");
        const wsFontFamily = setting("uiFontFamily");
        if (wsFontFamily === "inter" || wsFontFamily === "jetbrains") setUiFontFamily(wsFontFamily);
        const wsFontWeight = Number(setting("uiFontWeight"));
        setUiFontWeight(wsFontWeight >= 350 && wsFontWeight <= 600 ? wsFontWeight : 450);
        const wsFontSize = Number(setting("uiFontSize"));
        if (wsFontSize >= 10 && wsFontSize <= 20) setUiFontSize(wsFontSize);
        const wsLineHeight = Number(setting("uiLineHeight"));
        if (wsLineHeight >= 1 && wsLineHeight <= 2) setUiLineHeight(wsLineHeight);
        // Restore both modes so switching layouts does not replace saved geometry with defaults.
        setWorkflowPanelMode(setting("workflow.panelMode") === "design" ? "design" : "run");
        try {
          const saved = JSON.parse(setting("focused.leftPanels") ?? "{}");
          if (typeof saved === "object" && saved !== null)
            setLeftPanels((current) => restoredFocusedLeftPanels(current, saved));
        } catch {}
        try {
          const saved = JSON.parse(setting("focused.rightPanels") ?? "{}");
          if (typeof saved === "object" && saved !== null) setRightPanels((current) => ({ ...current, ...saved }));
        } catch {}
        const savedFocusedLeftWidth = Number(setting("focused.leftWidth"));
        if (savedFocusedLeftWidth >= 280 && savedFocusedLeftWidth <= 900) setLeftSidebarWidth(savedFocusedLeftWidth);
        const savedFocusedRightWidth = Number(setting("focused.rightWidth"));
        if (savedFocusedRightWidth >= 180 && savedFocusedRightWidth <= 700)
          setRightSidebarWidth(savedFocusedRightWidth);
        const savedClassicLeftWidth = Number(setting("classic.leftWidth"));
        if (savedClassicLeftWidth >= 180 && savedClassicLeftWidth <= 500) setClassicLeftWidth(savedClassicLeftWidth);
        const savedClassicRightWidth = Number(setting("classic.rightWidth"));
        if (savedClassicRightWidth >= 240 && savedClassicRightWidth <= 960)
          setClassicRightWidth(savedClassicRightWidth);
        const savedTasksOpen = setting("classic.tasksOpen");
        if (savedTasksOpen === "true" || savedTasksOpen === "false") setClassicTasksOpen(savedTasksOpen === "true");
        const savedAiOpen = setting("classic.aiOpen");
        if (savedAiOpen === "true" || savedAiOpen === "false") setClassicAiOpen(savedAiOpen === "true");
        const savedSplit = Number(setting("classic.split"));
        if (savedSplit >= 10 && savedSplit <= 90) setClassicSplit(savedSplit);
        const savedSideView = setting("classic.sideView");
        if (
          [
            "project",
            "git",
            "taskGit",
            "java",
            "useful",
            "agents",
            "harness",
            "workflowRuns",
            "timers",
            "triggers",
            "proc",
          ].includes(savedSideView ?? "")
        )
          setClassicSideView(savedSideView as typeof classicSideView);
        const savedTerminalHeight = Number(setting("bottom.terminalHeight"));
        if (savedTerminalHeight >= 130 && savedTerminalHeight <= 520) setTerminalHeight(savedTerminalHeight);
        const savedJavaHeight = Number(setting("bottom.javaHeight"));
        if (savedJavaHeight >= 140 && savedJavaHeight <= 1200) setJavaPanelHeight(savedJavaHeight);
        const savedProblemsHeight = Number(setting("bottom.problemsHeight"));
        if (savedProblemsHeight >= 120 && savedProblemsHeight <= 520) setProblemsHeight(savedProblemsHeight);
        const savedGitLogHeight = Number(setting("bottom.gitLogHeight"));
        if (savedGitLogHeight >= 180 && savedGitLogHeight <= 650) setGitLogHeight(savedGitLogHeight);
        setStatusMessage("Discovering AI providers…");
        const providerResult = await client.request("ai.providers", {});
        setAiProviders(providerResult.providers);
        setJavaOptions(result.options.javaProject);
        if (result.options.javaProject) {
          setStatusMessage("Loading Java project…");
          try {
            setJavaTree(await loadJavaProjectTree(client));
          } catch {
            setJavaTree([]);
          }
        } else setJavaTree([]);
        setStatusMessage("Restoring editors and terminals…");
        await restoreWorkspaceOptions(result.options, client);
        setStatusMessage("Loading tasks…");
        const taskResult = await client.request("tasks.list", {});
        setTasks(taskResult.tasks);
        setSelectedTaskId(taskResult.selectedTaskId);
        selectedTaskIdRef.current = taskResult.selectedTaskId;
        activeTaskRef.current = taskResult.tasks.find((task) => task.id === taskResult.selectedTaskId);
        const initialPanel = initialTaskPanel(sideLayout, taskResult.selectedTaskId, setting);
        if (initialPanel.classic) setClassicSideView(initialPanel.classic);
        if (initialPanel.focusedTaskGit !== undefined)
          setRightPanels((current) => ({ ...current, taskGit: initialPanel.focusedTaskGit! }));
        // The provider is remembered per task, so it can only be resolved once the selected task is known.
        const taskProvider = setting(aiProviderTaskKey(taskResult.selectedTaskId)) as AiProvider | null;
        const wsProvider = setting("aiProvider") as AiProvider | null;
        const known = (candidate: AiProvider | null) =>
          Boolean(candidate) && providerResult.providers.some((item) => item.id === candidate);
        const provider = known(taskProvider)
          ? taskProvider!
          : known(wsProvider)
            ? wsProvider!
            : (providerResult.providers[0]?.id ?? "");
        aiProviderRef.current = provider;
        setAiProvider(provider);
        wsSave(aiProviderTaskKey(taskResult.selectedTaskId), provider);
        setStatusMessage(
          `Loading ${providerResult.providers.find((item) => item.id === provider)?.name ?? provider} models…`,
        );
        const modelResult = await client.request("ai.models", { provider });
        setStatusMessage("Restoring AI session…");
        let session = (await client.request("ai.get", { provider })).session;
        const savedModel = setting(`ai.${provider}.model`);
        const savedReasoning = setting(`ai.${provider}.reasoning`);
        if (savedModel && modelResult.models.some((model) => model.id === savedModel)) {
          const model = modelResult.models.find((item) => item.id === savedModel)!;
          const reasoning =
            savedReasoning && model.reasoningLevels.includes(savedReasoning) ? savedReasoning : model.defaultReasoning;
          if (session.status !== "in_progress" && (session.model !== savedModel || session.reasoning !== reasoning))
            session = (await client.request("ai.configure", { provider, model: savedModel, reasoning })).session;
        }
        setAiModels(modelResult.models);
        setAiSession(session);
        setAiSessions([session]);
        setAiUsage(undefined);
        setTree(result.tree);
        connectionReady = true;
        setStatus("connected");
        setStatusMessage("");
        const backgroundRoot = client.getRoot();
        const backgroundWorkspace = result.workspace;
        const backgroundRevision = taskSwitchSequence.current;
        const canApply = () =>
          clientRef.current === client &&
          client.isConnected() &&
          client.getRoot() === backgroundRoot &&
          activeWorkspaceRef.current === backgroundWorkspace &&
          taskSwitchSequence.current === backgroundRevision;
        // History and auxiliary panels hydrate independently of the usable workspace.
        startBackgroundLoading(
          [
            () =>
              client.request("ai.usage", { provider }).then(({ usage }) => {
                if (canApply() && provider === aiProviderRef.current) setAiUsage(usage);
              }),
            () => refreshAiSessions(client, canApply),
            () => refreshAiStatuses(client, canApply),
            () => refreshUsefulFiles(client, canApply),
            () => refreshRunConfigs(client, canApply),
            () => refreshAgents(client, taskResult.selectedTaskId, canApply),
            () => refreshHarnesses(client, canApply),
            () => refreshHarnessRuns(client, canApply),
          ],
          canApply,
          () => showStatus("Some background panels could not load. Use their refresh button to retry.", "error"),
        );
        void refreshGit(client);
        void refreshTaskGit(activeTaskRef.current, client);
        writeSetting("connection", JSON.stringify({ host, port }));
      } catch (error) {
        if (clientRef.current !== client) return;
        connectionReady = false;
        recovery.stop();
        invalidations.dispose();
        workflowRefresh.dispose();
        client.disconnect();
        if (clientRef.current === client) clientRef.current = undefined;
        setStatus("workspace-error");
        setStatusMessage(error instanceof Error ? error.message : "Workspace could not be opened");
      }
    } catch (error) {
      if (clientRef.current !== client) return;
      invalidations.dispose();
      workflowRefresh.dispose();
      recovery.stop();
      client.disconnect();
      clientRef.current = undefined;
      setStatus("failed");
      setStatusMessage(error instanceof Error ? error.message : "Connection failed");
    }
  };

  useEffect(() => {
    if (didAutoConnect.current || !launchConfig.host || !launchConfig.port) return;
    didAutoConnect.current = true;
    void connect();
  }, [launchConfig.host, launchConfig.port]);

  const disconnect = () => {
    if (hasDirtyTabs && !window.confirm("Disconnect and discard unsaved changes?")) return;
    invalidationRefreshes.current?.dispose();
    recoveryRef.current?.stop();
    clientRef.current?.disconnect();
    clientRef.current = undefined;
    workspaceKeyRef.current = "";
    cursorPositions.setWorkspace("");
    setWorkspaceOptionsReady(false);
    setTasks([]);
    setSelectedTaskId(undefined);
    setJavaOptions(undefined);
    setJavaTree([]);
    setJavaRunning(false);
    setJavaDebugState({ status: "stopped", variables: [] });
    setJavaLog("");
    setLayout(initialLayout);
    setTree([]);
    setStatus("idle");
    setStatusMessage("");
    markdownBlockTerminals.current.clear();
  };

  const persistedFileTabs = group.tabs.filter(
    (tab) => tab.type === "file" && (!tab.rootId || tab.rootId === selectedRootId),
  );
  const persistedActiveTab =
    activeTab?.type === "file" && (!activeTab.rootId || activeTab.rootId === selectedRootId) ? activeTab : undefined;
  const terminalPanelOpen = layout.panels.some((panel) => panel.type === "terminal");
  const hasUnreadTerminalOutput = layout.terminalGroup.tabs.some((tab) => tab.hasUnreadOutput);
  useEffect(() => {
    setLayout(clearViewedTerminalActivity);
  }, [terminalPanelOpen, layout.terminalGroup]);
  const activeTerminalIndex = layout.terminalGroup.tabs.findIndex((tab) => tab.id === layout.terminalGroup.activeTabId);
  const terminalOptions: NonNullable<WorkspaceOptions["terminal"]> = {
    tabs: layout.terminalGroup.tabs.map((tab) => ({ displayName: tab.title, terminalId: tab.terminalId })),
    ...(activeTerminalIndex >= 0 ? { activeTabIndex: activeTerminalIndex } : {}),
    panelOpen: terminalPanelOpen,
  };
  const pinnedFiles = pinnedFilePaths(persistedFileTabs);
  const documentOptions = workflowDocumentOptions(group.tabs, group.activeTabId, selectedRootId);
  const workspaceOptionsSignature = `${persistedFileTabs.map((tab) => tab.path).join("\0")}\n${pinnedFiles.join("\0")}\n${persistedActiveTab?.path ?? ""}\n${JSON.stringify(javaOptions)}\n${JSON.stringify(terminalOptions)}\n${JSON.stringify(fileColors)}\n${gitCommitMessage}\n${JSON.stringify(searchQueries)}\n${JSON.stringify(javaBreakpoints)}\n${JSON.stringify(documentOptions)}`;
  useEffect(() => {
    if (status !== "connected" || !workspaceOptionsReady || !clientRef.current) return;
    const options: WorkspaceOptions = {
      ...documentOptions,
      openFiles: persistedFileTabs.map((tab) => tab.path),
      ...(pinnedFiles.length ? { pinnedFiles } : {}),
      ...(persistedActiveTab ? { activeFile: persistedActiveTab.path } : {}),
      ...(javaOptions ? { javaProject: javaOptions } : {}),
      terminal: terminalOptions,
      ...(Object.keys(fileColors).length ? { fileColors } : {}),
      ...(gitCommitMessage ? { gitCommitMessage } : {}),
      javaBreakpoints,
      ...(Object.keys(searchQueries).length ? { searchQueries } : {}),
    };
    void clientRef.current.request("workspace.saveOptions", { options }).catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : "Could not save workspace options");
    });
  }, [status, workspaceOptionsReady, workspaceOptionsSignature]);

  useEffect(
    () =>
      setSelectedGitPaths(
        (current) => new Set([...current].filter((path) => gitEntries.some((entry) => entry.path === path))),
      ),
    [gitEntries],
  );

  const selectedRollbackEntries = useMemo(
    () => selectedGitEntries(gitEntries, selectedGitPaths),
    [gitEntries, selectedGitPaths],
  );
  const gitOperationRunning = gitCommitting || gitPushing || gitFetching || gitRollingBack || gitPulling || gitRebasing;

  const refreshTree = async (includeIgnored = showIgnoredRef.current) => {
    try {
      setTree((await clientRef.current!.request("filesystem.listTree", { includeIgnored })).tree);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Refresh failed");
    }
  };
  const {
    openFile,
    openAiFile,
    openDiff,
    openTaskDiff,
    openCheckpointDiff,
    restoreCheckpoint,
    reviewCheckpointFile,
    activateEditorTab,
    openUsefulFile,
    openRunConfigFile,
    openAgentFile,
    openSkillFile,
  } = useFileOpeners({
    selectedRootIdRef,
    group,
    updateGroup,
    clientRef,
    rememberNavigation,
    setPendingNavigation,
    tasks,
    selectedTaskId,
    refreshTaskGit,
    refreshGit,
    refreshTree,
    setStatusMessage,
    selectWorkspaceRootRef,
    selectedTaskIdRef,
    switchTaskRef,
    layoutRef,
    setRunConfigs,
  });
  const {
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
  } = useGitActions({
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
  });
  const { closeTab, closeTabs, openTabInWindow, moveTab, toggleTabPin, saveFileTab, saveActive } = useEditorTabActions({
    updateGroup,
    layoutRef,
    setTabContextMenu,
    host,
    port,
    draggedTabId,
    setDraggedTabId,
    clientRef,
    selfWriteUntil,
    setRunConfigs,
    refreshSkills,
    refreshAgents,
    scheduleJavaCheck,
    layout,
  });
  const {
    switchAiProvider,
    refreshAiProviders,
    switchTask,
    selectClassicSideView,
    toggleFocusedTaskGit,
    openTask,
    currentAiAttachmentKey,
    currentAiAttachments,
    currentAiDraft,
    selectedAgent,
    selectedAgentReference,
    selectedSkillIds,
    chatSession,
    availableChatSkills,
    selectAgent,
    updateAiDraft,
    updateAiAttachments,
    attachWorkspaceFile,
    sendAiPrompt,
    sendAiPromptAsTask,
    resolveAiPermission,
    answerAiQuestion,
    steerAiPrompt,
    followUpCheckpoint,
    configureAi,
    newAiSession,
    switchAiSession,
    removeAiSession,
    interruptAi,
  } = useAiActions({
    selectedTaskIdRef,
    clientRef,
    wsSave,
    aiProviderRef,
    setAiProvider,
    setAiModelsLoading,
    aiToken,
    workspaceKeyRef,
    applyAiSession,
    setAiModels,
    setAiUsage,
    refreshAiSessions,
    setStatusMessage,
    setAiProviders,
    taskSwitchActive,
    queuedTaskSwitch,
    invalidationRefreshes,
    taskSwitchSequence,
    gitStatusRequested,
    setGitEntries,
    setGitUpstream,
    setGitError,
    setRunConfigs,
    setTaskSwitching,
    setRightPanels,
    setWorkspaceOptionsReady,
    layoutRef,
    saveFileTab,
    selectedRootIdRef,
    javaOptionsRef,
    fileColors,
    gitCommitMessage,
    javaBreakpoints,
    searchQueries,
    showIgnoredRef,
    terminalWriters,
    terminalBuffers,
    markdownBlockTerminals,
    setLayout,
    setTasks,
    setSelectedTaskId,
    activeTaskRef,
    setTree,
    setClassicSideView,
    setActiveWorkspace,
    activeWorkspaceRef,
    cursorPositions,
    setProjectName,
    setJavaOptions,
    setJavaTree,
    setJavaRunning,
    setJavaDebugState,
    setJavaLog,
    setJavaDiagnostics,
    restoreWorkspaceOptions,
    aiProviders,
    refreshGit,
    refreshAi,
    refreshTaskGit,
    refreshRunConfigs,
    refreshAgents,
    setStatus,
    switchTaskRef,
    sideLayout,
    setClassicAiOpen,
    setLeftPanels,
    selectedTaskId,
    aiAttachments,
    aiProvider,
    aiSession,
    agents,
    selectedAgentKey,
    skillCatalog,
    setSelectedAgentKey,
    setAiAttachments,
    setEditorGitMenu,
    refreshAiStatuses,
    showStatus,
  });
  const { createTask, deleteTask, setTaskStatus, renameTask, setTaskArchived, timerAction, mergeTask } = useTaskActions(
    {
      clientRef,
      taskSwitching,
      setTaskSwitching,
      setTasks,
      switchTask,
      setStatusMessage,
      selectedTaskId,
      setSelectedTaskId,
      setAiAttachments,
      setAiStatuses,
      aiStatusesApplied,
      aiStatusesRequested,
      refreshAiStatuses,
      setMergeDialog,
      showStatus,
    },
  );
  const { saveUsefulFileDialog, deleteUsefulFile, saveAgentDialog, deleteAgent } = useNoteAndAgentFiles({
    clientRef,
    usefulDialog,
    updateGroup,
    setUsefulDialog,
    refreshUsefulFiles,
    setStatusMessage,
    agentDialog,
    selectedAgentKey,
    selectAgent,
    setAgentDialog,
    refreshAgents,
  });

  useEffect(() => {
    if (status !== "connected") return;
    const dirtyFiles = group.tabs.filter(
      (tab) =>
        (tab.type === "file" ||
          tab.type === "useful" ||
          tab.type === "runConfig" ||
          tab.type === "agent" ||
          tab.type === "skill") &&
        tab.dirty &&
        !tab.loading &&
        !tab.error,
    );
    if (dirtyFiles.length === 0) return;
    const timer = setTimeout(() => {
      for (const tab of dirtyFiles) void saveFileTab(tab);
    }, 600);
    return () => clearTimeout(timer);
  }, [status, group.tabs, saveFileTab]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const shortcut = editorTabShortcut(event);
      if (!shortcut || !editorShortcutEligible(event.target, document)) return;
      const currentGroup = layoutRef.current.editorGroups[0];
      if (!currentGroup?.tabs.length) return;
      if (shortcut === "close") {
        const current = currentGroup.tabs.find((tab) => tab.id === currentGroup.activeTabId);
        if (!current) return;
        event.preventDefault();
        closeTab(current);
        return;
      }
      const nextId = adjacentEditorTabId(
        currentGroup.tabs.map((tab) => tab.id),
        currentGroup.activeTabId,
        shortcut === "previous",
      );
      if (!nextId) return;
      event.preventDefault();
      updateGroup((tabs) => ({ tabs, activeTabId: nextId }));
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [updateGroup]);

  const toggleShowIgnored = () => {
    const next = !showIgnoredRef.current;
    showIgnoredRef.current = next;
    setShowIgnored(next);
    writeSetting("showIgnoredFiles", String(next));
    if (clientRef.current) void refreshTree(next);
  };

  const beginLeftSidebarResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setLeftSidebarWidth(Math.max(280, Math.min(Math.min(900, window.innerWidth * 0.65), moveEvent.clientX - 30)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginRightSidebarResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setRightSidebarWidth(
        Math.max(180, Math.min(Math.min(700, window.innerWidth * 0.55), window.innerWidth - moveEvent.clientX - 30)),
      );
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginClassicLeftResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => setClassicLeftWidth(Math.max(180, Math.min(500, moveEvent.clientX - 30)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginClassicRightResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setClassicRightWidth(
        Math.max(240, Math.min(Math.min(960, window.innerWidth * 0.72), window.innerWidth - moveEvent.clientX - 30)),
      );
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginClassicSplitResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) =>
      setClassicSplit(Math.max(20, Math.min(80, ((moveEvent.clientY - bounds.top) / bounds.height) * 100)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const changeSideLayout = (value: "classic" | "ai-focused") => {
    setSideLayout(value);
    writeSetting("sideLayout", value);
  };

  const createTerminal = async (command?: string): Promise<string | undefined> => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const result = await client.request("terminal.create", { cols: 80, rows: 24 });
      updateTerminalGroup((current) => {
        const id = crypto.randomUUID();
        const tab = {
          id,
          rootId: selectedRootIdRef.current,
          terminalId: result.terminalId,
          title: `Terminal ${current.tabs.length + 1}`,
          status: "running" as const,
        };
        return { ...current, tabs: [...current.tabs, tab], activeTabId: id };
      });
      setLayout((current) => ({
        ...current,
        panels: [
          ...current.panels.filter(
            (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
          ),
          { id: "terminal", type: "terminal" },
        ],
      }));
      if (command)
        await client.request("terminal.input", {
          terminalId: result.terminalId,
          data: `${command.replace(/\s+$/, "")}\n`,
        });
      return result.terminalId;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create terminal");
      return undefined;
    }
  };

  const openTerminalReference = async (terminalId: string, title: string): Promise<boolean> => {
    if (!clientRef.current) return false;
    const existing = layoutRef.current.terminalGroup.tabs.find((tab) => tab.terminalId === terminalId);
    if (!existing) {
      const attached = await clientRef.current.request("terminal.attach", { terminalId });
      if (attached.state === "stale") {
        setStatusMessage("That terminal is no longer available.");
        return false;
      }
      terminalBuffers.current.set(attached.session.terminalId, attached.session.output);
      updateTerminalGroup((current) => {
        const alreadyOpen = current.tabs.find((tab) => tab.terminalId === attached.session.terminalId);
        if (alreadyOpen) return { ...current, activeTabId: alreadyOpen.id };
        const id = crypto.randomUUID();
        return {
          ...current,
          tabs: [
            ...current.tabs,
            {
              id,
              rootId: selectedRootIdRef.current,
              terminalId: attached.session.terminalId,
              title,
              status: attached.session.status === "running" ? "running" : "exited",
              ...(attached.session.exitCode === undefined ? {} : { exitCode: attached.session.exitCode }),
              ...(attached.session.status === "running" ? { recovery: "reattached" as const } : {}),
            },
          ],
          activeTabId: id,
        };
      });
    } else updateTerminalGroup((current) => ({ ...current, activeTabId: existing.id }));
    setLayout((current) => ({
      ...current,
      panels: [
        ...current.panels.filter((panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type)),
        { id: "terminal", type: "terminal" },
      ],
    }));
    return true;
  };

  const openHarnessAppTerminal = async (harnessId: string, blockId: string, runId?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Backend is disconnected");
    const terminal = await client.request("harnesses.app.terminal", { harnessId, blockId, runId });
    const label =
      harnesses.find((item) => item.id === harnessId)?.blocks.find((item) => item.id === blockId)?.label ?? "App";
    if (!(await openTerminalReference(terminal.terminalId, `${label} output`)))
      throw new Error("App output terminal is unavailable");
  };

  const openRunConfigTerminal = async (config: RunConfig) => {
    if (!config.terminalId || !clientRef.current) return;
    await openTerminalReference(config.terminalId, config.name);
  };
  const runConfigAction = async (config: RunConfig, action: "run" | "stop" | "restart" | "openTerminal") => {
    setRunConfigMenu(undefined);
    try {
      const next = (
        await clientRef.current!.request(`runConfig.${action}` as "runConfig.run", {
          scope: config.scope,
          name: config.name,
        })
      ).config;
      setRunConfigs((items) =>
        items.map((item) => (item.scope === next.scope && item.name === next.name ? next : item)),
      );
      if (action !== "stop") await openRunConfigTerminal(next);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Run configuration action failed");
    }
  };

  const runMarkdownCommand = async (blockId: string, command: string) => {
    const terminalId = markdownBlockTerminals.current.get(blockId);
    const existing = terminalId
      ? layoutRef.current.terminalGroup.tabs.find((tab) => tab.terminalId === terminalId && tab.status === "running")
      : undefined;
    if (existing && clientRef.current) {
      updateTerminalGroup((current) => ({ ...current, activeTabId: existing.id }));
      setLayout((current) => ({
        ...current,
        panels: [
          ...current.panels.filter(
            (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
          ),
          { id: "terminal", type: "terminal" },
        ],
      }));
      try {
        await clientRef.current.request("terminal.input", {
          terminalId: existing.terminalId,
          data: `${command.replace(/\s+$/, "")}\n`,
        });
        return;
      } catch {
        markdownBlockTerminals.current.delete(blockId);
      }
    }
    const created = await createTerminal(command);
    if (created) markdownBlockTerminals.current.set(blockId, created);
  };

  const renderMarkdownPre = ({
    children,
    node,
  }: {
    children?: ReactNode;
    node?: { position?: { start?: { line?: number } } };
  }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return <pre>{children}</pre>;
    const language = child.props.className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
    if (!language || !["sh", "shell", "bash", "zsh"].includes(language)) return <pre>{children}</pre>;
    const command = String(child.props.children ?? "").replace(/\n$/, "");
    const blockId = `${activeTab?.type ?? "markdown"}:${activeTab?.usefulScope ?? activeTab?.agentScope ?? activeTab?.skillId ?? "workspace"}:${activeTab?.path ?? "markdown"}:${node?.position?.start?.line ?? command}`;
    return (
      <div className="markdown-shell-block">
        <header>
          <span>{language}</span>
          <button
            title="Run in block terminal"
            disabled={!command.trim()}
            onClick={() => void runMarkdownCommand(blockId, command)}
          >
            <Play size={14} />
          </button>
        </header>
        <pre>{children}</pre>
      </div>
    );
  };

  const toggleTerminalPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "terminal");
    if (visible) {
      setLayout((current) => ({ ...current, panels: current.panels.filter((panel) => panel.type !== "terminal") }));
    } else if (layout.terminalGroup.tabs.length > 0) {
      setLayout((current) => ({
        ...current,
        panels: [
          ...current.panels.filter((panel) => !["languageOutput", "problems", "gitlog"].includes(panel.type)),
          { id: "terminal", type: "terminal" },
        ],
      }));
    } else {
      void createTerminal();
    }
  };

  const closeTerminal = async (tab: LayoutModel["terminalGroup"]["tabs"][number]) => {
    if (tab.rootId && tab.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(tab.rootId);
    const owner = runConfigs.find(
      (config) => config.terminalId === tab.terminalId && ["starting", "running", "stopping"].includes(config.status),
    );
    if (owner && clientRef.current)
      void clientRef.current
        .request("runConfig.stop", { scope: owner.scope, name: owner.name })
        .then((result) =>
          setRunConfigs((items) =>
            items.map((item) =>
              item.scope === result.config.scope && item.name === result.config.name ? result.config : item,
            ),
          ),
        )
        .catch(() => undefined);
    else if (tab.status !== "unavailable")
      void clientRef.current
        ?.request("terminal.close", { terminalId: tab.terminalId })
        .then(() => refreshRunProjects())
        .catch(() => undefined);
    terminalBuffers.current.delete(tab.terminalId);
    for (const [blockId, terminalId] of markdownBlockTerminals.current)
      if (terminalId === tab.terminalId) markdownBlockTerminals.current.delete(blockId);
    setLayout((current) => {
      const index = current.terminalGroup.tabs.findIndex((item) => item.id === tab.id);
      const tabs = current.terminalGroup.tabs.filter((item) => item.id !== tab.id);
      const activeTabId =
        current.terminalGroup.activeTabId === tab.id
          ? tabs[Math.min(index, tabs.length - 1)]?.id
          : current.terminalGroup.activeTabId;
      return {
        ...current,
        panels: tabs.length ? current.panels : current.panels.filter((panel) => panel.type !== "terminal"),
        terminalGroup: { ...current.terminalGroup, tabs, activeTabId },
      };
    });
  };

  const renameTerminal = (tab: LayoutModel["terminalGroup"]["tabs"][number], value: string) => {
    const title = value.trim();
    if (!title) return;
    updateTerminalGroup((current) => ({
      ...current,
      tabs: current.tabs.map((item) => (item.id === tab.id ? { ...item, title: title.slice(0, 100) } : item)),
    }));
  };

  const duplicateTerminal = async (tab: LayoutModel["terminalGroup"]["tabs"][number]) => {
    const client = clientRef.current;
    if (!client) return;
    if (tab.rootId && tab.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(tab.rootId);
    try {
      const session = await client.request("terminal.create", { cols: 80, rows: 24 });
      updateTerminalGroup((current) => {
        const id = crypto.randomUUID();
        const index = current.tabs.findIndex((item) => item.id === tab.id);
        const copy = {
          id,
          rootId: selectedRootIdRef.current,
          terminalId: session.terminalId,
          title: `${tab.title} copy`.slice(0, 100),
          status: "running" as const,
        };
        return {
          ...current,
          tabs: [...current.tabs.slice(0, index + 1), copy, ...current.tabs.slice(index + 1)],
          activeTabId: id,
        };
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not duplicate terminal");
    }
  };

  const moveTerminal = (tabId: string, targetTabId: string) =>
    updateTerminalGroup((current) => {
      const from = current.tabs.findIndex((tab) => tab.id === tabId);
      const to = current.tabs.findIndex((tab) => tab.id === targetTabId);
      if (from < 0 || to < 0 || from === to) return current;
      const tabs = [...current.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab!);
      return { ...current, tabs };
    });

  const beginTerminalResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const move = (moveEvent: PointerEvent) =>
      setTerminalHeight(Math.max(130, Math.min(window.innerHeight - 150, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const refreshJavaTree = async () => {
    try {
      setJavaTree(await loadJavaProjectTree(clientRef.current!));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not refresh Java project");
    }
  };

  const addJavaSourceRoot = async (sourcePath: string) => {
    setTreeContextMenu(undefined);
    try {
      const result = await clientRef.current!.request("java.addSourceRoot", { path: sourcePath });
      setJavaOptions(result.options);
      javaOptionsRef.current = result.options;
      setJavaTree(result.tree);
      if (sideLayout === "classic") setClassicSideView("java");
      else setRightPanels((current) => ({ ...current, java: true }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not add source root");
    }
  };

  const saveProjectPathDialog = async (name: string) => {
    if (!clientRef.current || !projectPathDialog) return;
    const { mode, node, parentPath } = projectPathDialog;
    const targetPath = parentPath ? `${parentPath}/${name}` : name;
    if (mode === "file") {
      await clientRef.current.request("filesystem.createFile", { path: targetPath });
      setProjectPathDialog(undefined);
      await Promise.all([refreshTree(), refreshGit()]);
      await openFile({ name: name.split("/").at(-1) ?? name, path: targetPath, type: "file" });
      return;
    }
    if (mode === "directory") {
      await clientRef.current.request("filesystem.createDirectory", { path: targetPath });
      setProjectPathDialog(undefined);
      await refreshTree();
      return;
    }
    if (targetPath === node.path) {
      setProjectPathDialog(undefined);
      return;
    }
    await clientRef.current.request("filesystem.rename", { path: node.path, newPath: targetPath });
    const oldPrefix = `${node.path}/`;
    const newPrefix = `${targetPath}/`;
    const renamePath = (value: string) =>
      value === node.path
        ? targetPath
        : node.type === "directory" && value.startsWith(oldPrefix)
          ? newPrefix + value.slice(oldPrefix.length)
          : value;
    updateGroup((tabs, active) => ({
      tabs: tabs.map((tab) =>
        tab.type === "file"
          ? {
              ...tab,
              path: renamePath(tab.path),
              title:
                tab.path === node.path || (node.type === "directory" && tab.path.startsWith(oldPrefix))
                  ? (renamePath(tab.path).split("/").at(-1) ?? tab.title)
                  : tab.title,
            }
          : tab,
      ),
      activeTabId: active,
    }));
    setFileColors((current) =>
      Object.fromEntries(Object.entries(current).map(([path, color]) => [renamePath(path), color])),
    );
    if (javaOptionsRef.current) {
      const next = {
        ...javaOptionsRef.current,
        pomPath: renamePath(javaOptionsRef.current.pomPath),
        sourceRoots: javaOptionsRef.current.sourceRoots.map(renamePath),
        outputPath: renamePath(javaOptionsRef.current.outputPath),
        testOutputPath: renamePath(javaOptionsRef.current.testOutputPath),
      };
      javaOptionsRef.current = next;
      setJavaOptions(next);
    }
    setProjectPathDialog(undefined);
    await Promise.all([refreshTree(), refreshGit(), javaOptionsRef.current ? refreshJavaTree() : Promise.resolve()]);
  };

  const deleteProjectPath = async (node: FileTreeNode) => {
    const client = clientRef.current;
    if (!client) return;
    const prefix = `${node.path}/`;
    const affectedTabs = layoutRef.current.editorGroups
      .flatMap((editorGroup) => editorGroup.tabs)
      .filter(
        (tab) =>
          tab.type === "file" && (tab.path === node.path || (node.type === "directory" && tab.path.startsWith(prefix))),
      );
    const dirty = affectedTabs.filter((tab) => tab.dirty);
    if (dirty.length) {
      setStatusMessage(
        `Save or discard changes before deleting ${node.path}: ${dirty.map((tab) => tab.path).join(", ")}`,
      );
      return;
    }
    try {
      const preview = await client.request("filesystem.previewDelete", { path: node.path });
      const separator = activeWorkspace.includes("\\") ? "\\" : "/";
      const resolved = `${activeWorkspace.replace(/[\\/]+$/, "")}${separator}${node.path.split("/").join(separator)}`;
      const detail = preview.childCount
        ? `\n\n${preview.childCount} child item${preview.childCount === 1 ? "" : "s"} will also be moved to trash.${preview.children.length ? `\n\n${preview.children.slice(0, 8).join("\n")}${preview.childCount > 8 ? "\n…" : ""}` : ""}`
        : "";
      if (!window.confirm(`Move this ${preview.type} to workspace trash?\n\n${resolved}${detail}`)) return;
      const result = await client.request("filesystem.delete", { path: node.path });
      const closing = new Set(affectedTabs.map((tab) => tab.id));
      updateGroup((tabs, active) => {
        const next = tabs.filter((tab) => !closing.has(tab.id));
        return { tabs: next, activeTabId: active && !closing.has(active) ? active : next.at(-1)?.id };
      });
      setFileColors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([filePath]) => filePath !== node.path && !(node.type === "directory" && filePath.startsWith(prefix)),
          ),
        ),
      );
      if (result.recoveryId) setLastDeleted({ recoveryId: result.recoveryId, path: node.path });
      showStatus(`${node.path} moved to workspace trash`, "success");
      await Promise.all([refreshTree(), refreshGit(), javaOptionsRef.current ? refreshJavaTree() : Promise.resolve()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Could not delete ${node.path}`);
    }
  };

  const restoreLastDeleted = async () => {
    if (!lastDeleted || !clientRef.current) return;
    try {
      await clientRef.current.request("filesystem.restore", { recoveryId: lastDeleted.recoveryId });
      showStatus(`${lastDeleted.path} restored`, "success");
      setLastDeleted(undefined);
      await Promise.all([refreshTree(), refreshGit(), javaOptionsRef.current ? refreshJavaTree() : Promise.resolve()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not restore deleted path");
    }
  };

  const toggleJavaPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "languageOutput");
    setLayout((current) => ({
      ...current,
      panels: visible
        ? current.panels.filter((panel) => panel.type !== "languageOutput")
        : [
            ...current.panels.filter(
              (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
            ),
            { id: "languageOutput", type: "languageOutput" },
          ],
    }));
  };

  const toggleProblemsPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "problems");
    setLayout((current) => ({
      ...current,
      panels: visible
        ? current.panels.filter((panel) => panel.type !== "problems")
        : [
            ...current.panels.filter(
              (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
            ),
            { id: "problems", type: "problems" },
          ],
    }));
    if (!visible) void checkJava();
  };

  const toggleGitLogPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "gitlog");
    setLayout((current) => ({
      ...current,
      panels: visible
        ? current.panels.filter((panel) => panel.type !== "gitlog")
        : [
            ...current.panels.filter(
              (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
            ),
            { id: "gitlog", type: "gitlog" },
          ],
    }));
  };

  const saveLaunchFiles = async () => {
    const client = clientRef.current!;
    const rootId = client.getRoot();
    for (const tab of layoutRef.current.editorGroups.flatMap((group) => group.tabs)) {
      if (tab.type === "file" && (!tab.rootId || tab.rootId === rootId) && tab.dirty && !(await saveFileTab(tab)))
        throw new Error(`Could not save ${tab.path} before launching a process`);
    }
    if (clientRef.current !== client || client.getRoot() !== rootId)
      throw new Error("Workspace changed while saving edits");
    return client;
  };

  const runJavaAction = async (action: "language.build" | "language.run") => {
    setLayout((current) => ({
      ...current,
      panels: [
        ...current.panels.filter((panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type)),
        { id: "languageOutput", type: "languageOutput" },
      ],
    }));
    setJavaRunning(true);
    try {
      const client = await saveLaunchFiles();
      await client.request(action, { language: "java" }, { timeoutMs: 10 * 60_000 });
    } catch (error) {
      setJavaRunning(false);
      setJavaLog((current) => `${current}${error instanceof Error ? error.message : "Java process failed"}\n`);
      if (error instanceof Error && error.message.includes("Java configuration")) setShowRunConfigurationDialog(true);
    }
  };

  const stopJava = async () => {
    try {
      await clientRef.current!.request("language.stop", { language: "java" });
    } catch {
      /* Process may have already exited. */
    }
  };

  const debugJava = async () => {
    setLayout((current) => ({
      ...current,
      panels: [
        ...current.panels.filter((panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type)),
        { id: "languageOutput", type: "languageOutput" },
      ],
    }));
    setJavaRunning(true);
    try {
      const client = await saveLaunchFiles();
      await languageClient(client, "java").startDebug(
        javaBreakpoints.map(({ className, ...breakpoint }) => ({ ...breakpoint, extra: { className } })),
        { timeoutMs: 10 * 60_000 },
      );
    } catch (error) {
      setJavaRunning(false);
      setJavaDebugState({ status: "stopped", variables: [] });
      setJavaLog((current) => `${current}${error instanceof Error ? error.message : "Debugger failed"}\n`);
      if (error instanceof Error && error.message.includes("Java configuration")) setShowRunConfigurationDialog(true);
    }
  };

  const applyJavaChanges = async () => {
    const client = clientRef.current;
    if (!client) throw new Error("Not connected");
    const rootId = client.getRoot();
    for (const tab of layoutRef.current.editorGroups.flatMap((item) => item.tabs)) {
      if (tab.type === "file" && tab.rootId === rootId && tab.dirty) {
        if (!(await saveFileTab(tab)))
          throw new Error(`Could not save ${tab.path}. Fix the save error before applying changes.`);
      }
    }
    if (clientRef.current !== client || client.getRoot() !== rootId)
      throw new Error("Workspace changed while saving edits");
    // JavaPanel still renders Java HotSwap details; this is the Java-specific result boundary.
    return languageClient(client, "java").applyChanges({
      timeoutMs: 10 * 60_000,
    }) as unknown as Promise<JavaApplyChangesResult>;
  };

  const commandJavaDebugger = async (command: LanguageDebugCommand) => {
    try {
      await languageClient(clientRef.current!, "java").debugCommand(command);
    } catch (error) {
      setJavaLog((current) => `${current}${error instanceof Error ? error.message : "Debugger command failed"}\n`);
    }
  };

  const toggleBreakpoint = (filePath: string, content: string, line: number) => {
    const packageName = content.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1];
    const simpleName =
      filePath
        .split("/")
        .pop()
        ?.replace(/\.java$/i, "") ?? "";
    const className = packageName ? `${packageName}.${simpleName}` : simpleName;
    setJavaBreakpoints((current) =>
      current.some((item) => item.path === filePath && item.line === line)
        ? current.filter((item) => item.path !== filePath || item.line !== line)
        : [...current, { path: filePath, line, className }],
    );
  };

  const decorateBreakpoints = (instance: editor.IStandaloneCodeEditor, filePath: string, api: Monaco) => {
    breakpointDecorationsRef.current = instance.deltaDecorations(
      breakpointDecorationsRef.current,
      javaBreakpoints
        .filter((item) => item.path === filePath)
        .map((item) => ({
          range: { startLineNumber: item.line, startColumn: 1, endLineNumber: item.line, endColumn: 1 },
          options: {
            isWholeLine: false,
            glyphMarginClassName: "java-breakpoint",
            glyphMargin: { position: api.editor.GlyphMarginLane.Center },
            glyphMarginHoverMessage: { value: `Breakpoint at line ${item.line}` },
          },
        })),
    );
  };

  useEffect(() => {
    if (monacoEditorRef.current && monacoRef.current && activeTab?.type === "file")
      decorateBreakpoints(monacoEditorRef.current, activeTab.path, monacoRef.current);
  }, [activeTab?.path, javaBreakpoints]);

  useEffect(() => {
    if (javaDebugState.status !== "running" && javaDebugState.status !== "paused") return;
    const client = clientRef.current;
    if (!client) return;
    void languageClient(client, "java")
      .setBreakpoints(javaBreakpoints.map(({ className, ...breakpoint }) => ({ ...breakpoint, extra: { className } })))
      .catch((error: unknown) =>
        setStatusMessage(error instanceof Error ? error.message : "Could not update breakpoints"),
      );
  }, [javaBreakpoints, javaDebugState.status]);

  useEffect(() => {
    if (
      activeTab?.type !== "file" ||
      !clientRef.current ||
      !gitEntries.some((entry) => entry.path === activeTab.path)
    ) {
      setActiveGitHunks([]);
      return;
    }
    let current = true;
    void clientRef.current
      .request("git.diff", { path: activeTab.path })
      .then((result) => {
        if (current) setActiveGitHunks(result.hunks);
      })
      .catch(() => {
        if (current) setActiveGitHunks([]);
      });
    return () => {
      current = false;
    };
  }, [activeTab?.path, activeTab?.type, gitEntries]);

  useEffect(() => {
    const instance = monacoEditorRef.current;
    if (!instance || activeTab?.type !== "file") return;
    gitDecorationsRef.current = instance.deltaDecorations(
      gitDecorationsRef.current,
      gitHunkDecorations(activeGitHunks),
    );
  }, [activeGitHunks, activeTab?.path, activeTab?.type]);

  useEffect(() => {
    const instance = monacoEditorRef.current;
    const api = monacoRef.current;
    const model = instance?.getModel();
    if (!api || !model || activeTab?.type !== "file") return;
    const diagnostics = javaDiagnostics.filter((item) => item.path === activeTab.path);
    api.editor.setModelMarkers(
      model,
      "java",
      diagnostics.map((item) => {
        const line = Math.max(1, Math.min(item.line, model.getLineCount()));
        const column = Math.max(1, Math.min(item.column, model.getLineMaxColumn(line)));
        return {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: Math.max(column + 1, model.getLineMaxColumn(line)),
          severity: item.severity === "error" ? api.MarkerSeverity.Error : api.MarkerSeverity.Warning,
          message: item.message,
          source: "Maven",
        };
      }),
    );
  }, [activeTab?.path, javaDiagnostics]);

  useEffect(() => {
    debugEditorRef.current?.update({ ...javaDebugState, busy: javaDebugState.applyingChanges });
    if (javaDebugState.status === "paused" && javaDebugState.path && activeTab?.path !== javaDebugState.path) {
      void openFile({ name: javaDebugState.path.split("/").pop()!, path: javaDebugState.path, type: "file" });
    }
  }, [javaDebugState]);
  useEffect(() => () => debugEditorRef.current?.dispose(), []);

  const beginJavaResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = javaPanelHeight;
    const move = (moveEvent: PointerEvent) =>
      setJavaPanelHeight(Math.max(140, Math.min(520, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginProblemsResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = problemsHeight;
    const move = (moveEvent: PointerEvent) =>
      setProblemsHeight(Math.max(120, Math.min(520, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginGitLogResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = gitLogHeight;
    const move = (moveEvent: PointerEvent) =>
      setGitLogHeight(Math.max(180, Math.min(650, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const openDiagnostic = async (diagnostic: RootedJavaDiagnostic) => {
    if (diagnostic.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(diagnostic.rootId);
    rememberNavigation({
      rootId: diagnostic.rootId,
      path: diagnostic.path,
      line: diagnostic.line,
      column: diagnostic.column,
    });
    await openFile({ name: diagnostic.path.split("/").pop() ?? diagnostic.path, path: diagnostic.path, type: "file" });
    setPendingNavigation({
      result: {
        rootId: selectedRootIdRef.current,
        path: diagnostic.path,
        line: diagnostic.line,
        column: diagnostic.column,
        preview: diagnostic.message,
      },
      matchLength: 1,
    });
  };

  const openJavaLocation = async (location: RootedJavaLspLocation) => {
    if (location.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(location.rootId);
    rememberNavigation({
      rootId: location.rootId,
      path: location.path,
      line: location.startLine,
      column: location.startColumn,
    });
    await openFile({ name: location.path.split("/").pop() ?? location.path, path: location.path, type: "file" });
    setPendingNavigation({
      result: {
        rootId: selectedRootIdRef.current,
        path: location.path,
        line: location.startLine,
        column: location.startColumn,
        preview: "Java symbol",
      },
      matchLength: Math.max(1, location.endColumn - location.startColumn),
    });
    setJavaUsages(undefined);
  };

  const searchWorkspaceSymbols = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return { symbols: [], truncated: false };
    const result = await client.request("language.symbols", { language: "java", query, limit: 100 });
    return { symbols: result.symbols, truncated: result.truncated ?? false };
  }, []);

  const openWorkspaceSymbol = async (symbol: RootedWorkspaceSymbol) => {
    setWorkspaceSymbolsOpen(false);
    if (symbol.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(symbol.rootId);
    rememberNavigation({ rootId: symbol.rootId, path: symbol.path, line: symbol.line, column: symbol.column });
    await openFile({ name: symbol.path.split("/").pop() ?? symbol.path, path: symbol.path, type: "file" });
    setPendingNavigation({
      result: {
        rootId: selectedRootIdRef.current,
        path: symbol.path,
        line: symbol.line,
        column: symbol.column,
        preview: symbol.name,
      },
      matchLength: Math.max(1, symbol.name.length),
    });
  };

  function rememberNavigation(target: EditorLocation): void {
    const current = layoutRef.current.editorGroups[0];
    const tab = current?.tabs.find((item) => item.id === current.activeTabId);
    const position = monacoEditorRef.current?.getPosition();
    if (tab?.type === "file")
      navigationHistory.current.visit({
        rootId: tab.rootId ?? selectedRootIdRef.current,
        path: tab.path,
        line: position?.lineNumber ?? 1,
        column: position?.column ?? 1,
      });
    navigationHistory.current.visit(target);
  }

  const navigateHistory = async (direction: "back" | "forward") => {
    const location = direction === "back" ? navigationHistory.current.back() : navigationHistory.current.forward();
    if (!location) return;
    if (location.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(location.rootId);
    await openFile({ name: location.path.split("/").pop() ?? location.path, path: location.path, type: "file" });
    setPendingNavigation({ result: { ...location, preview: "Recent location" }, matchLength: 1 });
  };

  const applyJavaImport = (suggestion: JavaTypeSuggestion, range = importChoices?.range) => {
    const instance = monacoEditorRef.current;
    const model = instance?.getModel();
    if (!instance || !model || !range) return;
    const content = model.getValue();
    const packageName = content.match(/^\s*package\s+([\w$.]+)\s*;/m)?.[1];
    const needsImport =
      suggestion.qualifiedName.includes(".") &&
      !suggestion.qualifiedName.startsWith("java.lang.") &&
      !suggestion.qualifiedName.startsWith(`${packageName}.`) &&
      !new RegExp(`^\\s*import\\s+${suggestion.qualifiedName.replaceAll(".", "\\.")}\\s*;`, "m").test(content);
    const edits: editor.IIdentifiedSingleEditOperation[] = [
      { range, text: suggestion.simpleName, forceMoveMarkers: true },
    ];
    if (needsImport) {
      const imports = [...content.matchAll(/^\s*import\s+[^;]+;\s*$/gm)];
      const packageMatch = content.match(/^\s*package\s+[\w$.]+\s*;\s*$/m);
      const offset =
        imports.at(-1)?.index !== undefined
          ? imports.at(-1)!.index! + imports.at(-1)![0].length
          : packageMatch?.index !== undefined
            ? packageMatch.index + packageMatch[0].length
            : 0;
      const position = model.getPositionAt(offset);
      edits.push({
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text: `${offset === 0 ? "" : "\n"}import ${suggestion.qualifiedName};\n`,
        forceMoveMarkers: true,
      });
    }
    instance.executeEdits("java-auto-import", edits);
    instance.focus();
    setImportChoices(undefined);
  };

  const runHttpRequest = async (request: ParsedHttpRequest) => {
    if (!clientRef.current) return;
    setHttpResult({ request, loading: true });
    try {
      setHttpResult({ request, response: await clientRef.current.request("http.execute", request), loading: false });
    } catch (error) {
      setHttpResult({ request, error: error instanceof Error ? error.message : "HTTP request failed", loading: false });
    }
  };

  const mountEditor = (instance: editor.IStandaloneCodeEditor, api: Monaco) => {
    debugEditorRef.current?.dispose();
    debugEditorRef.current = undefined;
    monacoEditorRef.current = instance;
    const restoredViewState = activeTab ? editorViewStates.mount(activeTab.id, instance) : false;
    editorStatusBarRef.current?.attach(instance);
    monacoRef.current = api;
    gitDecorationsRef.current = instance.deltaDecorations(
      [],
      gitHunkDecorations(activeTab?.type === "file" ? activeGitHunksRef.current : []),
    );
    for (const disposable of javaLanguageDisposables.current) disposable.dispose();
    javaLanguageDisposables.current = [];
    if (
      activeTab?.type !== "file" &&
      activeTab?.type !== "useful" &&
      activeTab?.type !== "runConfig" &&
      activeTab?.type !== "agent" &&
      activeTab?.type !== "skill"
    )
      return;
    const model = instance.getModel();
    const savedCursor = model ? validateCursorPosition(cursorPositions.get(activeTab), model) : undefined;
    if (savedCursor && !restoredViewState) instance.setPosition(savedCursor);
    javaLanguageDisposables.current.push(
      instance.onDidChangeCursorPosition((event) => cursorPositions.update(activeTab, event.position)),
    );
    const filePath = activeTab.path;
    if (activeTab.type === "file" && /\.java$/i.test(filePath)) {
      const client = clientRef.current!;
      const rootId = client.getRoot();
      debugEditorRef.current = attachDebugEditor(instance, api, filePath, (reference, start) => {
        if (clientRef.current !== client || client.getRoot() !== rootId)
          return Promise.reject(new Error("Workspace changed"));
        return languageClient(client, "java").debugVariables(reference, start);
      });
      debugEditorRef.current.update({ ...javaDebugStateRef.current, busy: javaDebugStateRef.current.applyingChanges });
    }
    breakpointDecorationsRef.current = [];
    if (activeTab.type === "file") decorateBreakpoints(instance, filePath, api);
    if (activeTab.type === "file")
      javaLanguageDisposables.current.push(
        instance.onContextMenu((event) => {
          event.event.preventDefault();
          const selection = instance.getSelection();
          const hasSelection = Boolean(selection && !selection.isEmpty());
          setEditorGitMenu({
            x: Math.min(event.event.posx, window.innerWidth - 245),
            y: Math.min(event.event.posy, window.innerHeight - 85),
            path: filePath,
            ...(hasSelection ? { ...selectedLineRange(selection!), content: instance.getModel()?.getValue() } : {}),
          });
        }),
      );
    if (activeTab.type === "file")
      javaLanguageDisposables.current.push(
        instance.onMouseDown((event) => {
          const element = event.target.element as HTMLElement | null;
          if (!element?.closest(".git-change-marker")) return;
          const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber;
          const hunk = line
            ? activeGitHunksRef.current.find(
                (item) =>
                  line >= Math.max(1, item.modifiedStart) &&
                  line <= Math.max(1, item.modifiedStart) + Math.max(1, item.modifiedLines) - 1,
              )
            : undefined;
          const entry = gitEntries.find((item) => item.path === filePath);
          if (!hunk || !entry) return;
          void openGitHunkDialog(filePath, hunk, event.event.posx, event.event.posy);
        }),
      );
    if (/\.http$/i.test(filePath)) {
      let decorations: string[] = [];
      const decorate = () => {
        decorations = instance.deltaDecorations(
          decorations,
          parseHttpRequests(instance.getValue()).map((request) => ({
            range: { startLineNumber: request.line, startColumn: 1, endLineNumber: request.line, endColumn: 1 },
            options: {
              glyphMarginClassName: "http-run-marker",
              glyphMarginHoverMessage: { value: `Run ${request.method} ${request.url}` },
            },
          })),
        );
      };
      decorate();
      javaLanguageDisposables.current.push(instance.onDidChangeModelContent(decorate));
      javaLanguageDisposables.current.push(
        instance.onMouseDown((event) => {
          if (!(event.target.element as HTMLElement | null)?.closest(".http-run-marker")) return;
          const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber;
          const request = parseHttpRequests(instance.getValue()).find((item) => item.line === line);
          if (request) void runHttpRequest(request);
        }),
      );
      return;
    }
    if (activeTab.type !== "file") return;
    if (model && ["javascript", "typescript"].includes(model.getLanguageId())) {
      const markerCollection = instance.createDecorationsCollection();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generation = 0;
      let disposed = false;
      const decorate = async () => {
        const requestGeneration = ++generation;
        const version = model.getVersionId();
        try {
          const getWorker = await (model.getLanguageId() === "typescript"
            ? api.languages.typescript.getTypeScriptWorker()
            : api.languages.typescript.getJavaScriptWorker());
          const worker = await getWorker(model.uri);
          const tree = await worker.getNavigationTree(model.uri.toString());
          if (!disposed && requestGeneration === generation && version === model.getVersionId())
            markerCollection.set(functionStartDecorations(navigationFunctionStarts(tree, model)));
        } catch {
          if (!disposed && requestGeneration === generation) markerCollection.clear();
        }
      };
      void decorate();
      javaLanguageDisposables.current.push(
        instance.onDidChangeModelContent(() => {
          ++generation;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void decorate(), 300);
        }),
      );
      javaLanguageDisposables.current.push({
        dispose: () => {
          disposed = true;
          if (timer) clearTimeout(timer);
          markerCollection.clear();
        },
      });
    }
    if (!/\.java$/i.test(filePath)) return;
    let lexicalDecorations: string[] = [];
    const decorateJavaLexicalTokens = () => {
      const decorations: editor.IModelDeltaDecoration[] = [];
      if (highlightTheme === "ftpud" && theme === "light") {
        const content = instance.getValue();
        const lines = content.split(/\r?\n/);
        api.editor.tokenize(content, "java").forEach((tokens, line) =>
          tokens.forEach((token, index) => {
            const kind =
              token.type.startsWith("string.escape.invalid") || token.type.startsWith("string.invalid")
                ? "invalid"
                : token.type.startsWith("string.escape")
                  ? "escape"
                  : token.type.startsWith("string")
                    ? "string"
                    : token.type.startsWith("annotation")
                      ? "annotation"
                      : undefined;
            if (kind)
              decorations.push({
                range: {
                  startLineNumber: line + 1,
                  startColumn: token.offset + 1,
                  endLineNumber: line + 1,
                  endColumn: (tokens[index + 1]?.offset ?? lines[line]?.length ?? 0) + 1,
                },
                options: { inlineClassName: `ftpud-java-${kind}`, inlineClassNameAffectsLetterSpacing: true },
              });
          }),
        );
      }
      lexicalDecorations = instance.deltaDecorations(lexicalDecorations, decorations);
    };
    decorateJavaLexicalTokens();
    javaLanguageDisposables.current.push(instance.onDidChangeModelContent(decorateJavaLexicalTokens));
    javaLanguageDisposables.current.push({
      dispose: () => {
        instance.deltaDecorations(lexicalDecorations, []);
      },
    });
    const functionMarkers = instance.createDecorationsCollection();
    let semanticGeneration = 0;
    let semanticDisposed = false;
    let semanticDecorations: string[] = [];
    let semanticTimer: ReturnType<typeof setTimeout> | undefined;
    const decorateJavaTypes = async () => {
      if (!clientRef.current) {
        semanticDecorations = instance.deltaDecorations(semanticDecorations, []);
        functionMarkers.clear();
        return;
      }
      const generation = ++semanticGeneration;
      const version = instance.getModel()?.getVersionId();
      try {
        const result = await clientRef.current.request("language.lsp.semanticTokens", {
          language: "java",
          path: filePath,
          content: instance.getValue(),
        });
        if (semanticDisposed || generation !== semanticGeneration || version !== instance.getModel()?.getVersionId())
          return;
        functionMarkers.set(
          functionStartDecorations(
            result.tokens
              .filter(
                (token) =>
                  ["function", "method", "constructor"].includes(token.type) &&
                  (token.modifiers.includes("declaration") || token.modifiers.includes("definition")),
              )
              .map((token) => ({
                line: token.startLine,
                name:
                  instance.getModel()?.getValueInRange({
                    startLineNumber: token.startLine,
                    startColumn: token.startColumn,
                    endLineNumber: token.endLine,
                    endColumn: token.endColumn,
                  }) ?? "",
              })),
          ),
        );
        if (highlightTheme !== "ftpud") {
          semanticDecorations = instance.deltaDecorations(semanticDecorations, []);
          return;
        }
        semanticDecorations = instance.deltaDecorations(
          semanticDecorations,
          result.tokens.flatMap((token) => {
            const constant =
              (token.modifiers.includes("readonly") || token.type === "enumMember") &&
              (token.modifiers.includes("static") || token.type === "enumMember");
            const kind = constant
              ? "constant"
              : token.type === "interface"
                ? "interface"
                : ["class", "type", "enum", "struct"].includes(token.type)
                  ? "class"
                  : token.type === "decorator"
                    ? "annotation"
                    : ["property", "field"].includes(token.type)
                      ? token.modifiers.includes("static")
                        ? "static-field"
                        : "field"
                      : ["function", "method", "constructor"].includes(token.type)
                        ? theme === "dark" || token.modifiers.includes("declaration") || token.type === "constructor"
                          ? "function"
                          : token.modifiers.includes("static")
                            ? "static-method"
                            : undefined
                        : undefined;
            return kind
              ? [
                  {
                    range: {
                      startLineNumber: token.startLine,
                      startColumn: token.startColumn,
                      endLineNumber: token.endLine,
                      endColumn: token.endColumn,
                    },
                    options: {
                      inlineClassName: `ftpud${theme === "dark" ? "-dark" : ""}-java-${kind}`,
                      inlineClassNameAffectsLetterSpacing: true,
                    },
                  },
                ]
              : [];
          }),
        );
      } catch {
        if (!semanticDisposed && generation === semanticGeneration) {
          semanticDecorations = instance.deltaDecorations(semanticDecorations, []);
          functionMarkers.clear();
        }
      }
    };
    refreshJavaSemanticRef.current = () => {
      void decorateJavaTypes();
    };
    void decorateJavaTypes();
    javaLanguageDisposables.current.push(
      instance.onDidChangeModelContent(() => {
        ++semanticGeneration;
        if (semanticTimer) clearTimeout(semanticTimer);
        semanticTimer = setTimeout(() => void decorateJavaTypes(), 500);
      }),
    );
    javaLanguageDisposables.current.push({
      dispose: () => {
        semanticDisposed = true;
        refreshJavaSemanticRef.current = undefined;
        if (semanticTimer) clearTimeout(semanticTimer);
        functionMarkers.clear();
        instance.deltaDecorations(semanticDecorations, []);
      },
    });
    javaLanguageDisposables.current.push(
      api.languages.registerCompletionItemProvider("java", {
        triggerCharacters: ["."],
        provideCompletionItems: async (model, position) => {
          if (!clientRef.current || model !== instance.getModel()) return { suggestions: [] };
          const result = await clientRef.current.request("language.lsp.completion", {
            language: "java",
            path: filePath,
            content: model.getValue(),
            line: position.lineNumber,
            column: position.column,
          });
          const word = model.getWordUntilPosition(position);
          return {
            suggestions: result.items.map((item) => ({
              label: item.label,
              detail: item.detail,
              kind: api.languages.CompletionItemKind.Text,
              insertText: item.insertText,
              range: item.range
                ? {
                    startLineNumber: item.range.startLine,
                    startColumn: item.range.startColumn,
                    endLineNumber: item.range.endLine,
                    endColumn: item.range.endColumn,
                  }
                : {
                    startLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endLineNumber: position.lineNumber,
                    endColumn: word.endColumn,
                  },
              additionalTextEdits: item.additionalTextEdits.map((edit) => ({
                range: {
                  startLineNumber: edit.range.startLine,
                  startColumn: edit.range.startColumn,
                  endLineNumber: edit.range.endLine,
                  endColumn: edit.range.endColumn,
                },
                text: edit.text,
              })),
            })),
          };
        },
      }),
    );
    javaLanguageDisposables.current.push(
      instance.addAction({
        id: "java.semantic-completion",
        label: "Java completion",
        keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.Enter, api.KeyMod.WinCtrl | api.KeyCode.Enter],
        run: () => instance.trigger("java", "editor.action.triggerSuggest", {}),
      }),
    );
    javaLanguageDisposables.current.push(
      instance.onMouseDown((event) => {
        if ((event.target.element as HTMLElement | null)?.closest(".git-change-marker, .function-start-marker")) return;
        const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber;
        if ((event.target.type === 2 || event.target.type === 3) && line) {
          toggleBreakpoint(filePath, instance.getValue(), line);
          return;
        }
        const position = event.target.position;
        if (!position || (!event.event.ctrlKey && !event.event.metaKey) || !clientRef.current) return;
        event.event.preventDefault();
        const content = instance.getValue();
        const navigationRoot = clientRef.current.getRoot();
        void clientRef.current
          .request("language.lsp.definition", {
            language: "java",
            path: filePath,
            content,
            line: position.lineNumber,
            column: position.column,
          })
          .then(async ({ locations }) => {
            if (navigationRoot !== selectedRootIdRef.current) return;
            const declaration = locations.find(
              (location) =>
                location.path === filePath &&
                position.lineNumber >= location.startLine &&
                position.lineNumber <= location.endLine &&
                position.column >= location.startColumn &&
                position.column <= location.endColumn,
            );
            if (declaration) {
              const references = await clientRef.current!.request("language.lsp.references", {
                language: "java",
                path: filePath,
                content,
                line: position.lineNumber,
                column: position.column,
              });
              if (navigationRoot === selectedRootIdRef.current) setJavaUsages(references.locations);
            } else if (locations[0]) void openJavaLocation(locations[0]);
          })
          .catch((error: unknown) =>
            setStatusMessage(error instanceof Error ? error.message : "Java navigation failed"),
          );
      }),
    );
  };

  const mountWorkingDiff = (instance: editor.IStandaloneDiffEditor) => {
    editorViewStates.clearMounted();
    monacoDiffEditorRef.current = instance;
    editorStatusBarRef.current?.attach(instance.getModifiedEditor());
    if (activeTab?.type === "diff") {
      const modifiedEditor = instance.getModifiedEditor();
      const model = modifiedEditor.getModel();
      const savedCursor = model ? validateCursorPosition(cursorPositions.get(activeTab), model) : undefined;
      if (savedCursor) modifiedEditor.setPosition(savedCursor);
      modifiedEditor.onDidChangeCursorPosition((event) => cursorPositions.update(activeTab, event.position));
    }
    instance.getModifiedEditor().onDidChangeModelContent(() => {
      if (diffRollbackTimer.current) clearTimeout(diffRollbackTimer.current);
      diffRollbackTimer.current = setTimeout(async () => {
        const current = layoutRef.current.editorGroups[0];
        const tab = current?.tabs.find((item) => item.id === current.activeTabId);
        if (!tab || tab.type !== "diff" || !clientRef.current) return;
        const content = instance.getModifiedEditor().getValue();
        const untracked = gitEntries.some(
          (entry) => entry.path === tab.path && entry.indexStatus === "?" && entry.worktreeStatus === "?",
        );
        try {
          if (untracked && !content) await clientRef.current.request("git.rollback", { path: tab.path });
          else {
            selfWriteUntil.current.set(tab.path, Date.now() + 1500);
            await clientRef.current.request("filesystem.writeFile", { path: tab.path, content });
          }
          updateGroup((tabs, active) => ({
            tabs: tabs.map((item) =>
              item.id === tab.id ? { ...item, content, savedContent: content, dirty: false } : item,
            ),
            activeTabId: active,
          }));
          await Promise.all([refreshGit(), refreshTree()]);
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : "Could not rollback change block");
        }
      }, 200);
    });
  };

  const openSearchForNode = (node: FileTreeNode) => {
    const scope = node.type === "directory" ? node.path : node.path.split("/").slice(0, -1).join("/");
    setTreeContextMenu(undefined);
    setSearchScope(scope);
  };

  const transferProjectPaths = async (kind: "copy" | "move", nodes: FileTreeNode[], duplicate = false) => {
    const client = clientRef.current;
    if (!client || nodes.length === 0) return;
    const destinationDirectory = duplicate
      ? undefined
      : await requestText({
          title: `${kind === "copy" ? "Copy" : "Move"} ${nodes.length} item${nodes.length === 1 ? "" : "s"}`,
          label: "Destination directory",
          placeholder: "Workspace root",
          description: "Path relative to the workspace root. Leave empty for the root.",
          optional: true,
          confirmLabel: kind === "copy" ? "Copy" : "Move",
        });
    if (!duplicate && destinationDirectory === undefined) return;
    const duplicateName = (name: string) => {
      const dot = name.lastIndexOf(".");
      return dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`;
    };
    const items = nodes.map((node) => ({
      source: node.path,
      destination: duplicate
        ? [...node.path.split("/").slice(0, -1), duplicateName(node.name)].filter(Boolean).join("/")
        : [destinationDirectory!.replace(/^\/+|\/+$/g, ""), node.name].filter(Boolean).join("/"),
    }));
    const fileTabs = layoutRef.current.editorGroups.flatMap((group) => group.tabs).filter((tab) => tab.type === "file");
    const openFiles = fileTabs.map((tab) => tab.path);
    const dirtyFiles = fileTabs.filter((tab) => tab.dirty).map((tab) => tab.path);
    try {
      let preview = await client.request("filesystem.transferPreflight", { kind, items, openFiles, dirtyFiles });
      if (preview.dirtyFiles.length) {
        setStatusMessage(`Save or discard changes first: ${preview.dirtyFiles.join(", ")}`);
        return;
      }
      let overwritePaths: string[] = [];
      if (preview.collisions) {
        const collisions = preview.items.filter((item) => item.collision).map((item) => item.destination);
        if (
          !(await requestConfirm({
            title: "Overwrite existing files?",
            message: `${collisions.length} destination${collisions.length === 1 ? " exists" : "s exist"}. Overwrite ${collisions.length === 1 ? "it" : "them"}?`,
            detail: collisions.join("\n"),
            confirmLabel: "Overwrite",
            danger: true,
          }))
        )
          return;
        overwritePaths = collisions;
        preview = await client.request("filesystem.transferPreflight", {
          kind,
          items,
          overwritePaths,
          openFiles,
          dirtyFiles,
        });
      }
      const summary = `${kind === "copy" ? "Copy" : "Move"} ${preview.items.length} item${preview.items.length === 1 ? "" : "s"}?${preview.overwrites ? `\nOverwrites: ${preview.overwrites}` : ""}${preview.caseOnlyRenames ? `\nCase-only renames: ${preview.caseOnlyRenames}` : ""}${preview.crossDeviceMoves ? `\nCross-device moves (copy then remove): ${preview.crossDeviceMoves}` : ""}${preview.openFiles.length ? `\nOpen files affected: ${preview.openFiles.length}` : ""}${preview.skipped.length ? `\nSkipped nested/invalid selections: ${preview.skipped.length}` : ""}`;
      if (
        !(await requestConfirm({
          title: kind === "copy" ? "Copy items?" : "Move items?",
          message: summary,
          confirmLabel: kind === "copy" ? "Copy" : "Move",
        }))
      )
        return;
      const result = await client.request("filesystem.transferApply", {
        kind,
        items,
        overwritePaths,
        openFiles,
        dirtyFiles,
        confirmed: true,
      });
      if (kind === "move")
        for (const item of result.completed) {
          const prefix = `${item.source}/`;
          const replacement = `${item.destination}/`;
          updateGroup((tabs, active) => ({
            tabs: tabs.map((tab) =>
              tab.type === "file" && (tab.path === item.source || tab.path.startsWith(prefix))
                ? {
                    ...tab,
                    path: tab.path === item.source ? item.destination : replacement + tab.path.slice(prefix.length),
                    title:
                      (tab.path === item.source ? item.destination : replacement + tab.path.slice(prefix.length))
                        .split("/")
                        .at(-1) ?? tab.title,
                  }
                : tab,
            ),
            activeTabId: active,
          }));
        }
      setProjectSelection(new Set(result.completed.map((item) => item.destination)));
      await Promise.all([refreshTree(), refreshGit(), javaOptionsRef.current ? refreshJavaTree() : Promise.resolve()]);
      showStatus(
        `${result.completed.length} item${result.completed.length === 1 ? "" : "s"} ${kind === "copy" ? "copied" : "moved"}${result.failures.length ? `; ${result.failures.length} failed` : ""}`,
        result.failures.length ? "error" : "success",
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Could not ${kind} selected paths`);
    }
  };

  const runProjectTreeAction = (action: ProjectTreeAction, nodes: FileTreeNode[]) => {
    const node = nodes[0];
    if (!node) return;
    const actions = projectTreeActions({ node, count: nodes.length });
    if (!actions[action]) return;
    if (action === "open") {
      void openFile(node);
      return;
    }
    if (action === "copyRelativePath" || action === "copyAbsolutePath") {
      const separator = activeWorkspace.includes("\\") ? "\\" : "/";
      const value = nodes
        .map((item) =>
          action === "copyRelativePath"
            ? item.path
            : activeWorkspace
              ? `${activeWorkspace.replace(/[\\/]+$/, "")}${separator}${item.path.split("/").join(separator)}`
              : item.path,
        )
        .join("\n");
      if (!window.desktop?.writeClipboard) {
        setStatusMessage("Electron clipboard bridge is unavailable");
        return;
      }
      void window.desktop
        .writeClipboard(value)
        .then(() =>
          setStatusMessage(
            action === "copyRelativePath" ? "Copied workspace-relative path" : "Copied remote workspace absolute path",
          ),
        )
        .catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : "Could not copy path"));
      return;
    }
    if (action === "duplicate") {
      void transferProjectPaths("copy", nodes, true);
      return;
    }
    if (action === "copyTo" || action === "moveTo") {
      void transferProjectPaths(action === "copyTo" ? "copy" : "move", nodes);
      return;
    }
    const parentPath = node.type === "directory" ? node.path : node.path.split("/").slice(0, -1).join("/");
    if (action === "createFile") setProjectPathDialog({ mode: "file", node, parentPath });
    else if (action === "createDirectory") setProjectPathDialog({ mode: "directory", node, parentPath });
    else if (action === "rename") setProjectPathDialog({ mode: "rename", node, parentPath });
    else if (action === "delete") {
      if (nodes.length > 1) setStatusMessage("Bulk delete is not part of this operation; select one item to delete");
      else void deleteProjectPath(node);
    }
  };

  const navigateToSearchResult = async (result: SearchResult, matchLength: number) => {
    if (result.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(result.rootId);
    rememberNavigation({ rootId: result.rootId, path: result.path, line: result.line, column: result.column });
    await openFile({ name: result.path.split("/").pop() ?? result.path, path: result.path, type: "file" });
    setPendingNavigation({ result, matchLength });
    setSearchScope(undefined);
  };

  const loadBranchMenu = async () => {
    setBranchMenu({ branches: [], loading: true });
    try {
      setBranchMenu({ branches: (await clientRef.current!.request("git.branches", {})).branches, loading: false });
    } catch (error) {
      setBranchMenu(undefined);
      setStatusMessage(error instanceof Error ? error.message : "Could not load branches");
    }
  };

  const toggleBranchMenu = async () => {
    if (branchMenu) {
      setBranchMenu(undefined);
      return;
    }
    await loadBranchMenu();
  };

  const checkoutBranch = async (branch: GitBranchInfo) => {
    if (!clientRef.current || branch.current) return;
    try {
      const result = await clientRef.current.request("git.checkoutBranch", {
        branch: branch.name,
        ...(branch.remote ? { remote: true } : {}),
      });
      setGitBranch(result.branch);
      setBranchMenu(undefined);
      await Promise.all([refreshGit(), refreshTree()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not checkout branch");
    }
  };

  const renameBranch = async (branch: GitBranchInfo) => {
    const newName = await requestText({
      title: "Rename branch",
      message: `Rename ${branch.name}. Its upstream is kept.`,
      label: "New name",
      defaultValue: branch.name,
      validate: gitRefNameError,
      confirmLabel: "Rename",
    });
    if (!clientRef.current || !newName || newName === branch.name) return;
    try {
      const result = await clientRef.current.request("git.renameBranch", { branch: branch.name, newName });
      setGitBranch(result.branch);
      setBranchMenu(undefined);
      await refreshGit();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not rename branch");
    }
  };

  const createBranch = async () => {
    const name = await requestText({
      title: "Create branch",
      message: "Create a local branch from the current commit and switch to it.",
      label: "Branch name",
      placeholder: "feature/my-change",
      validate: (value) =>
        gitRefNameError(value) ??
        ((branchMenu?.branches ?? []).some((item) => !item.remote && item.name === value)
          ? "A local branch with this name exists"
          : undefined),
      confirmLabel: "Create",
    });
    if (!clientRef.current || !name) return;
    try {
      await clientRef.current.request("git.createBranch", { name });
      await loadBranchMenu();
      setStatusMessage(`Created branch ${name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create branch");
    }
  };
  const deleteBranch = async (branch: GitBranchInfo) => {
    if (!clientRef.current) return;
    try {
      const preview = await clientRef.current.request("git.branchDeletePreview", {
        branch: branch.name,
        remote: branch.remote,
      });
      const force = !branch.remote && preview.unmerged.length > 0;
      const details = preview.unmerged.length
        ? `\n\n${preview.unmerged.length} commit(s) are not merged into the current branch.${force ? " This will force-delete the branch." : ""}`
        : "";
      if (
        !(await requestConfirm({
          title: `Delete ${branch.remote ? "remote" : "local"} branch?`,
          message: `${branch.remote ? "Delete remote" : "Delete local"} branch ${branch.name}?${details}`,
          confirmLabel: force ? "Force delete" : "Delete",
          danger: true,
        }))
      )
        return;
      await clientRef.current.request("git.deleteBranch", {
        branch: branch.name,
        remote: branch.remote,
        force,
        confirm: true,
      });
      await loadBranchMenu();
      setStatusMessage(`Deleted ${branch.remote ? "remote" : "local"} branch ${branch.name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete branch");
    }
  };
  const publishBranch = async (branch: GitBranchInfo) => {
    const remote = await requestText({
      title: "Publish branch",
      message: `Push ${branch.name} and set it to track the same branch on the remote.`,
      label: "Remote",
      defaultValue: "origin",
      confirmLabel: "Publish",
    });
    if (!clientRef.current || !remote) return;
    try {
      await clientRef.current.request("git.publishBranch", {
        branch: branch.name,
        remote,
        force: false,
        confirm: true,
      });
      await Promise.all([loadBranchMenu(), refreshGit()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not publish branch");
    }
  };
  const setBranchUpstream = async (branch: GitBranchInfo) => {
    const values = await requestFields({
      title: "Set upstream",
      message: `Choose the remote branch ${branch.name} pulls from and pushes to.`,
      fields: [
        { id: "remote", label: "Remote", defaultValue: "origin" },
        { id: "upstream", label: "Remote branch", defaultValue: branch.name, validate: gitRefNameError },
      ],
      confirmLabel: "Set upstream",
    });
    if (!clientRef.current || !values) return;
    try {
      await clientRef.current.request("git.setBranchUpstream", {
        branch: branch.name,
        remote: values.remote!,
        upstream: values.upstream!,
        confirm: true,
      });
      await refreshGit();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not set branch upstream");
    }
  };

  const editorFontFamily = "JetBrains Mono";
  const terminalFontFamily = "JetBrains Mono Variable";
  const editorLineHeight = Math.round(uiFontSize * uiLineHeight);
  const normalizedTaskFilter = taskFilter.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (
            taskLifecycleFilter === "archived"
              ? !task.archived
              : taskLifecycleFilter !== "all" && (task.archived || task.status !== taskLifecycleFilter)
          )
            return false;
          if (!normalizedTaskFilter) return true;
          const summary = aiStatuses.tasks[task.id] ?? emptyAiSummary;
          return `${task.name} ${task.status} ${summary.status} ${summary.preview}`
            .toLowerCase()
            .includes(normalizedTaskFilter);
        })
        .slice()
        .sort(
          (left, right) =>
            Number(left.archived) - Number(right.archived) ||
            Number(left.status === "finished") - Number(right.status === "finished"),
        ),
    [aiStatuses.tasks, normalizedTaskFilter, taskLifecycleFilter, tasks],
  );
  const showRootTask =
    !normalizedTaskFilter ||
    `root workspace ${aiStatuses.root.status} ${aiStatuses.root.preview}`.toLowerCase().includes(normalizedTaskFilter);
  const selectedTaskTimerActive = Boolean(selectedTaskId && aiStatuses.tasks[selectedTaskId]?.waitingUntil);
  const selectWorkspaceRoot = async (rootId: string) => {
    const client = clientRef.current;
    if (!client || rootId === selectedRootId) return;
    const previous = selectedRootId;
    const selectionRefreshes = invalidationRefreshes.current;
    selectionRefreshes?.reset();
    setTaskSwitching(true);
    try {
      const currentGroup = layoutRef.current.editorGroups[0]!;
      const currentFiles = currentGroup.tabs.filter(
        (tab) => tab.type === "file" && (!tab.rootId || tab.rootId === previous),
      );
      const currentTerminal = {
        ...layoutRef.current.terminalGroup,
        tabs: layoutRef.current.terminalGroup.tabs.filter((tab) => !tab.rootId || tab.rootId === previous),
      };
      const activeTerminalIndex = currentTerminal.tabs.findIndex((tab) => tab.id === currentTerminal.activeTabId);
      await client.request("workspace.saveOptions", {
        options: {
          ...workflowDocumentOptions(currentGroup.tabs, currentGroup.activeTabId, selectedRootIdRef.current),
          openFiles: currentFiles.map((tab) => tab.path),
          ...(pinnedFilePaths(currentFiles).length ? { pinnedFiles: pinnedFilePaths(currentFiles) } : {}),
          ...(currentFiles.find((tab) => tab.id === currentGroup.activeTabId)
            ? { activeFile: currentFiles.find((tab) => tab.id === currentGroup.activeTabId)!.path }
            : {}),
          ...(javaOptionsRef.current ? { javaProject: javaOptionsRef.current } : {}),
          terminal: {
            tabs: currentTerminal.tabs.map((tab) => ({ displayName: tab.title, terminalId: tab.terminalId })),
            ...(activeTerminalIndex >= 0 ? { activeTabIndex: activeTerminalIndex } : {}),
            panelOpen: layoutRef.current.panels.some((panel) => panel.type === "terminal"),
          },
          ...(Object.keys(fileColors).length ? { fileColors } : {}),
          ...(gitCommitMessage ? { gitCommitMessage } : {}),
          javaBreakpoints,
          ...(Object.keys(searchQueries).length ? { searchQueries } : {}),
        },
      });
      selectionRefreshes?.reset();
      client.setRoot(rootId);
      const result = await client.request("workspace.selectRoot", { rootId, includeIgnored: showIgnoredRef.current });
      selectedRootIdRef.current = rootId;
      setSelectedRootId(rootId);
      setActiveWorkspace(result.workspace);
      activeWorkspaceRef.current = result.workspace;
      setProjectName(result.projectName);
      setTree(result.tree);
      workspaceKeyRef.current = result.workspace;
      cursorPositions.setWorkspace(result.workspace);
      setTasks([]);
      setSelectedTaskId(undefined);
      setGitEntries([]);
      setTaskGitEntries([]);
      setJavaOptions(result.options.javaProject);
      setUsefulFiles((files) => files.filter((file) => file.scope === "global"));
      setRunConfigs((configs) => configs.filter((config) => config.scope === "global"));
      await restoreWorkspaceOptions(result.options, client);
      await Promise.all([
        refreshTasks(client),
        refreshGit(client),
        refreshAi(client),
        refreshUsefulFiles(client),
        refreshRunConfigs(client),
        refreshAgents(client),
      ]);
      if (clientRef.current === client && client.getRoot() === rootId && client.isConnected()) {
        selectionRefreshes?.refreshConfiguration();
        setStatus("connected");
      }
    } catch (error) {
      selectionRefreshes?.reset();
      client.setRoot(previous);
      setStatusMessage(error instanceof Error ? error.message : "Could not switch workspace root");
    } finally {
      setTaskSwitching(false);
    }
  };
  selectWorkspaceRootRef.current = selectWorkspaceRoot;
  const activateTerminalTab = (id: string) => {
    const tab = layoutRef.current.terminalGroup.tabs.find((item) => item.id === id);
    void (async () => {
      if (tab?.rootId && tab.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(tab.rootId);
      updateTerminalGroup((current) => ({ ...current, activeTabId: id }));
    })();
  };
  const addWorkspaceRoot = async (path: string, alias: string) => {
    const client = clientRef.current;
    if (!client) return;
    const result = await client.request("workspace.addRoot", { path, alias });
    setWorkspaceRoots(result.roots);
    await selectWorkspaceRoot(result.root.id);
    setWorkspaceRootDialogOpen(false);
  };
  const removeWorkspaceRoot = async () => {
    const client = clientRef.current;
    const removable = workspaceRoots.filter((root) => !root.primary && root.id !== selectedRootId);
    if (!client || !removable.length) return;
    const rootId = await requestText({
      title: "Unregister workspace root",
      message: "The root's remote directory is not deleted.",
      label: "Root",
      choices: removable.map((root) => ({ value: root.id, label: root.alias })),
      confirmLabel: "Unregister",
      danger: true,
    });
    const root = removable.find((item) => item.id === rootId);
    if (!root) return;
    if (
      layoutRef.current.editorGroups[0]?.tabs.some((tab) => tab.rootId === root.id) ||
      layoutRef.current.terminalGroup.tabs.some((tab) => tab.rootId === root.id)
    ) {
      setStatusMessage("Close this root's editor and terminal tabs before unregistering it");
      return;
    }
    try {
      const result = await client.request("workspace.removeRoot", { rootId: root.id });
      setWorkspaceRoots(result.roots);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not remove workspace root");
    }
  };
  const rightSidebarOpen =
    rightPanels.project ||
    rightPanels.git ||
    rightPanels.useful ||
    rightPanels.agents ||
    rightPanels.skills ||
    ((rightPanels.taskGit || rightPanels.promptHistory) && Boolean(selectedTaskId)) ||
    (rightPanels.java && Boolean(javaOptions));
  useEffect(() => {
    const client = clientRef.current;
    setLanguages([]);
    if (status !== "connected" || !client) return;
    let current = true;
    void client
      .request("language.list", {})
      .then(({ languages }) => {
        if (current) setLanguages(languages);
      })
      .catch((error: unknown) => {
        if (current) setStatusMessage(error instanceof Error ? error.message : "Could not list language services");
      });
    return () => {
      current = false;
    };
  }, [status, selectedRootId, selectedTaskId]);
  const refreshRunProjects = useCallback(
    async (client = clientRef.current) => {
      if (!client || !client.isConnected() || taskSwitchActive.current) return;
      const root = client.getRoot();
      const task = selectedTaskIdRef.current;
      const workspace = activeWorkspaceRef.current;
      const generation = ++runProjectGeneration.current;
      const results = await Promise.allSettled(
        languages
          .filter((language) => language.capabilities.run)
          .map(async (language) => {
            const { options } = await client.request("language.options", { language: language.id });
            return runProject(language, options);
          }),
      );
      if (
        generation !== runProjectGeneration.current ||
        clientRef.current !== client ||
        client.getRoot() !== root ||
        selectedTaskIdRef.current !== task ||
        activeWorkspaceRef.current !== workspace ||
        taskSwitchActive.current
      )
        return;
      const projects = results.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
      setRunProjects(projects);
      setSelectedLanguage((current) =>
        projects.some((project) => project.language === current) ? current : projects[0]?.language,
      );
    },
    [languages],
  );
  useEffect(() => {
    runProjectGeneration.current++;
    setRunProjects([]);
    setRunProjectProcesses({});
    setRunConfigurationEditor(undefined);
    setRunProjectBusy(false);
    if (status === "connected")
      void refreshRunProjects().catch((error: unknown) =>
        setStatusMessage(error instanceof Error ? error.message : "Could not load run configurations"),
      );
  }, [status, selectedRootId, selectedTaskId, refreshRunProjects]);
  useEffect(() => {
    const client = clientRef.current;
    if (!client || status !== "connected") return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    return client.subscribeServerEvents((event) => {
      if (
        clientRef.current !== client ||
        client.getRoot() !== root ||
        task !== selectedTaskIdRef.current ||
        taskSwitchActive.current
      )
        return;
      if (
        (event.type === "terminal.exit" && event.payload.rootId === root) ||
        (event.type === "configuration.changed" &&
          event.payload.rootId === root &&
          event.payload.resource.startsWith("languages/"))
      ) {
        void refreshRunProjects().catch(() => undefined);
        return;
      }
      if (
        event.type === "filesystem.changed" &&
        event.payload.rootId === root &&
        (event.payload.overflow ||
          event.payload.paths.some(
            (path) => /(^|\/)(package\.json|pom\.xml)$/.test(path) || /^\.settings\/(npm|java)\.json$/.test(path),
          ))
      ) {
        void refreshRunProjects().catch(() => undefined);
        return;
      }
      if (
        (event.type !== "language.output" && event.type !== "language.exit" && event.type !== "language.debug.state") ||
        event.payload.rootId !== root
      )
        return;
      const language = event.payload.language;
      setRunProjectProcesses((current) => {
        const previous = current[language] ?? { running: false, log: "" };
        if (event.type === "language.output")
          return {
            ...current,
            [language]: { ...previous, log: (previous.log + event.payload.data).slice(-1_000_000) },
          };
        if (event.type === "language.exit")
          return {
            ...current,
            [language]: {
              ...previous,
              running: false,
              log: `${previous.log}\nProcess exited${event.payload.exitCode === null ? "" : ` with code ${event.payload.exitCode}`}\n`,
            },
          };
        return { ...current, [language]: { ...previous, running: event.payload.status !== "stopped" } };
      });
    });
  }, [status, selectedRootId, selectedTaskId, refreshRunProjects]);
  useEffect(() => {
    if (languages.length && status === "connected") void refreshRunProjects().catch(() => undefined);
  }, [javaOptions]);
  const selectProjectRunConfiguration = async (language: string, id: string) => {
    const client = clientRef.current;
    if (!client || taskSwitchActive.current) return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    setRunProjectBusy(true);
    try {
      await languageClient(client, language).request("language.selectRunConfiguration", { id });
      if (clientRef.current !== client || client.getRoot() !== root || task !== selectedTaskIdRef.current) return;
      setSelectedLanguage(language);
      await refreshRunProjects(client);
      const java = await client.request("java.getOptions", {});
      if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current) {
        setJavaOptions(java.options);
        javaOptionsRef.current = java.options;
      }
    } catch (error) {
      if (clientRef.current === client && client.getRoot() === root)
        setStatusMessage(error instanceof Error ? error.message : "Could not select run configuration");
    } finally {
      if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current)
        setRunProjectBusy(false);
    }
  };
  const registerRunProject = async (path: string) => {
    const registration = projectRegistration(path);
    const client = clientRef.current;
    setTreeContextMenu(undefined);
    if (!registration || !client || taskSwitchActive.current) return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    setRunProjectBusy(true);
    try {
      await languageClient(client, registration.language).request("language.load", { extra: registration.extra });
      if (clientRef.current !== client || client.getRoot() !== root || task !== selectedTaskIdRef.current) return;
      const java = await client.request("java.getOptions", {});
      if (clientRef.current !== client || client.getRoot() !== root || task !== selectedTaskIdRef.current) return;
      setJavaOptions(java.options);
      javaOptionsRef.current = java.options;
      if (java.options) void refreshJavaTree();
      await refreshRunProjects(client);
      if (
        clientRef.current !== client ||
        client.getRoot() !== root ||
        task !== selectedTaskIdRef.current ||
        taskSwitchActive.current
      )
        return;
      openRunConfigurations(registration.language);
      void refreshTree();
    } catch (error) {
      if (clientRef.current === client && client.getRoot() === root)
        setStatusMessage(error instanceof Error ? error.message : "Could not add project");
    } finally {
      if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current)
        setRunProjectBusy(false);
    }
  };
  const launchProjectConfiguration = async (language: string, debug = false) => {
    if (runProjectBusy || taskSwitchActive.current || runProjectProcesses[language]?.running) return;
    const client = clientRef.current;
    if (!client) return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    const current = () =>
      clientRef.current === client &&
      client.getRoot() === root &&
      selectedTaskIdRef.current === task &&
      !taskSwitchActive.current;
    setSelectedLanguage(language);
    setRunProjectProcesses((states) => ({
      ...states,
      [language]: { ...(states[language] ?? { log: "" }), running: true, error: undefined },
    }));
    try {
      await saveLaunchFiles();
      if (!current()) return;
      if (debug)
        await languageClient(client, language).startDebug(
          language === "java"
            ? javaBreakpoints.map(({ className, ...breakpoint }) => ({ ...breakpoint, extra: { className } }))
            : [],
          { timeoutMs: 10 * 60_000 },
        );
      else {
        const { terminal } = await languageClient(client, language).request(
          "language.run",
          {},
          { timeoutMs: 10 * 60_000 },
        );
        if (current()) await openTerminalReference(terminal.terminalId, terminal.displayName ?? "Run");
      }
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : "Run failed";
        setRunProjectProcesses((states) => ({
          ...states,
          [language]: { ...(states[language] ?? { log: "" }), running: false, error: message },
        }));
        setStatusMessage(message);
      }
    }
  };
  const stopProjectConfiguration = async (language: string) => {
    try {
      await languageClient(clientRef.current!, language).request("language.stop", {});
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not stop project");
    }
  };
  const commandContext: CommandContext = {
    connected: status === "connected",
    hasActiveEditor: Boolean(activeTab),
    activeEditorDirty: Boolean(activeTab?.dirty),
    gitBusy: gitOperationRunning,
    taskSwitching,
    aiBusy: aiSession.status === "in_progress",
  };
  const commands: Command[] = [
    {
      id: "project.commandPalette",
      label: "Show Command Palette",
      category: "Project",
      when: (context) => context.connected,
      execute: () => setCommandPaletteOpen(true),
    },
    {
      id: "project.quickOpen",
      label: "Go to File",
      category: "Project",
      when: (context) => context.connected,
      execute: () => setQuickOpen(true),
    },
    {
      id: "project.workspaceSymbols",
      label: "Go to Workspace Symbol",
      category: "Project",
      when: (context) => context.connected,
      execute: () => setWorkspaceSymbolsOpen(true),
    },
    {
      id: "editor.navigateBack",
      label: "Go Back",
      category: "Editor",
      when: (context) => context.connected,
      execute: () => navigateHistory("back"),
    },
    {
      id: "editor.navigateForward",
      label: "Go Forward",
      category: "Editor",
      when: (context) => context.connected,
      execute: () => navigateHistory("forward"),
    },
    {
      id: "project.refresh",
      label: "Refresh Project",
      category: "Project",
      when: (context) => context.connected,
      execute: () => refreshTree(),
    },
    {
      id: "project.findInFiles",
      label: "Find in Files",
      category: "Project",
      when: (context) => context.connected,
      execute: () => setSearchScope(""),
    },
    {
      id: "git.refresh",
      label: "Refresh Git Changes",
      category: "Git",
      when: (context) => context.connected && !context.gitBusy,
      execute: () => refreshGit(),
    },
    {
      id: "terminal.new",
      label: "New Terminal",
      category: "Terminal",
      when: (context) => context.connected,
      execute: () => {
        void createTerminal();
      },
    },
    {
      id: "terminal.toggle",
      label: "Toggle Terminal Panel",
      category: "Terminal",
      when: (context) => context.connected,
      execute: toggleTerminalPanel,
    },
    {
      id: "task.create",
      label: "Create Task",
      category: "Task",
      when: (context) => context.connected && !context.taskSwitching,
      execute: () => setShowCreateTaskDialog(true),
    },
    {
      id: "ai.open",
      label: "Open AI",
      category: "AI",
      when: (context) => context.connected,
      execute: () => {
        if (sideLayout === "classic") setClassicAiOpen(true);
        else
          setLeftPanels((current) => ({
            ...current,
            ai: true,
            harness: false,
            timers: false,
            triggers: false,
            proc: false,
          }));
        void refreshAi();
      },
    },
    {
      id: "language.tools",
      label: "Open Run Configurations",
      category: "Language",
      when: (context) => context.connected && runProjects.length > 0,
      execute: () => openRunConfigurations(),
    },
    ...languageCommands(
      languages.filter((language) => runProjects.some((project) => project.language === language.id)),
      openRunConfigurations,
    ),
    {
      id: "editor.save",
      label: "Save Active Editor",
      category: "Editor",
      when: (context) => context.hasActiveEditor && context.activeEditorDirty,
      execute: () => saveActive(),
    },
  ];

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const command = commands.find((candidate) => shortcutMatches(event, shortcutBindings[candidate.id]));
      if (!command) return;
      if (!commandEnabled(command, commandContext)) {
        if (command.id === "editor.save") event.preventDefault();
        return;
      }
      if ((event.target as Element | null)?.closest?.(".terminal-panel") && command.id !== "editor.save") return;
      const overlayOpen = Boolean(
        document.querySelector('[role="dialog"], [role="alertdialog"], .context-menu-layer, .floating-window-layer'),
      );
      if (
        overlayOpen &&
        (command.id === "project.commandPalette" ||
          (command.id === "project.quickOpen" && !quickOpen) ||
          (command.id === "project.workspaceSymbols" && !workspaceSymbolsOpen))
      )
        return;
      event.preventDefault();
      void command.execute();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [commands, commandContext, quickOpen, shortcutBindings, workspaceSymbolsOpen]);

  const taskHarnessRuns = workflowRunsForContext(
    harnessRuns,
    workspaceRoots.find((root) => root.id === selectedRootId)?.path,
    activeWorkspace,
    selectedTaskId,
  );
  const openWorkflowTab = (workflow: HarnessDefinition) => {
    updateGroup((tabs) => openWorkflowEditor(tabs, workflow, selectedRootId, selectedTaskId));
  };
  const workflowDesignPanel = (
    <HarnessPanel
      onOpenWorkflow={openWorkflowTab}
      skillCatalog={skillCatalog}
      onRefreshSkills={refreshSkills}
      designOnly
      harnesses={harnesses}
      runs={taskHarnessRuns}
      diagnostics={harnessDiagnostics}
      providers={aiProviders}
      agents={agents}
      defaultProvider={aiProvider}
      onLoadModels={loadHarnessModels}
      onValidate={validateHarnessDefinition}
      onCreate={createHarness}
      onRead={readHarness}
      onSave={saveHarness}
      onDelete={deleteHarness}
      onRun={runHarness}
      onTestBlock={testHarnessBlock}
      onKillApp={killHarnessApp}
      onReadApp={readHarnessApp}
      onReadRun={readHarnessRun}
      onChat={chatHarness}
      onSteerChat={steerHarnessChat}
      onAutopilot={setHarnessAutopilot}
      onOpenAppTerminal={openHarnessAppTerminal}
      onAppendRun={appendHarnessRun}
      onResolvePermission={resolveHarnessPermission}
      onAnswerQuestion={answerHarnessQuestion}
      onResumePause={resumeHarnessPause}
      onRetryPause={retryHarnessPause}
      onCancelPause={cancelHarnessPause}
      onCancelRun={cancelHarnessRun}
      onDeleteRun={deleteHarnessRun}
      onError={setStatusMessage}
    />
  );
  const showWorkflowDesign = sideLayout === "classic" ? classicSideView === "harness" : workflowPanelMode === "design";
  const renderWorkflowPanel = (tab?: EditorTab) => (
    <WorkflowRunPanel
      onOpenWorkflow={tab ? undefined : openWorkflowTab}
      editorView={!!tab}
      providers={aiProviders}
      defaultProvider={aiProvider}
      onLoadModels={loadHarnessModels}
      key={tab?.id ?? `${selectedRootId}:${selectedTaskId ?? "root"}`}
      harnesses={tab ? harnesses.filter((workflow) => workflow.id === tab.workflowId) : harnesses}
      runs={
        tab
          ? workflowRunsForContext(
              harnessRuns,
              workspaceRoots.find((root) => root.id === selectedRootId)?.path,
              activeWorkspace,
              tab.workflowTaskId,
            )
          : taskHarnessRuns
      }
      diagnostics={harnessDiagnostics}
      onValidate={validateHarnessDefinition}
      onRun={runHarness}
      onKillApp={killHarnessApp}
      onReadApp={readHarnessApp}
      onReadRun={readHarnessRun}
      onChat={chatHarness}
      onSteerChat={steerHarnessChat}
      onAutopilot={setHarnessAutopilot}
      onOpenAppTerminal={openHarnessAppTerminal}
      onCancelRun={cancelHarnessRun}
      onResolvePermission={resolveHarnessPermission}
      onAnswerQuestion={answerHarnessQuestion}
      onResumePause={resumeHarnessPause}
      onRetryPause={retryHarnessPause}
      onCancelPause={cancelHarnessPause}
      onError={setStatusMessage}
    />
  );
  const workflowRunPanel = renderWorkflowPanel();
  const workflowPanels =
    harnessesLoading || harnessRunsLoading ? (
      <p role="status">Loading workflows…</p>
    ) : (
      <div className="workflow-mode-panels">
        <div hidden={!showWorkflowDesign}>{workflowDesignPanel}</div>
        <div hidden={showWorkflowDesign}>{workflowRunPanel}</div>
      </div>
    );
  const processesPanel = (
    <ProcessesPanel
      key={selectedRootId}
      processes={managedProcessList}
      loading={processLoading}
      error={processError}
      disabled={status !== "connected" || taskSwitching}
      onRefresh={() => refreshProcesses()}
      onKill={async (processId) => {
        const client = clientRef.current;
        if (!client) throw new Error("Backend is disconnected. Reconnect and try again.");
        await client.request("processes.kill", { processId });
        await refreshProcesses();
      }}
    />
  );
  const triggersPanel = (
    <TriggersPanel
      key={selectedRootId}
      triggers={triggers}
      workflows={harnesses}
      roots={workspaceRoots}
      selectedTaskId={selectedTaskId}
      defaultProvider={aiProvider}
      providers={aiProviders}
      tasks={tasks}
      disabled={taskSwitching}
      onLoadAgents={loadScheduleAgents}
      onLoadModels={loadActionModels}
      onRefresh={refreshAiStatuses}
      onError={setStatusMessage}
      onCreate={async (input) => {
        const client = clientRef.current;
        if (!client) throw new Error("Backend is disconnected");
        await client.request("triggers.create", input);
        await refreshAiStatuses(client);
      }}
      onAction={async (triggerId, action) => {
        const client = clientRef.current;
        if (!client) throw new Error("Backend is disconnected");
        if (action === "fire") await client.request("triggers.fire", { triggerId });
        else if (action === "delete") await client.request("triggers.delete", { triggerId });
        else await client.request("triggers.enabled", { triggerId, enabled: action === "resume" });
        await refreshAiStatuses(client);
      }}
    />
  );
  const timersPanel = (
    <TimersPanel
      key={selectedRootId}
      timers={activeTimers}
      schedules={schedules}
      workflows={harnesses}
      roots={workspaceRoots}
      selectedTaskId={selectedTaskId}
      defaultProvider={aiProvider}
      onLoadAgents={loadScheduleAgents}
      onLoadModels={loadActionModels}
      onCreateSchedule={async (input) => {
        const client = clientRef.current;
        if (!client) throw new Error("Backend is disconnected");
        await client.request("schedules.create", input);
        await refreshAiStatuses(client);
      }}
      onScheduleAction={async (scheduleId, action) => {
        const client = clientRef.current;
        if (!client) throw new Error("Backend is disconnected");
        if (action === "fire") await client.request("schedules.fire", { scheduleId });
        else if (action === "delete") await client.request("schedules.delete", { scheduleId });
        else await client.request("schedules.enabled", { scheduleId, enabled: action === "resume" });
        await refreshAiStatuses(client);
      }}
      providers={aiProviders}
      tasks={tasks}
      runs={harnessRuns}
      disabled={taskSwitching}
      onRefresh={refreshAiStatuses}
      onError={setStatusMessage}
      onAction={async (timerId, action) => {
        const client = clientRef.current;
        if (!client) return;
        if (action === "cancel") await client.request("timers.cancel", { timerId });
        else await client.request("timers.fire", { timerId });
        await refreshAiStatuses(client);
      }}
      onCancelAll={async () => {
        const client = clientRef.current;
        if (!client) return;
        await client.request("timers.cancelAll", {});
        await refreshAiStatuses(client);
      }}
    />
  );

  const projectProcessStates: Record<string, RunProjectProcess> = {
    ...runProjectProcesses,
    java: { ...(runProjectProcesses.java ?? { log: "" }), running: javaRunning || !!runProjectProcesses.java?.running },
  };
  for (const project of runProjects)
    if (project.terminalRunning)
      projectProcessStates[project.language] = {
        ...(projectProcessStates[project.language] ?? { log: "" }),
        running: true,
      };
  const runProjectActions = {
    projects: runProjects,
    selectedLanguage,
    processes: projectProcessStates,
    busy: runProjectBusy || taskSwitching || status !== "connected",
    onSelect: (language: string, id: string) => {
      void selectProjectRunConfiguration(language, id);
    },
    onConfigure: (language: string) => {
      setSelectedLanguage(language);
      setRunConfigurationEditor(language);
    },
    onRun: (language: string, debug?: boolean) => {
      void launchProjectConfiguration(language, debug);
    },
    onStop: (language: string) => {
      void stopProjectConfiguration(language);
    },
  };
  const rightBottomTools = (
    <>
      <div className="tool-stripe-spacer" aria-hidden="true" />
      <div className="right-bottom-tools">
        <button
          className={`tool-stripe-button right ${rightPanels.useful ? "active" : ""}`}
          title={rightPanels.useful ? "Hide Useful Files" : "Show Useful Files"}
          onClick={() =>
            setRightPanels((current) => {
              if (!current.useful) void refreshUsefulFiles();
              return { ...current, useful: !current.useful };
            })
          }
        >
          <Bookmark size={15} />
          <span>Useful</span>
        </button>
        <button
          className={`tool-stripe-button right ${rightPanels.agents ? "active" : ""}`}
          title={rightPanels.agents ? "Hide Agents" : "Show Agents"}
          onClick={() =>
            setRightPanels((current) => {
              if (!current.agents) void refreshAgents();
              return { ...current, agents: !current.agents };
            })
          }
        >
          <Bot size={15} />
          <span>Agents</span>
        </button>
        <button
          className={`tool-stripe-button right ${rightPanels.skills ? "active" : ""}`}
          title={rightPanels.skills ? "Hide Skills" : "Show Skills"}
          onClick={() =>
            setRightPanels((current) => {
              if (!current.skills) void refreshSkills();
              return { ...current, skills: !current.skills };
            })
          }
        >
          <GraduationCap size={15} />
          <span>Skills</span>
        </button>
        <SidebarExtentButton edge="right" extended={rightSidebarExtended} onChange={setRightSidebarExtended} />
      </div>
    </>
  );
  const ProjectConfigurationEditor = runConfigurationEditor
    ? (projectConfigurationEditors[runConfigurationEditor] ?? GenericProjectConfigurationDialog)
    : undefined;
  // Keep live buffers mounted during automatic recovery; commands still see disconnected.
  if (status !== "connected" && status !== "disconnected")
    return <ConnectionScreen {...{ host, port, status, statusMessage, setHost, setPort, connect }} />;

  return (
    <AuthenticationClientContext.Provider value={clientRef.current ?? null}>
      <div className={`ide-shell${focusMode ? " focus-mode" : ""}`}>
        <ModalFocusManager />
        {statusMessage && (
          <div
            className={`status-toast ${statusKind}`}
            role={statusKind === "error" ? "alert" : "status"}
            aria-live={statusKind === "error" ? "assertive" : "polite"}
          >
            {statusKind === "progress" ? (
              <LoaderCircle className="status-toast-spinner" size={16} />
            ) : statusKind === "success" ? (
              <Check size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            <span>{statusMessage}</span>
            {status === "disconnected" && statusKind === "error" && (
              <button
                onClick={() => {
                  showStatus("Restoring backend connection…", "progress");
                  recoveryRef.current?.start();
                }}
              >
                Reconnect
              </button>
            )}
            {projectTransfer && (
              <button title="Cancel file transfer" onClick={() => void cancelProjectTransfer()}>
                <X size={14} />
              </button>
            )}
            {lastDeleted && statusKind === "success" && <button onClick={() => void restoreLastDeleted()}>Undo</button>}
            {statusKind !== "progress" && (
              <button title="Dismiss" aria-label="Dismiss status message" onClick={() => setStatusMessageState("")}>
                <X size={14} />
              </button>
            )}
          </div>
        )}
        <header className="titlebar-actions" aria-label="Workspace toolbar">
          <div className="workspace-identity" title={activeWorkspace}>
            <span className="branding-mark titlebar-branding" aria-hidden="true" />
            <span>{projectName}</span>
          </div>
          <BranchPicker
            current={gitBranch}
            menu={branchMenu}
            onToggle={() => void toggleBranchMenu()}
            onClose={() => setBranchMenu(undefined)}
            onRefresh={() => void loadBranchMenu()}
            onCreate={() => void createBranch()}
            onCheckout={checkoutBranch}
            onRename={renameBranch}
            onDelete={deleteBranch}
            onPublish={publishBranch}
            onSetUpstream={setBranchUpstream}
          />
          <div className="titlebar-spacer" />
          <RunConfigurationToolbar {...runProjectActions} />
          {storageOpen && clientRef.current && (
            <StoragePanel client={clientRef.current} onClose={() => setStorageOpen(false)} />
          )}
          {aiProvidersOpen && clientRef.current && (
            <AiProvidersPanel
              client={clientRef.current}
              onClose={() => setAiProvidersOpen(false)}
              onChanged={() => void refreshAiProviders()}
            />
          )}
          {pluginsOpen && clientRef.current && (
            <PluginsPanel client={clientRef.current} onClose={() => setPluginsOpen(false)} />
          )}
          {toolsOpen && clientRef.current && (
            <ToolsPanel client={clientRef.current} onClose={() => setToolsOpen(false)} />
          )}
          <div className="workspace-utilities">
            <FocusModeButton active={focusMode} onChange={changeFocusMode} />
            <span className="workspace-utility-divider" aria-hidden="true" />
            <ConnectionMenu
              host={host}
              port={port}
              cloudOrigin={cloudConnection ? launchConfig.cloudOrigin : undefined}
              connected={status === "connected"}
              onDisconnect={disconnect}
            />
            <div className="settings-anchor">
              <button
                className="workspace-settings-button"
                aria-label="Settings"
                title="Settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings size={16} />
                <span>Settings</span>
              </button>
              {settingsOpen && (
                <SettingsMenu
                  onClose={() => setSettingsOpen(false)}
                  onStorage={() => {
                    setSettingsOpen(false);
                    setStorageOpen(true);
                  }}
                  onAiProviders={() => {
                    setSettingsOpen(false);
                    setAiProvidersOpen(true);
                  }}
                  onPlugins={() => {
                    setSettingsOpen(false);
                    setPluginsOpen(true);
                  }}
                  onTools={() => {
                    setSettingsOpen(false);
                    setToolsOpen(true);
                  }}
                  workspace={activeWorkspace}
                  sideLayout={sideLayout}
                  onSideLayoutChange={changeSideLayout}
                  commands={commands}
                  shortcutBindings={shortcutBindings}
                  platform={platform}
                  onShortcutChange={changeShortcut}
                  onShortcutsReset={resetShortcuts}
                  values={{ theme, highlightTheme, uiFontFamily, uiFontWeight, uiFontSize, uiLineHeight }}
                  isWorkspaceOverride={(setting) => hasWorkspaceSetting(activeWorkspace, setting)}
                  onChange={(setting, value) => {
                    workspaceDefaultsRef.current.delete(setting);
                    if (setting === "theme") setTheme(value as DesktopSettings["theme"]);
                    else if (setting === "highlightTheme")
                      setHighlightTheme(value as DesktopSettings["highlightTheme"]);
                    else if (setting === "uiFontFamily") setUiFontFamily(value as DesktopSettings["uiFontFamily"]);
                    else if (setting === "uiFontWeight") setUiFontWeight(value as number);
                    else if (setting === "uiFontSize") setUiFontSize(value as number);
                    else setUiLineHeight(value as number);
                  }}
                  onReset={(setting) => {
                    resetWorkspaceSetting(activeWorkspace, setting);
                    workspaceDefaultsRef.current.add(setting);
                    const value = readSetting(setting);
                    if (setting === "theme") setTheme(value === "dark" ? "dark" : "light");
                    else if (setting === "highlightTheme")
                      setHighlightTheme(value === "ftpud" || value === "ftpud-dark" ? "ftpud" : "default");
                    else if (setting === "uiFontFamily") setUiFontFamily(value === "jetbrains" ? "jetbrains" : "inter");
                    else if (setting === "uiFontWeight") setUiFontWeight(readSettingNumber(setting, 450, 350, 600));
                    else if (setting === "uiFontSize") setUiFontSize(readSettingNumber(setting, 13, 10, 20));
                    else setUiLineHeight(readSettingNumber(setting, 1.2, 1, 2));
                    setSettingsRevision((revision) => revision + 1);
                  }}
                />
              )}
            </div>
          </div>
        </header>
        <div
          className={`workspace-row${leftSidebarExtended ? " extend-left" : ""}${rightSidebarExtended ? " extend-right" : ""}`}
        >
          <div className="workspace-sidebar workspace-sidebar-left">
            {sideLayout === "ai-focused" ? (
              <>
                <FocusDock edge="left" active={focusMode}>
                  <nav className="tool-stripe" aria-label="Left tool windows">
                    <button
                      className={`tool-stripe-button ${leftPanels.tasks ? "active" : ""}`}
                      title={leftPanels.tasks ? "Hide Tasks" : "Show Tasks"}
                      onClick={() => setLeftPanels((current) => ({ ...current, tasks: !current.tasks }))}
                    >
                      <ListTodo size={15} />
                      <span>Tasks</span>
                      {tasks.length > 0 && (
                        <span className="tool-badge">{tasks.length > 99 ? "99+" : tasks.length}</span>
                      )}
                    </button>
                    <button
                      className={`tool-stripe-button ${leftPanels.ai ? "active" : ""}`}
                      title={leftPanels.ai ? "Hide AI" : "Show AI"}
                      onClick={() =>
                        setLeftPanels((current) => {
                          if (!current.ai) void refreshAi();
                          return {
                            ...current,
                            ai: !current.ai,
                            harness: false,
                            timers: false,
                            triggers: false,
                            proc: false,
                          };
                        })
                      }
                    >
                      <Sparkles size={15} />
                      <span>AI</span>
                      {aiSession.status === "in_progress" && <span className="tool-badge">...</span>}
                    </button>
                    <button
                      className={`tool-stripe-button ${leftPanels.harness && workflowPanelMode === "run" ? "active" : ""}`}
                      title="Workflows · View / Run"
                      onClick={() => {
                        setWorkflowPanelMode("run");
                        setLeftPanels((current) => ({
                          ...current,
                          harness: true,
                          ai: false,
                          timers: false,
                          triggers: false,
                          proc: false,
                        }));
                        void Promise.all([refreshHarnesses(), refreshHarnessRuns()]);
                      }}
                    >
                      <Play size={15} />
                      <span>Workflows</span>
                    </button>
                    <div className="tool-stripe-bottom">
                      <button
                        className={`tool-stripe-button ${leftPanels.harness && workflowPanelMode === "design" ? "active" : ""}`}
                        title="Workflow design"
                        onClick={() => {
                          setWorkflowPanelMode("design");
                          setLeftPanels((current) => ({
                            ...current,
                            harness: true,
                            ai: false,
                            timers: false,
                            triggers: false,
                            proc: false,
                          }));
                          void refreshHarnesses();
                        }}
                      >
                        <Workflow size={15} />
                        <span>Workflow design</span>
                      </button>
                      <button
                        className={`tool-stripe-button ${leftPanels.timers ? "active" : ""}`}
                        title={leftPanels.timers ? "Hide Timers" : "Show Timers"}
                        onClick={() =>
                          setLeftPanels((current) => ({
                            ...current,
                            timers: !current.timers,
                            triggers: false,
                            proc: false,
                            ai: false,
                            harness: false,
                          }))
                        }
                      >
                        <Clock size={15} />
                        <span>Timers</span>
                        {activeTimers.length + schedules.filter((item) => item.enabled).length > 0 && (
                          <span className="tool-badge">
                            {activeTimers.length + schedules.filter((item) => item.enabled).length}
                          </span>
                        )}
                      </button>
                      <button
                        className={`tool-stripe-button ${leftPanels.triggers ? "active" : ""}`}
                        title={leftPanels.triggers ? "Hide Triggers" : "Show Triggers"}
                        onClick={() =>
                          setLeftPanels((current) => ({
                            ...current,
                            triggers: !current.triggers,
                            timers: false,
                            proc: false,
                            ai: false,
                            harness: false,
                          }))
                        }
                      >
                        <Zap size={15} />
                        <span>Triggers</span>
                        {triggers.some((item) => item.enabled) && (
                          <span className="tool-badge">{triggers.filter((item) => item.enabled).length}</span>
                        )}
                      </button>
                      <button
                        className={`tool-stripe-button ${leftPanels.proc ? "active" : ""}`}
                        title={leftPanels.proc ? "Hide Processes" : "Show Processes"}
                        onClick={() => {
                          setLeftPanels((current) => ({
                            ...current,
                            proc: !current.proc,
                            ai: false,
                            harness: false,
                            timers: false,
                            triggers: false,
                          }));
                          void refreshProcesses();
                        }}
                      >
                        <SquareTerminal size={15} />
                        <span>Proc</span>
                        {managedProcessList.length > 0 && (
                          <span className="tool-badge">{managedProcessList.length}</span>
                        )}
                      </button>
                      <SidebarExtentButton
                        edge="left"
                        extended={leftSidebarExtended}
                        onChange={setLeftSidebarExtended}
                      />
                    </div>
                  </nav>
                </FocusDock>
                {(leftPanels.tasks ||
                  leftPanels.ai ||
                  leftPanels.harness ||
                  leftPanels.timers ||
                  leftPanels.triggers ||
                  leftPanels.proc) && (
                  <>
                    <aside className="side-panel side-panel-left" style={{ width: leftSidebarWidth }}>
                      <ResizablePanelStack
                        workspace={activeWorkspace}
                        setting="focused.leftSizes"
                        ids={[
                          ...(leftPanels.tasks ? ["tasks"] : []),
                          ...(leftPanels.ai ||
                          leftPanels.harness ||
                          leftPanels.timers ||
                          leftPanels.triggers ||
                          leftPanels.proc
                            ? ["ai"]
                            : []),
                        ]}
                      >
                        {leftPanels.tasks && (
                          <section key="tasks" className="stacked-panel">
                            <header className="panel-header">
                              <span>Tasks</span>
                              <button
                                title="Create task"
                                disabled={taskSwitching}
                                onClick={() => setShowCreateTaskDialog(true)}
                              >
                                <Plus size={15} />
                              </button>
                            </header>
                            <div className="task-filters">
                              <QuickFilter
                                value={taskFilter}
                                placeholder="Filter tasks"
                                label="Filter tasks"
                                onChange={setTaskFilter}
                              />
                              <select
                                aria-label="Task lifecycle filter"
                                value={taskLifecycleFilter}
                                onChange={(event) =>
                                  setTaskLifecycleFilter(event.target.value as typeof taskLifecycleFilter)
                                }
                              >
                                <option value="active">Active</option>
                                <option value="finished">Finished</option>
                                <option value="archived">Archived</option>
                                <option value="all">All</option>
                              </select>
                            </div>
                            <div className="tasks-list">
                              {showRootTask && (
                                <TaskRow
                                  icon={<Folder size={15} />}
                                  name="Root workspace"
                                  summary={aiStatuses.root}
                                  selected={selectedTaskId === undefined}
                                  disabled={taskSwitching}
                                  onClick={() => openTask(undefined, aiStatuses.root.pendingPermission)}
                                  onCancelTimer={() => void timerAction(undefined, "cancel")}
                                  onFireTimer={() => void timerAction(undefined, "fire")}
                                />
                              )}
                              {filteredTasks.map((task) => {
                                const summary = aiStatuses.tasks[task.id] ?? emptyAiSummary;
                                return (
                                  <TaskRow
                                    key={task.id}
                                    icon={<ListTodo size={15} />}
                                    name={task.name}
                                    branch={task.branch}
                                    summary={summary}
                                    finished={task.status === "finished"}
                                    archived={task.archived}
                                    selected={selectedTaskId === task.id}
                                    disabled={taskSwitching}
                                    onClick={() => openTask(task.id, summary.pendingPermission)}
                                    onSetFinished={() =>
                                      void setTaskStatus(task, task.status === "finished" ? "active" : "finished")
                                    }
                                    onRename={() => void renameTask(task)}
                                    onSetArchived={() => void setTaskArchived(task, !task.archived)}
                                    onMerge={() => setMergeDialog(task)}
                                    onDelete={() => void deleteTask(task)}
                                    onCancelTimer={() => void timerAction(task, "cancel")}
                                    onFireTimer={() => void timerAction(task, "fire")}
                                  />
                                );
                              })}
                              {!showRootTask && filteredTasks.length === 0 && (
                                <div className="filter-empty">No matching tasks</div>
                              )}
                            </div>
                          </section>
                        )}
                        {leftPanels.ai && (
                          <section key="ai" className="stacked-panel">
                            <header className="panel-header">
                              <span>AI</span>
                              <AgentPicker
                                agents={agents}
                                value={selectedAgentKey}
                                disabled={aiSession.status === "in_progress"}
                                onChange={selectAgent}
                              />
                              <span className={`ai-status ${aiSession.status}`}>
                                {formatAiStatus(aiSession.status)}
                              </span>
                            </header>
                            <AiPanel
                              key={`${activeWorkspace}:${selectedTaskId ?? "root"}:${aiProvider}:${aiSession.id ?? "legacy"}`}
                              provider={aiProvider}
                              providers={aiProviders}
                              session={chatSession}
                              sessions={aiSessions}
                              models={aiModels}
                              modelsLoading={aiModelsLoading}
                              usage={aiUsage}
                              attachments={currentAiAttachments}
                              draft={currentAiDraft}
                              workspacePath={activeWorkspace}
                              permissionOwner={{
                                provider: aiProvider,
                                ...(selectedTaskId ? { taskId: selectedTaskId } : {}),
                                ...(aiSession.id ? { sessionId: aiSession.id } : {}),
                              }}
                              skills={availableChatSkills}
                              onSkillsChange={selectSkills}
                              onOpenSkills={() => {
                                setRightPanels((current) => ({ ...current, skills: true }));
                                void refreshSkills();
                              }}
                              permissionActionsDisabled={taskSwitching}
                              sessionChangesDisabled={selectedTaskTimerActive}
                              onProviderChange={(provider) => void switchAiProvider(provider)}
                              onConfigurationChange={configureAi}
                              onAttachmentsChange={updateAiAttachments}
                              onDraftChange={updateAiDraft}
                              onSend={sendAiPrompt}
                              onSendAsTask={selectedTaskId ? undefined : sendAiPromptAsTask}
                              onSteer={steerAiPrompt}
                              onInterrupt={() => void interruptAi()}
                              onNewSession={() => void newAiSession()}
                              onSwitchSession={(session) => void switchAiSession(session)}
                              onRemoveSession={(session) => void removeAiSession(session)}
                              onResolvePermission={resolveAiPermission}
                              onAnswerQuestion={answerAiQuestion}
                              onOpenFile={(path, line, column) => void openAiFile(path, line, column)}
                              onOpenExternal={(url) => void window.desktop?.openExternal(url)}
                            />
                          </section>
                        )}
                        {leftPanels.harness && (
                          <section key="harness" className="stacked-panel">
                            <header className="panel-header">
                              <span>{workflowPanelMode === "design" ? "Workflow design" : "Workflows"}</span>
                              <button
                                title="Refresh workflows"
                                onClick={() => void Promise.all([refreshHarnesses(), refreshHarnessRuns()])}
                              >
                                <RefreshCw size={14} />
                              </button>
                            </header>
                            {workflowPanels}
                          </section>
                        )}
                        {leftPanels.proc && (
                          <section key="proc" className="stacked-panel">
                            {processesPanel}
                          </section>
                        )}
                        {leftPanels.timers && (
                          <section key="timers" className="stacked-panel">
                            {timersPanel}
                          </section>
                        )}
                        {leftPanels.triggers && (
                          <section key="triggers" className="stacked-panel">
                            {triggersPanel}
                          </section>
                        )}
                      </ResizablePanelStack>
                    </aside>
                    <div
                      className="resize-handle"
                      role="separator"
                      aria-label="Resize left sidebar"
                      aria-orientation="vertical"
                      aria-valuemin={280}
                      aria-valuemax={Math.round(Math.min(900, window.innerWidth * 0.65))}
                      aria-valuenow={Math.round(leftSidebarWidth)}
                      tabIndex={0}
                      onKeyDown={(event) =>
                        keyboardResize(
                          event,
                          leftSidebarWidth,
                          setLeftSidebarWidth,
                          280,
                          Math.min(900, window.innerWidth * 0.65),
                        )
                      }
                      onPointerDown={beginLeftSidebarResize}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <FocusDock edge="left" active={focusMode}>
                  <nav className="tool-stripe" aria-label="Left tool windows">
                    <button
                      className={`tool-stripe-button ${classicSideView === "project" ? "active" : ""}`}
                      title="Project"
                      onClick={() => selectClassicSideView("project")}
                    >
                      <Folder size={15} />
                      <span>Project</span>
                    </button>
                    <button
                      className={`tool-stripe-button ${classicSideView === "git" ? "active" : ""}`}
                      title="Git changes"
                      onClick={() => {
                        selectClassicSideView("git");
                        void refreshGit();
                      }}
                    >
                      <GitBranch size={15} />
                      <span>Git</span>
                      {gitEntries.length > 0 && (
                        <span className="tool-badge">{gitEntries.length > 99 ? "99+" : gitEntries.length}</span>
                      )}
                    </button>
                    {selectedTaskId && (
                      <button
                        className={`tool-stripe-button ${classicSideView === "taskGit" ? "active" : ""}`}
                        title="Changes from task base branch"
                        onClick={() => {
                          selectClassicSideView("taskGit");
                          void refreshTaskGit();
                        }}
                      >
                        <GitCompareArrows size={15} />
                        <span>Task Git</span>
                        {taskGitEntries.length > 0 && (
                          <span className="tool-badge">
                            {taskGitEntries.length > 99 ? "99+" : taskGitEntries.length}
                          </span>
                        )}
                      </button>
                    )}
                    {selectedTaskId && (
                      <button
                        className={`tool-stripe-button ${rightPanels.promptHistory ? "active" : ""}`}
                        title={rightPanels.promptHistory ? "Hide Prompt History" : "Show Prompt History"}
                        onClick={() =>
                          setRightPanels((current) => {
                            if (!current.promptHistory) void refreshTaskGit();
                            return { ...current, promptHistory: !current.promptHistory };
                          })
                        }
                      >
                        <History size={15} />
                        <span>History</span>
                        {taskCheckpoints.length > 0 && (
                          <span className="tool-badge">
                            {taskCheckpoints.length > 99 ? "99+" : taskCheckpoints.length}
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      className={`tool-stripe-button ${classicSideView === "workflowRuns" ? "active" : ""}`}
                      title="Workflows · View / Run"
                      onClick={() => {
                        selectClassicSideView("workflowRuns");
                        void Promise.all([refreshHarnesses(), refreshHarnessRuns()]);
                      }}
                    >
                      <Play size={15} />
                      <span>Workflows</span>
                    </button>
                    {javaOptions && (
                      <button
                        className={`tool-stripe-button ${classicSideView === "java" ? "active" : ""}`}
                        title="Java project"
                        onClick={() => {
                          selectClassicSideView("java");
                          void refreshJavaTree();
                        }}
                      >
                        <Coffee size={15} />
                        <span>Java</span>
                      </button>
                    )}
                    <div className="tool-stripe-bottom">
                      <button
                        className={`tool-stripe-button ${classicSideView === "harness" ? "active" : ""}`}
                        title="Workflow design"
                        onClick={() => {
                          selectClassicSideView("harness");
                          void refreshHarnesses();
                        }}
                      >
                        <Workflow size={15} />
                        <span>Workflow design</span>
                      </button>
                      <button
                        className={`tool-stripe-button ${classicSideView === "timers" ? "active" : ""}`}
                        title="Timers"
                        onClick={() => selectClassicSideView("timers")}
                      >
                        <Clock size={15} />
                        <span>Timers</span>
                        {activeTimers.length + schedules.filter((item) => item.enabled).length > 0 && (
                          <span className="tool-badge">
                            {activeTimers.length + schedules.filter((item) => item.enabled).length}
                          </span>
                        )}
                      </button>
                      <button
                        className={`tool-stripe-button ${classicSideView === "triggers" ? "active" : ""}`}
                        title="Triggers"
                        onClick={() => selectClassicSideView("triggers")}
                      >
                        <Zap size={15} />
                        <span>Triggers</span>
                        {triggers.some((item) => item.enabled) && (
                          <span className="tool-badge">{triggers.filter((item) => item.enabled).length}</span>
                        )}
                      </button>
                      <button
                        className={`tool-stripe-button ${classicSideView === "proc" ? "active" : ""}`}
                        title="Processes"
                        onClick={() => {
                          selectClassicSideView("proc");
                          void refreshProcesses();
                        }}
                      >
                        <SquareTerminal size={15} />
                        <span>Proc</span>
                        {managedProcessList.length > 0 && (
                          <span className="tool-badge">{managedProcessList.length}</span>
                        )}
                      </button>
                      <SidebarExtentButton
                        edge="left"
                        extended={leftSidebarExtended}
                        onChange={setLeftSidebarExtended}
                      />
                    </div>
                  </nav>
                </FocusDock>
                <aside className="side-panel classic-left-panel" style={{ width: classicLeftWidth }}>
                  {classicSideView === "proc" ? (
                    processesPanel
                  ) : classicSideView === "timers" ? (
                    timersPanel
                  ) : classicSideView === "triggers" ? (
                    triggersPanel
                  ) : classicSideView === "project" ? (
                    <>
                      <header className="panel-header">
                        <span>Project</span>
                        <div className="panel-header-actions">
                          <button
                            title={showIgnored ? "Hide ignored files" : "Show all files (including Git-ignored)"}
                            className={showIgnored ? "active" : ""}
                            onClick={toggleShowIgnored}
                          >
                            {showIgnored ? <Eye size={14} /> : <EyeOff size={14} />}
                          </button>
                          <button title="Synchronize files" onClick={() => void refreshTree()}>
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </header>
                      <QuickFilter
                        value={projectFilter}
                        placeholder={projectContentFilter ? "Filter by file contents" : "Filter files"}
                        label={projectContentFilter ? "Filter files by contents" : "Filter project files"}
                        onChange={setProjectFilter}
                        contentSearch={projectContentFilter}
                        contentSearchLoading={projectContentFilterLoading}
                        onContentSearchChange={setProjectContentFilter}
                      />
                      <div className="workspace-name">
                        <select
                          aria-label="Workspace root"
                          value={selectedRootId}
                          disabled={taskSwitching}
                          onChange={(event) => void selectWorkspaceRoot(event.target.value)}
                        >
                          {workspaceRoots.map((root) => (
                            <option key={root.id} value={root.id}>
                              {root.alias}
                            </option>
                          ))}
                        </select>
                        <button title="Add remote workspace root" onClick={() => setWorkspaceRootDialogOpen(true)}>
                          <Plus size={13} />
                        </button>
                        <button
                          title="Unregister an inactive workspace root"
                          disabled={!workspaceRoots.some((root) => !root.primary && root.id !== selectedRootId)}
                          onClick={() => void removeWorkspaceRoot()}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <ProjectTree
                        nodes={tree}
                        javaNodes={javaOptions ? javaTree : undefined}
                        query={projectContentFilter ? "" : projectFilter}
                        matchingPaths={
                          projectContentFilter && projectFilter.trim() ? (projectContentPaths ?? new Set()) : undefined
                        }
                        activePath={activeTab?.path}
                        selectedPaths={projectSelection}
                        fileColors={fileColors}
                        gitStatuses={projectGitStatuses}
                        onAction={runProjectTreeAction}
                        onSelectionChange={setProjectSelection}
                        onContextMenu={(nodes, x, y) =>
                          setTreeContextMenu({
                            x: Math.min(x, window.innerWidth - 220),
                            y: Math.min(y, window.innerHeight - 180),
                            nodes,
                          })
                        }
                      />
                    </>
                  ) : classicSideView === "git" ? (
                    <>
                      <header className="panel-header">
                        <span title="Git changes">Git</span>
                        <div className="panel-header-actions">
                          <GitToolbarActions
                            onStash={() => setGitStashDialog(true)}
                            selectedCount={selectedRollbackEntries.length}
                            operationRunning={gitOperationRunning}
                            pushing={gitPushing}
                            fetching={gitFetching}
                            rollingBack={gitRollingBack}
                            upstream={gitUpstream}
                            onRollbackSelected={openRollbackSelected}
                            onUndoLastCommit={() => void previewHistoryRewrite("undo")}
                            onPush={() => void pushGit()}
                            onFetch={() => void fetchGit()}
                            onRefresh={() => void refreshGit()}
                          />
                        </div>
                      </header>
                      <div className="git-branch">
                        <GitBranch size={13} />
                        <span>{gitBranch}</span>
                        {gitUpstream && (
                          <small
                            title={
                              gitUpstream.lastFetch
                                ? `Last fetched ${new Date(gitUpstream.lastFetch).toLocaleString()}`
                                : "Not fetched in this Core session"
                            }
                          >
                            {gitUpstream.upstream} · {gitUpstream.ahead} ahead · {gitUpstream.behind} behind
                          </small>
                        )}
                      </div>
                      <KeyboardGitChangesView
                        entries={gitEntries}
                        error={gitError}
                        selectedPaths={selectedGitPaths}
                        onTogglePath={(path) =>
                          setSelectedGitPaths((current) => {
                            const next = new Set(current);
                            next.has(path) ? next.delete(path) : next.add(path);
                            return next;
                          })
                        }
                        activePath={activeTab?.path}
                        onOpenDiff={openDiff}
                        onOpenConflict={(entry) => setGitConflictPath(entry.path)}
                        onOpenFile={(entry) =>
                          void openFile({
                            name: entry.path.split("/").pop() ?? entry.path,
                            path: entry.path,
                            type: "file",
                          })
                        }
                        onContextMenu={(event, entry) => {
                          event.preventDefault();
                          setGitRollbackMenu({
                            ...menuPosition(
                              event.clientX,
                              event.clientY,
                              220,
                              290,
                              window.innerWidth,
                              window.innerHeight,
                            ),
                            entry,
                          });
                        }}
                      />
                      <GitCommitPanel
                        message={gitCommitMessage}
                        selectedCount={selectedGitPaths.size}
                        operationRunning={gitOperationRunning}
                        committing={gitCommitting}
                        onMessageChange={setGitCommitMessage}
                        onCommit={(message) => void commitSelectedFiles(message)}
                        onCommitAndPush={(message) => void commitAndPush(message)}
                        pushing={gitPushing}
                        stagedCount={gitEntries.filter((entry) => entry.states.includes("index")).length}
                        onAmend={() => void previewHistoryRewrite("amend")}
                      />
                    </>
                  ) : classicSideView === "taskGit" && selectedTaskId ? (
                    <>
                      <header className="panel-header">
                        <span>Task Git</span>
                        <button title="Refresh task comparison" onClick={() => void refreshTaskGit()}>
                          <RefreshCw size={14} />
                        </button>
                      </header>
                      <div className="git-branch">
                        <GitCompareArrows size={13} />
                        <span>{tasks.find((task) => task.id === selectedTaskId)?.baseBranch ?? "Base branch"}</span>
                      </div>
                      <GitChangesView
                        entries={taskGitEntries}
                        error={taskGitError}
                        emptyMessage="No changes from base branch"
                        groupTitle="Changes from Base"
                        activePath={activeTab?.path}
                        onOpenDiff={openTaskDiff}
                        onContextMenu={(event, entry) => {
                          event.preventDefault();
                          const task = activeTaskRef.current;
                          if (task)
                            setGitRollbackMenu({
                              ...menuPosition(
                                event.clientX,
                                event.clientY,
                                220,
                                150,
                                window.innerWidth,
                                window.innerHeight,
                              ),
                              entry,
                              taskRef: task.baseBranch,
                            });
                        }}
                        onOpenFile={(entry) =>
                          void openFile({
                            name: entry.path.split("/").pop() ?? entry.path,
                            path: entry.path,
                            type: "file",
                          })
                        }
                      />
                    </>
                  ) : classicSideView === "useful" ? (
                    <>
                      <header className="panel-header">
                        <span>Useful Files</span>
                        <button title="Refresh useful files" onClick={() => void refreshUsefulFiles()}>
                          <RefreshCw size={14} />
                        </button>
                      </header>
                      <div className="useful-files-list">
                        <UsefulFileSection
                          title="Global"
                          scope="global"
                          files={usefulFiles}
                          activeTab={activeTab}
                          onOpen={openUsefulFile}
                          onCreate={(scope) => setUsefulDialog({ mode: "create", scope })}
                          onRename={(file) => setUsefulDialog({ mode: "rename", scope: file.scope, file })}
                          onDelete={(file) => void deleteUsefulFile(file)}
                        />
                        <UsefulFileSection
                          title="Local"
                          scope="local"
                          files={usefulFiles}
                          activeTab={activeTab}
                          onOpen={openUsefulFile}
                          onCreate={(scope) => setUsefulDialog({ mode: "create", scope })}
                          onRename={(file) => setUsefulDialog({ mode: "rename", scope: file.scope, file })}
                          onDelete={(file) => void deleteUsefulFile(file)}
                        />
                      </div>
                    </>
                  ) : classicSideView === "agents" ? (
                    <AgentsPanel
                      agents={agents}
                      activeTab={activeTab}
                      onRefresh={() => void refreshAgents()}
                      onOpen={(file) => void openAgentFile(file)}
                      onCreate={(scope) => setAgentDialog({ mode: "create", scope })}
                      onRename={(file) => {
                        if (file.scope !== "workspace") setAgentDialog({ mode: "rename", scope: file.scope, file });
                      }}
                      onDelete={(file) => void deleteAgent(file)}
                    />
                  ) : classicSideView === "harness" || classicSideView === "workflowRuns" ? (
                    <>
                      <header className="panel-header">
                        <span>{showWorkflowDesign ? "Workflow design" : "Workflows"}</span>
                        <button
                          title="Refresh workflows"
                          onClick={() => void Promise.all([refreshHarnesses(), refreshHarnessRuns()])}
                        >
                          <RefreshCw size={14} />
                        </button>
                      </header>
                      {workflowPanels}
                    </>
                  ) : (
                    <>
                      <header className="panel-header">
                        <span>Java Project</span>
                        <button title="Refresh Java project" onClick={() => void refreshJavaTree()}>
                          <RefreshCw size={14} />
                        </button>
                      </header>
                      <div className="java-project-meta">
                        <Coffee size={13} />
                        <span>{javaOptions?.pomPath}</span>
                      </div>
                      <div className="tree java-tree">
                        {javaOptions && (
                          <JavaProjectTree nodes={javaTree} activePath={activeTab?.path} onOpen={openFile} />
                        )}
                      </div>
                    </>
                  )}
                </aside>
                <div
                  className="resize-handle"
                  role="separator"
                  aria-label="Resize left sidebar"
                  aria-orientation="vertical"
                  aria-valuemin={180}
                  aria-valuemax={500}
                  aria-valuenow={Math.round(classicLeftWidth)}
                  tabIndex={0}
                  onKeyDown={(event) => keyboardResize(event, classicLeftWidth, setClassicLeftWidth, 180, 500)}
                  onPointerDown={beginClassicLeftResize}
                />
              </>
            )}
          </div>
          <main className="workbench">
            <div className="tabs" role="tablist" aria-label="Open editors">
              {group.tabs.map((tab) => {
                const label = editorTabLabel(tab);
                return (
                  <div
                    className={`tab ${tab.pinned ? "pinned" : ""} ${tab.id === group.activeTabId ? "active" : ""} ${tab.id === draggedTabId ? "dragging" : ""}`}
                    role="tab"
                    aria-selected={tab.id === group.activeTabId}
                    aria-label={tab.pinned ? `${label} (pinned)` : label}
                    tabIndex={tab.id === group.activeTabId ? 0 : -1}
                    title={`${label}${tab.pinned ? " · Pinned" : ""} · Ctrl+Tab to switch · Ctrl/Cmd+W to close`}
                    key={tab.id}
                    draggable
                    onDragStart={(event) => {
                      setDraggedTabId(tab.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", tab.id);
                    }}
                    onDragEnd={() => setDraggedTabId(undefined)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveTab(tab.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTabContextMenu({
                        x: Math.min(event.clientX, window.innerWidth - 220),
                        y: Math.min(event.clientY, window.innerHeight - 125),
                        tab,
                      });
                    }}
                    onMouseDown={(event) => {
                      if (event.button === 1) event.preventDefault();
                    }}
                    onAuxClick={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        closeTab(tab);
                      }
                    }}
                    onClick={() => void activateEditorTab(tab)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void activateEditorTab(tab);
                      }
                    }}
                  >
                    {tab.type === "workflow" ? (
                      <Workflow size={14} />
                    ) : tab.type === "diff" ? (
                      <GitCompareArrows size={14} />
                    ) : (
                      <File size={14} />
                    )}
                    <span
                      className={
                        tab.type === "file" && tab.rootId === selectedRootId && projectGitStatuses[tab.path]
                          ? `tab-file-name git-${projectGitStatuses[tab.path] === "C" ? "created" : "modified"}`
                          : "tab-file-name"
                      }
                    >
                      {label}
                    </span>
                    {tab.dirty && <span className="dirty" title="Unsaved changes" />}
                    <button
                      type="button"
                      className="close"
                      aria-label={`Close ${label}`}
                      title={`Close ${label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
              <div className="tab-spacer" />
              {activeTab?.type === "diff" && (
                <div className="editor-mode-switch" aria-label="Diff layout">
                  <button
                    className={activeTab.diffMode === "split" ? "active" : ""}
                    title="Side-by-side diff"
                    onClick={() =>
                      updateGroup((tabs, active) => ({
                        tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, diffMode: "split" } : tab)),
                        activeTabId: active,
                      }))
                    }
                  >
                    <Columns2 size={14} />
                  </button>
                  <button
                    className={activeTab.diffMode !== "split" ? "active" : ""}
                    title="Unified diff"
                    onClick={() =>
                      updateGroup((tabs, active) => ({
                        tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, diffMode: "unified" } : tab)),
                        activeTabId: active,
                      }))
                    }
                  >
                    <ListTree size={14} />
                  </button>
                </div>
              )}
              {(activeTab?.type === "file" ||
                activeTab?.type === "useful" ||
                activeTab?.type === "agent" ||
                activeTab?.type === "skill" ||
                activeTab?.type === "workflowDocument") &&
                /\.md$/i.test(activeTab.path) && (
                  <div className="editor-mode-switch" aria-label="Markdown mode">
                    <button
                      className={activeTab.markdownMode !== "preview" ? "active" : ""}
                      title="Edit Markdown"
                      onClick={() =>
                        updateGroup((tabs, active) => ({
                          tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, markdownMode: "edit" } : tab)),
                          activeTabId: active,
                        }))
                      }
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className={activeTab.markdownMode === "preview" ? "active" : ""}
                      title="Preview Markdown"
                      onClick={() =>
                        updateGroup((tabs, active) => ({
                          tabs: tabs.map((tab) =>
                            tab.id === activeTab.id ? { ...tab, markdownMode: "preview" } : tab,
                          ),
                          activeTabId: active,
                        }))
                      }
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                )}
              <button
                className="save-button"
                title="Save active file"
                disabled={
                  (activeTab?.type !== "file" &&
                    activeTab?.type !== "useful" &&
                    activeTab?.type !== "runConfig" &&
                    activeTab?.type !== "agent" &&
                    activeTab?.type !== "skill") ||
                  !activeTab.dirty
                }
                onClick={() => void saveActive()}
              >
                <Save size={15} />
              </button>
            </div>
            <div
              className="editor-area"
              key={`editor-area:${theme}:${highlightTheme}`}
              onContextMenu={(event) => {
                if (activeTab?.type !== "file" || activeTab.markdownMode === "preview") return;
                event.preventDefault();
                const selection = monacoEditorRef.current?.getSelection();
                const hasSelection = Boolean(selection && !selection.isEmpty());
                setEditorGitMenu({
                  x: Math.min(event.clientX, window.innerWidth - 245),
                  y: Math.min(event.clientY, window.innerHeight - 85),
                  path: activeTab.path,
                  ...(hasSelection
                    ? { ...selectedLineRange(selection!), content: monacoEditorRef.current?.getModel()?.getValue() }
                    : {}),
                });
              }}
            >
              {group.tabs
                .filter((tab) => tab.type === "workflow" && tab.rootId === selectedRootId)
                .map((tab) => (
                  <div className="workflow-editor-tab" key={tab.id} hidden={tab.id !== group.activeTabId}>
                    {taskSwitching ? (
                      <p role="status">Switching workspace…</p>
                    ) : tab.workflowTaskId !== selectedTaskId ? (
                      <div className="harness-empty">
                        <Workflow size={30} />
                        <strong>This workflow belongs to another task</strong>
                        <button onClick={() => void activateEditorTab(tab)}>Switch to workflow task</button>
                      </div>
                    ) : harnessesLoading ? (
                      <p role="status">Loading workflow…</p>
                    ) : !harnesses.some((workflow) => workflow.id === tab.workflowId) ? (
                      <div className="harness-empty">
                        <Workflow size={30} />
                        <strong>Workflow unavailable</strong>
                        <span>This workflow may have been deleted.</span>
                      </div>
                    ) : (
                      renderWorkflowPanel(tab)
                    )}
                  </div>
                ))}
              {!activeTab ? (
                <div className="empty-editor">
                  <div className="workspace-welcome">
                    <span className="branding-mark welcome-branding" aria-hidden="true" />
                    <h1>
                      Your workspace,
                      <br />
                      <span>ready.</span>
                    </h1>
                    <p>Explore your project, build with an agent, or run a workflow.</p>
                    <button onClick={() => setQuickOpen(true)}>
                      <Folder size={18} />
                      <span>Open a file</span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ) : activeTab.loading ? (
                <div className="empty-editor">Loading {activeTab.title}...</div>
              ) : activeTab.error && !activeTab.content ? (
                <div className="editor-error">{activeTab.error}</div>
              ) : (
                <>
                  {activeTab.error && <div className="inline-error">{activeTab.error}</div>}
                  {activeTab.type === "workflow" ? null : activeTab.type === "diff" ? (
                    <>
                      <DiffEditor
                        key={`${activeTab.id}:${activeTab.diffMode ?? "unified"}`}
                        original={activeTab.originalContent ?? ""}
                        modified={activeTab.content}
                        language={
                          languageByExtension[activeTab.path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext"
                        }
                        beforeMount={configureMonacoThemes}
                        theme={monacoTheme(theme, highlightTheme)}
                        onMount={mountWorkingDiff}
                        options={{
                          automaticLayout: true,
                          readOnly: false,
                          originalEditable: false,
                          renderMarginRevertIcon: true,
                          renderSideBySide: activeTab.diffMode === "split",
                          useInlineViewWhenSpaceIsLimited: false,
                          minimap: { enabled: false },
                          fontFamily: editorFontFamily,
                          fontWeight: "normal",
                          fontSize: uiFontSize,
                          lineHeight: editorLineHeight,
                          scrollBeyondLastLine: false,
                        }}
                      />
                      <DiffNavigation editorRef={monacoDiffEditorRef} />
                    </>
                  ) : activeTab.markdownMode === "preview" ? (
                    <div className="markdown-preview">
                      <MarkdownPreview
                        sourcePath={activeTab.type === "skill" ? (activeTab.skillPath ?? "SKILL.md") : activeTab.path}
                        workspacePath={activeTab.type === "skill" ? undefined : activeWorkspace}
                        renderPre={renderMarkdownPre}
                        onOpenFile={(path) =>
                          activeTab.type === "skill"
                            ? void openSkillFile(activeTab.skillId!, "preview", path)
                            : void openFile({ name: path.split("/").pop() ?? path, path, type: "file" })
                        }
                        onOpenExternal={(url) => {
                          void window.desktop
                            ?.openExternal(url)
                            .catch((error: unknown) =>
                              setStatusMessage(error instanceof Error ? error.message : "Could not open external link"),
                            );
                        }}
                        onChange={
                          activeTab.type === "workflowDocument" ||
                          (activeTab.type === "skill" && !!activeTab.skillPath && activeTab.skillPath !== "SKILL.md")
                            ? undefined
                            : (content) =>
                                updateGroup((tabs, active) => ({
                                  tabs: tabs.map((tab) =>
                                    tab.id === activeTab.id
                                      ? { ...tab, content, dirty: content !== tab.savedContent, error: undefined }
                                      : tab,
                                  ),
                                  activeTabId: active,
                                }))
                        }
                      >
                        {activeTab.content}
                      </MarkdownPreview>
                    </div>
                  ) : (
                    <StableEditor
                      key={`${activeTab.type}:${activeTab.usefulScope ?? activeTab.runConfigScope ?? activeTab.agentScope ?? activeTab.skillId ?? "workspace"}:${activeTab.path}`}
                      path={
                        activeTab.type === "workflowDocument"
                          ? `${activeTab.id}.md`
                          : activeTab.type === "useful"
                            ? `useful-${activeTab.usefulScope}/${activeTab.path}`
                            : activeTab.type === "runConfig"
                              ? `run-config-${activeTab.runConfigScope}/${activeTab.path}.sh`
                              : activeTab.type === "agent"
                                ? `agent-${activeTab.agentScope}/${activeTab.path}`
                                : activeTab.type === "skill"
                                  ? `skill-${activeTab.skillId}/${activeTab.skillPath ?? "SKILL.md"}`
                                  : activeTab.path
                      }
                      language={
                        activeTab.type === "runConfig"
                          ? "shell"
                          : (languageByExtension[activeTab.path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext")
                      }
                      value={activeTab.content}
                      beforeMount={configureMonacoThemes}
                      theme={monacoTheme(theme, highlightTheme)}
                      onMount={mountEditor}
                      options={{
                        readOnly:
                          activeTab.type === "workflowDocument" ||
                          (activeTab.type === "skill" && !!activeTab.skillPath && activeTab.skillPath !== "SKILL.md"),
                        automaticLayout: true,
                        contextmenu: false,
                        minimap: { enabled: false },
                        glyphMargin: activeTab.type === "file" || /\.http$/i.test(activeTab.path),
                        fontFamily: editorFontFamily,
                        fontWeight: "normal",
                        fontSize: uiFontSize,
                        lineHeight: editorLineHeight,
                        scrollBeyondLastLine: false,
                        padding: { top: 10 },
                      }}
                      onChange={(value) =>
                        updateGroup((tabs, active) => ({
                          tabs: tabs.map((tab) =>
                            tab.id === activeTab.id
                              ? { ...tab, content: value, dirty: value !== tab.savedContent, error: undefined }
                              : tab,
                          ),
                          activeTabId: active,
                        }))
                      }
                    />
                  )}
                </>
              )}
              <EditorStatusBar
                ref={editorStatusBarRef}
                active={Boolean(
                  activeTab &&
                  activeTab.type !== "workflow" &&
                  !activeTab.loading &&
                  !(activeTab.error && !activeTab.content) &&
                  activeTab.markdownMode !== "preview",
                )}
              />
            </div>
            {httpResult && (
              <section className="http-response-panel">
                <header>
                  <span>
                    {httpResult.request.method} {httpResult.request.url}
                  </span>
                  {httpResult.loading ? (
                    <small>Sending...</small>
                  ) : httpResult.response ? (
                    <small className={httpResult.response.status >= 400 ? "error" : "success"}>
                      {httpResult.response.status} {httpResult.response.statusText} · {httpResult.response.durationMs}{" "}
                      ms
                    </small>
                  ) : null}
                  <button title="Close response" onClick={() => setHttpResult(undefined)}>
                    <X size={14} />
                  </button>
                </header>
                {httpResult.error ? (
                  <div className="http-response-error">{httpResult.error}</div>
                ) : httpResult.response ? (
                  <div className="http-response-content">
                    <pre className="http-response-headers">
                      {Object.entries(httpResult.response.headers)
                        .map(([name, value]) => `${name}: ${value}`)
                        .join("\n")}
                    </pre>
                    <pre className="http-response-body">{httpResult.response.body}</pre>
                  </div>
                ) : (
                  <div className="http-response-loading">Waiting for response...</div>
                )}
              </section>
            )}
          </main>
          <div className="workspace-sidebar workspace-sidebar-right">
            {sideLayout === "ai-focused" ? (
              <>
                {rightSidebarOpen && (
                  <>
                    <div
                      className="right-resize-handle"
                      role="separator"
                      aria-label="Resize right sidebar"
                      aria-orientation="vertical"
                      aria-valuemin={180}
                      aria-valuemax={Math.round(Math.min(700, window.innerWidth * 0.55))}
                      aria-valuenow={Math.round(rightSidebarWidth)}
                      tabIndex={0}
                      onKeyDown={(event) =>
                        keyboardResize(
                          event,
                          rightSidebarWidth,
                          setRightSidebarWidth,
                          180,
                          Math.min(700, window.innerWidth * 0.55),
                          true,
                        )
                      }
                      onPointerDown={beginRightSidebarResize}
                    />
                    <aside className="side-panel side-panel-right" style={{ width: rightSidebarWidth }}>
                      <ResizablePanelStack
                        workspace={activeWorkspace}
                        setting="focused.rightSizes"
                        ids={[
                          ...(rightPanels.project ? ["project"] : []),
                          ...(rightPanels.git ? ["git"] : []),
                          ...(rightPanels.taskGit && selectedTaskId ? ["taskGit"] : []),
                          ...(rightPanels.promptHistory && selectedTaskId ? ["promptHistory"] : []),
                          ...(rightPanels.java && javaOptions ? ["java"] : []),
                          ...(rightPanels.useful ? ["useful"] : []),
                          ...(rightPanels.agents ? ["agents"] : []),
                          ...(rightPanels.skills ? ["skills"] : []),
                        ]}
                      >
                        {rightPanels.project && (
                          <section key="project" className="stacked-panel">
                            <header className="panel-header">
                              <span>Project</span>
                              <div className="panel-header-actions">
                                <button
                                  title={showIgnored ? "Hide ignored files" : "Show all files (including Git-ignored)"}
                                  className={showIgnored ? "active" : ""}
                                  onClick={toggleShowIgnored}
                                >
                                  {showIgnored ? <Eye size={14} /> : <EyeOff size={14} />}
                                </button>
                                <button title="Synchronize files" onClick={() => void refreshTree()}>
                                  <RefreshCw size={14} />
                                </button>
                              </div>
                            </header>
                            <QuickFilter
                              value={projectFilter}
                              placeholder={projectContentFilter ? "Filter by file contents" : "Filter files"}
                              label={projectContentFilter ? "Filter files by contents" : "Filter project files"}
                              onChange={setProjectFilter}
                              contentSearch={projectContentFilter}
                              contentSearchLoading={projectContentFilterLoading}
                              onContentSearchChange={setProjectContentFilter}
                            />
                            <div className="workspace-name">
                              <select
                                aria-label="Workspace root"
                                value={selectedRootId}
                                disabled={taskSwitching}
                                onChange={(event) => void selectWorkspaceRoot(event.target.value)}
                              >
                                {workspaceRoots.map((root) => (
                                  <option key={root.id} value={root.id}>
                                    {root.alias}
                                  </option>
                                ))}
                              </select>
                              <button
                                title="Add remote workspace root"
                                onClick={() => setWorkspaceRootDialogOpen(true)}
                              >
                                <Plus size={13} />
                              </button>
                              <button
                                title="Unregister an inactive workspace root"
                                disabled={!workspaceRoots.some((root) => !root.primary && root.id !== selectedRootId)}
                                onClick={() => void removeWorkspaceRoot()}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                            <ProjectTree
                              nodes={tree}
                              javaNodes={javaOptions ? javaTree : undefined}
                              query={projectContentFilter ? "" : projectFilter}
                              matchingPaths={
                                projectContentFilter && projectFilter.trim()
                                  ? (projectContentPaths ?? new Set())
                                  : undefined
                              }
                              activePath={activeTab?.path}
                              selectedPaths={projectSelection}
                              fileColors={fileColors}
                              gitStatuses={projectGitStatuses}
                              onAction={runProjectTreeAction}
                              onSelectionChange={setProjectSelection}
                              onContextMenu={(nodes, x, y) =>
                                setTreeContextMenu({
                                  x: Math.min(x, window.innerWidth - 220),
                                  y: Math.min(y, window.innerHeight - 180),
                                  nodes,
                                })
                              }
                            />
                          </section>
                        )}
                        {rightPanels.git && (
                          <section key="git" className="stacked-panel">
                            <header className="panel-header">
                              <span title="Git changes">Git</span>
                              <div className="panel-header-actions">
                                <GitToolbarActions
                                  onStash={() => setGitStashDialog(true)}
                                  selectedCount={selectedRollbackEntries.length}
                                  operationRunning={gitOperationRunning}
                                  pushing={gitPushing}
                                  fetching={gitFetching}
                                  rollingBack={gitRollingBack}
                                  upstream={gitUpstream}
                                  onRollbackSelected={openRollbackSelected}
                                  onUndoLastCommit={() => void previewHistoryRewrite("undo")}
                                  onPush={() => void pushGit()}
                                  onFetch={() => void fetchGit()}
                                  onRefresh={() => void refreshGit()}
                                />
                              </div>
                            </header>
                            <div className="git-branch">
                              <GitBranch size={13} />
                              <span>{gitBranch}</span>
                              {gitUpstream && (
                                <small
                                  title={
                                    gitUpstream.lastFetch
                                      ? `Last fetched ${new Date(gitUpstream.lastFetch).toLocaleString()}`
                                      : "Not fetched in this Core session"
                                  }
                                >
                                  {gitUpstream.upstream} · {gitUpstream.ahead} ahead · {gitUpstream.behind} behind
                                </small>
                              )}
                            </div>
                            <KeyboardGitChangesView
                              entries={gitEntries}
                              error={gitError}
                              selectedPaths={selectedGitPaths}
                              onTogglePath={(path) =>
                                setSelectedGitPaths((current) => {
                                  const next = new Set(current);
                                  next.has(path) ? next.delete(path) : next.add(path);
                                  return next;
                                })
                              }
                              activePath={activeTab?.path}
                              onOpenDiff={openDiff}
                              onOpenConflict={(entry) => setGitConflictPath(entry.path)}
                              onOpenFile={(entry) =>
                                void openFile({
                                  name: entry.path.split("/").pop() ?? entry.path,
                                  path: entry.path,
                                  type: "file",
                                })
                              }
                              onContextMenu={(event, entry) => {
                                event.preventDefault();
                                setGitRollbackMenu({
                                  ...menuPosition(
                                    event.clientX,
                                    event.clientY,
                                    220,
                                    290,
                                    window.innerWidth,
                                    window.innerHeight,
                                  ),
                                  entry,
                                });
                              }}
                            />
                            <GitCommitPanel
                              message={gitCommitMessage}
                              selectedCount={selectedGitPaths.size}
                              operationRunning={gitOperationRunning}
                              committing={gitCommitting}
                              onMessageChange={setGitCommitMessage}
                              onCommit={(message) => void commitSelectedFiles(message)}
                              onCommitAndPush={(message) => void commitAndPush(message)}
                              pushing={gitPushing}
                              stagedCount={gitEntries.filter((entry) => entry.states.includes("index")).length}
                              onAmend={() => void previewHistoryRewrite("amend")}
                            />
                          </section>
                        )}
                        {rightPanels.taskGit && selectedTaskId && (
                          <section key="taskGit" className="stacked-panel">
                            <header className="panel-header">
                              <span>Task Git</span>
                              <button title="Refresh task comparison" onClick={() => void refreshTaskGit()}>
                                <RefreshCw size={14} />
                              </button>
                            </header>
                            <div className="git-branch">
                              <GitCompareArrows size={13} />
                              <span>
                                {tasks.find((task) => task.id === selectedTaskId)?.baseBranch ?? "Base branch"}
                              </span>
                            </div>
                            <GitChangesView
                              entries={taskGitEntries}
                              error={taskGitError}
                              emptyMessage="No changes from base branch"
                              groupTitle="Changes from Base"
                              activePath={activeTab?.path}
                              onOpenDiff={openTaskDiff}
                              onContextMenu={(event, entry) => {
                                event.preventDefault();
                                const task = activeTaskRef.current;
                                if (task)
                                  setGitRollbackMenu({
                                    ...menuPosition(
                                      event.clientX,
                                      event.clientY,
                                      220,
                                      150,
                                      window.innerWidth,
                                      window.innerHeight,
                                    ),
                                    entry,
                                    taskRef: task.baseBranch,
                                  });
                              }}
                              onOpenFile={(entry) =>
                                void openFile({
                                  name: entry.path.split("/").pop() ?? entry.path,
                                  path: entry.path,
                                  type: "file",
                                })
                              }
                            />
                          </section>
                        )}
                        {rightPanels.promptHistory && selectedTaskId && (
                          <TaskCheckpointHistory
                            key="promptHistory"
                            checkpoints={taskCheckpoints}
                            onOpen={openCheckpointDiff}
                            onReview={reviewCheckpointFile}
                            onRestore={restoreCheckpoint}
                            onFollowUp={followUpCheckpoint}
                            onClose={() => setRightPanels((current) => ({ ...current, promptHistory: false }))}
                          />
                        )}
                        {rightPanels.java && javaOptions && (
                          <section key="java" className="stacked-panel">
                            <header className="panel-header">
                              <span>Java Project</span>
                              <button title="Refresh Java project" onClick={() => void refreshJavaTree()}>
                                <RefreshCw size={14} />
                              </button>
                            </header>
                            <div className="java-project-meta">
                              <Coffee size={13} />
                              <span>{javaOptions.pomPath}</span>
                            </div>
                            <div className="tree java-tree">
                              <JavaProjectTree nodes={javaTree} activePath={activeTab?.path} onOpen={openFile} />
                            </div>
                          </section>
                        )}
                        {rightPanels.useful && (
                          <section key="useful" className="stacked-panel">
                            <header className="panel-header">
                              <span>Useful Files</span>
                              <button title="Refresh useful files" onClick={() => void refreshUsefulFiles()}>
                                <RefreshCw size={14} />
                              </button>
                            </header>
                            <div className="useful-files-list">
                              <UsefulFileSection
                                title="Global"
                                scope="global"
                                files={usefulFiles}
                                activeTab={activeTab}
                                onOpen={openUsefulFile}
                                onCreate={(scope) => setUsefulDialog({ mode: "create", scope })}
                                onRename={(file) => setUsefulDialog({ mode: "rename", scope: file.scope, file })}
                                onDelete={(file) => void deleteUsefulFile(file)}
                              />
                              <UsefulFileSection
                                title="Local"
                                scope="local"
                                files={usefulFiles}
                                activeTab={activeTab}
                                onOpen={openUsefulFile}
                                onCreate={(scope) => setUsefulDialog({ mode: "create", scope })}
                                onRename={(file) => setUsefulDialog({ mode: "rename", scope: file.scope, file })}
                                onDelete={(file) => void deleteUsefulFile(file)}
                              />
                            </div>
                          </section>
                        )}
                        {rightPanels.agents && (
                          <section key="agents" className="stacked-panel">
                            <AgentsPanel
                              agents={agents}
                              activeTab={activeTab}
                              onRefresh={() => void refreshAgents()}
                              onOpen={(file) => void openAgentFile(file)}
                              onCreate={(scope) => setAgentDialog({ mode: "create", scope })}
                              onRename={(file) => {
                                if (file.scope !== "workspace")
                                  setAgentDialog({ mode: "rename", scope: file.scope, file });
                              }}
                              onDelete={(file) => void deleteAgent(file)}
                            />
                          </section>
                        )}
                        {rightPanels.skills && (
                          <section key="skills" className="stacked-panel">
                            <SkillsPanel
                              key={activeWorkspace}
                              catalog={skillCatalog}
                              agents={agents}
                              agentPreset={selectedAgentReference}
                              selected={selectedSkillIds}
                              running={aiSession.status === "in_progress"}
                              disabled={taskSwitching}
                              onRefresh={() => refreshSkills()}
                              onSelection={selectSkills}
                              onOpen={openSkillFile}
                              activeSkillId={activeTab?.type === "skill" ? activeTab.skillId : undefined}
                              actions={skillActions}
                            />
                          </section>
                        )}
                      </ResizablePanelStack>
                    </aside>
                  </>
                )}
                <FocusDock edge="right" active={focusMode}>
                  <nav className="right-tool-stripe" aria-label="Right tool windows">
                    <button
                      className={`tool-stripe-button right ${rightPanels.project ? "active" : ""}`}
                      title={rightPanels.project ? "Hide Project" : "Show Project"}
                      onClick={() => setRightPanels((current) => ({ ...current, project: !current.project }))}
                    >
                      <Folder size={15} />
                      <span>Project</span>
                    </button>
                    <button
                      className={`tool-stripe-button right ${rightPanels.git ? "active" : ""}`}
                      title={rightPanels.git ? "Hide Git changes" : "Show Git changes"}
                      onClick={() =>
                        setRightPanels((current) => {
                          if (!current.git) void refreshGit();
                          return { ...current, git: !current.git };
                        })
                      }
                    >
                      <GitBranch size={15} />
                      <span>Git</span>
                      {gitEntries.length > 0 && (
                        <span className="tool-badge">{gitEntries.length > 99 ? "99+" : gitEntries.length}</span>
                      )}
                    </button>
                    {selectedTaskId && (
                      <button
                        className={`tool-stripe-button right ${rightPanels.taskGit ? "active" : ""}`}
                        title={rightPanels.taskGit ? "Hide Task Git" : "Show Task Git"}
                        onClick={toggleFocusedTaskGit}
                      >
                        <GitCompareArrows size={15} />
                        <span>Task Git</span>
                        {taskGitEntries.length > 0 && (
                          <span className="tool-badge">
                            {taskGitEntries.length > 99 ? "99+" : taskGitEntries.length}
                          </span>
                        )}
                      </button>
                    )}
                    {selectedTaskId && (
                      <button
                        className={`tool-stripe-button right ${rightPanels.promptHistory ? "active" : ""}`}
                        title={rightPanels.promptHistory ? "Hide Prompt History" : "Show Prompt History"}
                        onClick={() =>
                          setRightPanels((current) => {
                            if (!current.promptHistory) void refreshTaskGit();
                            return { ...current, promptHistory: !current.promptHistory };
                          })
                        }
                      >
                        <History size={15} />
                        <span>History</span>
                        {taskCheckpoints.length > 0 && (
                          <span className="tool-badge">
                            {taskCheckpoints.length > 99 ? "99+" : taskCheckpoints.length}
                          </span>
                        )}
                      </button>
                    )}
                    {javaOptions && (
                      <button
                        className={`tool-stripe-button right ${rightPanels.java ? "active" : ""}`}
                        title={rightPanels.java ? "Hide Java project" : "Show Java project"}
                        onClick={() =>
                          setRightPanels((current) => {
                            if (!current.java) void refreshJavaTree();
                            return { ...current, java: !current.java };
                          })
                        }
                      >
                        <Coffee size={15} />
                        <span>Java</span>
                      </button>
                    )}
                    {rightBottomTools}
                  </nav>
                </FocusDock>
              </>
            ) : (
              <>
                {(rightPanels.useful ||
                  rightPanels.agents ||
                  classicTasksOpen ||
                  classicAiOpen ||
                  rightPanels.skills ||
                  (rightPanels.promptHistory && selectedTaskId)) && (
                  <>
                    <div
                      className="right-resize-handle"
                      role="separator"
                      aria-label="Resize right sidebar"
                      aria-orientation="vertical"
                      aria-valuemin={240}
                      aria-valuemax={Math.round(Math.min(960, window.innerWidth * 0.72))}
                      aria-valuenow={Math.round(classicRightWidth)}
                      tabIndex={0}
                      onKeyDown={(event) =>
                        keyboardResize(
                          event,
                          classicRightWidth,
                          setClassicRightWidth,
                          240,
                          Math.min(960, window.innerWidth * 0.72),
                          true,
                        )
                      }
                      onPointerDown={beginClassicRightResize}
                    />
                    <aside className="side-panel classic-right-panel" style={{ width: classicRightWidth }}>
                      {rightPanels.useful && (
                        <section key="useful" className="stacked-panel">
                          <header className="panel-header">
                            <span>Useful Files</span>
                            <button title="Refresh useful files" onClick={() => void refreshUsefulFiles()}>
                              <RefreshCw size={14} />
                            </button>
                          </header>
                          <div className="useful-files-list">
                            <UsefulFileSection
                              title="Global"
                              scope="global"
                              files={usefulFiles}
                              activeTab={activeTab}
                              onOpen={openUsefulFile}
                              onCreate={(scope) => setUsefulDialog({ mode: "create", scope })}
                              onRename={(file) => setUsefulDialog({ mode: "rename", scope: file.scope, file })}
                              onDelete={(file) => void deleteUsefulFile(file)}
                            />
                            <UsefulFileSection
                              title="Local"
                              scope="local"
                              files={usefulFiles}
                              activeTab={activeTab}
                              onOpen={openUsefulFile}
                              onCreate={(scope) => setUsefulDialog({ mode: "create", scope })}
                              onRename={(file) => setUsefulDialog({ mode: "rename", scope: file.scope, file })}
                              onDelete={(file) => void deleteUsefulFile(file)}
                            />
                          </div>
                        </section>
                      )}
                      {rightPanels.agents && (
                        <section key="agents" className="stacked-panel">
                          <AgentsPanel
                            agents={agents}
                            activeTab={activeTab}
                            onRefresh={() => void refreshAgents()}
                            onOpen={(file) => void openAgentFile(file)}
                            onCreate={(scope) => setAgentDialog({ mode: "create", scope })}
                            onRename={(file) => {
                              if (file.scope !== "workspace")
                                setAgentDialog({ mode: "rename", scope: file.scope, file });
                            }}
                            onDelete={(file) => void deleteAgent(file)}
                          />
                        </section>
                      )}
                      {classicTasksOpen && (
                        <section
                          className="stacked-panel"
                          style={classicAiOpen ? { flex: `0 0 ${classicSplit}%` } : undefined}
                        >
                          <header className="panel-header">
                            <span>Tasks</span>
                            <button
                              title="Create task"
                              disabled={taskSwitching}
                              onClick={() => setShowCreateTaskDialog(true)}
                            >
                              <Plus size={15} />
                            </button>
                          </header>
                          <div className="task-filters">
                            <QuickFilter
                              value={taskFilter}
                              placeholder="Filter tasks"
                              label="Filter tasks"
                              onChange={setTaskFilter}
                            />
                            <select
                              aria-label="Task lifecycle filter"
                              value={taskLifecycleFilter}
                              onChange={(event) =>
                                setTaskLifecycleFilter(event.target.value as typeof taskLifecycleFilter)
                              }
                            >
                              <option value="active">Active</option>
                              <option value="finished">Finished</option>
                              <option value="archived">Archived</option>
                              <option value="all">All</option>
                            </select>
                          </div>
                          <div className="tasks-list">
                            {showRootTask && (
                              <TaskRow
                                icon={<Folder size={15} />}
                                name="Root workspace"
                                summary={aiStatuses.root}
                                selected={selectedTaskId === undefined}
                                disabled={taskSwitching}
                                onClick={() => openTask(undefined, aiStatuses.root.pendingPermission)}
                                onCancelTimer={() => void timerAction(undefined, "cancel")}
                                onFireTimer={() => void timerAction(undefined, "fire")}
                              />
                            )}
                            {filteredTasks.map((task) => {
                              const summary = aiStatuses.tasks[task.id] ?? emptyAiSummary;
                              return (
                                <TaskRow
                                  key={task.id}
                                  icon={<ListTodo size={15} />}
                                  name={task.name}
                                  branch={task.branch}
                                  summary={summary}
                                  finished={task.status === "finished"}
                                  archived={task.archived}
                                  selected={selectedTaskId === task.id}
                                  disabled={taskSwitching}
                                  onClick={() => openTask(task.id, summary.pendingPermission)}
                                  onSetFinished={() =>
                                    void setTaskStatus(task, task.status === "finished" ? "active" : "finished")
                                  }
                                  onRename={() => void renameTask(task)}
                                  onSetArchived={() => void setTaskArchived(task, !task.archived)}
                                  onMerge={() => setMergeDialog(task)}
                                  onDelete={() => void deleteTask(task)}
                                  onCancelTimer={() => void timerAction(task, "cancel")}
                                  onFireTimer={() => void timerAction(task, "fire")}
                                />
                              );
                            })}
                            {!showRootTask && filteredTasks.length === 0 && (
                              <div className="filter-empty">No matching tasks</div>
                            )}
                          </div>
                        </section>
                      )}
                      {classicTasksOpen && classicAiOpen && (
                        <div className="classic-panel-divider" onPointerDown={beginClassicSplitResize} />
                      )}
                      {classicAiOpen && (
                        <section className="stacked-panel">
                          <header className="panel-header">
                            <span>AI</span>
                            <AgentPicker
                              agents={agents}
                              value={selectedAgentKey}
                              disabled={aiSession.status === "in_progress"}
                              onChange={selectAgent}
                            />
                            <span className={`ai-status ${aiSession.status}`}>{formatAiStatus(aiSession.status)}</span>
                          </header>
                          <AiPanel
                            key={`classic:${activeWorkspace}:${selectedTaskId ?? "root"}:${aiProvider}:${aiSession.id ?? "legacy"}`}
                            provider={aiProvider}
                            providers={aiProviders}
                            session={chatSession}
                            sessions={aiSessions}
                            models={aiModels}
                            modelsLoading={aiModelsLoading}
                            usage={aiUsage}
                            attachments={currentAiAttachments}
                            draft={currentAiDraft}
                            workspacePath={activeWorkspace}
                            permissionOwner={{
                              provider: aiProvider,
                              ...(selectedTaskId ? { taskId: selectedTaskId } : {}),
                              ...(aiSession.id ? { sessionId: aiSession.id } : {}),
                            }}
                            skills={availableChatSkills}
                            onSkillsChange={selectSkills}
                            onOpenSkills={() => {
                              setRightPanels((current) => ({ ...current, skills: true }));
                              void refreshSkills();
                            }}
                            permissionActionsDisabled={taskSwitching}
                            sessionChangesDisabled={selectedTaskTimerActive}
                            onProviderChange={(provider) => void switchAiProvider(provider)}
                            onConfigurationChange={configureAi}
                            onAttachmentsChange={updateAiAttachments}
                            onDraftChange={updateAiDraft}
                            onSend={sendAiPrompt}
                            onSendAsTask={selectedTaskId ? undefined : sendAiPromptAsTask}
                            onSteer={steerAiPrompt}
                            onInterrupt={() => void interruptAi()}
                            onNewSession={() => void newAiSession()}
                            onSwitchSession={(session) => void switchAiSession(session)}
                            onRemoveSession={(session) => void removeAiSession(session)}
                            onResolvePermission={resolveAiPermission}
                            onAnswerQuestion={answerAiQuestion}
                            onOpenFile={(path, line, column) => void openAiFile(path, line, column)}
                            onOpenExternal={(url) => void window.desktop?.openExternal(url)}
                          />
                        </section>
                      )}
                      {rightPanels.skills && (
                        <section className="stacked-panel">
                          <SkillsPanel
                            key={activeWorkspace}
                            catalog={skillCatalog}
                            agents={agents}
                            agentPreset={selectedAgentReference}
                            selected={selectedSkillIds}
                            running={aiSession.status === "in_progress"}
                            disabled={taskSwitching}
                            onRefresh={() => refreshSkills()}
                            onSelection={selectSkills}
                            onOpen={openSkillFile}
                            activeSkillId={activeTab?.type === "skill" ? activeTab.skillId : undefined}
                            actions={skillActions}
                          />
                        </section>
                      )}
                      {rightPanels.promptHistory && selectedTaskId && (
                        <TaskCheckpointHistory
                          checkpoints={taskCheckpoints}
                          onOpen={openCheckpointDiff}
                          onReview={reviewCheckpointFile}
                          onRestore={restoreCheckpoint}
                          onFollowUp={followUpCheckpoint}
                          onClose={() => setRightPanels((current) => ({ ...current, promptHistory: false }))}
                        />
                      )}
                    </aside>
                  </>
                )}
                <FocusDock edge="right" active={focusMode}>
                  <nav className="right-tool-stripe" aria-label="Right tool windows">
                    <button
                      className={`tool-stripe-button right ${classicTasksOpen ? "active" : ""}`}
                      title={classicTasksOpen ? "Hide Tasks" : "Show Tasks"}
                      onClick={() => setClassicTasksOpen((open) => !open)}
                    >
                      <ListTodo size={15} />
                      <span>Tasks</span>
                      {tasks.length > 0 && (
                        <span className="tool-badge">{tasks.length > 99 ? "99+" : tasks.length}</span>
                      )}
                    </button>
                    <button
                      className={`tool-stripe-button right ${classicAiOpen ? "active" : ""}`}
                      title={classicAiOpen ? "Hide AI" : "Show AI"}
                      onClick={() => {
                        setClassicAiOpen((open) => {
                          if (!open) void refreshAi();
                          return !open;
                        });
                      }}
                    >
                      <Sparkles size={15} />
                      <span>AI</span>
                      {aiSession.status === "in_progress" && <span className="tool-badge">...</span>}
                    </button>
                    {rightBottomTools}
                  </nav>
                </FocusDock>
              </>
            )}
          </div>
          <div className="workspace-bottom-panels">
            {layout.terminalGroup.tabs.length > 0 && (
              <TerminalPanel
                visible={terminalPanelOpen}
                onActivity={markUnreadTerminalOutput}
                theme={theme}
                fontFamily={terminalFontFamily}
                fontSize={uiFontSize}
                lineHeight={uiLineHeight}
                client={clientRef.current!}
                group={layout.terminalGroup}
                height={terminalHeight}
                highlightedTerminalIds={
                  new Set(
                    runConfigs
                      .filter((config) => ["starting", "running", "stopping"].includes(config.status))
                      .flatMap((config) => (config.terminalId ? [config.terminalId] : [])),
                  )
                }
                onActivate={activateTerminalTab}
                onCreate={() => void createTerminal()}
                onClose={closeTerminal}
                onRename={renameTerminal}
                onDuplicate={(tab) => void duplicateTerminal(tab)}
                onMove={moveTerminal}
                onRecoveryShown={(tabId) =>
                  updateTerminalGroup((group) => ({
                    ...group,
                    tabs: group.tabs.map((tab) => (tab.id === tabId ? { ...tab, recovery: undefined } : tab)),
                  }))
                }
                onResizeStart={beginTerminalResize}
                registerWriter={registerTerminalWriter}
              />
            )}
            {layout.panels.some((panel) => panel.type === "languageOutput") &&
              javaOptions &&
              languages.find((language) => language.id === "java") && (
                <JavaPanel
                  key={`java-panel:${selectedRootId}`}
                  capabilities={languages.find((language) => language.id === "java")!.capabilities}
                  height={javaPanelHeight}
                  log={javaLog}
                  running={javaRunning}
                  options={javaOptions}
                  debugState={javaDebugState}
                  onConfigure={() => setShowRunConfigurationDialog(true)}
                  onApplyChanges={applyJavaChanges}
                  onInspect={(reference, start) =>
                    languageClient(clientRef.current!, "java").debugVariables(reference, start)
                  }
                  onBuild={() => void runJavaAction("language.build")}
                  onRun={() => void runJavaAction("language.run")}
                  onDebug={() => void debugJava()}
                  onStop={() => void stopJava()}
                  onDebugCommand={(command) => void commandJavaDebugger(command)}
                  onClear={() => setJavaLog("")}
                  onResizeStart={beginJavaResize}
                  onHeightChange={setJavaPanelHeight}
                />
              )}
            {layout.panels.some((panel) => panel.type === "problems") && javaOptions && (
              <ProblemsPanel
                language="java"
                height={problemsHeight}
                diagnostics={javaDiagnostics}
                checking={javaChecking}
                onRefresh={() => void checkJava()}
                onOpen={(diagnostic) => void openDiagnostic(diagnostic)}
                onResizeStart={beginProblemsResize}
              />
            )}
            {layout.panels.some((panel) => panel.type === "gitlog") && (
              <GitLogPanel
                client={clientRef.current!}
                height={gitLogHeight}
                revision={gitRevision}
                onResizeStart={beginGitLogResize}
                onRepositoryChanged={() => {
                  void Promise.all([refreshGit(), refreshTree()]);
                }}
                onMergeConflict={() => {
                  void clientRef.current
                    ?.request("git.conflicts", {})
                    .then((conflicts) => setGitConflictPath(conflicts.files[0]?.path ?? ""));
                }}
              />
            )}
          </div>
        </div>
        <FocusDock edge="bottom" active={focusMode}>
          <footer className="bottom-tool-bar">
            <button
              className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "terminal") ? "active" : ""}`}
              onClick={toggleTerminalPanel}
            >
              <SquareTerminal size={14} />
              <span>Terminal</span>
              {hasUnreadTerminalOutput && (
                <span className="terminal-activity-dot" role="img" aria-label="New terminal output" />
              )}
              {layout.terminalGroup.tabs.length > 0 && (
                <span className="bottom-tool-count">{layout.terminalGroup.tabs.length}</span>
              )}
            </button>
            {javaOptions && (
              <button
                className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "languageOutput") ? "active" : ""}`}
                onClick={toggleJavaPanel}
              >
                <Coffee size={14} />
                <span>Java</span>
                {javaRunning && <span className="running-indicator" />}
              </button>
            )}
            {javaOptions && (
              <button
                className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "problems") ? "active" : ""}`}
                onClick={toggleProblemsPanel}
              >
                <CircleAlert size={14} />
                <span>Problems</span>
                {javaDiagnostics.length > 0 && <span className="bottom-tool-count">{javaDiagnostics.length}</span>}
              </button>
            )}
            <button
              className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "gitlog") ? "active" : ""}`}
              onClick={toggleGitLogPanel}
            >
              <GitBranch size={14} />
              <span>Git</span>
            </button>
            {runConfigs.map((config, index) => (
              <button
                key={`${config.scope}:${config.name}`}
                className={`bottom-tool-button run-config-entry ${index === 0 ? "first" : ""} ${["starting", "running", "stopping"].includes(config.status) ? "active-run" : ""}`}
                aria-label={`${config.name}, ${config.scope}, ${config.status}`}
                title={`${config.scope} Run Config: ${config.name} (${config.status})`}
                onClick={() => void runConfigAction(config, config.terminalId ? "openTerminal" : "run")}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setRunConfigMenu({
                    x: Math.min(event.clientX, window.innerWidth - 218),
                    y: Math.min(event.clientY, window.innerHeight - 126),
                    config,
                  });
                }}
              >
                <Play size={12} />
                <span>{config.name}</span>
                <span className={`run-config-indicator ${config.status}`} aria-hidden="true" />
              </button>
            ))}
          </footer>
        </FocusDock>
        {treeContextMenu && (
          <div className="context-menu-layer" onMouseDown={() => setTreeContextMenu(undefined)}>
            <ContextMenu
              className="context-menu"
              aria-label={`Actions for ${treeContextMenu.nodes.length} selected item${treeContextMenu.nodes.length === 1 ? "" : "s"}`}
              style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                disabled={treeContextMenu.nodes.length !== 1}
                onClick={() => openSearchForNode(treeContextMenu.nodes[0]!)}
              >
                <Search size={14} />
                <span>Find in Files</span>
              </button>
              <div className="context-menu-separator" role="separator" />
              <button
                role="menuitem"
                disabled={treeContextMenu.nodes.length !== 1}
                onClick={() => {
                  runProjectTreeAction("createFile", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <File size={14} />
                <span>New File...</span>
              </button>
              <button
                disabled={treeContextMenu.nodes.length !== 1}
                onClick={() => {
                  runProjectTreeAction("createDirectory", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <Folder size={14} />
                <span>New Directory...</span>
              </button>
              <div className="context-menu-separator" role="separator" />
              <button
                disabled={treeContextMenu.nodes.length !== 1}
                onClick={() => {
                  runProjectTreeAction("rename", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <Pencil size={14} />
                <span>Rename...</span>
              </button>
              <button
                disabled={treeContextMenu.nodes.length !== 1 || treeContextMenu.nodes[0]?.type !== "file"}
                onClick={() => {
                  runProjectTreeAction("open", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <FileText size={14} />
                <span>Open</span>
              </button>
              <button
                disabled={treeContextMenu.nodes.length !== 1 || Boolean(projectTransfer)}
                onClick={() => {
                  void uploadToWorkspace(treeContextMenu.nodes[0]!);
                  setTreeContextMenu(undefined);
                }}
              >
                <ArrowUp size={14} />
                <span>Upload file...</span>
              </button>
              <button
                disabled={
                  treeContextMenu.nodes.length !== 1 ||
                  treeContextMenu.nodes[0]?.type !== "file" ||
                  Boolean(projectTransfer)
                }
                onClick={() => {
                  void downloadFromWorkspace(treeContextMenu.nodes[0]!);
                  setTreeContextMenu(undefined);
                }}
              >
                <ArrowDown size={14} />
                <span>Download file...</span>
              </button>
              <button
                onClick={() => {
                  runProjectTreeAction("duplicate", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <ClipboardCopy size={14} />
                <span>Duplicate</span>
              </button>
              <button
                onClick={() => {
                  runProjectTreeAction("copyTo", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <ClipboardCopy size={14} />
                <span>Copy to...</span>
              </button>
              <button
                onClick={() => {
                  runProjectTreeAction("moveTo", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <ArrowUpRight size={14} />
                <span>Move to...</span>
              </button>
              <div className="context-menu-separator" role="separator" />
              <div className="context-submenu-trigger">
                <button role="menuitem" aria-haspopup="menu" aria-label="Copy paths">
                  <ClipboardCopy size={14} />
                  <span>Copy Paths</span>
                  <ChevronRight size={13} />
                </button>
                <ContextMenu
                  className="context-menu context-submenu copy-submenu"
                  role="menu"
                  aria-label="Copy path actions"
                >
                  {copyProjectTreeActions.map(({ action, label }) => (
                    <button
                      key={action}
                      role="menuitem"
                      onClick={() => {
                        runProjectTreeAction(action, treeContextMenu.nodes);
                        setTreeContextMenu(undefined);
                      }}
                    >
                      <ClipboardCopy size={14} />
                      <span>{label}</span>
                    </button>
                  ))}
                </ContextMenu>
              </div>
              <div className="context-menu-separator" role="separator" />
              {treeContextMenu.nodes.length === 1 &&
                treeContextMenu.nodes[0]?.type === "file" &&
                projectRegistration(treeContextMenu.nodes[0].path) && (
                  <button
                    role="menuitem"
                    disabled={runProjectBusy || taskSwitching}
                    onClick={() => void registerRunProject(treeContextMenu.nodes[0]!.path)}
                  >
                    <Package size={14} />
                    <span>{projectRegistration(treeContextMenu.nodes[0].path)!.label}</span>
                  </button>
                )}
              {treeContextMenu.nodes.length === 1 &&
                javaOptions &&
                treeContextMenu.nodes[0]?.type === "directory" &&
                treeContextMenu.nodes[0].path && (
                  <button onClick={() => void addJavaSourceRoot(treeContextMenu.nodes[0]!.path)}>
                    <Coffee size={14} />
                    <span>Mark as Sources Root</span>
                  </button>
                )}
              {treeContextMenu.nodes.length === 1 && treeContextMenu.nodes[0]?.path && (
                <div className="context-submenu-trigger">
                  <button>
                    <Palette size={14} />
                    <span>Color</span>
                    <ChevronRight size={13} />
                  </button>
                  <ContextMenu className="context-menu context-submenu color-submenu">
                    {fileColorChoices.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => {
                          const target = treeContextMenu.nodes[0]!.path;
                          setFileColors((current) => ({ ...current, [target]: color.id }));
                          setTreeContextMenu(undefined);
                        }}
                      >
                        <span className={`file-color-swatch ${color.id}`} />
                        <span>{color.label}</span>
                        {fileColors[treeContextMenu.nodes[0]!.path] === color.id && <Check size={13} />}
                      </button>
                    ))}
                    <button
                      disabled={!fileColors[treeContextMenu.nodes[0]!.path]}
                      onClick={() => {
                        const target = treeContextMenu.nodes[0]!.path;
                        setFileColors((current) => {
                          const next = { ...current };
                          delete next[target];
                          return next;
                        });
                        setTreeContextMenu(undefined);
                      }}
                    >
                      <X size={14} />
                      <span>Clear Color</span>
                    </button>
                  </ContextMenu>
                </div>
              )}
              <button
                className="danger"
                disabled={treeContextMenu.nodes.length !== 1}
                onClick={() => {
                  runProjectTreeAction("delete", treeContextMenu.nodes);
                  setTreeContextMenu(undefined);
                }}
              >
                <Trash2 size={14} />
                <span>Delete...</span>
              </button>
            </ContextMenu>
          </div>
        )}
        {editorGitMenu && (
          <div className="context-menu-layer" onMouseDown={() => setEditorGitMenu(undefined)}>
            <ContextMenu
              className="context-menu editor-git-menu"
              style={{ left: editorGitMenu.x, top: editorGitMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button onClick={() => attachWorkspaceFile(editorGitMenu.path)}>
                <Bot size={14} />
                <span>Attach to AI</span>
              </button>
              <div className="context-submenu-trigger">
                <button>
                  <GitBranch size={14} />
                  <span>Git</span>
                  <ChevronRight size={13} />
                </button>
                <ContextMenu className="context-menu context-submenu">
                  <button
                    onClick={() => {
                      setGitHistory({ path: editorGitMenu.path });
                      setEditorGitMenu(undefined);
                    }}
                  >
                    <FileDiff size={14} />
                    <span>Show file changes</span>
                  </button>
                  <button
                    disabled={editorGitMenu.startLine === undefined}
                    onClick={() => {
                      setGitHistory({
                        path: editorGitMenu.path,
                        startLine: editorGitMenu.startLine,
                        endLine: editorGitMenu.endLine,
                        content: editorGitMenu.content,
                      });
                      setEditorGitMenu(undefined);
                    }}
                  >
                    <ListTree size={14} />
                    <span>Show selection changes</span>
                  </button>
                </ContextMenu>
              </div>
            </ContextMenu>
          </div>
        )}
        {gitRollbackMenu && (
          <div className="context-menu-layer" onMouseDown={() => setGitRollbackMenu(undefined)}>
            <ContextMenu
              className="context-menu"
              style={{ left: gitRollbackMenu.x, top: gitRollbackMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {(() => {
                const entry = gitRollbackMenu.entry;
                const deleted = entry.indexStatus === "D" || entry.worktreeStatus === "D";
                const untracked = entry.states.includes("untracked");
                const close = () => setGitRollbackMenu(undefined);
                return (
                  <>
                    {!gitRollbackMenu.taskRef &&
                      (entry.states.includes("conflict") ? (
                        <button
                          onClick={() => {
                            setGitConflictPath(entry.path);
                            close();
                          }}
                        >
                          <GitBranch size={14} />
                          <span>Resolve Conflict</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            close();
                            void openDiff(entry);
                          }}
                        >
                          <FileDiff size={14} />
                          <span>Open Diff</span>
                        </button>
                      ))}
                    {!deleted && (
                      <button
                        onClick={() => {
                          close();
                          void openFile({
                            name: entry.path.split("/").pop() ?? entry.path,
                            path: entry.path,
                            type: "file",
                          });
                        }}
                      >
                        <File size={14} />
                        <span>Open File</span>
                      </button>
                    )}
                    {!untracked && (
                      <button
                        onClick={() => {
                          close();
                          setGitHistory({ path: entry.path });
                        }}
                      >
                        <History size={14} />
                        <span>Show History</span>
                      </button>
                    )}
                    <button onClick={() => copyGitPath(entry)}>
                      <ClipboardCopy size={14} />
                      <span>Copy Path</span>
                    </button>
                    {!gitRollbackMenu.taskRef && !entry.states.includes("conflict") && (
                      <>
                        <div className="context-menu-separator" role="separator" />
                        <button
                          disabled={gitOperationRunning || (!entry.states.includes("worktree") && !untracked)}
                          onClick={() => void updateGitIndex("stage", entry.path)}
                        >
                          <Plus size={14} />
                          <span>Stage File</span>
                        </button>
                        <button
                          disabled={gitOperationRunning || !entry.states.includes("index")}
                          onClick={() => void updateGitIndex("unstage", entry.path)}
                        >
                          <Minus size={14} />
                          <span>Unstage File</span>
                        </button>
                        {untracked && (
                          <button disabled={gitOperationRunning} onClick={() => void ignoreGitPath(entry)}>
                            <EyeOff size={14} />
                            <span>Add to .gitignore</span>
                          </button>
                        )}
                      </>
                    )}
                    <div className="context-menu-separator" role="separator" />
                    <button
                      className="danger"
                      disabled={gitOperationRunning}
                      onClick={() => void rollbackFile(entry, gitRollbackMenu.taskRef)}
                    >
                      <RotateCcw size={14} />
                      <span>{untracked ? "Delete File" : "Rollback"}</span>
                    </button>
                  </>
                );
              })()}
            </ContextMenu>
          </div>
        )}
        {tabContextMenu && (
          <div className="context-menu-layer" onMouseDown={() => setTabContextMenu(undefined)}>
            <ContextMenu
              className="context-menu tab-context-menu"
              style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {tabContextMenu.tab.type === "file" && (
                <button onClick={() => toggleTabPin(tabContextMenu.tab)}>
                  {tabContextMenu.tab.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  <span>{tabContextMenu.tab.pinned ? "Unpin Tab" : "Pin Tab"}</span>
                </button>
              )}
              <button onClick={() => closeTabs(tabContextMenu.tab, "all")}>
                <X size={14} />
                <span>Close All Unpinned</span>
              </button>
              <button
                disabled={
                  !group.tabs
                    .slice(group.tabs.findIndex((tab) => tab.id === tabContextMenu.tab.id) + 1)
                    .some((tab) => !tab.pinned)
                }
                onClick={() => closeTabs(tabContextMenu.tab, "right")}
              >
                <ArrowUpRight className="close-right-icon" size={14} />
                <span>Close Unpinned to the Right</span>
              </button>
              <button
                disabled={
                  tabContextMenu.tab.type === "diff" ||
                  tabContextMenu.tab.type === "agent" ||
                  tabContextMenu.tab.type === "skill" ||
                  tabContextMenu.tab.type === "runConfig" ||
                  tabContextMenu.tab.type === "workflowDocument" ||
                  tabContextMenu.tab.type === "workflow"
                }
                onClick={() => void openTabInWindow(tabContextMenu.tab)}
              >
                <Columns2 size={14} />
                <span>Open in New Window</span>
              </button>
            </ContextMenu>
          </div>
        )}
        {runConfigMenu && (
          <div className="context-menu-layer" onMouseDown={() => setRunConfigMenu(undefined)}>
            <ContextMenu
              className="context-menu"
              style={{ left: runConfigMenu.x, top: runConfigMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                disabled={!runConfigMenu.config.terminalId}
                onClick={() => void runConfigAction(runConfigMenu.config, "openTerminal")}
              >
                <SquareTerminal size={14} />
                <span>Open Terminal</span>
              </button>
              <button
                disabled={["starting", "running", "stopping"].includes(runConfigMenu.config.status)}
                onClick={() => void runConfigAction(runConfigMenu.config, "run")}
              >
                <Play size={14} />
                <span>Run</span>
              </button>
              <button
                disabled={!["starting", "running"].includes(runConfigMenu.config.status)}
                onClick={() => void runConfigAction(runConfigMenu.config, "stop")}
              >
                <Square size={14} />
                <span>Stop</span>
              </button>
              <button
                disabled={runConfigMenu.config.status === "stopping"}
                onClick={() => void runConfigAction(runConfigMenu.config, "restart")}
              >
                <RefreshCw size={14} />
                <span>Restart</span>
              </button>
            </ContextMenu>
          </div>
        )}
        {projectPathDialog && (
          <ProjectPathDialog
            mode={projectPathDialog.mode}
            initialName={projectPathDialog.mode === "rename" ? projectPathDialog.node.name : ""}
            parentPath={projectPathDialog.parentPath}
            onClose={() => setProjectPathDialog(undefined)}
            onSave={saveProjectPathDialog}
          />
        )}
        {workspaceRootDialogOpen && (
          <WorkspaceRootDialog onClose={() => setWorkspaceRootDialogOpen(false)} onSave={addWorkspaceRoot} />
        )}
        {searchScope !== undefined && (
          <FindInFilesDialog
            client={clientRef.current!}
            rootAlias={workspaceRoots.find((root) => root.id === selectedRootId)?.alias ?? projectName}
            rootIds={workspaceRoots.map((root) => root.id)}
            rootAliases={Object.fromEntries(workspaceRoots.map((root) => [root.id, root.alias]))}
            scope={searchScope}
            queries={searchQueries}
            onQueriesChange={setSearchQueries}
            onClose={() => setSearchScope(undefined)}
            onNavigate={(result, matchLength) => void navigateToSearchResult(result, matchLength)}
          />
        )}
        {quickOpen && (
          <QuickOpenDialog
            files={workspaceFiles(tree)}
            onClose={() => setQuickOpen(false)}
            onOpen={(file) => {
              setQuickOpen(false);
              void openFile(file);
            }}
          />
        )}
        {workspaceSymbolsOpen && (
          <WorkspaceSymbolDialog
            search={searchWorkspaceSymbols}
            onClose={() => setWorkspaceSymbolsOpen(false)}
            onOpen={(symbol) => void openWorkspaceSymbol(symbol)}
          />
        )}
        {commandPaletteOpen && (
          <CommandPalette
            commands={commands}
            context={commandContext}
            bindings={shortcutBindings}
            platform={platform}
            onClose={() => setCommandPaletteOpen(false)}
          />
        )}
        {importChoices && (
          <div className="dialog-overlay" onMouseDown={() => setImportChoices(undefined)}>
            <section
              className="import-chooser"
              role="dialog"
              aria-modal="true"
              aria-label="Choose Java import"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <span>Import class</span>
                <button title="Close" onClick={() => setImportChoices(undefined)}>
                  <X size={15} />
                </button>
              </header>
              <div>
                {importChoices.suggestions.map((suggestion) => (
                  <button key={suggestion.qualifiedName} onClick={() => applyJavaImport(suggestion)}>
                    <span>{suggestion.simpleName}</span>
                    <code>{suggestion.qualifiedName}</code>
                    <small>{suggestion.source}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
        {javaUsages && (
          <div className="dialog-overlay" onMouseDown={() => setJavaUsages(undefined)}>
            <section
              className="import-chooser usage-chooser"
              role="dialog"
              aria-modal="true"
              aria-label="Java usages"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <span>Usages ({javaUsages.length})</span>
                <button title="Close" onClick={() => setJavaUsages(undefined)}>
                  <X size={15} />
                </button>
              </header>
              <div>
                {javaUsages.length === 0 ? (
                  <div className="problems-empty">No project usages found</div>
                ) : (
                  javaUsages.map((location, index) => (
                    <button
                      key={`${location.path}:${location.startLine}:${location.startColumn}:${index}`}
                      onClick={() => void openJavaLocation(location)}
                    >
                      <span>{location.path.split("/").pop()}</span>
                      <code>{location.path}</code>
                      <small>
                        {location.startLine}:{location.startColumn}
                      </small>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        {gitHistory && (
          <GitHistoryDialog
            client={clientRef.current!}
            path={gitHistory.path}
            startLine={gitHistory.startLine}
            endLine={gitHistory.endLine}
            content={gitHistory.content}
            onClose={() => setGitHistory(undefined)}
          />
        )}
        {gitRollbackDialog && (
          <RollbackSelectedDialog
            entries={gitRollbackDialog}
            busy={gitRollingBack}
            onClose={() => {
              if (!gitRollingBack) setGitRollbackDialog(undefined);
            }}
            onConfirm={(deleteUntracked) => void rollbackSelected(deleteUntracked)}
          />
        )}
        {gitRewriteDialog && (
          <GitHistoryRewriteDialog
            action={gitRewriteDialog.action}
            preview={gitRewriteDialog.preview}
            busy={gitCommitting}
            onClose={() => {
              if (!gitCommitting) setGitRewriteDialog(undefined);
            }}
            onConfirm={(confirmedRisk) => void executeHistoryRewrite(confirmedRisk)}
          />
        )}
        {gitStashDialog && clientRef.current && (
          <GitStashDialog
            client={clientRef.current}
            selectedPaths={[...selectedGitPaths]}
            onClose={() => setGitStashDialog(false)}
            onChanged={() => {
              void Promise.all([refreshGit(), refreshTree()]);
            }}
          />
        )}
        {gitConflictPath && clientRef.current && (
          <GitConflictWorkspaceDialog
            client={clientRef.current}
            initialPath={gitConflictPath}
            onClose={() => setGitConflictPath(undefined)}
            onChanged={() => {
              void Promise.all([refreshGit(), refreshTree()]);
            }}
          />
        )}
        {gitPullDialog && (
          <GitPullDialog
            preview={gitPullDialog.preview}
            busy={gitPulling}
            error={gitPullDialog.error}
            onClose={() => {
              if (!gitPulling) setGitPullDialog(undefined);
            }}
            onConfirm={(strategy) => void executePull(strategy)}
          />
        )}
        {gitRebaseDialog && (
          <GitRebaseDialog
            preview={gitRebaseDialog.preview}
            busy={gitRebasing}
            error={gitRebaseDialog.error}
            onClose={() => {
              if (!gitRebasing) setGitRebaseDialog(undefined);
            }}
            onConfirm={(items) => void executeInteractiveRebase(items)}
          />
        )}
        {gitHunkDialog && (
          <div className="context-menu-layer" onMouseDown={() => setGitHunkDialog(undefined)}>
            <section
              className="git-hunk-popup"
              role="dialog"
              aria-label={`Previous content in ${gitHunkDialog.path}`}
              style={{ left: gitHunkDialog.x, top: gitHunkDialog.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <strong>Before this change</strong>
                  <span>
                    {gitHunkDialog.path.split("/").pop()} · line {gitHunkDialog.hunk.originalStart}
                  </span>
                </div>
                <button title="Close" onClick={() => setGitHunkDialog(undefined)}>
                  <X size={14} />
                </button>
              </header>
              {gitHunkDialog.error && <div className="git-hunk-error">{gitHunkDialog.error}</div>}
              <pre>
                {gitHunkDialog.hunk.originalLines === 0
                  ? "This block did not exist before."
                  : gitHunkDialog.originalContent
                      .split("\n")
                      .slice(
                        Math.max(0, gitHunkDialog.hunk.originalStart - 1),
                        Math.max(0, gitHunkDialog.hunk.originalStart - 1) + gitHunkDialog.hunk.originalLines,
                      )
                      .join("\n")}
              </pre>
              <footer>
                {gitHunkDialog.hunk.source === "worktree" ? (
                  <button onClick={() => void updateGitIndex("stage", gitHunkDialog.path, gitHunkDialog.hunk)}>
                    <Check size={13} />
                    <span>Stage Hunk</span>
                  </button>
                ) : (
                  <button onClick={() => void updateGitIndex("unstage", gitHunkDialog.path, gitHunkDialog.hunk)}>
                    <X size={13} />
                    <span>Unstage Hunk</span>
                  </button>
                )}
                <button
                  className="danger"
                  disabled={gitHunkDialog.hunk.source !== "worktree"}
                  onClick={() => void rollbackGitHunk()}
                >
                  <RefreshCw size={13} />
                  <span>Rollback</span>
                </button>
              </footer>
            </section>
          </div>
        )}
        {externalConflict && (
          <ExternalChangeConflict
            dialog={externalConflict}
            onClose={() => setExternalConflict(undefined)}
            onReload={() => {
              updateGroup((tabs, active) => ({
                tabs: tabs.map((tab) =>
                  tab.id === externalConflict.tabId
                    ? {
                        ...tab,
                        content: externalConflict.externalContent,
                        savedContent: externalConflict.externalContent,
                        revision: externalConflict.externalRevision,
                        dirty: false,
                        error: undefined,
                      }
                    : tab,
                ),
                activeTabId: active,
              }));
              setExternalConflict(undefined);
            }}
            onOverwrite={() => {
              const tab = layoutRef.current.editorGroups[0]?.tabs.find((item) => item.id === externalConflict.tabId);
              if (!tab || !clientRef.current) return;
              void clientRef.current
                .request("filesystem.writeFile", {
                  path: externalConflict.path,
                  content: tab.content,
                  expectedRevision: externalConflict.externalRevision,
                  force: true,
                })
                .then((saved) => {
                  updateGroup((tabs, active) => ({
                    tabs: tabs.map((item) =>
                      item.id === tab.id
                        ? {
                            ...item,
                            savedContent: tab.content,
                            dirty: false,
                            revision: saved.revision,
                            error: undefined,
                          }
                        : item,
                    ),
                    activeTabId: active,
                  }));
                  setExternalConflict(undefined);
                })
                .catch((error: unknown) =>
                  setExternalConflict((current) =>
                    current
                      ? { ...current, error: error instanceof Error ? error.message : "Could not overwrite" }
                      : current,
                  ),
                );
            }}
            onSaveAs={(target) => {
              const tab = layoutRef.current.editorGroups[0]?.tabs.find((item) => item.id === externalConflict.tabId);
              if (!tab || !clientRef.current) return;
              void clientRef.current
                .request("filesystem.writeFile", { path: target, content: tab.content, create: true })
                .then(() => {
                  setExternalConflict(undefined);
                  void refreshTree();
                })
                .catch((error: unknown) =>
                  setExternalConflict((current) =>
                    current
                      ? { ...current, error: error instanceof Error ? error.message : "Could not save as" }
                      : current,
                  ),
                );
            }}
          />
        )}
        {ProjectConfigurationEditor && clientRef.current && (
          <ProjectConfigurationEditor
            key={`project-configuration:${selectedRootId}:${selectedTaskId ?? ""}:${runConfigurationEditor}`}
            client={clientRef.current}
            language={runConfigurationEditor}
            running={!!runProjectActions.processes[runConfigurationEditor ?? ""]?.running}
            onClose={() => setRunConfigurationEditor(undefined)}
            onSaved={() => {
              setRunConfigurationEditor(undefined);
              void refreshRunProjects();
              const client = clientRef.current;
              const root = client?.getRoot();
              const task = selectedTaskIdRef.current;
              void client
                ?.request("java.getOptions", {})
                .then(({ options }) => {
                  if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current) {
                    setJavaOptions(options);
                    javaOptionsRef.current = options;
                  }
                })
                .catch((error: unknown) => {
                  if (clientRef.current === client && client?.getRoot() === root && task === selectedTaskIdRef.current)
                    setStatusMessage(error instanceof Error ? error.message : "Could not refresh Java project");
                });
            }}
          />
        )}
        {showRunConfigurationDialog && (
          <JavaConfigurationDialog
            key={`java-configuration:${selectedRootId}`}
            client={clientRef.current!}
            running={javaRunning}
            onClose={() => setShowRunConfigurationDialog(false)}
            onSaved={(options) => {
              setJavaOptions(options);
              javaOptionsRef.current = options;
              setShowRunConfigurationDialog(false);
              void refreshJavaTree();
              void refreshTree();
            }}
          />
        )}
        {showCreateTaskDialog && (
          <CreateTaskDialog
            client={clientRef.current!}
            onClose={() => setShowCreateTaskDialog(false)}
            onCreate={createTask}
          />
        )}
        {mergeDialog && (
          <MergeTaskDialog
            task={mergeDialog}
            onClose={() => setMergeDialog(undefined)}
            onMerge={(strategy) => void mergeTask(mergeDialog, strategy)}
          />
        )}
        {usefulDialog && (
          <UsefulFileDialog
            mode={usefulDialog.mode}
            initialName={usefulDialog.file?.name ?? ""}
            scope={usefulDialog.scope}
            onClose={() => setUsefulDialog(undefined)}
            onSave={saveUsefulFileDialog}
          />
        )}
        {runConfigDialog && (
          <RunConfigDialog
            scope={runConfigDialog.scope}
            onClose={() => setRunConfigDialog(undefined)}
            onSave={async (name, commands) => {
              const config = (
                await clientRef.current!.request("runConfig.create", { scope: runConfigDialog.scope, name, commands })
              ).config;
              setRunConfigs((items) =>
                [...items, config].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope)),
              );
              setRunConfigDialog(undefined);
            }}
          />
        )}
        <DialogHost />
        {agentDialog && (
          <AgentDialog
            mode={agentDialog.mode}
            initialName={agentDialog.file?.name ?? ""}
            scope={agentDialog.scope}
            onClose={() => setAgentDialog(undefined)}
            onSave={saveAgentDialog}
          />
        )}
      </div>
    </AuthenticationClientContext.Provider>
  );
}

// Keep existing named imports working while components live in their domain modules.
export { TaskRow } from "./TaskRow";
export { TaskCheckpointHistory, CheckpointHandoff } from "./TaskCheckpointHistory";
export { keyboardResize, selectedLineRange } from "./editor-helpers";
