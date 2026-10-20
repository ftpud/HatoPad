import {
  type FileTreeNode,
  type SearchResult,
  type GitStatusEntry,
  type TaskCheckpoint,
  type TaskCheckpointFile,
  type UsefulFile,
  type RunConfig,
  type AgentFile,
  type WorkspaceTask,
} from "@hatopad/protocol";
import { type EditorTab, type EditorGroup, type LayoutModel } from "./model";
import { reviewOutcome } from "./app-shared";
import { useCallback, useEffect } from "react";
import { requestText, requestConfirm } from "./dialogs";
import { type CoreClient } from "./client";
import { type EditorLocation } from "./navigation-history";

export interface FileOpenersDeps {
  selectedRootIdRef: React.MutableRefObject<string>;
  group: EditorGroup;
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  rememberNavigation: (target: EditorLocation) => void;
  setPendingNavigation: React.Dispatch<React.SetStateAction<{ result: SearchResult; matchLength: number } | undefined>>;
  tasks: WorkspaceTask[];
  selectedTaskId: string | undefined;
  refreshTaskGit: (task?: WorkspaceTask | undefined, client?: CoreClient | undefined) => Promise<void>;
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
  setStatusMessage: (message: string) => void;
  selectWorkspaceRootRef: React.MutableRefObject<(rootId: string) => Promise<void>>;
  selectedTaskIdRef: React.MutableRefObject<string | undefined>;
  switchTaskRef: React.MutableRefObject<(taskId?: string) => Promise<void>>;
  layoutRef: React.MutableRefObject<LayoutModel>;
  setRunConfigs: React.Dispatch<React.SetStateAction<RunConfig[]>>;
}

/** Moved from App; statement bodies are unchanged. */
export function useFileOpeners(deps: FileOpenersDeps) {
  const {
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
  } = deps;
  const openFile = async (node: FileTreeNode) => {
    const rootId = selectedRootIdRef.current;
    const existing = group.tabs.find((tab) => tab.type === "file" && tab.rootId === rootId && tab.path === node.path);
    if (existing) {
      updateGroup((tabs) => ({ tabs, activeTabId: existing.id }));
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "file",
      rootId,
      title: node.name,
      path: node.path,
      dirty: false,
      content: "",
      savedContent: "",
      loading: true,
      markdownMode: /\.md$/i.test(node.path) ? "preview" : undefined,
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await clientRef.current!.request("filesystem.readFile", { path: node.path });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                content: result.content,
                savedContent: result.content,
                revision: result.revision,
                loading: false,
              }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, loading: false, error: error instanceof Error ? error.message : "Read failed" }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };

  const openAiFile = async (path: string, line?: number, column?: number) => {
    await openFile({ name: path.split("/").pop() ?? path, path, type: "file" });
    if (!line) return;
    updateGroup((tabs, active) => ({
      tabs: tabs.map((tab) =>
        tab.type === "file" && tab.rootId === selectedRootIdRef.current && tab.path === path
          ? { ...tab, markdownMode: "edit" }
          : tab,
      ),
      activeTabId: active,
    }));
    const result: SearchResult = {
      rootId: selectedRootIdRef.current,
      path,
      line,
      column: column ?? 1,
      preview: "AI response link",
    };
    rememberNavigation({ rootId: result.rootId, path, line, column: result.column });
    setPendingNavigation({ result, matchLength: 1 });
  };

  const openDiff = async (entry: GitStatusEntry) => {
    const existing = group.tabs.find((tab) => tab.type === "diff" && tab.path === entry.path);
    if (existing) {
      updateGroup((tabs) => ({ tabs, activeTabId: existing.id }));
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "diff",
      rootId: selectedRootIdRef.current,
      title: `${entry.path.split("/").pop() ?? entry.path} (Diff)`,
      path: entry.path,
      dirty: false,
      content: "",
      savedContent: "",
      originalContent: "",
      diffMode: "unified",
      loading: true,
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await clientRef.current!.request("git.diff", { path: entry.path });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                originalContent: result.originalContent,
                content: result.modifiedContent,
                savedContent: result.modifiedContent,
                loading: false,
              }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, loading: false, error: error instanceof Error ? error.message : "Could not load diff" }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };

  const openTaskDiff = async (entry: GitStatusEntry) => {
    const task = tasks.find((item) => item.id === selectedTaskId);
    if (!task) return;
    const tabPath = `task-git:${task.id}:${entry.path}`;
    const existing = group.tabs.find((tab) => tab.type === "diff" && tab.path === tabPath);
    if (existing) {
      updateGroup((tabs) => ({ tabs, activeTabId: existing.id }));
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "diff",
      rootId: selectedRootIdRef.current,
      title: `${entry.path.split("/").pop() ?? entry.path} (Task Diff)`,
      path: tabPath,
      diffRef: task.baseBranch,
      diffPath: entry.path,
      ...(entry.originalPath ? { diffOriginalPath: entry.originalPath } : {}),
      dirty: false,
      content: "",
      savedContent: "",
      originalContent: "",
      diffMode: "unified",
      loading: true,
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await clientRef.current!.request("git.compareDiff", {
        ref: task.baseBranch,
        path: entry.path,
        ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
      });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                originalContent: result.originalContent,
                content: result.modifiedContent,
                savedContent: result.modifiedContent,
                loading: false,
              }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, loading: false, error: error instanceof Error ? error.message : "Could not load task diff" }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };

  const openCheckpointDiff = async (checkpoint: TaskCheckpoint, file: TaskCheckpointFile) => {
    const tabPath = `task-checkpoint:${checkpoint.id}:${file.path}`;
    const existing = group.tabs.find((tab) => tab.type === "diff" && tab.path === tabPath);
    if (existing) {
      updateGroup((tabs) => ({ tabs, activeTabId: existing.id }));
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "diff",
      rootId: selectedRootIdRef.current,
      title: `${file.path.split("/").pop() ?? file.path} (${checkpoint.prompt.slice(0, 24)})`,
      path: tabPath,
      dirty: false,
      content: "",
      savedContent: "",
      originalContent: "",
      diffMode: "unified",
      loading: true,
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await clientRef.current!.request("taskGit.diff", { checkpointId: checkpoint.id, path: file.path });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                originalContent: result.binary ? "Binary file" : result.originalContent,
                content: result.binary ? "Binary file" : result.modifiedContent,
                savedContent: result.modifiedContent,
                loading: false,
                ...(result.truncated ? { error: "Large checkpoint diff truncated to 256 KiB per side." } : {}),
              }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                loading: false,
                error: error instanceof Error ? error.message : "Could not load checkpoint diff",
              }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };

  const restoreCheckpoint = async (checkpoint: TaskCheckpoint) => {
    if (
      !confirm(
        `Restore checkpoint changes from “${checkpoint.prompt.slice(0, 80)}”? Files edited after the checkpoint will be reported as conflicts and left unchanged.`,
      )
    )
      return;
    try {
      const result = await clientRef.current!.request("taskGit.restore", { checkpointId: checkpoint.id });
      await Promise.all([refreshTaskGit(), refreshGit(), refreshTree()]);
      setStatusMessage(reviewOutcome("Checkpoint restore", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not restore checkpoint");
    }
  };

  const reviewCheckpointFile = async (checkpoint: TaskCheckpoint, file: TaskCheckpointFile) => {
    try {
      const result = await clientRef.current!.request("taskGit.review", {
        checkpointId: checkpoint.id,
        paths: [file.path],
      });
      await Promise.all([refreshTaskGit(), refreshGit(), refreshTree()]);
      setStatusMessage(reviewOutcome("Checkpoint change", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not accept checkpoint change");
    }
  };

  const activateEditorTab = useCallback(
    async (tab: EditorTab) => {
      if (tab.rootId && tab.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(tab.rootId);
      if (tab.type === "workflow" && tab.workflowTaskId !== selectedTaskIdRef.current) {
        await switchTaskRef.current(tab.workflowTaskId);
        if (tab.workflowTaskId !== selectedTaskIdRef.current) return;
      }
      updateGroup((tabs) => ({ tabs, activeTabId: tab.id }));
      if (!clientRef.current || tab.loading || tab.dirty || tab.type === "workflowDocument" || tab.type === "workflow")
        return;
      try {
        if (tab.type === "diff") {
          const result = tab.diffRef
            ? await clientRef.current.request("git.compareDiff", {
                ref: tab.diffRef,
                path: tab.diffPath ?? tab.path,
                ...(tab.diffOriginalPath ? { originalPath: tab.diffOriginalPath } : {}),
              })
            : await clientRef.current.request("git.diff", { path: tab.path });
          updateGroup((tabs, active) => ({
            tabs: tabs.map((item) =>
              item.id === tab.id && !item.dirty
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
          return;
        }
        const result =
          tab.type === "useful"
            ? await clientRef.current.request("useful.read", { scope: tab.usefulScope!, name: tab.path })
            : tab.type === "runConfig"
              ? {
                  content: (
                    await clientRef.current.request("runConfig.read", { scope: tab.runConfigScope!, name: tab.path })
                  ).config.commands,
                }
              : tab.type === "agent"
                ? await clientRef.current.request("agents.read", { scope: tab.agentScope!, name: tab.path })
                : tab.type === "skill"
                  ? await clientRef.current.request("skills.read", { id: tab.skillId!, path: tab.skillPath })
                  : await clientRef.current.request("filesystem.readFile", { path: tab.path });
        updateGroup((tabs, active) => ({
          tabs: tabs.map((item) =>
            item.id === tab.id && !item.dirty
              ? { ...item, content: result.content, savedContent: result.content, error: undefined }
              : item,
          ),
          activeTabId: active,
        }));
      } catch (error) {
        updateGroup((tabs, active) => ({
          tabs: tabs.map((item) =>
            item.id === tab.id
              ? { ...item, error: error instanceof Error ? error.message : "Could not refresh file" }
              : item,
          ),
          activeTabId: active,
        }));
      }
    },
    [updateGroup],
  );

  const openUsefulFile = async (file: UsefulFile) => {
    const existing = group.tabs.find(
      (tab) =>
        tab.type === "useful" &&
        tab.usefulScope === file.scope &&
        tab.path === file.name &&
        (file.scope === "global" || tab.rootId === selectedRootIdRef.current),
    );
    if (existing) {
      await activateEditorTab(existing);
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "useful",
      rootId: selectedRootIdRef.current,
      title: file.name,
      path: file.name,
      usefulScope: file.scope,
      dirty: false,
      content: "",
      savedContent: "",
      loading: true,
      markdownMode: /\.md$/i.test(file.name) ? "preview" : undefined,
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await clientRef.current!.request("useful.read", { scope: file.scope, name: file.name });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, content: result.content, savedContent: result.content, loading: false }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, loading: false, error: error instanceof Error ? error.message : "Could not read useful file" }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };
  const openRunConfigFile = useCallback(
    async (config: RunConfig) => {
      const existing = layoutRef.current.editorGroups[0]!.tabs.find(
        (tab) =>
          tab.type === "runConfig" &&
          tab.runConfigScope === config.scope &&
          tab.path === config.name &&
          (config.scope === "global" || tab.rootId === selectedRootIdRef.current),
      );
      if (existing) {
        updateGroup((tabs) => ({ tabs, activeTabId: existing.id }));
        return;
      }
      const client = clientRef.current!;
      const rootId = client.getRoot();
      const result = await client.request("runConfig.read", { scope: config.scope, name: config.name });
      if (clientRef.current !== client || client.getRoot() !== rootId) return;
      const tab: EditorTab = {
        id: crypto.randomUUID(),
        type: "runConfig",
        rootId: selectedRootIdRef.current,
        title: config.name,
        path: config.name,
        runConfigScope: config.scope,
        dirty: false,
        content: result.config.commands,
        savedContent: result.config.commands,
        loading: false,
      };
      updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    },
    [updateGroup],
  );
  useEffect(() => {
    const listener = (event: Event) => void openRunConfigFile((event as CustomEvent<RunConfig>).detail);
    window.addEventListener("hatopad:open-run-config", listener);
    return () => window.removeEventListener("hatopad:open-run-config", listener);
  }, [openRunConfigFile]);
  useEffect(() => {
    const renameConfig = (event: Event) => {
      const config = (event as CustomEvent<RunConfig>).detail;
      void requestText({
        title: "Rename run configuration",
        label: "Name",
        defaultValue: config.name,
        confirmLabel: "Rename",
      }).then((newName) => {
        if (!newName || newName === config.name) return;
        void clientRef.current
          ?.request("runConfig.rename", { scope: config.scope, name: config.name, newName })
          .then(({ config: renamed }) => {
            setRunConfigs((items) =>
              items.map((item) => (item.scope === config.scope && item.name === config.name ? renamed : item)),
            );
            updateGroup((tabs, active) => ({
              tabs: tabs.map((tab) =>
                tab.type === "runConfig" && tab.runConfigScope === config.scope && tab.path === config.name
                  ? { ...tab, path: renamed.name, title: renamed.name }
                  : tab,
              ),
              activeTabId: active,
            }));
          })
          .catch((error: unknown) =>
            setStatusMessage(error instanceof Error ? error.message : "Could not rename Run Config"),
          );
      });
    };
    const deleteConfig = (event: Event) => {
      const config = (event as CustomEvent<RunConfig>).detail;
      void requestConfirm({
        title: "Delete run configuration?",
        message: `Delete Run Config ${config.name}?`,
        confirmLabel: "Delete",
        danger: true,
      }).then((confirmed) => {
        if (!confirmed) return;
        void clientRef.current
          ?.request("runConfig.delete", { scope: config.scope, name: config.name })
          .then(() => {
            setRunConfigs((items) => items.filter((item) => item.scope !== config.scope || item.name !== config.name));
            updateGroup((tabs, active) => {
              const next = tabs.filter(
                (tab) => tab.type !== "runConfig" || tab.runConfigScope !== config.scope || tab.path !== config.name,
              );
              return { tabs: next, activeTabId: next.some((tab) => tab.id === active) ? active : next.at(-1)?.id };
            });
          })
          .catch((error: unknown) =>
            setStatusMessage(error instanceof Error ? error.message : "Could not delete Run Config"),
          );
      });
    };
    window.addEventListener("hatopad:rename-run-config", renameConfig);
    window.addEventListener("hatopad:delete-run-config", deleteConfig);
    return () => {
      window.removeEventListener("hatopad:rename-run-config", renameConfig);
      window.removeEventListener("hatopad:delete-run-config", deleteConfig);
    };
  }, [updateGroup]);

  const openAgentFile = async (file: AgentFile) => {
    if (file.scope === "workspace") {
      await openFile({ name: file.name, path: `.agents/${file.name}`, type: "file" });
      return;
    }
    const existing = group.tabs.find(
      (tab) => tab.type === "agent" && tab.agentScope === file.scope && tab.path === file.name,
    );
    if (existing) {
      await activateEditorTab(existing);
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "agent",
      rootId: selectedRootIdRef.current,
      title: file.name,
      path: file.name,
      agentScope: file.scope,
      dirty: false,
      content: "",
      savedContent: "",
      loading: true,
      markdownMode: "preview",
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await clientRef.current!.request("agents.read", { scope: file.scope, name: file.name });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, content: result.content, savedContent: result.content, loading: false }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, loading: false, error: error instanceof Error ? error.message : "Could not read agent" }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };

  const openSkillFile = async (id: string, mode: "edit" | "preview", resource = "SKILL.md") => {
    const client = clientRef.current;
    if (!client) throw new Error("Backend is disconnected");
    const rootId = client.getRoot();
    const existing = group.tabs.find(
      (tab) =>
        tab.type === "skill" &&
        tab.skillId === id &&
        (tab.skillPath ?? "SKILL.md") === resource &&
        (id.startsWith("global/") || tab.rootId === rootId),
    );
    if (existing) {
      await activateEditorTab(existing);
      updateGroup((tabs, active) => ({
        tabs: tabs.map((tab) => (tab.id === existing.id ? { ...tab, markdownMode: mode } : tab)),
        activeTabId: active,
      }));
      return;
    }
    const name = id.slice(id.indexOf("/") + 1);
    const path = id.startsWith("workspace/") ? `.agents/skills/${name}/${resource}` : `${name}/${resource}`;
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      type: "skill",
      rootId,
      title: `${name}/${resource}`,
      path,
      skillId: id,
      skillPath: resource,
      dirty: false,
      content: "",
      savedContent: "",
      loading: true,
      markdownMode: mode,
    };
    updateGroup((tabs) => ({ tabs: [...tabs, tab], activeTabId: tab.id }));
    try {
      const result = await client.request("skills.read", { id, path: resource });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, content: result.content, savedContent: result.content, loading: false }
            : item,
        ),
        activeTabId: active,
      }));
    } catch (error) {
      updateGroup((tabs, active) => ({
        tabs: tabs.map((item) =>
          item.id === tab.id
            ? { ...item, loading: false, error: error instanceof Error ? error.message : "Could not read skill" }
            : item,
        ),
        activeTabId: active,
      }));
    }
  };
  return {
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
  };
}
