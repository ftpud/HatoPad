import { TaskRow, formatAiStatus } from "../TaskRow";
import { ResizablePanelStack } from "../ResizablePanelStack";
import { QuickFilter } from "../QuickFilter";
import { JavaProjectTree } from "../JavaProjectTree";
import { AgentsPanel, AgentPicker } from "../AgentsPanel";
import { UsefulFileSection } from "../UsefulFileSection";
import { GitChangesView } from "../GitChangesPanel";
import { keyboardResize } from "../editor-helpers";
import { SidebarExtentButton } from "../SidebarExtentButton";
import { FocusDock } from "../FocusDock";
import {
  Sparkles,
  History,
  Clock,
  Zap,
  Coffee,
  Eye,
  EyeOff,
  Folder,
  GitBranch,
  GitCompareArrows,
  ListTodo,
  Play,
  Plus,
  RefreshCw,
  SquareTerminal,
  Trash2,
  Workflow,
} from "lucide-react";
import { GitToolbarActions } from "../GitRollbackControls";
import { GitCommitPanel } from "../GitCommitPanel";
import { GitChangesView as KeyboardGitChangesView } from "../GitChangesView";
import { AiPanel } from "../AiPanel";
import { ProjectTree } from "../ProjectTree";
import { menuPosition } from "../menu-position";
import type { AppViewContext } from "./view-types";

export function LeftWorkspaceSidebar({ context }: { context: AppViewContext }) {
  const {
    workspaceRoots,
    selectedRootId,
    activeWorkspace,
    selectedTaskId,
    refreshSkills,
    aiProviders,
    agents,
    aiProvider,
    sideLayout,
    classicSideView,
    workflowPanelMode,
    managedProcessList,
    status,
    taskSwitching,
    refreshProcesses,
    triggers,
    tasks,
    activeTimers,
    schedules,
    rightPanels,
    setRightPanels,
    refreshUsefulFiles,
    refreshAgents,
    focusMode,
    gitBranch,
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
    showWorkflowDesign,
    workflowPanels,
    processesPanel,
    triggersPanel,
    timersPanel,
  } = context;
  return (
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
                {tasks.length > 0 && <span className="tool-badge">{tasks.length > 99 ? "99+" : tasks.length}</span>}
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
                  {managedProcessList.length > 0 && <span className="tool-badge">{managedProcessList.length}</span>}
                </button>
                <SidebarExtentButton edge="left" extended={leftSidebarExtended} onChange={setLeftSidebarExtended} />
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
                          onChange={(event) => setTaskLifecycleFilter(event.target.value as typeof taskLifecycleFilter)}
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
                        <span className={`ai-status ${aiSession.status}`}>{formatAiStatus(aiSession.status)}</span>
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
                    <span className="tool-badge">{taskGitEntries.length > 99 ? "99+" : taskGitEntries.length}</span>
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
                    <span className="tool-badge">{taskCheckpoints.length > 99 ? "99+" : taskCheckpoints.length}</span>
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
                  {managedProcessList.length > 0 && <span className="tool-badge">{managedProcessList.length}</span>}
                </button>
                <SidebarExtentButton edge="left" extended={leftSidebarExtended} onChange={setLeftSidebarExtended} />
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
                      ...menuPosition(event.clientX, event.clientY, 220, 290, window.innerWidth, window.innerHeight),
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
                        ...menuPosition(event.clientX, event.clientY, 220, 150, window.innerWidth, window.innerHeight),
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
                  {javaOptions && <JavaProjectTree nodes={javaTree} activePath={activeTab?.path} onOpen={openFile} />}
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
  );
}
