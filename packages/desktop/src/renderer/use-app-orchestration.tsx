import { useMcpLibrary } from "./use-mcp-library";
import type { McpSelection } from "@hatopad/protocol";
import { usePanelActions } from "./use-panel-actions";
import { useProjectFileActions } from "./use-project-file-actions";
import { useTerminalActions } from "./use-terminal-actions";
import { createDiffWriteGate, useEditorIntegration } from "./use-editor-integration";
import { useProjectTreeActions } from "./use-project-tree-actions";
import { useBranchActions } from "./use-branch-actions";
import { useLanguageProjectActions } from "./use-language-project-actions";
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
import { agentKey } from "./AgentsPanel";
import { ConnectionStatus } from "./ConnectionScreen";
import { gitHunkDecorations } from "./editor-helpers";
import { flushSync } from "react-dom";
import { startBackgroundLoading } from "./background-loading";
import { javaConfigurationPath } from "@hatopad/protocol";
import { type Monaco } from "@monaco-editor/react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiProvider,
  AiSession,
  GitDiffHunk,
  JavaProjectOptions,
  RunConfigScope,
  WorkspaceOptions,
} from "@hatopad/protocol";
import type { editor } from "monaco-editor";
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

import {
  readSetting,
  readSettingNumber,
  readWorkspaceSetting,
  workspaceSettingKey,
  writeSetting,
  writeWorkspaceSetting,
} from "./settings";
import { type DesktopSettings } from "./SettingsMenu";

import { editorTabLabel, initialLayout, type EditorTab, type LayoutModel, type Panel } from "./model";
import { clearViewedTerminalActivity, markTerminalActivity } from "./terminal-activity";
import { languageClient, loadJavaProjectTree } from "./language-client";
import { attachDebugEditor } from "./debug-editor";

import { selectedGitEntries, shouldApplyGitStatus } from "./GitRollbackControls";
import { type SkillsActions } from "./SkillsPanel";
import { workflowDocumentOptions, restoreWorkflowDocuments } from "./workflow-documents";

import { type HighlightTheme } from "./theme";
import { CURSOR_POSITIONS_SETTING, CursorPositionStore } from "./cursor-state";
import { restoredFocusedLeftPanels, initialTaskPanel } from "./task-panel-state";

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
import { type EditorStatusBarHandle } from "./EditorStatusBar";
import { adjacentEditorTabId, editorShortcutEligible, editorTabShortcut } from "./editor-shortcuts";
import { orderPinnedTabs, pinnedFilePaths } from "./pinned-tabs";
import { EditorViewStateStore } from "./editor-view-state";
import { reconcileProjectTree } from "./project-tree-reconciliation";
import { NavigationHistory, type EditorLocation } from "./navigation-history";
import {
  aiAgentTaskKey,
  aiProviderTaskKey,
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

export function useAppOrchestration() {
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
  const clientRef = useRef<CoreClient>();
  const { mcpServers, setMcpServers, refreshMcps, mcpActions, mcpLibraryAvailable, mcpUnavailableReason } =
    useMcpLibrary(clientRef);
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
  const diffWriteGate = useRef(createDiffWriteGate());
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
  const selectMcps = useCallback(
    async (selections: McpSelection[], editorEnabled: boolean) => {
      const client = clientRef.current;
      if (!client || !aiSession.id) return;
      const token = aiToken();
      if (!client.supports("mcp.library")) throw new Error("Update Core to use chat MCP controls.");
      const { session } = await client.request("ai.mcp", {
        provider: token.provider,
        sessionId: aiSession.id,
        selections,
        editorEnabled,
      });
      applyAiSession(session, token);
    },
    [aiSession.id, aiToken, applyAiSession],
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
    setMcpServers([]);
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
          [
            () => refreshAiSessions(client, stillCurrent),
            () => refreshHarnessRuns(client, stillCurrent),
            () => refreshMcps(client, stillCurrent),
          ],
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
          (canApply) => refreshMcps(client, canApply),
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
                        savedContent: result.modifiedContent,
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
            const selfWriteEnds = selfWriteUntil.current.get(openTab.path) ?? 0;
            if (selfWriteEnds > Date.now()) {
              // An external write inside the self-write window must still be reconciled once it closes.
              setTimeout(
                () => {
                  if (clientRef.current === client)
                    client.onServerEvent?.({
                      ...event,
                      payload: { ...event.payload, paths: [openTab.path], overflow: false },
                    });
                },
                selfWriteEnds - Date.now() + 50,
              );
              continue;
            }
            try {
              const result = await client.request("filesystem.readFile", { path: openTab.path });
              const latest = layoutRef.current.editorGroups[0]?.tabs.find((tab) => tab.id === openTab.id);
              if (latest?.revision && JSON.stringify(latest.revision) === JSON.stringify(result.revision)) continue;
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
            () => refreshMcps(client, canApply),
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
    selectedRootIdRef,
    selectedTaskIdRef,
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
    diffWriteGate,
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
  const {
    uploadToWorkspace,
    downloadFromWorkspace,
    cancelProjectTransfer,
    saveProjectPathDialog,
    deleteProjectPath,
    restoreLastDeleted,
  } = useProjectFileActions({
    clientRef,
    showStatus,
    tree,
    host,
    port,
    setProjectTransfer,
    projectTransfer,
    setStatusMessage,
    projectPathDialog,
    setProjectPathDialog,
    refreshTree,
    refreshGit,
    openFile,
    updateGroup,
    setFileColors,
    javaOptionsRef,
    setJavaOptions,
    refreshJavaTree,
    layoutRef,
    activeWorkspace,
    setLastDeleted,
    lastDeleted,
  });
  const {
    runJavaAction,
    stopJava,
    debugJava,
    applyJavaChanges,
    commandJavaDebugger,
    toggleBreakpoint,
    decorateBreakpoints,
    beginJavaResize,
    beginProblemsResize,
    beginGitLogResize,
    openDiagnostic,
    openJavaLocation,
    searchWorkspaceSymbols,
    openWorkspaceSymbol,
    applyJavaImport,
    refreshRunProjects,
    selectProjectRunConfiguration,
    registerRunProject,
    launchProjectConfiguration,
    stopProjectConfiguration,
  } = useLanguageProjectActions({
    setLayout,
    setJavaRunning,
    saveLaunchFiles,
    setJavaLog,
    setShowRunConfigurationDialog,
    clientRef,
    javaBreakpoints,
    setJavaDebugState,
    layoutRef,
    saveFileTab,
    setJavaBreakpoints,
    breakpointDecorationsRef,
    javaPanelHeight,
    setJavaPanelHeight,
    problemsHeight,
    setProblemsHeight,
    gitLogHeight,
    setGitLogHeight,
    selectedRootIdRef,
    selectWorkspaceRootRef,
    rememberNavigation,
    openFile,
    setPendingNavigation,
    setJavaUsages,
    setWorkspaceSymbolsOpen,
    importChoices,
    monacoEditorRef,
    setImportChoices,
    taskSwitchActive,
    selectedTaskIdRef,
    activeWorkspaceRef,
    runProjectGeneration,
    languages,
    setRunProjects,
    setSelectedLanguage,
    setRunProjectBusy,
    setJavaOptions,
    javaOptionsRef,
    setStatusMessage,
    setTreeContextMenu,
    refreshJavaTree,
    openRunConfigurations,
    refreshTree,
    runProjectBusy,
    runProjectProcesses,
    setRunProjectProcesses,
    openTerminalReference: (terminalId, title) => openTerminalReference(terminalId, title),
  });
  const {
    createTerminal,
    openTerminalReference,
    openHarnessAppTerminal,
    openRunConfigTerminal,
    runConfigAction,
    runMarkdownCommand,
    renderMarkdownPre,
    toggleTerminalPanel,
    closeTerminal,
    renameTerminal,
    duplicateTerminal,
    moveTerminal,
    beginTerminalResize,
  } = useTerminalActions({
    clientRef,
    updateTerminalGroup,
    selectedRootIdRef,
    setLayout,
    setStatusMessage,
    layoutRef,
    terminalBuffers,
    harnesses,
    setRunConfigMenu,
    setRunConfigs,
    markdownBlockTerminals,
    activeTab,
    layout,
    selectWorkspaceRootRef,
    runConfigs,
    refreshRunProjects,
    terminalHeight,
    setTerminalHeight,
  });

  const {
    openSearchForNode,
    transferProjectPaths,
    runProjectTreeAction,
    navigateToSearchResult,
    selectWorkspaceRoot,
    activateTerminalTab,
    addWorkspaceRoot,
    removeWorkspaceRoot,
  } = useProjectTreeActions({
    diffWriteGate,
    setTreeContextMenu,
    setSearchScope,
    clientRef,
    layoutRef,
    setStatusMessage,
    updateGroup,
    setProjectSelection,
    refreshTree,
    refreshGit,
    javaOptionsRef,
    refreshJavaTree,
    showStatus,
    openFile,
    activeWorkspace,
    setProjectPathDialog,
    deleteProjectPath,
    selectedRootIdRef,
    selectWorkspaceRootRef,
    rememberNavigation,
    setPendingNavigation,
    selectedRootId,
    invalidationRefreshes,
    setTaskSwitching,
    fileColors,
    gitCommitMessage,
    javaBreakpoints,
    searchQueries,
    showIgnoredRef,
    setSelectedRootId,
    setActiveWorkspace,
    activeWorkspaceRef,
    setProjectName,
    setTree,
    workspaceKeyRef,
    cursorPositions,
    setTasks,
    setSelectedTaskId,
    setGitEntries,
    setTaskGitEntries,
    setJavaOptions,
    setUsefulFiles,
    setRunConfigs,
    restoreWorkspaceOptions,
    refreshTasks,
    refreshAi,
    refreshUsefulFiles,
    refreshRunConfigs,
    refreshAgents,
    setStatus,
    updateTerminalGroup,
    setWorkspaceRoots,
    setWorkspaceRootDialogOpen,
    workspaceRoots,
  });
  selectWorkspaceRootRef.current = selectWorkspaceRoot;
  const rightSidebarOpen =
    rightPanels.project ||
    rightPanels.git ||
    rightPanels.useful ||
    rightPanels.agents ||
    rightPanels.skills ||
    rightPanels.mcp ||
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
  const {
    loadBranchMenu,
    toggleBranchMenu,
    checkoutBranch,
    renameBranch,
    createBranch,
    deleteBranch,
    publishBranch,
    setBranchUpstream,
  } = useBranchActions({
    setBranchMenu,
    clientRef,
    setStatusMessage,
    branchMenu,
    setGitBranch,
    refreshGit,
    refreshTree,
  });
  const { navigateHistory, runHttpRequest, mountEditor, mountWorkingDiff } = useEditorIntegration({
    navigationHistory,
    selectedRootIdRef,
    selectWorkspaceRootRef,
    openFile,
    setPendingNavigation,
    clientRef,
    setHttpResult,
    debugEditorRef,
    monacoEditorRef,
    activeTab,
    editorViewStates,
    editorStatusBarRef,
    monacoRef,
    gitDecorationsRef,
    activeGitHunksRef,
    javaLanguageDisposables,
    cursorPositions,
    javaDebugStateRef,
    breakpointDecorationsRef,
    decorateBreakpoints,
    setEditorGitMenu,
    gitEntries,
    openGitHunkDialog,
    highlightTheme,
    theme,
    refreshJavaSemanticRef,
    toggleBreakpoint,
    setJavaUsages,
    openJavaLocation,
    setStatusMessage,
    monacoDiffEditorRef,
    diffRollbackTimer,
    diffWriteGate,
    selectedTaskIdRef,
    layoutRef,
    selfWriteUntil,
    updateGroup,
    refreshGit,
    refreshTree,
  });
  const {
    beginLeftSidebarResize,
    beginRightSidebarResize,
    beginClassicLeftResize,
    beginClassicRightResize,
    beginClassicSplitResize,
    changeSideLayout,
    toggleJavaPanel,
    toggleProblemsPanel,
    toggleGitLogPanel,
  } = usePanelActions({
    setLeftSidebarWidth,
    setRightSidebarWidth,
    setClassicLeftWidth,
    setClassicRightWidth,
    setClassicSplit,
    setSideLayout,
    layout,
    setLayout,
    checkJava,
  });

  return {
    mcpLibraryAvailable,
    mcpUnavailableReason,
    mcpServers,
    refreshMcps,
    mcpActions,
    selectMcps,
    harnessRuns,
    workspaceRoots,
    selectedRootId,
    activeWorkspace,
    selectedTaskId,
    updateGroup,
    skillCatalog,
    refreshSkills,
    harnesses,
    harnessDiagnostics,
    aiProviders,
    agents,
    aiProvider,
    loadHarnessModels,
    validateHarnessDefinition,
    createHarness,
    readHarness,
    saveHarness,
    deleteHarness,
    runHarness,
    testHarnessBlock,
    killHarnessApp,
    readHarnessApp,
    readHarnessRun,
    chatHarness,
    steerHarnessChat,
    setHarnessAutopilot,
    openHarnessAppTerminal,
    appendHarnessRun,
    resolveHarnessPermission,
    answerHarnessQuestion,
    resumeHarnessPause,
    retryHarnessPause,
    cancelHarnessPause,
    cancelHarnessRun,
    deleteHarnessRun,
    setStatusMessage,
    sideLayout,
    classicSideView,
    workflowPanelMode,
    harnessesLoading,
    harnessRunsLoading,
    managedProcessList,
    processLoading,
    processError,
    status,
    taskSwitching,
    refreshProcesses,
    clientRef,
    triggers,
    tasks,
    loadScheduleAgents,
    loadActionModels,
    refreshAiStatuses,
    activeTimers,
    schedules,
    runProjectProcesses,
    javaRunning,
    runProjects,
    selectedLanguage,
    runProjectBusy,
    selectProjectRunConfiguration,
    setSelectedLanguage,
    setRunConfigurationEditor,
    launchProjectConfiguration,
    stopProjectConfiguration,
    rightPanels,
    setRightPanels,
    refreshUsefulFiles,
    refreshAgents,
    rightSidebarExtended,
    setRightSidebarExtended,
    runConfigurationEditor,
    host,
    port,
    statusMessage,
    setHost,
    setPort,
    connect,
    focusMode,
    statusKind,
    showStatus,
    recoveryRef,
    projectTransfer,
    cancelProjectTransfer,
    lastDeleted,
    restoreLastDeleted,
    setStatusMessageState,
    projectName,
    gitBranch,
    branchMenu,
    toggleBranchMenu,
    setBranchMenu,
    loadBranchMenu,
    createBranch,
    checkoutBranch,
    renameBranch,
    deleteBranch,
    publishBranch,
    setBranchUpstream,
    storageOpen,
    setStorageOpen,
    aiProvidersOpen,
    setAiProvidersOpen,
    refreshAiProviders,
    pluginsOpen,
    setPluginsOpen,
    toolsOpen,
    setToolsOpen,
    changeFocusMode,
    cloudConnection,
    launchConfig,
    disconnect,
    settingsOpen,
    setSettingsOpen,
    changeSideLayout,
    commands,
    shortcutBindings,
    platform,
    changeShortcut,
    resetShortcuts,
    theme,
    highlightTheme,
    uiFontFamily,
    uiFontWeight,
    uiFontSize,
    uiLineHeight,
    workspaceDefaultsRef,
    setTheme,
    setHighlightTheme,
    setUiFontFamily,
    setUiFontWeight,
    setUiFontSize,
    setUiLineHeight,
    setSettingsRevision,
    leftSidebarExtended,
    leftPanels,
    setLeftPanels,
    refreshAi,
    aiSession,
    setWorkflowPanelMode,
    refreshHarnesses,
    refreshHarnessRuns,
    setLeftSidebarExtended,
    leftSidebarWidth,
    setShowCreateTaskDialog,
    taskFilter,
    setTaskFilter,
    taskLifecycleFilter,
    setTaskLifecycleFilter,
    showRootTask,
    aiStatuses,
    openTask,
    timerAction,
    filteredTasks,
    emptyAiSummary,
    setTaskStatus,
    renameTask,
    setTaskArchived,
    setMergeDialog,
    deleteTask,
    selectedAgentKey,
    selectAgent,
    chatSession,
    aiSessions,
    aiModels,
    aiModelsLoading,
    aiUsage,
    currentAiAttachments,
    currentAiDraft,
    availableChatSkills,
    selectSkills,
    selectedTaskTimerActive,
    switchAiProvider,
    configureAi,
    updateAiAttachments,
    updateAiDraft,
    sendAiPrompt,
    sendAiPromptAsTask,
    steerAiPrompt,
    interruptAi,
    newAiSession,
    switchAiSession,
    removeAiSession,
    resolveAiPermission,
    answerAiQuestion,
    openAiFile,
    setLeftSidebarWidth,
    beginLeftSidebarResize,
    selectClassicSideView,
    refreshGit,
    gitEntries,
    refreshTaskGit,
    taskGitEntries,
    taskCheckpoints,
    javaOptions,
    refreshJavaTree,
    classicLeftWidth,
    showIgnored,
    toggleShowIgnored,
    refreshTree,
    projectFilter,
    projectContentFilter,
    setProjectFilter,
    projectContentFilterLoading,
    setProjectContentFilter,
    selectWorkspaceRoot,
    setWorkspaceRootDialogOpen,
    removeWorkspaceRoot,
    tree,
    javaTree,
    projectContentPaths,
    activeTab,
    projectSelection,
    fileColors,
    projectGitStatuses,
    runProjectTreeAction,
    setProjectSelection,
    setTreeContextMenu,
    setGitStashDialog,
    selectedRollbackEntries,
    gitOperationRunning,
    gitPushing,
    gitFetching,
    gitRollingBack,
    gitUpstream,
    openRollbackSelected,
    previewHistoryRewrite,
    pushGit,
    fetchGit,
    gitError,
    selectedGitPaths,
    setSelectedGitPaths,
    openDiff,
    setGitConflictPath,
    openFile,
    setGitRollbackMenu,
    gitCommitMessage,
    gitCommitting,
    setGitCommitMessage,
    commitSelectedFiles,
    commitAndPush,
    taskGitError,
    openTaskDiff,
    activeTaskRef,
    usefulFiles,
    openUsefulFile,
    setUsefulDialog,
    deleteUsefulFile,
    openAgentFile,
    setAgentDialog,
    deleteAgent,
    setClassicLeftWidth,
    beginClassicLeftResize,
    group,
    draggedTabId,
    setDraggedTabId,
    moveTab,
    setTabContextMenu,
    closeTab,
    activateEditorTab,
    saveActive,
    monacoEditorRef,
    setEditorGitMenu,
    setQuickOpen,
    mountWorkingDiff,
    editorFontFamily,
    editorLineHeight,
    monacoDiffEditorRef,
    renderMarkdownPre,
    openSkillFile,
    mountEditor,
    editorStatusBarRef,
    httpResult,
    setHttpResult,
    rightSidebarOpen,
    rightSidebarWidth,
    setRightSidebarWidth,
    beginRightSidebarResize,
    openCheckpointDiff,
    reviewCheckpointFile,
    restoreCheckpoint,
    followUpCheckpoint,
    selectedAgentReference,
    selectedSkillIds,
    skillActions,
    toggleFocusedTaskGit,
    classicTasksOpen,
    classicAiOpen,
    classicRightWidth,
    setClassicRightWidth,
    beginClassicRightResize,
    classicSplit,
    beginClassicSplitResize,
    setClassicTasksOpen,
    setClassicAiOpen,
    layout,
    terminalPanelOpen,
    markUnreadTerminalOutput,
    terminalFontFamily,
    terminalHeight,
    runConfigs,
    activateTerminalTab,
    createTerminal,
    closeTerminal,
    renameTerminal,
    duplicateTerminal,
    moveTerminal,
    updateTerminalGroup,
    beginTerminalResize,
    registerTerminalWriter,
    languages,
    javaPanelHeight,
    javaLog,
    javaDebugState,
    setShowRunConfigurationDialog,
    applyJavaChanges,
    runJavaAction,
    debugJava,
    stopJava,
    commandJavaDebugger,
    setJavaLog,
    beginJavaResize,
    setJavaPanelHeight,
    problemsHeight,
    javaDiagnostics,
    javaChecking,
    checkJava,
    openDiagnostic,
    beginProblemsResize,
    gitLogHeight,
    gitRevision,
    beginGitLogResize,
    toggleTerminalPanel,
    hasUnreadTerminalOutput,
    toggleJavaPanel,
    toggleProblemsPanel,
    toggleGitLogPanel,
    runConfigAction,
    setRunConfigMenu,
    treeContextMenu,
    openSearchForNode,
    uploadToWorkspace,
    downloadFromWorkspace,
    registerRunProject,
    addJavaSourceRoot,
    setFileColors,
    editorGitMenu,
    attachWorkspaceFile,
    setGitHistory,
    gitRollbackMenu,
    copyGitPath,
    updateGitIndex,
    ignoreGitPath,
    rollbackFile,
    tabContextMenu,
    toggleTabPin,
    closeTabs,
    openTabInWindow,
    runConfigMenu,
    projectPathDialog,
    setProjectPathDialog,
    saveProjectPathDialog,
    workspaceRootDialogOpen,
    addWorkspaceRoot,
    searchScope,
    searchQueries,
    setSearchQueries,
    setSearchScope,
    navigateToSearchResult,
    quickOpen,
    workspaceSymbolsOpen,
    searchWorkspaceSymbols,
    setWorkspaceSymbolsOpen,
    openWorkspaceSymbol,
    commandPaletteOpen,
    commandContext,
    setCommandPaletteOpen,
    importChoices,
    setImportChoices,
    applyJavaImport,
    javaUsages,
    setJavaUsages,
    openJavaLocation,
    gitHistory,
    gitRollbackDialog,
    setGitRollbackDialog,
    rollbackSelected,
    gitRewriteDialog,
    setGitRewriteDialog,
    executeHistoryRewrite,
    gitStashDialog,
    gitConflictPath,
    gitPullDialog,
    gitPulling,
    setGitPullDialog,
    executePull,
    gitRebaseDialog,
    gitRebasing,
    setGitRebaseDialog,
    executeInteractiveRebase,
    gitHunkDialog,
    setGitHunkDialog,
    rollbackGitHunk,
    externalConflict,
    setExternalConflict,
    layoutRef,
    refreshRunProjects,
    selectedTaskIdRef,
    setJavaOptions,
    javaOptionsRef,
    showRunConfigurationDialog,
    showCreateTaskDialog,
    createTask,
    mergeDialog,
    mergeTask,
    usefulDialog,
    saveUsefulFileDialog,
    runConfigDialog,
    setRunConfigDialog,
    setRunConfigs,
    agentDialog,
    saveAgentDialog,
  };
}

export type AppViewModel = ReturnType<typeof useAppOrchestration>;
