import { SidebarExtentButton } from "../SidebarExtentButton";

import { openWorkflowEditor } from "../workflow-tabs";

import { Bookmark, GraduationCap, Bot, Plug } from "lucide-react";
import type { HarnessDefinition } from "@hatopad/protocol";
import { workflowRunsForContext } from "../workflow-context";

import { type EditorTab } from "../model";

import { type RunProjectProcess } from "../run-projects";
import { GenericProjectConfigurationDialog } from "../GenericProjectConfigurationDialog";
import { projectConfigurationEditors } from "../plugins/languages/configuration-editors";

import { ProcessesPanel } from "../ProcessesPanel";
import { TimersPanel } from "../TimersPanel";
import { TriggersPanel } from "../TriggersPanel";
import { WorkflowRunPanel } from "../WorkflowRunPanel";
import { HarnessPanel } from "../HarnessPanel";

import type { AppViewModel } from "../use-app-orchestration";

export function createAppViewParts(model: AppViewModel) {
  const {
    mcpServers,
    refreshMcps,
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
  } = model;

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
      mcpServers={mcpServers}
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
          className={`tool-stripe-button right ${rightPanels.mcp ? "active" : ""}`}
          title={rightPanels.mcp ? "Hide MCP servers" : "Show MCP servers"}
          onClick={() => {
            setRightPanels((current) => ({ ...current, mcp: !current.mcp }));
            void refreshMcps();
          }}
        >
          <Plug size={15} />
          <span>MCP</span>
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
  return {
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
  };
}
