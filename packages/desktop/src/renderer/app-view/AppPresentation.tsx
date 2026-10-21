import { AppToolbar } from "./AppToolbar";
import { LeftWorkspaceSidebar } from "./LeftWorkspaceSidebar";
import { EditorWorkbench } from "./EditorWorkbench";
import { RightWorkspaceSidebar } from "./RightWorkspaceSidebar";
import { BottomWorkspacePanels } from "./BottomWorkspacePanels";
import { WorkspaceBottomToolbar } from "./WorkspaceBottomToolbar";

import { ExternalChangeConflict, ProjectPathDialog, WorkspaceRootDialog, RunConfigDialog } from "../WorkspaceDialogs";
import { MergeTaskDialog, CreateTaskDialog } from "../TaskDialogs";
import { AgentDialog } from "../AgentsPanel";
import { UsefulFileDialog } from "../UsefulFileSection";

import { ConnectionScreen } from "../ConnectionScreen";

import { AuthenticationClientContext } from "../AiAuthentication";

import { FocusDock } from "../FocusDock";

import { ContextMenu } from "../ContextMenu";

import {
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
  ClipboardCopy,
  Coffee,
  Columns2,
  EyeOff,
  File,
  FileDiff,
  FileText,
  Folder,
  GitBranch,
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
  Search,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";

import { DialogHost } from "../dialogs";

import { JavaConfigurationDialog } from "../plugins/languages/java";

import { projectRegistration } from "../run-projects";

import { GitHistoryDialog } from "../GitHistoryDialog";

import { RollbackSelectedDialog } from "../GitRollbackControls";

import { GitHistoryRewriteDialog } from "../GitHistoryRewriteDialog";
import { GitStashDialog } from "../GitStashDialog";
import { GitPullDialog } from "../GitPullDialog";
import { GitRebaseDialog } from "../GitRebaseDialog";

import { GitConflictWorkspaceDialog } from "../GitConflictWorkspace";

import { FindInFilesDialog } from "../FindInFilesDialog";

import { copyProjectTreeActions } from "../project-context-menu";
import { QuickOpenDialog, workspaceFiles } from "../QuickOpenDialog";
import { CommandPalette } from "../CommandPalette";
import { WorkspaceSymbolDialog } from "../WorkspaceSymbolDialog";

import { ModalFocusManager } from "../accessibility";
import { fileColorChoices } from "../app-shared";
import type { AppViewModel } from "../use-app-orchestration";
import { createAppViewParts } from "./AppViewParts";

export function AppPresentation({ model }: { model: AppViewModel }) {
  const context = { ...model, ...createAppViewParts(model) };
  const {
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
    taskHarnessRuns,
    openWorkflowTab,
    workflowDesignPanel,
    showWorkflowDesign,
    renderWorkflowPanel,
    workflowRunPanel,
    workflowPanels,
    processesPanel,
    triggersPanel,
    timersPanel,
    projectProcessStates,
    runProjectActions,
    rightBottomTools,
    ProjectConfigurationEditor,
  } = context;

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
        <AppToolbar context={context} />
        <div
          className={`workspace-row${leftSidebarExtended ? " extend-left" : ""}${rightSidebarExtended ? " extend-right" : ""}`}
        >
          <LeftWorkspaceSidebar context={context} />
          <EditorWorkbench context={context} />
          <RightWorkspaceSidebar context={context} />
          <BottomWorkspacePanels context={context} />
        </div>
        <FocusDock edge="bottom" active={focusMode}>
          <WorkspaceBottomToolbar context={context} />
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
            initialName={
              projectPathDialog.mode === "rename" ? (projectPathDialog.node.path.split("/").at(-1) ?? "") : ""
            }
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
