import type { RunProject, RunProjectProcess } from "./run-projects";
import type { JavaBreakpoint, JavaDebugState, LanguageDescriptor } from "@hatopad/protocol";
import { type Monaco } from "@monaco-editor/react";
import { useCallback } from "react";
import type {
  FileTreeNode,
  JavaApplyChangesResult,
  LanguageDebugCommand,
  JavaProjectOptions,
  JavaTypeSuggestion,
  RootedJavaDiagnostic,
  RootedJavaLspLocation,
  RootedWorkspaceSymbol,
  SearchResult,
} from "@hatopad/protocol";
import type { editor } from "monaco-editor";
import { CoreClient } from "./client";
import { type EditorTab, type LayoutModel } from "./model";
import { languageClient } from "./language-client";
import { projectRegistration, runProject } from "./run-projects";
import { type EditorLocation } from "./navigation-history";

export interface UseLanguageProjectActionsDeps {
  setLayout: React.Dispatch<React.SetStateAction<LayoutModel>>;
  setJavaRunning: React.Dispatch<React.SetStateAction<boolean>>;
  saveLaunchFiles: () => Promise<CoreClient>;
  setJavaLog: React.Dispatch<React.SetStateAction<string>>;
  setShowRunConfigurationDialog: React.Dispatch<React.SetStateAction<boolean>>;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  javaBreakpoints: JavaBreakpoint[];
  setJavaDebugState: React.Dispatch<React.SetStateAction<JavaDebugState>>;
  layoutRef: React.MutableRefObject<LayoutModel>;
  saveFileTab: (current: EditorTab) => Promise<boolean>;
  setJavaBreakpoints: React.Dispatch<React.SetStateAction<JavaBreakpoint[]>>;
  breakpointDecorationsRef: React.MutableRefObject<string[]>;
  javaPanelHeight: number;
  setJavaPanelHeight: React.Dispatch<React.SetStateAction<number>>;
  problemsHeight: number;
  setProblemsHeight: React.Dispatch<React.SetStateAction<number>>;
  gitLogHeight: number;
  setGitLogHeight: React.Dispatch<React.SetStateAction<number>>;
  selectedRootIdRef: React.MutableRefObject<string>;
  selectWorkspaceRootRef: React.MutableRefObject<(rootId: string) => Promise<void>>;
  rememberNavigation: (target: EditorLocation) => void;
  openFile: (node: FileTreeNode) => Promise<void>;
  setPendingNavigation: React.Dispatch<React.SetStateAction<{ result: SearchResult; matchLength: number } | undefined>>;
  setJavaUsages: React.Dispatch<React.SetStateAction<RootedJavaLspLocation[] | undefined>>;
  setWorkspaceSymbolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  importChoices:
    | {
        suggestions: JavaTypeSuggestion[];
        range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
      }
    | undefined;
  monacoEditorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | undefined>;
  setImportChoices: React.Dispatch<
    React.SetStateAction<
      | {
          suggestions: JavaTypeSuggestion[];
          range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
        }
      | undefined
    >
  >;
  taskSwitchActive: React.MutableRefObject<boolean>;
  selectedTaskIdRef: React.MutableRefObject<string | undefined>;
  activeWorkspaceRef: React.MutableRefObject<string>;
  runProjectGeneration: React.MutableRefObject<number>;
  languages: LanguageDescriptor[];
  setRunProjects: React.Dispatch<React.SetStateAction<RunProject[]>>;
  setSelectedLanguage: React.Dispatch<React.SetStateAction<string | undefined>>;
  setRunProjectBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setJavaOptions: React.Dispatch<React.SetStateAction<JavaProjectOptions | undefined>>;
  javaOptionsRef: React.MutableRefObject<JavaProjectOptions | undefined>;
  setStatusMessage: (message: string) => void;
  setTreeContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodes: FileTreeNode[] } | undefined>>;
  refreshJavaTree: () => Promise<void>;
  openRunConfigurations: (language?: string) => void;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
  runProjectBusy: boolean;
  runProjectProcesses: Record<string, RunProjectProcess>;
  setRunProjectProcesses: React.Dispatch<React.SetStateAction<Record<string, RunProjectProcess>>>;
  openTerminalReference: (terminalId: string, title: string) => Promise<boolean>;
}

export function useLanguageProjectActions(deps: UseLanguageProjectActionsDeps) {
  const {
    setLayout,
    setJavaRunning,
    saveLaunchFiles,
    setJavaLog,
    setShowRunConfigurationDialog,
    clientRef,
    javaBreakpoints,
    setJavaDebugState,
    layoutRef,
    saveFileTab,
    setJavaBreakpoints,
    breakpointDecorationsRef,
    javaPanelHeight,
    setJavaPanelHeight,
    problemsHeight,
    setProblemsHeight,
    gitLogHeight,
    setGitLogHeight,
    selectedRootIdRef,
    selectWorkspaceRootRef,
    rememberNavigation,
    openFile,
    setPendingNavigation,
    setJavaUsages,
    setWorkspaceSymbolsOpen,
    importChoices,
    monacoEditorRef,
    setImportChoices,
    taskSwitchActive,
    selectedTaskIdRef,
    activeWorkspaceRef,
    runProjectGeneration,
    languages,
    setRunProjects,
    setSelectedLanguage,
    setRunProjectBusy,
    setJavaOptions,
    javaOptionsRef,
    setStatusMessage,
    setTreeContextMenu,
    refreshJavaTree,
    openRunConfigurations,
    refreshTree,
    runProjectBusy,
    runProjectProcesses,
    setRunProjectProcesses,
    openTerminalReference,
  } = deps;

  const runJavaAction = async (action: "language.build" | "language.run") => {
    setLayout((current) => ({
      ...current,
      panels: [
        ...current.panels.filter((panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type)),
        { id: "languageOutput", type: "languageOutput" },
      ],
    }));
    setJavaRunning(true);
    try {
      const client = await saveLaunchFiles();
      await client.request(action, { language: "java" }, { timeoutMs: 10 * 60_000 });
    } catch (error) {
      setJavaRunning(false);
      setJavaLog((current) => `${current}${error instanceof Error ? error.message : "Java process failed"}\n`);
      if (error instanceof Error && error.message.includes("Java configuration")) setShowRunConfigurationDialog(true);
    }
  };

  const stopJava = async () => {
    try {
      await clientRef.current!.request("language.stop", { language: "java" });
    } catch {
      /* Process may have already exited. */
    }
  };

  const debugJava = async () => {
    setLayout((current) => ({
      ...current,
      panels: [
        ...current.panels.filter((panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type)),
        { id: "languageOutput", type: "languageOutput" },
      ],
    }));
    setJavaRunning(true);
    try {
      const client = await saveLaunchFiles();
      await languageClient(client, "java").startDebug(
        javaBreakpoints.map(({ className, ...breakpoint }) => ({ ...breakpoint, extra: { className } })),
        { timeoutMs: 10 * 60_000 },
      );
    } catch (error) {
      setJavaRunning(false);
      setJavaDebugState({ status: "stopped", variables: [] });
      setJavaLog((current) => `${current}${error instanceof Error ? error.message : "Debugger failed"}\n`);
      if (error instanceof Error && error.message.includes("Java configuration")) setShowRunConfigurationDialog(true);
    }
  };

  const applyJavaChanges = async () => {
    const client = clientRef.current;
    if (!client) throw new Error("Not connected");
    const rootId = client.getRoot();
    for (const tab of layoutRef.current.editorGroups.flatMap((item) => item.tabs)) {
      if (tab.type === "file" && tab.rootId === rootId && tab.dirty) {
        if (!(await saveFileTab(tab)))
          throw new Error(`Could not save ${tab.path}. Fix the save error before applying changes.`);
      }
    }
    if (clientRef.current !== client || client.getRoot() !== rootId)
      throw new Error("Workspace changed while saving edits");
    // JavaPanel still renders Java HotSwap details; this is the Java-specific result boundary.
    return languageClient(client, "java").applyChanges({
      timeoutMs: 10 * 60_000,
    }) as unknown as Promise<JavaApplyChangesResult>;
  };

  const commandJavaDebugger = async (command: LanguageDebugCommand) => {
    try {
      await languageClient(clientRef.current!, "java").debugCommand(command);
    } catch (error) {
      setJavaLog((current) => `${current}${error instanceof Error ? error.message : "Debugger command failed"}\n`);
    }
  };

  const toggleBreakpoint = (filePath: string, content: string, line: number) => {
    const packageName = content.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1];
    const simpleName =
      filePath
        .split("/")
        .pop()
        ?.replace(/\.java$/i, "") ?? "";
    const className = packageName ? `${packageName}.${simpleName}` : simpleName;
    setJavaBreakpoints((current) =>
      current.some((item) => item.path === filePath && item.line === line)
        ? current.filter((item) => item.path !== filePath || item.line !== line)
        : [...current, { path: filePath, line, className }],
    );
  };

  const decorateBreakpoints = (instance: editor.IStandaloneCodeEditor, filePath: string, api: Monaco) => {
    breakpointDecorationsRef.current = instance.deltaDecorations(
      breakpointDecorationsRef.current,
      javaBreakpoints
        .filter((item) => item.path === filePath)
        .map((item) => ({
          range: { startLineNumber: item.line, startColumn: 1, endLineNumber: item.line, endColumn: 1 },
          options: {
            isWholeLine: false,
            glyphMarginClassName: "java-breakpoint",
            glyphMargin: { position: api.editor.GlyphMarginLane.Center },
            glyphMarginHoverMessage: { value: `Breakpoint at line ${item.line}` },
          },
        })),
    );
  };

  const beginJavaResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = javaPanelHeight;
    const move = (moveEvent: PointerEvent) =>
      setJavaPanelHeight(Math.max(140, Math.min(520, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginProblemsResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = problemsHeight;
    const move = (moveEvent: PointerEvent) =>
      setProblemsHeight(Math.max(120, Math.min(520, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginGitLogResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = gitLogHeight;
    const move = (moveEvent: PointerEvent) =>
      setGitLogHeight(Math.max(180, Math.min(650, startHeight + startY - moveEvent.clientY)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const openDiagnostic = async (diagnostic: RootedJavaDiagnostic) => {
    if (diagnostic.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(diagnostic.rootId);
    rememberNavigation({
      rootId: diagnostic.rootId,
      path: diagnostic.path,
      line: diagnostic.line,
      column: diagnostic.column,
    });
    await openFile({ name: diagnostic.path.split("/").pop() ?? diagnostic.path, path: diagnostic.path, type: "file" });
    setPendingNavigation({
      result: {
        rootId: selectedRootIdRef.current,
        path: diagnostic.path,
        line: diagnostic.line,
        column: diagnostic.column,
        preview: diagnostic.message,
      },
      matchLength: 1,
    });
  };

  const openJavaLocation = async (location: RootedJavaLspLocation) => {
    if (location.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(location.rootId);
    rememberNavigation({
      rootId: location.rootId,
      path: location.path,
      line: location.startLine,
      column: location.startColumn,
    });
    await openFile({ name: location.path.split("/").pop() ?? location.path, path: location.path, type: "file" });
    setPendingNavigation({
      result: {
        rootId: selectedRootIdRef.current,
        path: location.path,
        line: location.startLine,
        column: location.startColumn,
        preview: "Java symbol",
      },
      matchLength: Math.max(1, location.endColumn - location.startColumn),
    });
    setJavaUsages(undefined);
  };

  const searchWorkspaceSymbols = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return { symbols: [], truncated: false };
    const result = await client.request("language.symbols", { language: "java", query, limit: 100 });
    return { symbols: result.symbols, truncated: result.truncated ?? false };
  }, []);

  const openWorkspaceSymbol = async (symbol: RootedWorkspaceSymbol) => {
    setWorkspaceSymbolsOpen(false);
    if (symbol.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(symbol.rootId);
    rememberNavigation({ rootId: symbol.rootId, path: symbol.path, line: symbol.line, column: symbol.column });
    await openFile({ name: symbol.path.split("/").pop() ?? symbol.path, path: symbol.path, type: "file" });
    setPendingNavigation({
      result: {
        rootId: selectedRootIdRef.current,
        path: symbol.path,
        line: symbol.line,
        column: symbol.column,
        preview: symbol.name,
      },
      matchLength: Math.max(1, symbol.name.length),
    });
  };

  const applyJavaImport = (suggestion: JavaTypeSuggestion, range = importChoices?.range) => {
    const instance = monacoEditorRef.current;
    const model = instance?.getModel();
    if (!instance || !model || !range) return;
    const content = model.getValue();
    const packageName = content.match(/^\s*package\s+([\w$.]+)\s*;/m)?.[1];
    const needsImport =
      suggestion.qualifiedName.includes(".") &&
      !suggestion.qualifiedName.startsWith("java.lang.") &&
      !suggestion.qualifiedName.startsWith(`${packageName}.`) &&
      !new RegExp(`^\\s*import\\s+${suggestion.qualifiedName.replaceAll(".", "\\.")}\\s*;`, "m").test(content);
    const edits: editor.IIdentifiedSingleEditOperation[] = [
      { range, text: suggestion.simpleName, forceMoveMarkers: true },
    ];
    if (needsImport) {
      const imports = [...content.matchAll(/^\s*import\s+[^;]+;\s*$/gm)];
      const packageMatch = content.match(/^\s*package\s+[\w$.]+\s*;\s*$/m);
      const offset =
        imports.at(-1)?.index !== undefined
          ? imports.at(-1)!.index! + imports.at(-1)![0].length
          : packageMatch?.index !== undefined
            ? packageMatch.index + packageMatch[0].length
            : 0;
      const position = model.getPositionAt(offset);
      edits.push({
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text: `${offset === 0 ? "" : "\n"}import ${suggestion.qualifiedName};\n`,
        forceMoveMarkers: true,
      });
    }
    instance.executeEdits("java-auto-import", edits);
    instance.focus();
    setImportChoices(undefined);
  };

  const refreshRunProjects = useCallback(
    async (client = clientRef.current) => {
      if (!client || !client.isConnected() || taskSwitchActive.current) return;
      const root = client.getRoot();
      const task = selectedTaskIdRef.current;
      const workspace = activeWorkspaceRef.current;
      const generation = ++runProjectGeneration.current;
      const results = await Promise.allSettled(
        languages
          .filter((language) => language.capabilities.run)
          .map(async (language) => {
            const { options } = await client.request("language.options", { language: language.id });
            return runProject(language, options);
          }),
      );
      if (
        generation !== runProjectGeneration.current ||
        clientRef.current !== client ||
        client.getRoot() !== root ||
        selectedTaskIdRef.current !== task ||
        activeWorkspaceRef.current !== workspace ||
        taskSwitchActive.current
      )
        return;
      const projects = results.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
      setRunProjects(projects);
      setSelectedLanguage((current) =>
        projects.some((project) => project.language === current) ? current : projects[0]?.language,
      );
    },
    [languages],
  );

  const selectProjectRunConfiguration = async (language: string, id: string) => {
    const client = clientRef.current;
    if (!client || taskSwitchActive.current) return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    setRunProjectBusy(true);
    try {
      await languageClient(client, language).request("language.selectRunConfiguration", { id });
      if (clientRef.current !== client || client.getRoot() !== root || task !== selectedTaskIdRef.current) return;
      setSelectedLanguage(language);
      await refreshRunProjects(client);
      const java = await client.request("java.getOptions", {});
      if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current) {
        setJavaOptions(java.options);
        javaOptionsRef.current = java.options;
      }
    } catch (error) {
      if (clientRef.current === client && client.getRoot() === root)
        setStatusMessage(error instanceof Error ? error.message : "Could not select run configuration");
    } finally {
      if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current)
        setRunProjectBusy(false);
    }
  };

  const registerRunProject = async (path: string) => {
    const registration = projectRegistration(path);
    const client = clientRef.current;
    setTreeContextMenu(undefined);
    if (!registration || !client || taskSwitchActive.current) return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    setRunProjectBusy(true);
    try {
      await languageClient(client, registration.language).request("language.load", { extra: registration.extra });
      if (clientRef.current !== client || client.getRoot() !== root || task !== selectedTaskIdRef.current) return;
      const java = await client.request("java.getOptions", {});
      if (clientRef.current !== client || client.getRoot() !== root || task !== selectedTaskIdRef.current) return;
      setJavaOptions(java.options);
      javaOptionsRef.current = java.options;
      if (java.options) void refreshJavaTree();
      await refreshRunProjects(client);
      if (
        clientRef.current !== client ||
        client.getRoot() !== root ||
        task !== selectedTaskIdRef.current ||
        taskSwitchActive.current
      )
        return;
      openRunConfigurations(registration.language);
      void refreshTree();
    } catch (error) {
      if (clientRef.current === client && client.getRoot() === root)
        setStatusMessage(error instanceof Error ? error.message : "Could not add project");
    } finally {
      if (clientRef.current === client && client.getRoot() === root && task === selectedTaskIdRef.current)
        setRunProjectBusy(false);
    }
  };

  const launchProjectConfiguration = async (language: string, debug = false) => {
    if (runProjectBusy || taskSwitchActive.current || runProjectProcesses[language]?.running) return;
    const client = clientRef.current;
    if (!client) return;
    const root = client.getRoot();
    const task = selectedTaskIdRef.current;
    const current = () =>
      clientRef.current === client &&
      client.getRoot() === root &&
      selectedTaskIdRef.current === task &&
      !taskSwitchActive.current;
    setSelectedLanguage(language);
    setRunProjectProcesses((states) => ({
      ...states,
      [language]: { ...(states[language] ?? { log: "" }), running: true, error: undefined },
    }));
    try {
      await saveLaunchFiles();
      if (!current()) return;
      if (debug)
        await languageClient(client, language).startDebug(
          language === "java"
            ? javaBreakpoints.map(({ className, ...breakpoint }) => ({ ...breakpoint, extra: { className } }))
            : [],
          { timeoutMs: 10 * 60_000 },
        );
      else {
        const { terminal } = await languageClient(client, language).request(
          "language.run",
          {},
          { timeoutMs: 10 * 60_000 },
        );
        if (current()) await openTerminalReference(terminal.terminalId, terminal.displayName ?? "Run");
      }
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : "Run failed";
        setRunProjectProcesses((states) => ({
          ...states,
          [language]: { ...(states[language] ?? { log: "" }), running: false, error: message },
        }));
        setStatusMessage(message);
      }
    }
  };

  const stopProjectConfiguration = async (language: string) => {
    try {
      await languageClient(clientRef.current!, language).request("language.stop", {});
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not stop project");
    }
  };
  return {
    runJavaAction,
    stopJava,
    debugJava,
    applyJavaChanges,
    commandJavaDebugger,
    toggleBreakpoint,
    decorateBreakpoints,
    beginJavaResize,
    beginProblemsResize,
    beginGitLogResize,
    openDiagnostic,
    openJavaLocation,
    searchWorkspaceSymbols,
    openWorkspaceSymbol,
    applyJavaImport,
    refreshRunProjects,
    selectProjectRunConfiguration,
    registerRunProject,
    launchProjectConfiguration,
    stopProjectConfiguration,
  };
}
