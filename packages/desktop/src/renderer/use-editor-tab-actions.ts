import { type EditorTab, type LayoutModel } from "./model";
import { togglePinnedTab } from "./pinned-tabs";
import { useCallback } from "react";
import { type CoreClient } from "./client";
import { type RunConfig } from "@hatopad/protocol";

export interface EditorTabActionsDeps {
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  layoutRef: React.MutableRefObject<LayoutModel>;
  setTabContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; tab: EditorTab } | undefined>>;
  host: string;
  port: string;
  draggedTabId: string | undefined;
  setDraggedTabId: React.Dispatch<React.SetStateAction<string | undefined>>;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  selfWriteUntil: React.MutableRefObject<Map<string, number>>;
  setRunConfigs: React.Dispatch<React.SetStateAction<RunConfig[]>>;
  refreshSkills: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  refreshAgents: (
    client?: CoreClient | undefined,
    taskId?: string | undefined,
    canApply?: () => boolean,
  ) => Promise<void>;
  scheduleJavaCheck: () => void;
  layout: LayoutModel;
}

/** Moved from App; statement bodies are unchanged. */
export function useEditorTabActions(deps: EditorTabActionsDeps) {
  const {
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
  } = deps;
  const closeTab = (tab: EditorTab) => {
    if (tab.dirty && !window.confirm(`Discard unsaved changes in ${tab.title}?`)) return;
    updateGroup((tabs, active) => {
      const index = tabs.findIndex((item) => item.id === tab.id);
      const next = tabs.filter((item) => item.id !== tab.id);
      const activeTabId = active === tab.id ? next[Math.min(index, next.length - 1)]?.id : active;
      return { tabs: next, activeTabId };
    });
  };

  const closeTabs = (tab: EditorTab, mode: "all" | "right") => {
    const tabs = layoutRef.current.editorGroups[0]?.tabs ?? [];
    const index = tabs.findIndex((item) => item.id === tab.id);
    // Batch close never removes pins; individual close retains the existing dirty confirmation.
    const closing = (mode === "all" ? tabs : tabs.slice(index + 1)).filter((item) => !item.pinned);
    if (
      closing.some((item) => item.dirty) &&
      !window.confirm(`Close ${closing.length} tab${closing.length === 1 ? "" : "s"} and discard unsaved changes?`)
    )
      return;
    const closingIds = new Set(closing.map((item) => item.id));
    updateGroup((current, active) => {
      const next = current.filter((item) => !closingIds.has(item.id));
      return {
        tabs: next,
        activeTabId:
          active && !closingIds.has(active) ? active : (next[Math.min(index, next.length - 1)]?.id ?? next.at(-1)?.id),
      };
    });
    setTabContextMenu(undefined);
  };

  const openTabInWindow = async (tab: EditorTab) => {
    setTabContextMenu(undefined);
    if (
      tab.type === "diff" ||
      tab.type === "agent" ||
      tab.type === "skill" ||
      tab.type === "runConfig" ||
      tab.type === "workflowDocument" ||
      tab.type === "workflow"
    )
      return;
    if (tab.dirty) await saveFileTab(tab);
    const options = {
      host,
      port,
      type: tab.type,
      path: tab.path,
      ...(tab.type === "useful" ? { scope: tab.usefulScope } : {}),
    } as const;
    if (window.desktop?.openEditorWindow) window.desktop.openEditorWindow(options);
    else {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("detached", "1");
      url.searchParams.set("host", host);
      url.searchParams.set("port", port);
      url.searchParams.set("type", tab.type);
      url.searchParams.set("path", tab.path);
      if (tab.type === "useful" && tab.usefulScope) url.searchParams.set("scope", tab.usefulScope);
      window.open(url.toString(), "_blank", "popup,width=1000,height=720");
    }
  };

  const moveTab = (targetId: string) => {
    if (!draggedTabId || draggedTabId === targetId) return;
    updateGroup((tabs, active) => {
      const source = tabs.findIndex((tab) => tab.id === draggedTabId);
      const target = tabs.findIndex((tab) => tab.id === targetId);
      if (source < 0 || target < 0) return { tabs, activeTabId: active };
      const next = [...tabs];
      const [moved] = next.splice(source, 1);
      next.splice(target, 0, moved!);
      return { tabs: next, activeTabId: active };
    });
    setDraggedTabId(undefined);
  };

  const toggleTabPin = (tab: EditorTab) => {
    if (tab.type !== "file") return;
    updateGroup((tabs, active) => ({ tabs: togglePinnedTab(tabs, tab.id), activeTabId: active }));
    setTabContextMenu(undefined);
  };

  const saveFileTab = useCallback(
    async (current: EditorTab) => {
      if (current.type === "skill" && current.skillPath && current.skillPath !== "SKILL.md") return !current.dirty;
      if (
        (current.type !== "file" &&
          current.type !== "useful" &&
          current.type !== "runConfig" &&
          current.type !== "agent" &&
          current.type !== "skill") ||
        current.loading ||
        current.error ||
        !current.dirty ||
        !clientRef.current
      )
        return !current.dirty;
      const content = current.content;
      try {
        selfWriteUntil.current.set(current.path, Date.now() + 1500);
        if (current.type === "useful")
          await clientRef.current.request("useful.write", { scope: current.usefulScope!, name: current.path, content });
        else if (current.type === "runConfig") {
          const config = (
            await clientRef.current.request("runConfig.write", {
              scope: current.runConfigScope!,
              name: current.path,
              commands: content,
            })
          ).config;
          setRunConfigs((items) =>
            items.map((item) => (item.scope === config.scope && item.name === config.name ? config : item)),
          );
        } else if (current.type === "agent")
          await clientRef.current.request("agents.write", { scope: current.agentScope!, name: current.path, content });
        else if (current.type === "skill")
          await clientRef.current.request("skills.write", { id: current.skillId!, content });
        else {
          const saved = await clientRef.current.request("filesystem.writeFile", {
            path: current.path,
            content,
            expectedRevision: current.revision,
          });
          updateGroup((tabs, active) => ({
            tabs: tabs.map((tab) =>
              tab.id === current.id
                ? {
                    ...tab,
                    dirty: tab.content !== content,
                    savedContent: content,
                    revision: saved.revision,
                    error: undefined,
                  }
                : tab,
            ),
            activeTabId: active,
          }));
        }
        if (current.type !== "file")
          updateGroup((tabs, active) => ({
            tabs: tabs.map((tab) =>
              tab.id === current.id
                ? { ...tab, dirty: tab.content !== content, savedContent: content, error: undefined }
                : tab,
            ),
            activeTabId: active,
          }));
        if (
          current.type === "skill" ||
          (current.type === "file" && /^\.agents\/(skills\/|skills\.json$)/.test(current.path))
        )
          await refreshSkills();
        if (current.type === "agent" || (current.type === "file" && /^\.agents\/[^/]+\.md$/i.test(current.path)))
          await refreshAgents();
        if (current.type === "file" && /\.java$/i.test(current.path)) scheduleJavaCheck();
        return true;
      } catch (error) {
        selfWriteUntil.current.delete(current.path);
        updateGroup((tabs, active) => ({
          tabs: tabs.map((tab) =>
            tab.id === current.id ? { ...tab, error: error instanceof Error ? error.message : "Save failed" } : tab,
          ),
          activeTabId: active,
        }));
        return false;
      }
    },
    [refreshAgents, refreshSkills, scheduleJavaCheck, updateGroup],
  );

  const saveActive = useCallback(async () => {
    const current = layout.editorGroups[0]?.tabs.find((tab) => tab.id === layout.editorGroups[0]?.activeTabId);
    if (current) await saveFileTab(current);
  }, [layout, saveFileTab]);
  return { closeTab, closeTabs, openTabInWindow, moveTab, toggleTabPin, saveFileTab, saveActive };
}
