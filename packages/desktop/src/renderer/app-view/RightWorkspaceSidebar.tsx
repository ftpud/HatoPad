import { McpPanel } from "../McpPanel";
import { TaskCheckpointHistory } from "../TaskCheckpointHistory";
import { TaskRow, formatAiStatus } from "../TaskRow";
import { ResizablePanelStack } from "../ResizablePanelStack";
import { QuickFilter } from "../QuickFilter";
import { JavaProjectTree } from "../JavaProjectTree";
import { AgentsPanel, AgentPicker } from "../AgentsPanel";
import { UsefulFileSection } from "../UsefulFileSection";
import { GitChangesView } from "../GitChangesPanel";
import { keyboardResize } from "../editor-helpers";
import { FocusDock } from "../FocusDock";
import {
  Sparkles,
  History,
  Coffee,
  Eye,
  EyeOff,
  Folder,
  GitBranch,
  GitCompareArrows,
  ListTodo,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { GitToolbarActions } from "../GitRollbackControls";
import { GitCommitPanel } from "../GitCommitPanel";
import { GitChangesView as KeyboardGitChangesView } from "../GitChangesView";
import { SkillsPanel } from "../SkillsPanel";
import { AiPanel } from "../AiPanel";
import { ProjectTree } from "../ProjectTree";
import { menuPosition } from "../menu-position";
import type { AppViewContext } from "./view-types";

export function RightWorkspaceSidebar({ context }: { context: AppViewContext }) {
  const {
    mcpServers,
    mcpLibraryAvailable,
    mcpUnavailableReason,
    refreshMcps,
    mcpActions,
    selectMcps,
    workspaceRoots,
    selectedRootId,
    activeWorkspace,
    selectedTaskId,
    skillCatalog,
    refreshSkills,
    aiProviders,
    agents,
    aiProvider,
    sideLayout,
    status,
    taskSwitching,
    tasks,
    rightPanels,
    setRightPanels,
    refreshUsefulFiles,
    refreshAgents,
    focusMode,
    gitBranch,
    refreshAi,
    aiSession,
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
    refreshGit,
    gitEntries,
    refreshTaskGit,
    taskGitEntries,
    taskCheckpoints,
    javaOptions,
    refreshJavaTree,
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
    openSkillFile,
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
    rightBottomTools,
  } = context;
  return (
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
                    ...(rightPanels.mcp ? ["mcp"] : []),
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
                          if (file.scope !== "workspace") setAgentDialog({ mode: "rename", scope: file.scope, file });
                        }}
                        onDelete={(file) => void deleteAgent(file)}
                      />
                    </section>
                  )}
                  {rightPanels.mcp && (
                    <section key="mcp" className="stacked-panel">
                      <McpPanel
                        key={selectedRootId}
                        servers={mcpServers}
                        unavailableReason={mcpUnavailableReason}
                        actions={mcpActions}
                        onRefresh={() => refreshMcps()}
                        disabled={taskSwitching}
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
                    <span className="tool-badge">{taskGitEntries.length > 99 ? "99+" : taskGitEntries.length}</span>
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
                    <span className="tool-badge">{taskCheckpoints.length > 99 ? "99+" : taskCheckpoints.length}</span>
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
            rightPanels.mcp ||
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
                        if (file.scope !== "workspace") setAgentDialog({ mode: "rename", scope: file.scope, file });
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
                      mcpServers={mcpServers}
                      onMcpChange={mcpLibraryAvailable ? selectMcps : undefined}
                      onOpenMcps={() => {
                        setRightPanels((current) => ({ ...current, mcp: true }));
                        void refreshMcps();
                      }}
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
                {rightPanels.mcp && (
                  <section className="stacked-panel">
                    <McpPanel
                      key={selectedRootId}
                      servers={mcpServers}
                      unavailableReason={mcpUnavailableReason}
                      actions={mcpActions}
                      onRefresh={() => refreshMcps()}
                      disabled={taskSwitching}
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
                {tasks.length > 0 && <span className="tool-badge">{tasks.length > 99 ? "99+" : tasks.length}</span>}
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
  );
}
