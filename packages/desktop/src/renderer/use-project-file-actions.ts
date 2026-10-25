import { useProjectTransferProgress } from "./use-project-transfer-progress";
import type { FileColor } from "@hatopad/protocol";
import type { FileTreeNode, JavaProjectOptions } from "@hatopad/protocol";
import { CoreClient } from "./client";
import { remoteUploadDestination, treeContainsPath } from "./remote-transfer";
import { type EditorTab, type LayoutModel } from "./model";
import { type StatusKind } from "./app-shared";

export interface UseProjectFileActionsDeps {
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  showStatus: (message: string, kind: StatusKind) => void;
  tree: FileTreeNode[];
  host: string;
  port: string;
  setProjectTransfer: React.Dispatch<
    React.SetStateAction<
      { operationId: string; token: string; label: string; bytes: number; total: number } | undefined
    >
  >;
  projectTransfer: { operationId: string; token: string; label: string; bytes: number; total: number } | undefined;
  setStatusMessage: (message: string) => void;
  projectPathDialog: { mode: "file" | "directory" | "rename"; node: FileTreeNode; parentPath: string } | undefined;
  setProjectPathDialog: React.Dispatch<
    React.SetStateAction<{ mode: "file" | "directory" | "rename"; node: FileTreeNode; parentPath: string } | undefined>
  >;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  openFile: (node: FileTreeNode) => Promise<void>;
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  setFileColors: React.Dispatch<React.SetStateAction<Record<string, FileColor>>>;
  javaOptionsRef: React.MutableRefObject<JavaProjectOptions | undefined>;
  setJavaOptions: React.Dispatch<React.SetStateAction<JavaProjectOptions | undefined>>;
  refreshJavaTree: () => Promise<void>;
  layoutRef: React.MutableRefObject<LayoutModel>;
  activeWorkspace: string;
  setLastDeleted: React.Dispatch<React.SetStateAction<{ recoveryId: string; path: string } | undefined>>;
  lastDeleted: { recoveryId: string; path: string } | undefined;
}

export function useProjectFileActions(deps: UseProjectFileActionsDeps) {
  const {
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
  } = deps;

  const trackTransfer = useProjectTransferProgress({
    projectTransfer,
    setProjectTransfer,
    showStatus,
    refreshTree,
    refreshGit,
  });

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
      const operationId = crypto.randomUUID();
      trackTransfer({
        operationId,
        token: ticket.token,
        label: `Uploading ${ticket.name}`,
        bytes: 0,
        total: ticket.size,
      });
      showStatus(`Uploading ${ticket.name}: 0%`, "progress");
      try {
        await window.desktop.startProjectTransfer({
          operationId,
          localId: local.id,
          token: ticket.token,
          host,
          port: Number(port),
          direction: "upload",
          size: ticket.size,
        });
      } catch (error) {
        trackTransfer(undefined);
        await clientRef.current
          .request("filesystem.remoteTransferCancel", { token: ticket.token })
          .catch(() => undefined);
        throw error;
      }
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
      const operationId = crypto.randomUUID();
      trackTransfer({
        operationId,
        token: ticket.token,
        label: `Downloading ${ticket.name}`,
        bytes: 0,
        total: ticket.size,
      });
      showStatus(`Downloading ${ticket.name}: 0%`, "progress");
      try {
        await window.desktop.startProjectTransfer({
          operationId,
          localId: local.id,
          token: ticket.token,
          host,
          port: Number(port),
          direction: "download",
          size: ticket.size,
        });
      } catch (error) {
        trackTransfer(undefined);
        await clientRef.current
          .request("filesystem.remoteTransferCancel", { token: ticket.token })
          .catch(() => undefined);
        throw error;
      }
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
    trackTransfer(undefined);
    showStatus("Transfer cancelled", "success");
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
  return {
    uploadToWorkspace,
    downloadFromWorkspace,
    cancelProjectTransfer,
    saveProjectPathDialog,
    deleteProjectPath,
    restoreLastDeleted,
  };
}
