import type { HarnessDefinition } from "@hatopad/protocol";
import { Play } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import type { RunConfig } from "@hatopad/protocol";
import { CoreClient } from "./client";
import { type EditorTab, type LayoutModel } from "./model";

export interface UseTerminalActionsDeps {
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  updateTerminalGroup: (update: (group: LayoutModel["terminalGroup"]) => LayoutModel["terminalGroup"]) => void;
  selectedRootIdRef: React.MutableRefObject<string>;
  setLayout: React.Dispatch<React.SetStateAction<LayoutModel>>;
  setStatusMessage: (message: string) => void;
  layoutRef: React.MutableRefObject<LayoutModel>;
  terminalBuffers: React.MutableRefObject<Map<string, string>>;
  harnesses: HarnessDefinition[];
  setRunConfigMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; config: RunConfig } | undefined>>;
  setRunConfigs: React.Dispatch<React.SetStateAction<RunConfig[]>>;
  markdownBlockTerminals: React.MutableRefObject<Map<string, string>>;
  activeTab: EditorTab | undefined;
  layout: LayoutModel;
  selectWorkspaceRootRef: React.MutableRefObject<(rootId: string) => Promise<void>>;
  runConfigs: RunConfig[];
  refreshRunProjects: (client?: CoreClient | undefined) => Promise<void>;
  terminalHeight: number;
  setTerminalHeight: React.Dispatch<React.SetStateAction<number>>;
}

export function useTerminalActions(deps: UseTerminalActionsDeps) {
  const {
    clientRef,
    updateTerminalGroup,
    selectedRootIdRef,
    setLayout,
    setStatusMessage,
    layoutRef,
    terminalBuffers,
    harnesses,
    setRunConfigMenu,
    setRunConfigs,
    markdownBlockTerminals,
    activeTab,
    layout,
    selectWorkspaceRootRef,
    runConfigs,
    refreshRunProjects,
    terminalHeight,
    setTerminalHeight,
  } = deps;

  const createTerminal = async (command?: string): Promise<string | undefined> => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const result = await client.request("terminal.create", { cols: 80, rows: 24 });
      updateTerminalGroup((current) => {
        const id = crypto.randomUUID();
        const tab = {
          id,
          rootId: selectedRootIdRef.current,
          terminalId: result.terminalId,
          title: `Terminal ${current.tabs.length + 1}`,
          status: "running" as const,
        };
        return { ...current, tabs: [...current.tabs, tab], activeTabId: id };
      });
      setLayout((current) => ({
        ...current,
        panels: [
          ...current.panels.filter(
            (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
          ),
          { id: "terminal", type: "terminal" },
        ],
      }));
      if (command)
        await client.request("terminal.input", {
          terminalId: result.terminalId,
          data: `${command.replace(/\s+$/, "")}\n`,
        });
      return result.terminalId;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create terminal");
      return undefined;
    }
  };

  const openTerminalReference = async (terminalId: string, title: string): Promise<boolean> => {
    if (!clientRef.current) return false;
    const existing = layoutRef.current.terminalGroup.tabs.find((tab) => tab.terminalId === terminalId);
    if (!existing) {
      const attached = await clientRef.current.request("terminal.attach", { terminalId });
      if (attached.state === "stale") {
        setStatusMessage("That terminal is no longer available.");
        return false;
      }
      terminalBuffers.current.set(attached.session.terminalId, attached.session.output);
      updateTerminalGroup((current) => {
        const alreadyOpen = current.tabs.find((tab) => tab.terminalId === attached.session.terminalId);
        if (alreadyOpen) return { ...current, activeTabId: alreadyOpen.id };
        const id = crypto.randomUUID();
        return {
          ...current,
          tabs: [
            ...current.tabs,
            {
              id,
              rootId: selectedRootIdRef.current,
              terminalId: attached.session.terminalId,
              title,
              status: attached.session.status === "running" ? "running" : "exited",
              ...(attached.session.exitCode === undefined ? {} : { exitCode: attached.session.exitCode }),
              ...(attached.session.status === "running" ? { recovery: "reattached" as const } : {}),
            },
          ],
          activeTabId: id,
        };
      });
    } else updateTerminalGroup((current) => ({ ...current, activeTabId: existing.id }));
    setLayout((current) => ({
      ...current,
      panels: [
        ...current.panels.filter((panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type)),
        { id: "terminal", type: "terminal" },
      ],
    }));
    return true;
  };

  const openHarnessAppTerminal = async (harnessId: string, blockId: string, runId?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Backend is disconnected");
    const terminal = await client.request("harnesses.app.terminal", { harnessId, blockId, runId });
    const label =
      harnesses.find((item) => item.id === harnessId)?.blocks.find((item) => item.id === blockId)?.label ?? "App";
    if (!(await openTerminalReference(terminal.terminalId, `${label} output`)))
      throw new Error("App output terminal is unavailable");
  };

  const openRunConfigTerminal = async (config: RunConfig) => {
    if (!config.terminalId || !clientRef.current) return;
    await openTerminalReference(config.terminalId, config.name);
  };

  const runConfigAction = async (config: RunConfig, action: "run" | "stop" | "restart" | "openTerminal") => {
    setRunConfigMenu(undefined);
    try {
      const next = (
        await clientRef.current!.request(`runConfig.${action}` as "runConfig.run", {
          scope: config.scope,
          name: config.name,
        })
      ).config;
      setRunConfigs((items) =>
        items.map((item) => (item.scope === next.scope && item.name === next.name ? next : item)),
      );
      if (action !== "stop") await openRunConfigTerminal(next);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Run configuration action failed");
    }
  };

  const runMarkdownCommand = async (blockId: string, command: string) => {
    const terminalId = markdownBlockTerminals.current.get(blockId);
    const existing = terminalId
      ? layoutRef.current.terminalGroup.tabs.find((tab) => tab.terminalId === terminalId && tab.status === "running")
      : undefined;
    if (existing && clientRef.current) {
      updateTerminalGroup((current) => ({ ...current, activeTabId: existing.id }));
      setLayout((current) => ({
        ...current,
        panels: [
          ...current.panels.filter(
            (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
          ),
          { id: "terminal", type: "terminal" },
        ],
      }));
      try {
        await clientRef.current.request("terminal.input", {
          terminalId: existing.terminalId,
          data: `${command.replace(/\s+$/, "")}\n`,
        });
        return;
      } catch {
        markdownBlockTerminals.current.delete(blockId);
      }
    }
    const created = await createTerminal(command);
    if (created) markdownBlockTerminals.current.set(blockId, created);
  };

  const renderMarkdownPre = ({
    children,
    node,
  }: {
    children?: ReactNode;
    node?: { position?: { start?: { line?: number } } };
  }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return <pre>{children}</pre>;
    const language = child.props.className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
    if (!language || !["sh", "shell", "bash", "zsh"].includes(language)) return <pre>{children}</pre>;
    const command = String(child.props.children ?? "").replace(/\n$/, "");
    const blockId = `${activeTab?.type ?? "markdown"}:${activeTab?.usefulScope ?? activeTab?.agentScope ?? activeTab?.skillId ?? "workspace"}:${activeTab?.path ?? "markdown"}:${node?.position?.start?.line ?? command}`;
    return (
      <div className="markdown-shell-block">
        <header>
          <span>{language}</span>
          <button
            title="Run in block terminal"
            disabled={!command.trim()}
            onClick={() => void runMarkdownCommand(blockId, command)}
          >
            <Play size={14} />
          </button>
        </header>
        <pre>{children}</pre>
      </div>
    );
  };

  const toggleTerminalPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "terminal");
    if (visible) {
      setLayout((current) => ({ ...current, panels: current.panels.filter((panel) => panel.type !== "terminal") }));
    } else if (layout.terminalGroup.tabs.length > 0) {
      setLayout((current) => ({
        ...current,
        panels: [
          ...current.panels.filter((panel) => !["languageOutput", "problems", "gitlog"].includes(panel.type)),
          { id: "terminal", type: "terminal" },
        ],
      }));
    } else {
      void createTerminal();
    }
  };

  const closeTerminal = async (tab: LayoutModel["terminalGroup"]["tabs"][number]) => {
    if (tab.rootId && tab.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(tab.rootId);
    const owner = runConfigs.find(
      (config) => config.terminalId === tab.terminalId && ["starting", "running", "stopping"].includes(config.status),
    );
    if (owner && clientRef.current)
      void clientRef.current
        .request("runConfig.stop", { scope: owner.scope, name: owner.name })
        .then((result) =>
          setRunConfigs((items) =>
            items.map((item) =>
              item.scope === result.config.scope && item.name === result.config.name ? result.config : item,
            ),
          ),
        )
        .catch(() => undefined);
    else if (tab.status !== "unavailable")
      void clientRef.current
        ?.request("terminal.close", { terminalId: tab.terminalId })
        .then(() => refreshRunProjects())
        .catch(() => undefined);
    terminalBuffers.current.delete(tab.terminalId);
    for (const [blockId, terminalId] of markdownBlockTerminals.current)
      if (terminalId === tab.terminalId) markdownBlockTerminals.current.delete(blockId);
    setLayout((current) => {
      const index = current.terminalGroup.tabs.findIndex((item) => item.id === tab.id);
      const tabs = current.terminalGroup.tabs.filter((item) => item.id !== tab.id);
      const activeTabId =
        current.terminalGroup.activeTabId === tab.id
          ? tabs[Math.min(index, tabs.length - 1)]?.id
          : current.terminalGroup.activeTabId;
      return {
        ...current,
        panels: tabs.length ? current.panels : current.panels.filter((panel) => panel.type !== "terminal"),
        terminalGroup: { ...current.terminalGroup, tabs, activeTabId },
      };
    });
  };

  const renameTerminal = (tab: LayoutModel["terminalGroup"]["tabs"][number], value: string) => {
    const title = value.trim();
    if (!title) return;
    updateTerminalGroup((current) => ({
      ...current,
      tabs: current.tabs.map((item) => (item.id === tab.id ? { ...item, title: title.slice(0, 100) } : item)),
    }));
  };

  const duplicateTerminal = async (tab: LayoutModel["terminalGroup"]["tabs"][number]) => {
    const client = clientRef.current;
    if (!client) return;
    if (tab.rootId && tab.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(tab.rootId);
    try {
      const session = await client.request("terminal.create", { cols: 80, rows: 24 });
      updateTerminalGroup((current) => {
        const id = crypto.randomUUID();
        const index = current.tabs.findIndex((item) => item.id === tab.id);
        const copy = {
          id,
          rootId: selectedRootIdRef.current,
          terminalId: session.terminalId,
          title: `${tab.title} copy`.slice(0, 100),
          status: "running" as const,
        };
        return {
          ...current,
          tabs: [...current.tabs.slice(0, index + 1), copy, ...current.tabs.slice(index + 1)],
          activeTabId: id,
        };
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not duplicate terminal");
    }
  };

  const moveTerminal = (tabId: string, targetTabId: string) =>
    updateTerminalGroup((current) => {
      const from = current.tabs.findIndex((tab) => tab.id === tabId);
      const to = current.tabs.findIndex((tab) => tab.id === targetTabId);
      if (from < 0 || to < 0 || from === to) return current;
      const tabs = [...current.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab!);
      return { ...current, tabs };
    });

  const beginTerminalResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const move = (moveEvent: PointerEvent) =>
      setTerminalHeight(Math.max(130, Math.min(window.innerHeight - 150, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  return {
    createTerminal,
    openTerminalReference,
    openHarnessAppTerminal,
    openRunConfigTerminal,
    runConfigAction,
    runMarkdownCommand,
    renderMarkdownPre,
    toggleTerminalPanel,
    closeTerminal,
    renameTerminal,
    duplicateTerminal,
    moveTerminal,
    beginTerminalResize,
  };
}
