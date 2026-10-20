import { useCallback, useMemo } from "react";
import {
  type AiProvider,
  resolveSkillIds,
  skillAllowedForAgent,
  type AiConfiguration,
  type TaskCheckpoint,
  type AiSession,
  type AiModel,
  type AiUsage,
  type AiProviderDescriptor,
  type GitStatusEntry,
  type GitUpstreamStatus,
  type RunConfig,
  type JavaProjectOptions,
  type FileColor,
  type JavaBreakpoint,
  type WorkspaceSearchQueries,
  type WorkspaceTask,
  type FileTreeNode,
  type JavaProjectNode,
  type JavaDebugState,
  type RootedJavaDiagnostic,
  type WorkspaceOptions,
  type AgentFile,
  type SkillCatalog,
} from "@hatopad/protocol";
import { aiProviderTaskKey, aiAgentTaskKey, type AiSnapshotToken, type StatusKind } from "./app-shared";
import { readSetting, workspaceSettingKey, writeWorkspaceSetting } from "./settings";
import { workflowDocumentOptions } from "./workflow-documents";
import { pinnedFilePaths } from "./pinned-tabs";
import { switchedTaskPanel, type ClassicTaskPanel, taskPanelPreferenceKey } from "./task-panel-state";
import { loadJavaProjectTree } from "./language-client";
import { openTaskFromSummary } from "./permission-navigation";
import { readAiPromptDraft, writeAiPromptDraft } from "./ai-prompt-drafts";
import { agentKey } from "./AgentsPanel";
import { type AiAttachment } from "./AiPanel";
import { type PermissionRequestOwner } from "./PermissionRequestActions";
import { type CoreClient } from "./client";
import { type InvalidationRefreshes } from "./invalidation-refreshes";
import { type LayoutModel, type EditorTab } from "./model";
import { type CursorPositionStore } from "./cursor-state";
import { type ConnectionStatus } from "./ConnectionScreen";

export interface AiActionsDeps {
  selectedTaskIdRef: React.MutableRefObject<string | undefined>;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  wsSave: (key: string, value: string) => void;
  aiProviderRef: React.MutableRefObject<string>;
  setAiProvider: React.Dispatch<React.SetStateAction<string>>;
  setAiModelsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  aiToken: () => AiSnapshotToken;
  workspaceKeyRef: React.MutableRefObject<string>;
  applyAiSession: (session: AiSession, token: AiSnapshotToken) => boolean;
  setAiModels: React.Dispatch<React.SetStateAction<AiModel[]>>;
  setAiUsage: React.Dispatch<React.SetStateAction<AiUsage | undefined>>;
  refreshAiSessions: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  setStatusMessage: (message: string) => void;
  setAiProviders: React.Dispatch<React.SetStateAction<AiProviderDescriptor[]>>;
  taskSwitchActive: React.MutableRefObject<boolean>;
  queuedTaskSwitch: React.MutableRefObject<string | null | undefined>;
  invalidationRefreshes: React.MutableRefObject<InvalidationRefreshes | undefined>;
  taskSwitchSequence: React.MutableRefObject<number>;
  gitStatusRequested: React.MutableRefObject<number>;
  setGitEntries: React.Dispatch<React.SetStateAction<GitStatusEntry[]>>;
  setGitUpstream: React.Dispatch<React.SetStateAction<GitUpstreamStatus | undefined>>;
  setGitError: React.Dispatch<React.SetStateAction<string>>;
  setRunConfigs: React.Dispatch<React.SetStateAction<RunConfig[]>>;
  setTaskSwitching: React.Dispatch<React.SetStateAction<boolean>>;
  setRightPanels: React.Dispatch<
    React.SetStateAction<{
      project: boolean;
      git: boolean;
      taskGit: boolean;
      promptHistory: boolean;
      java: boolean;
      useful: boolean;
      agents: boolean;
      skills: boolean;
    }>
  >;
  setWorkspaceOptionsReady: React.Dispatch<React.SetStateAction<boolean>>;
  layoutRef: React.MutableRefObject<LayoutModel>;
  saveFileTab: (current: EditorTab) => Promise<boolean>;
  selectedRootIdRef: React.MutableRefObject<string>;
  javaOptionsRef: React.MutableRefObject<JavaProjectOptions | undefined>;
  fileColors: Record<string, FileColor>;
  gitCommitMessage: string;
  javaBreakpoints: JavaBreakpoint[];
  searchQueries: WorkspaceSearchQueries;
  showIgnoredRef: React.MutableRefObject<boolean>;
  terminalWriters: React.MutableRefObject<Map<string, (data: string, replay?: boolean) => void>>;
  terminalBuffers: React.MutableRefObject<Map<string, string>>;
  markdownBlockTerminals: React.MutableRefObject<Map<string, string>>;
  setLayout: React.Dispatch<React.SetStateAction<LayoutModel>>;
  setTasks: React.Dispatch<React.SetStateAction<WorkspaceTask[]>>;
  setSelectedTaskId: React.Dispatch<React.SetStateAction<string | undefined>>;
  activeTaskRef: React.MutableRefObject<WorkspaceTask | undefined>;
  setTree: React.Dispatch<React.SetStateAction<FileTreeNode[]>>;
  setClassicSideView: React.Dispatch<React.SetStateAction<ClassicTaskPanel>>;
  setActiveWorkspace: React.Dispatch<React.SetStateAction<string>>;
  activeWorkspaceRef: React.MutableRefObject<string>;
  cursorPositions: CursorPositionStore;
  setProjectName: React.Dispatch<React.SetStateAction<string>>;
  setJavaOptions: React.Dispatch<React.SetStateAction<JavaProjectOptions | undefined>>;
  setJavaTree: React.Dispatch<React.SetStateAction<JavaProjectNode[]>>;
  setJavaRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setJavaDebugState: React.Dispatch<React.SetStateAction<JavaDebugState>>;
  setJavaLog: React.Dispatch<React.SetStateAction<string>>;
  setJavaDiagnostics: React.Dispatch<React.SetStateAction<RootedJavaDiagnostic[]>>;
  restoreWorkspaceOptions: (
    options: WorkspaceOptions,
    client: CoreClient,
    rootId?: string,
    recovery?: boolean,
    signal?: AbortSignal,
  ) => Promise<void>;
  aiProviders: AiProviderDescriptor[];
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  refreshAi: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshTaskGit: (task?: WorkspaceTask | undefined, client?: CoreClient | undefined) => Promise<void>;
  refreshRunConfigs: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshAgents: (
    client?: CoreClient | undefined,
    taskId?: string | undefined,
    canApply?: () => boolean,
  ) => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  switchTaskRef: React.MutableRefObject<(taskId?: string) => Promise<void>>;
  sideLayout: "classic" | "ai-focused";
  setClassicAiOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setLeftPanels: React.Dispatch<
    React.SetStateAction<{
      tasks: boolean;
      ai: boolean;
      harness: boolean;
      timers: boolean;
      triggers: boolean;
      proc: boolean;
    }>
  >;
  selectedTaskId: string | undefined;
  aiAttachments: Record<string, AiAttachment[]>;
  aiProvider: string;
  aiSession: AiSession;
  agents: AgentFile[];
  selectedAgentKey: string;
  skillCatalog: SkillCatalog;
  setSelectedAgentKey: React.Dispatch<React.SetStateAction<string>>;
  setAiAttachments: React.Dispatch<React.SetStateAction<Record<string, AiAttachment[]>>>;
  setEditorGitMenu: React.Dispatch<
    React.SetStateAction<
      { x: number; y: number; path: string; startLine?: number; endLine?: number; content?: string } | undefined
    >
  >;
  refreshAiStatuses: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  showStatus: (message: string, kind: StatusKind) => void;
}

/** Moved from App; statement bodies are unchanged. */
export function useAiActions(deps: AiActionsDeps) {
  const {
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
  } = deps;
  // `taskId` is passed explicitly because task switching changes the selected task and the provider
  // in the same pass: reading it from state here would remember the provider under the previous task.
  const switchAiProvider = useCallback(
    async (provider: AiProvider, taskId = selectedTaskIdRef.current) => {
      if (!clientRef.current) return;
      wsSave("aiProvider", provider);
      wsSave(aiProviderTaskKey(taskId), provider);
      if (provider === aiProviderRef.current) return;
      aiProviderRef.current = provider;
      setAiProvider(provider);
      setAiModelsLoading(true);
      const token = aiToken();
      try {
        const [sessionResult, models] = await Promise.all([
          clientRef.current.request("ai.get", { provider }),
          clientRef.current.request("ai.models", { provider }),
        ]);
        let session = sessionResult.session;
        const workspace = workspaceKeyRef.current;
        const savedModel = workspace ? readSetting(workspaceSettingKey(workspace, `ai.${provider}.model`)) : null;
        const savedReasoning = workspace
          ? readSetting(workspaceSettingKey(workspace, `ai.${provider}.reasoning`))
          : null;
        if (savedModel && models.models.some((model) => model.id === savedModel)) {
          const model = models.models.find((item) => item.id === savedModel)!;
          const reasoning =
            savedReasoning && model.reasoningLevels.includes(savedReasoning) ? savedReasoning : model.defaultReasoning;
          if (session.status !== "in_progress" && (session.model !== savedModel || session.reasoning !== reasoning))
            session = (await clientRef.current.request("ai.configure", { provider, model: savedModel, reasoning }))
              .session;
        }
        if (!applyAiSession(session, { ...token, provider })) return;
        setAiModels(models.models);
        const usage = (await clientRef.current.request("ai.usage", { provider })).usage;
        if (provider !== aiProviderRef.current) return;
        setAiUsage(usage);
        await refreshAiSessions();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not switch AI provider");
      } finally {
        if (aiProviderRef.current === provider) setAiModelsLoading(false);
      }
    },
    [aiToken, applyAiSession, refreshAiSessions],
  );
  // Only installed providers are offered; follow installs, updates and removals from Settings → AI providers.
  const refreshAiProviders = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const { providers } = await client.request("ai.providers", {});
      setAiProviders(providers);
      const current = aiProviderRef.current;
      if (providers.length && !providers.some((item) => item.id === current)) {
        await switchAiProvider(providers[0]!.id);
        return;
      }
      if (providers.some((item) => item.id === current)) {
        const { models } = await client.request("ai.models", { provider: current });
        if (aiProviderRef.current === current) setAiModels(models);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not refresh AI providers");
    }
  }, [switchAiProvider]);

  const switchTask = useCallback(
    async (taskId?: string) => {
      if (!clientRef.current) return;
      if (taskSwitchActive.current) {
        queuedTaskSwitch.current = taskId;
        return;
      }
      if (taskId === selectedTaskIdRef.current) return;
      invalidationRefreshes.current?.reset();
      const client = clientRef.current;
      const sequence = ++taskSwitchSequence.current;
      const isCurrent = () => taskSwitchSequence.current === sequence && clientRef.current === client;
      taskSwitchActive.current = true;
      gitStatusRequested.current += 1;
      setGitEntries([]);
      setGitUpstream(undefined);
      setGitError("");
      setRunConfigs([]);
      setTaskSwitching(true);
      setRightPanels((current) => ({ ...current, promptHistory: false }));
      setWorkspaceOptionsReady(false);
      setStatusMessage("");
      try {
        const currentGroup = layoutRef.current.editorGroups[0]!;
        for (const tab of currentGroup.tabs) if (tab.type === "file" && tab.dirty) await saveFileTab(tab);
        const currentFiles = currentGroup.tabs.filter((tab) => tab.type === "file");
        const currentTerminal = layoutRef.current.terminalGroup;
        const currentActiveTerminalIndex = currentTerminal.tabs.findIndex(
          (tab) => tab.id === currentTerminal.activeTabId,
        );
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
              ...(currentActiveTerminalIndex >= 0 ? { activeTabIndex: currentActiveTerminalIndex } : {}),
              panelOpen: layoutRef.current.panels.some((panel) => panel.type === "terminal"),
            },
            ...(Object.keys(fileColors).length ? { fileColors } : {}),
            ...(gitCommitMessage ? { gitCommitMessage } : {}),
            javaBreakpoints,
            ...(Object.keys(searchQueries).length ? { searchQueries } : {}),
          },
        });
        if (!isCurrent()) return;
        const result = await client.request("tasks.switch", {
          ...(taskId ? { taskId } : {}),
          includeIgnored: showIgnoredRef.current,
        });
        if (!isCurrent()) return;
        terminalWriters.current.clear();
        terminalBuffers.current.clear();
        markdownBlockTerminals.current.clear();
        setLayout((current) => {
          const tabs = current.terminalGroup.tabs.filter(
            (tab) => tab.rootId && tab.rootId !== selectedRootIdRef.current,
          );
          return {
            ...current,
            panels: current.panels.filter((panel) => !["terminal", "languageOutput", "problems"].includes(panel.type)),
            terminalGroup: { ...current.terminalGroup, tabs, activeTabId: tabs[0]?.id },
          };
        });
        setTasks(result.tasks);
        setSelectedTaskId(result.selectedTaskId);
        selectedTaskIdRef.current = result.selectedTaskId;
        activeTaskRef.current = result.tasks.find((task) => task.id === result.selectedTaskId);
        setTree(result.tree);
        const switchedPanel = switchedTaskPanel(result.selectedTaskId);
        if (switchedPanel.classic) setClassicSideView(switchedPanel.classic);
        if (switchedPanel.focusedTaskGit) setRightPanels((current) => ({ ...current, taskGit: true }));
        if (!result.selectedTaskId) {
          setRightPanels((current) => ({ ...current, taskGit: false }));
          setClassicSideView((current) => (current === "taskGit" ? "project" : current));
        }
        setActiveWorkspace(result.workspace);
        activeWorkspaceRef.current = result.workspace;
        cursorPositions.setWorkspace(result.workspace);
        setProjectName(result.projectName);
        setJavaOptions(result.options.javaProject);
        setJavaTree([]);
        setJavaRunning(false);
        setJavaDebugState({ status: "stopped", variables: [] });
        setJavaLog("");
        setJavaDiagnostics([]);
        if (result.options.javaProject) setJavaTree(await loadJavaProjectTree(client));
        if (!isCurrent()) return;
        await restoreWorkspaceOptions(result.options, client);
        if (!isCurrent()) return;
        const nextTask = result.tasks.find((task) => task.id === result.selectedTaskId);
        const savedProvider = workspaceKeyRef.current
          ? (readSetting(
              workspaceSettingKey(workspaceKeyRef.current, aiProviderTaskKey(result.selectedTaskId)),
            ) as AiProvider | null)
          : null;
        const nextProvider =
          savedProvider && aiProviders.some((item) => item.id === savedProvider)
            ? savedProvider
            : aiProviderRef.current;
        await switchAiProvider(nextProvider, result.selectedTaskId);
        await Promise.all([
          refreshGit(),
          refreshAi(),
          refreshAiSessions(),
          refreshTaskGit(nextTask),
          refreshRunConfigs(client),
          refreshAgents(clientRef.current, result.selectedTaskId),
        ]);
        if (isCurrent()) invalidationRefreshes.current?.refreshConfiguration();
        if (isCurrent() && client.isConnected()) setStatus("connected");
      } catch (error) {
        if (!isCurrent()) return;
        setWorkspaceOptionsReady(true);
        setStatusMessage(error instanceof Error ? error.message : "Could not switch task");
      } finally {
        if (isCurrent()) {
          taskSwitchActive.current = false;
          setTaskSwitching(false);
          const queued = queuedTaskSwitch.current;
          queuedTaskSwitch.current = null;
          if (queued !== null && queued !== selectedTaskIdRef.current) switchTaskRef.current(queued);
        }
      }
    },
    [
      aiProviders,
      fileColors,
      gitCommitMessage,
      refreshAgents,
      refreshAi,
      refreshAiSessions,
      refreshGit,
      refreshTaskGit,
      restoreWorkspaceOptions,
      saveFileTab,
      searchQueries,
      javaBreakpoints,
      switchAiProvider,
    ],
  );
  switchTaskRef.current = switchTask;

  const selectClassicSideView = useCallback((view: ClassicTaskPanel) => {
    setClassicSideView(view);
    const taskId = selectedTaskIdRef.current;
    if (taskId && workspaceKeyRef.current)
      writeWorkspaceSetting(workspaceKeyRef.current, taskPanelPreferenceKey("classic", taskId), view);
  }, []);

  const toggleFocusedTaskGit = useCallback(() => {
    setRightPanels((current) => {
      const open = !current.taskGit;
      const taskId = selectedTaskIdRef.current;
      if (taskId && workspaceKeyRef.current)
        writeWorkspaceSetting(
          workspaceKeyRef.current,
          taskPanelPreferenceKey("ai-focused", taskId),
          open ? "open" : "closed",
        );
      if (open) void refreshTaskGit();
      return { ...current, taskGit: open };
    });
  }, [refreshTaskGit]);

  const openTask = useCallback(
    (taskId?: string, pendingPermission = false) => {
      openTaskFromSummary({
        taskId,
        pendingPermission,
        sideLayout,
        openClassicAi: () => setClassicAiOpen(true),
        openFocusedAi: () =>
          setLeftPanels((current) => ({
            ...current,
            tasks: true,
            ai: true,
            harness: false,
            timers: false,
            triggers: false,
            proc: false,
          })),
        switchTask: (id) => void switchTask(id),
      });
    },
    [sideLayout, switchTask],
  );

  const currentAiAttachmentKey = selectedTaskId ?? "root";
  const currentAiAttachments = aiAttachments[currentAiAttachmentKey] ?? [];
  const currentAiDraft = readAiPromptDraft(workspaceKeyRef.current, selectedTaskId, aiProvider, aiSession.id);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agentKey(agent) === selectedAgentKey),
    [agents, selectedAgentKey],
  );
  const selectedAgentReference = selectedAgent ? { scope: selectedAgent.scope, name: selectedAgent.name } : null;
  const selectedSkillIds = useMemo(
    () => resolveSkillIds(skillCatalog, aiSession.skillIds ?? []),
    [skillCatalog, aiSession.skillIds],
  );
  const chatSession = { ...aiSession, skillIds: selectedSkillIds };
  const availableChatSkills = skillCatalog.skills.filter((skill) =>
    skillAllowedForAgent(skillCatalog.policy, skill.id, selectedAgentReference),
  );
  const selectAgent = useCallback((key: string) => {
    setSelectedAgentKey(key);
    if (workspaceKeyRef.current)
      writeWorkspaceSetting(workspaceKeyRef.current, aiAgentTaskKey(selectedTaskIdRef.current), key);
  }, []);
  const updateAiDraft = useCallback(
    (draft: string) =>
      writeAiPromptDraft(
        workspaceKeyRef.current,
        selectedTaskIdRef.current,
        aiProviderRef.current,
        aiSession.id,
        draft,
      ),
    [aiSession.id],
  );
  const updateAiAttachments = useCallback(
    (attachments: AiAttachment[]) =>
      setAiAttachments((current) => ({ ...current, [selectedTaskId ?? "root"]: attachments })),
    [selectedTaskId],
  );
  const attachWorkspaceFile = useCallback(
    (path: string) => {
      const key = selectedTaskId ?? "root";
      setAiAttachments((current) => {
        const attachments = current[key] ?? [];
        if (attachments.some((item) => item.path === path)) return current;
        return {
          ...current,
          [key]: [...attachments, { id: `workspace:${path}`, name: path.split("/").pop() ?? path, path }],
        };
      });
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
      setEditorGitMenu(undefined);
    },
    [refreshAi, selectedTaskId, sideLayout],
  );
  const sendAiPrompt = useCallback(
    async (prompt: string, configuration: AiConfiguration, attachments: AiAttachment[]) => {
      if (!clientRef.current) return;
      const content = attachments.map((attachment) =>
        attachment.path
          ? { type: "resource_link" as const, uri: `workspace:${attachment.path}`, name: attachment.name }
          : attachment.data && attachment.mimeType
            ? { type: "image" as const, data: attachment.data, mimeType: attachment.mimeType, name: attachment.name }
            : {
                type: "resource" as const,
                uri: `attachment:${encodeURIComponent(attachment.name)}`,
                mimeType: attachment.mimeType,
                text: attachment.content ?? "",
                name: attachment.name,
              },
      );
      const token = aiToken();
      try {
        applyAiSession(
          (
            await clientRef.current.request("ai.send", {
              provider: aiProviderRef.current,
              prompt,
              content,
              configuration,
              ...(selectedAgent
                ? { agent: selectedAgent.agent, agentPreset: { scope: selectedAgent.scope, name: selectedAgent.name } }
                : {}),
            })
          ).session,
          token,
        );
        await Promise.all([refreshAi(), refreshAiSessions()]);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : `Could not start ${aiProviderRef.current}`);
        throw error;
      }
    },
    [aiToken, applyAiSession, refreshAi, refreshAiSessions, selectedAgent],
  );
  const sendAiPromptAsTask = useCallback(
    async (prompt: string, configuration: AiConfiguration, attachments: AiAttachment[]) => {
      if (!clientRef.current || selectedTaskIdRef.current) return;
      const content = attachments.map((attachment) =>
        attachment.path
          ? { type: "resource_link" as const, uri: `workspace:${attachment.path}`, name: attachment.name }
          : attachment.data && attachment.mimeType
            ? { type: "image" as const, data: attachment.data, mimeType: attachment.mimeType, name: attachment.name }
            : {
                type: "resource" as const,
                uri: `attachment:${encodeURIComponent(attachment.name)}`,
                mimeType: attachment.mimeType,
                text: attachment.content ?? "",
                name: attachment.name,
              },
      );
      try {
        const { task } = await clientRef.current.request("tasks.createFromPrompt", {
          provider: aiProviderRef.current,
          prompt,
          content,
          configuration,
          skillIds: selectedSkillIds.filter((id) => availableChatSkills.some((skill) => skill.id === id)),
          ...(selectedAgent
            ? { agent: selectedAgent.agent, agentPreset: { scope: selectedAgent.scope, name: selectedAgent.name } }
            : {}),
        });
        setTasks((current) => [...current, task]);
        await refreshAiStatuses();
        showStatus(`Started ${task.branch}`, "success");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not start a new task");
        throw error;
      }
    },
    [selectedSkillIds, availableChatSkills, refreshAiStatuses, selectedAgent, showStatus],
  );
  const resolveAiPermission = useCallback(
    async (owner: PermissionRequestOwner, requestId: string, optionId?: string) => {
      if (!clientRef.current) return;
      const isActiveOwner = owner.taskId === selectedTaskIdRef.current && owner.provider === aiProviderRef.current;
      const token = isActiveOwner ? aiToken() : undefined;
      try {
        const result = await clientRef.current.request("ai.permission.resolve", {
          provider: owner.provider,
          requestId,
          optionId,
          target: {
            ...(owner.taskId ? { taskId: owner.taskId } : {}),
            ...(owner.sessionId ? { sessionId: owner.sessionId } : {}),
          },
        });
        if (token) applyAiSession(result.session, token);
        await refreshAiStatuses();
      } catch (error) {
        // A second window or the provider may have resolved the request first. Refreshing removes a
        // stale card; if it is still pending the card remains enabled and displays this error.
        await Promise.all([
          refreshAiStatuses().catch(() => undefined),
          isActiveOwner ? refreshAi().catch(() => undefined) : Promise.resolve(),
        ]);
        setStatusMessage(error instanceof Error ? error.message : "Could not resolve permission request");
        throw error;
      }
    },
    [aiToken, applyAiSession, refreshAi, refreshAiStatuses, setStatusMessage],
  );
  const answerAiQuestion = useCallback(
    async (
      owner: PermissionRequestOwner,
      requestId: string,
      action: import("@hatopad/protocol").AiQuestionAction,
      answer?: import("@hatopad/protocol").AiQuestionAnswer,
    ) => {
      if (!clientRef.current) return;
      const isActiveOwner = owner.taskId === selectedTaskIdRef.current && owner.provider === aiProviderRef.current;
      const token = isActiveOwner ? aiToken() : undefined;
      try {
        const result = await clientRef.current.request("ai.question.answer", {
          provider: owner.provider,
          requestId,
          action,
          ...(answer ? { answer } : {}),
          target: {
            ...(owner.taskId ? { taskId: owner.taskId } : {}),
            ...(owner.sessionId ? { sessionId: owner.sessionId } : {}),
          },
        });
        if (token) applyAiSession(result.session, token);
        await refreshAiStatuses();
      } catch (error) {
        await Promise.all([
          refreshAiStatuses().catch(() => undefined),
          isActiveOwner ? refreshAi().catch(() => undefined) : Promise.resolve(),
        ]);
        setStatusMessage(error instanceof Error ? error.message : "Could not answer the question");
        throw error;
      }
    },
    [aiToken, applyAiSession, refreshAi, refreshAiStatuses, setStatusMessage],
  );
  const steerAiPrompt = useCallback(
    async (prompt: string) => {
      if (!clientRef.current) return;
      const token = aiToken();
      try {
        applyAiSession(
          (await clientRef.current.request("ai.steer", { provider: aiProviderRef.current, prompt })).session,
          token,
        );
        await refreshAi();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not add input to the running turn");
        throw error;
      }
    },
    [aiToken, applyAiSession, refreshAi],
  );
  const followUpCheckpoint = useCallback(
    (checkpoint: TaskCheckpoint) => {
      updateAiDraft(`Review the changes from this checkpoint and continue: ${checkpoint.prompt}`);
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
    },
    [sideLayout, updateAiDraft],
  );
  const configureAi = useCallback(
    async (configuration: AiConfiguration) => {
      if (!clientRef.current) return;
      const token = aiToken();
      try {
        applyAiSession(
          (await clientRef.current.request("ai.configure", { provider: aiProviderRef.current, configuration })).session,
          token,
        );
        if (typeof configuration.model === "string") wsSave(`ai.${aiProviderRef.current}.model`, configuration.model);
        if (typeof configuration.reasoning === "string")
          wsSave(`ai.${aiProviderRef.current}.reasoning`, configuration.reasoning);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not save AI settings");
      }
    },
    [aiToken, applyAiSession],
  );

  const newAiSession = useCallback(async () => {
    if (!clientRef.current) return;
    const token = aiToken();
    try {
      applyAiSession((await clientRef.current.request("ai.clear", { provider: aiProviderRef.current })).session, token);
      await Promise.all([refreshAi(), refreshAiSessions()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not start a new AI session");
    }
  }, [aiToken, applyAiSession, refreshAi, refreshAiSessions]);

  const switchAiSession = useCallback(
    async (session: AiSession) => {
      if (!clientRef.current || !session.id) return;
      const token = aiToken();
      try {
        applyAiSession(
          (await clientRef.current.request("ai.restore", { provider: aiProviderRef.current, sessionId: session.id }))
            .session,
          token,
        );
        await Promise.all([refreshAi(), refreshAiSessions()]);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not switch AI session");
      }
    },
    [aiToken, applyAiSession, refreshAi, refreshAiSessions],
  );

  const removeAiSession = useCallback(
    async (session: AiSession) => {
      if (!clientRef.current || !session.id) return;
      const token = aiToken();
      try {
        applyAiSession(
          (await clientRef.current.request("ai.remove", { provider: aiProviderRef.current, sessionId: session.id }))
            .session,
          token,
        );
        await Promise.all([refreshAi(), refreshAiSessions()]);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not remove AI session");
      }
    },
    [aiToken, applyAiSession, refreshAi, refreshAiSessions],
  );

  const interruptAi = useCallback(async () => {
    if (!clientRef.current) return;
    const token = aiToken();
    try {
      applyAiSession(
        (await clientRef.current.request("ai.interrupt", { provider: aiProviderRef.current })).session,
        token,
      );
      await refreshAi();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not stop AI task");
    }
  }, [aiToken, applyAiSession, refreshAi]);
  return {
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
  };
}
