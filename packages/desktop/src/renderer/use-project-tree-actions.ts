import type {
  FileColor,
  JavaBreakpoint,
  WorkspaceSearchQueries,
  WorkspaceTask,
  GitStatusEntry,
  UsefulFile,
  WorkspaceRoot,
} from "@hatopad/protocol";
import { ConnectionStatus } from "./ConnectionScreen";
import type { FileTreeNode, JavaProjectOptions, RunConfig, SearchResult, WorkspaceOptions } from "@hatopad/protocol";
import { InvalidationRefreshes } from "./invalidation-refreshes";
import { CoreClient } from "./client";
import { requestConfirm, requestText } from "./dialogs";
import { type EditorTab, type LayoutModel } from "./model";
import { workflowDocumentOptions } from "./workflow-documents";
import { CursorPositionStore } from "./cursor-state";
import { projectTreeActions, type ProjectTreeAction } from "./project-tree-actions";
import { pinnedFilePaths } from "./pinned-tabs";
import { type EditorLocation } from "./navigation-history";
import { type StatusKind } from "./app-shared";

export interface UseProjectTreeActionsDeps {
  setTreeContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodes: FileTreeNode[] } | undefined>>;
  setSearchScope: React.Dispatch<React.SetStateAction<string | undefined>>;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  layoutRef: React.MutableRefObject<LayoutModel>;
  setStatusMessage: (message: string) => void;
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  setProjectSelection: React.Dispatch<React.SetStateAction<Set<string>>>;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  javaOptionsRef: React.MutableRefObject<JavaProjectOptions | undefined>;
  refreshJavaTree: () => Promise<void>;
  showStatus: (message: string, kind: StatusKind) => void;
  openFile: (node: FileTreeNode) => Promise<void>;
  activeWorkspace: string;
  setProjectPathDialog: React.Dispatch<
    React.SetStateAction<{ mode: "file" | "directory" | "rename"; node: FileTreeNode; parentPath: string } | undefined>
  >;
  deleteProjectPath: (node: FileTreeNode) => Promise<void>;
  selectedRootIdRef: React.MutableRefObject<string>;
  selectWorkspaceRootRef: React.MutableRefObject<(rootId: string) => Promise<void>>;
  rememberNavigation: (target: EditorLocation) => void;
  setPendingNavigation: React.Dispatch<React.SetStateAction<{ result: SearchResult; matchLength: number } | undefined>>;
  selectedRootId: string;
  invalidationRefreshes: React.MutableRefObject<InvalidationRefreshes | undefined>;
  setTaskSwitching: React.Dispatch<React.SetStateAction<boolean>>;
  fileColors: Record<string, FileColor>;
  gitCommitMessage: string;
  javaBreakpoints: JavaBreakpoint[];
  searchQueries: WorkspaceSearchQueries;
  showIgnoredRef: React.MutableRefObject<boolean>;
  setSelectedRootId: React.Dispatch<React.SetStateAction<string>>;
  setActiveWorkspace: React.Dispatch<React.SetStateAction<string>>;
  activeWorkspaceRef: React.MutableRefObject<string>;
  setProjectName: React.Dispatch<React.SetStateAction<string>>;
  setTree: React.Dispatch<React.SetStateAction<FileTreeNode[]>>;
  workspaceKeyRef: React.MutableRefObject<string>;
  cursorPositions: CursorPositionStore;
  setTasks: React.Dispatch<React.SetStateAction<WorkspaceTask[]>>;
  setSelectedTaskId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setGitEntries: React.Dispatch<React.SetStateAction<GitStatusEntry[]>>;
  setTaskGitEntries: React.Dispatch<React.SetStateAction<GitStatusEntry[]>>;
  setJavaOptions: React.Dispatch<React.SetStateAction<JavaProjectOptions | undefined>>;
  setUsefulFiles: React.Dispatch<React.SetStateAction<UsefulFile[]>>;
  setRunConfigs: React.Dispatch<React.SetStateAction<RunConfig[]>>;
  restoreWorkspaceOptions: (
    options: WorkspaceOptions,
    client: CoreClient,
    rootId?: string,
    recovery?: boolean,
    signal?: AbortSignal,
  ) => Promise<void>;
  refreshTasks: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshAi: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshUsefulFiles: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshRunConfigs: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshAgents: (
    client?: CoreClient | undefined,
    taskId?: string | undefined,
    canApply?: () => boolean,
  ) => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  updateTerminalGroup: (update: (group: LayoutModel["terminalGroup"]) => LayoutModel["terminalGroup"]) => void;
  setWorkspaceRoots: React.Dispatch<React.SetStateAction<WorkspaceRoot[]>>;
  setWorkspaceRootDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  workspaceRoots: WorkspaceRoot[];
}

export function useProjectTreeActions(deps: UseProjectTreeActionsDeps) {
  const {
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
  } = deps;

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
    else if (action === "rename")
      setProjectPathDialog({
        mode: "rename",
        node,
        parentPath: node.path.split("/").slice(0, -1).join("/"),
      });
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
  return {
    openSearchForNode,
    transferProjectPaths,
    runProjectTreeAction,
    navigateToSearchResult,
    selectWorkspaceRoot,
    activateTerminalTab,
    addWorkspaceRoot,
    removeWorkspaceRoot,
  };
}
