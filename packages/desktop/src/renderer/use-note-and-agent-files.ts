import { type UsefulFile, type AgentFile, type UsefulFileScope, type AgentFileScope } from "@hatopad/protocol";
import { agentKey } from "./AgentsPanel";
import { type CoreClient } from "./client";
import { type EditorTab } from "./model";

export interface NoteAndAgentFilesDeps {
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  usefulDialog: { mode: "create" | "rename"; scope: UsefulFileScope; file?: UsefulFile } | undefined;
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  setUsefulDialog: React.Dispatch<
    React.SetStateAction<{ mode: "create" | "rename"; scope: UsefulFileScope; file?: UsefulFile } | undefined>
  >;
  refreshUsefulFiles: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  setStatusMessage: (message: string) => void;
  agentDialog: { mode: "create" | "rename"; scope: Exclude<AgentFileScope, "workspace">; file?: AgentFile } | undefined;
  selectedAgentKey: string;
  selectAgent: (key: string) => void;
  setAgentDialog: React.Dispatch<
    React.SetStateAction<
      { mode: "create" | "rename"; scope: Exclude<AgentFileScope, "workspace">; file?: AgentFile } | undefined
    >
  >;
  refreshAgents: (
    client?: CoreClient | undefined,
    taskId?: string | undefined,
    canApply?: () => boolean,
  ) => Promise<void>;
}

/** Moved from App; statement bodies are unchanged. */
export function useNoteAndAgentFiles(deps: NoteAndAgentFilesDeps) {
  const {
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
  } = deps;
  const saveUsefulFileDialog = async (name: string) => {
    if (!clientRef.current || !usefulDialog) return;
    if (usefulDialog.mode === "create")
      await clientRef.current.request("useful.create", { scope: usefulDialog.scope, name });
    else {
      const oldName = usefulDialog.file!.name;
      await clientRef.current.request("useful.rename", { scope: usefulDialog.scope, name: oldName, newName: name });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((tab) =>
          tab.type === "useful" && tab.usefulScope === usefulDialog.scope && tab.path === oldName
            ? {
                ...tab,
                path: name,
                title: name,
                markdownMode: /\.md$/i.test(name) ? (tab.markdownMode ?? "preview") : undefined,
              }
            : tab,
        ),
        activeTabId: active,
      }));
    }
    setUsefulDialog(undefined);
    await refreshUsefulFiles();
  };

  const deleteUsefulFile = async (file: UsefulFile) => {
    if (!clientRef.current || !window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    try {
      await clientRef.current.request("useful.delete", file);
      updateGroup((tabs, active) => {
        const next = tabs.filter(
          (tab) => tab.type !== "useful" || tab.usefulScope !== file.scope || tab.path !== file.name,
        );
        return { tabs: next, activeTabId: next.some((tab) => tab.id === active) ? active : next.at(-1)?.id };
      });
      await refreshUsefulFiles();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete useful file");
    }
  };

  const saveAgentDialog = async (name: string) => {
    if (!clientRef.current || !agentDialog) return;
    if (agentDialog.mode === "create")
      await clientRef.current.request("agents.create", { scope: agentDialog.scope, name });
    else {
      const oldName = agentDialog.file!.name;
      const result = await clientRef.current.request("agents.rename", {
        scope: agentDialog.scope,
        name: oldName,
        newName: name,
      });
      const oldKey = agentKey({ scope: agentDialog.scope, name: oldName });
      const nextKey = agentKey({ scope: agentDialog.scope, name: result.name });
      updateGroup((tabs, active) => ({
        tabs: tabs.map((tab) =>
          tab.type === "agent" && tab.agentScope === agentDialog.scope && tab.path === oldName
            ? { ...tab, path: result.name, title: result.name }
            : tab,
        ),
        activeTabId: active,
      }));
      if (selectedAgentKey === oldKey) selectAgent(nextKey);
    }
    setAgentDialog(undefined);
    await refreshAgents();
  };

  const deleteAgent = async (file: AgentFile) => {
    if (
      !clientRef.current ||
      file.scope === "workspace" ||
      !window.confirm(`Delete agent ${file.name}? This cannot be undone.`)
    )
      return;
    try {
      await clientRef.current.request("agents.delete", { scope: file.scope, name: file.name });
      updateGroup((tabs, active) => {
        const next = tabs.filter(
          (tab) => tab.type !== "agent" || tab.agentScope !== file.scope || tab.path !== file.name,
        );
        return { tabs: next, activeTabId: next.some((tab) => tab.id === active) ? active : next.at(-1)?.id };
      });
      if (selectedAgentKey === agentKey(file)) selectAgent("");
      await refreshAgents();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete agent");
    }
  };
  return { saveUsefulFileDialog, deleteUsefulFile, saveAgentDialog, deleteAgent };
}
