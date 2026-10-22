import type { HttpResponse, LanguageDebugState, JavaDebugState, GitStatusEntry } from "@hatopad/protocol";
import { selectedLineRange, gitHunkDecorations, ParsedHttpRequest, parseHttpRequests } from "./editor-helpers";
import { type Monaco } from "@monaco-editor/react";
import type { FileTreeNode, GitDiffHunk, RootedJavaLspLocation, SearchResult } from "@hatopad/protocol";
import type { editor } from "monaco-editor";
import { CoreClient } from "./client";
import { type EditorTab, type LayoutModel } from "./model";
import { languageClient } from "./language-client";
import { attachDebugEditor } from "./debug-editor";
import { functionStartDecorations, navigationFunctionStarts } from "./function-markers";
import { type HighlightTheme } from "./theme";
import { CursorPositionStore, validateCursorPosition } from "./cursor-state";
import { type EditorStatusBarHandle } from "./EditorStatusBar";
import { EditorViewStateStore } from "./editor-view-state";
import { NavigationHistory } from "./navigation-history";

export interface UseEditorIntegrationDeps {
  navigationHistory: React.MutableRefObject<NavigationHistory>;
  selectedRootIdRef: React.MutableRefObject<string>;
  selectWorkspaceRootRef: React.MutableRefObject<(rootId: string) => Promise<void>>;
  openFile: (node: FileTreeNode) => Promise<void>;
  setPendingNavigation: React.Dispatch<React.SetStateAction<{ result: SearchResult; matchLength: number } | undefined>>;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  setHttpResult: React.Dispatch<
    React.SetStateAction<
      { request: ParsedHttpRequest; response?: HttpResponse; error?: string; loading: boolean } | undefined
    >
  >;
  debugEditorRef: React.MutableRefObject<{ update(next: LanguageDebugState): void; dispose(): void } | undefined>;
  monacoEditorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | undefined>;
  activeTab: EditorTab | undefined;
  editorViewStates: EditorViewStateStore;
  editorStatusBarRef: React.RefObject<EditorStatusBarHandle>;
  monacoRef: React.MutableRefObject<typeof import("monaco-editor") | undefined>;
  gitDecorationsRef: React.MutableRefObject<string[]>;
  activeGitHunksRef: React.MutableRefObject<GitDiffHunk[]>;
  javaLanguageDisposables: React.MutableRefObject<{ dispose(): void }[]>;
  cursorPositions: CursorPositionStore;
  javaDebugStateRef: React.MutableRefObject<JavaDebugState>;
  breakpointDecorationsRef: React.MutableRefObject<string[]>;
  decorateBreakpoints: (instance: editor.IStandaloneCodeEditor, filePath: string, api: Monaco) => void;
  setEditorGitMenu: React.Dispatch<
    React.SetStateAction<
      { x: number; y: number; path: string; startLine?: number; endLine?: number; content?: string } | undefined
    >
  >;
  gitEntries: GitStatusEntry[];
  openGitHunkDialog: (path: string, hunk: GitDiffHunk, x: number, y: number) => Promise<void>;
  highlightTheme: HighlightTheme;
  theme: "dark" | "light";
  refreshJavaSemanticRef: React.MutableRefObject<(() => void) | undefined>;
  toggleBreakpoint: (filePath: string, content: string, line: number) => void;
  setJavaUsages: React.Dispatch<React.SetStateAction<RootedJavaLspLocation[] | undefined>>;
  openJavaLocation: (location: RootedJavaLspLocation) => Promise<void>;
  setStatusMessage: (message: string) => void;
  monacoDiffEditorRef: React.MutableRefObject<editor.IStandaloneDiffEditor | undefined>;
  diffRollbackTimer: React.MutableRefObject<NodeJS.Timeout | undefined>;
  layoutRef: React.MutableRefObject<LayoutModel>;
  selfWriteUntil: React.MutableRefObject<Map<string, number>>;
  updateGroup: (update: (tabs: EditorTab[], active?: string) => { tabs: EditorTab[]; activeTabId?: string }) => void;
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
}

export function useEditorIntegration(deps: UseEditorIntegrationDeps) {
  const {
    navigationHistory,
    selectedRootIdRef,
    selectWorkspaceRootRef,
    openFile,
    setPendingNavigation,
    clientRef,
    setHttpResult,
    debugEditorRef,
    monacoEditorRef,
    activeTab,
    editorViewStates,
    editorStatusBarRef,
    monacoRef,
    gitDecorationsRef,
    activeGitHunksRef,
    javaLanguageDisposables,
    cursorPositions,
    javaDebugStateRef,
    breakpointDecorationsRef,
    decorateBreakpoints,
    setEditorGitMenu,
    gitEntries,
    openGitHunkDialog,
    highlightTheme,
    theme,
    refreshJavaSemanticRef,
    toggleBreakpoint,
    setJavaUsages,
    openJavaLocation,
    setStatusMessage,
    monacoDiffEditorRef,
    diffRollbackTimer,
    layoutRef,
    selfWriteUntil,
    updateGroup,
    refreshGit,
    refreshTree,
  } = deps;

  const navigateHistory = async (direction: "back" | "forward") => {
    const location = direction === "back" ? navigationHistory.current.back() : navigationHistory.current.forward();
    if (!location) return;
    if (location.rootId !== selectedRootIdRef.current) await selectWorkspaceRootRef.current(location.rootId);
    await openFile({ name: location.path.split("/").pop() ?? location.path, path: location.path, type: "file" });
    setPendingNavigation({ result: { ...location, preview: "Recent location" }, matchLength: 1 });
  };

  const runHttpRequest = async (request: ParsedHttpRequest) => {
    if (!clientRef.current) return;
    setHttpResult({ request, loading: true });
    // A late completion only updates the panel while this request is still the open, current one.
    const settle = (result: { response?: HttpResponse; error?: string }) =>
      setHttpResult((current) => (current?.request === request ? { request, ...result, loading: false } : current));
    try {
      settle({ response: await clientRef.current.request("http.execute", request) });
    } catch (error) {
      settle({ error: error instanceof Error ? error.message : "HTTP request failed" });
    }
  };

  const mountEditor = (instance: editor.IStandaloneCodeEditor, api: Monaco) => {
    debugEditorRef.current?.dispose();
    debugEditorRef.current = undefined;
    monacoEditorRef.current = instance;
    const restoredViewState = activeTab ? editorViewStates.mount(activeTab.id, instance) : false;
    editorStatusBarRef.current?.attach(instance);
    monacoRef.current = api;
    gitDecorationsRef.current = instance.deltaDecorations(
      [],
      gitHunkDecorations(activeTab?.type === "file" ? activeGitHunksRef.current : []),
    );
    for (const disposable of javaLanguageDisposables.current) disposable.dispose();
    javaLanguageDisposables.current = [];
    if (
      activeTab?.type !== "file" &&
      activeTab?.type !== "useful" &&
      activeTab?.type !== "runConfig" &&
      activeTab?.type !== "agent" &&
      activeTab?.type !== "skill"
    )
      return;
    const model = instance.getModel();
    const savedCursor = model ? validateCursorPosition(cursorPositions.get(activeTab), model) : undefined;
    if (savedCursor && !restoredViewState) instance.setPosition(savedCursor);
    javaLanguageDisposables.current.push(
      instance.onDidChangeCursorPosition((event) => cursorPositions.update(activeTab, event.position)),
    );
    const filePath = activeTab.path;
    if (activeTab.type === "file" && /\.java$/i.test(filePath)) {
      const client = clientRef.current!;
      const rootId = client.getRoot();
      debugEditorRef.current = attachDebugEditor(instance, api, filePath, (reference, start) => {
        if (clientRef.current !== client || client.getRoot() !== rootId)
          return Promise.reject(new Error("Workspace changed"));
        return languageClient(client, "java").debugVariables(reference, start);
      });
      debugEditorRef.current.update({ ...javaDebugStateRef.current, busy: javaDebugStateRef.current.applyingChanges });
    }
    breakpointDecorationsRef.current = [];
    if (activeTab.type === "file") decorateBreakpoints(instance, filePath, api);
    if (activeTab.type === "file")
      javaLanguageDisposables.current.push(
        instance.onContextMenu((event) => {
          event.event.preventDefault();
          const selection = instance.getSelection();
          const hasSelection = Boolean(selection && !selection.isEmpty());
          setEditorGitMenu({
            x: Math.min(event.event.posx, window.innerWidth - 245),
            y: Math.min(event.event.posy, window.innerHeight - 85),
            path: filePath,
            ...(hasSelection ? { ...selectedLineRange(selection!), content: instance.getModel()?.getValue() } : {}),
          });
        }),
      );
    if (activeTab.type === "file")
      javaLanguageDisposables.current.push(
        instance.onMouseDown((event) => {
          const element = event.target.element as HTMLElement | null;
          if (!element?.closest(".git-change-marker")) return;
          const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber;
          const hunk = line
            ? activeGitHunksRef.current.find(
                (item) =>
                  line >= Math.max(1, item.modifiedStart) &&
                  line <= Math.max(1, item.modifiedStart) + Math.max(1, item.modifiedLines) - 1,
              )
            : undefined;
          const entry = gitEntries.find((item) => item.path === filePath);
          if (!hunk || !entry) return;
          void openGitHunkDialog(filePath, hunk, event.event.posx, event.event.posy);
        }),
      );
    if (/\.http$/i.test(filePath)) {
      let decorations: string[] = [];
      const decorate = () => {
        decorations = instance.deltaDecorations(
          decorations,
          parseHttpRequests(instance.getValue()).map((request) => ({
            range: { startLineNumber: request.line, startColumn: 1, endLineNumber: request.line, endColumn: 1 },
            options: {
              glyphMarginClassName: "http-run-marker",
              glyphMarginHoverMessage: { value: `Run ${request.method} ${request.url}` },
            },
          })),
        );
      };
      decorate();
      javaLanguageDisposables.current.push(instance.onDidChangeModelContent(decorate));
      javaLanguageDisposables.current.push(
        instance.onMouseDown((event) => {
          if (!(event.target.element as HTMLElement | null)?.closest(".http-run-marker")) return;
          const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber;
          const request = parseHttpRequests(instance.getValue()).find((item) => item.line === line);
          if (request) void runHttpRequest(request);
        }),
      );
      return;
    }
    if (activeTab.type !== "file") return;
    if (model && ["javascript", "typescript"].includes(model.getLanguageId())) {
      const markerCollection = instance.createDecorationsCollection();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generation = 0;
      let disposed = false;
      const decorate = async () => {
        const requestGeneration = ++generation;
        const version = model.getVersionId();
        try {
          const getWorker = await (model.getLanguageId() === "typescript"
            ? api.languages.typescript.getTypeScriptWorker()
            : api.languages.typescript.getJavaScriptWorker());
          const worker = await getWorker(model.uri);
          const tree = await worker.getNavigationTree(model.uri.toString());
          if (!disposed && requestGeneration === generation && version === model.getVersionId())
            markerCollection.set(functionStartDecorations(navigationFunctionStarts(tree, model)));
        } catch {
          if (!disposed && requestGeneration === generation) markerCollection.clear();
        }
      };
      void decorate();
      javaLanguageDisposables.current.push(
        instance.onDidChangeModelContent(() => {
          ++generation;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void decorate(), 300);
        }),
      );
      javaLanguageDisposables.current.push({
        dispose: () => {
          disposed = true;
          if (timer) clearTimeout(timer);
          markerCollection.clear();
        },
      });
    }
    if (!/\.java$/i.test(filePath)) return;
    let lexicalDecorations: string[] = [];
    const decorateJavaLexicalTokens = () => {
      const decorations: editor.IModelDeltaDecoration[] = [];
      if (highlightTheme === "ftpud" && theme === "light") {
        const content = instance.getValue();
        const lines = content.split(/\r?\n/);
        api.editor.tokenize(content, "java").forEach((tokens, line) =>
          tokens.forEach((token, index) => {
            const kind =
              token.type.startsWith("string.escape.invalid") || token.type.startsWith("string.invalid")
                ? "invalid"
                : token.type.startsWith("string.escape")
                  ? "escape"
                  : token.type.startsWith("string")
                    ? "string"
                    : token.type.startsWith("annotation")
                      ? "annotation"
                      : undefined;
            if (kind)
              decorations.push({
                range: {
                  startLineNumber: line + 1,
                  startColumn: token.offset + 1,
                  endLineNumber: line + 1,
                  endColumn: (tokens[index + 1]?.offset ?? lines[line]?.length ?? 0) + 1,
                },
                options: { inlineClassName: `ftpud-java-${kind}`, inlineClassNameAffectsLetterSpacing: true },
              });
          }),
        );
      }
      lexicalDecorations = instance.deltaDecorations(lexicalDecorations, decorations);
    };
    decorateJavaLexicalTokens();
    javaLanguageDisposables.current.push(instance.onDidChangeModelContent(decorateJavaLexicalTokens));
    javaLanguageDisposables.current.push({
      dispose: () => {
        instance.deltaDecorations(lexicalDecorations, []);
      },
    });
    const functionMarkers = instance.createDecorationsCollection();
    let semanticGeneration = 0;
    let semanticDisposed = false;
    let semanticDecorations: string[] = [];
    let semanticTimer: ReturnType<typeof setTimeout> | undefined;
    const decorateJavaTypes = async () => {
      if (!clientRef.current) {
        semanticDecorations = instance.deltaDecorations(semanticDecorations, []);
        functionMarkers.clear();
        return;
      }
      const generation = ++semanticGeneration;
      const version = instance.getModel()?.getVersionId();
      try {
        const result = await clientRef.current.request("language.lsp.semanticTokens", {
          language: "java",
          path: filePath,
          content: instance.getValue(),
        });
        if (semanticDisposed || generation !== semanticGeneration || version !== instance.getModel()?.getVersionId())
          return;
        functionMarkers.set(
          functionStartDecorations(
            result.tokens
              .filter(
                (token) =>
                  ["function", "method", "constructor"].includes(token.type) &&
                  (token.modifiers.includes("declaration") || token.modifiers.includes("definition")),
              )
              .map((token) => ({
                line: token.startLine,
                name:
                  instance.getModel()?.getValueInRange({
                    startLineNumber: token.startLine,
                    startColumn: token.startColumn,
                    endLineNumber: token.endLine,
                    endColumn: token.endColumn,
                  }) ?? "",
              })),
          ),
        );
        if (highlightTheme !== "ftpud") {
          semanticDecorations = instance.deltaDecorations(semanticDecorations, []);
          return;
        }
        semanticDecorations = instance.deltaDecorations(
          semanticDecorations,
          result.tokens.flatMap((token) => {
            const constant =
              (token.modifiers.includes("readonly") || token.type === "enumMember") &&
              (token.modifiers.includes("static") || token.type === "enumMember");
            const kind = constant
              ? "constant"
              : token.type === "interface"
                ? "interface"
                : ["class", "type", "enum", "struct"].includes(token.type)
                  ? "class"
                  : token.type === "decorator"
                    ? "annotation"
                    : ["property", "field"].includes(token.type)
                      ? token.modifiers.includes("static")
                        ? "static-field"
                        : "field"
                      : ["function", "method", "constructor"].includes(token.type)
                        ? theme === "dark" || token.modifiers.includes("declaration") || token.type === "constructor"
                          ? "function"
                          : token.modifiers.includes("static")
                            ? "static-method"
                            : undefined
                        : undefined;
            return kind
              ? [
                  {
                    range: {
                      startLineNumber: token.startLine,
                      startColumn: token.startColumn,
                      endLineNumber: token.endLine,
                      endColumn: token.endColumn,
                    },
                    options: {
                      inlineClassName: `ftpud${theme === "dark" ? "-dark" : ""}-java-${kind}`,
                      inlineClassNameAffectsLetterSpacing: true,
                    },
                  },
                ]
              : [];
          }),
        );
      } catch {
        if (!semanticDisposed && generation === semanticGeneration) {
          semanticDecorations = instance.deltaDecorations(semanticDecorations, []);
          functionMarkers.clear();
        }
      }
    };
    refreshJavaSemanticRef.current = () => {
      void decorateJavaTypes();
    };
    void decorateJavaTypes();
    javaLanguageDisposables.current.push(
      instance.onDidChangeModelContent(() => {
        ++semanticGeneration;
        if (semanticTimer) clearTimeout(semanticTimer);
        semanticTimer = setTimeout(() => void decorateJavaTypes(), 500);
      }),
    );
    javaLanguageDisposables.current.push({
      dispose: () => {
        semanticDisposed = true;
        refreshJavaSemanticRef.current = undefined;
        if (semanticTimer) clearTimeout(semanticTimer);
        functionMarkers.clear();
        instance.deltaDecorations(semanticDecorations, []);
      },
    });
    javaLanguageDisposables.current.push(
      api.languages.registerCompletionItemProvider("java", {
        triggerCharacters: ["."],
        provideCompletionItems: async (model, position) => {
          if (!clientRef.current || model !== instance.getModel()) return { suggestions: [] };
          const result = await clientRef.current.request("language.lsp.completion", {
            language: "java",
            path: filePath,
            content: model.getValue(),
            line: position.lineNumber,
            column: position.column,
          });
          const word = model.getWordUntilPosition(position);
          return {
            suggestions: result.items.map((item) => ({
              label: item.label,
              detail: item.detail,
              kind: api.languages.CompletionItemKind.Text,
              insertText: item.insertText,
              range: item.range
                ? {
                    startLineNumber: item.range.startLine,
                    startColumn: item.range.startColumn,
                    endLineNumber: item.range.endLine,
                    endColumn: item.range.endColumn,
                  }
                : {
                    startLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endLineNumber: position.lineNumber,
                    endColumn: word.endColumn,
                  },
              additionalTextEdits: item.additionalTextEdits.map((edit) => ({
                range: {
                  startLineNumber: edit.range.startLine,
                  startColumn: edit.range.startColumn,
                  endLineNumber: edit.range.endLine,
                  endColumn: edit.range.endColumn,
                },
                text: edit.text,
              })),
            })),
          };
        },
      }),
    );
    javaLanguageDisposables.current.push(
      instance.addAction({
        id: "java.semantic-completion",
        label: "Java completion",
        keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.Enter, api.KeyMod.WinCtrl | api.KeyCode.Enter],
        run: () => instance.trigger("java", "editor.action.triggerSuggest", {}),
      }),
    );
    javaLanguageDisposables.current.push(
      instance.onMouseDown((event) => {
        if ((event.target.element as HTMLElement | null)?.closest(".git-change-marker, .function-start-marker")) return;
        const line = event.target.position?.lineNumber ?? event.target.range?.startLineNumber;
        if ((event.target.type === 2 || event.target.type === 3) && line) {
          toggleBreakpoint(filePath, instance.getValue(), line);
          return;
        }
        const position = event.target.position;
        if (!position || (!event.event.ctrlKey && !event.event.metaKey) || !clientRef.current) return;
        event.event.preventDefault();
        const content = instance.getValue();
        const navigationRoot = clientRef.current.getRoot();
        void clientRef.current
          .request("language.lsp.definition", {
            language: "java",
            path: filePath,
            content,
            line: position.lineNumber,
            column: position.column,
          })
          .then(async ({ locations }) => {
            if (navigationRoot !== selectedRootIdRef.current) return;
            const declaration = locations.find(
              (location) =>
                location.path === filePath &&
                position.lineNumber >= location.startLine &&
                position.lineNumber <= location.endLine &&
                position.column >= location.startColumn &&
                position.column <= location.endColumn,
            );
            if (declaration) {
              const references = await clientRef.current!.request("language.lsp.references", {
                language: "java",
                path: filePath,
                content,
                line: position.lineNumber,
                column: position.column,
              });
              if (navigationRoot === selectedRootIdRef.current) setJavaUsages(references.locations);
            } else if (locations[0]) void openJavaLocation(locations[0]);
          })
          .catch((error: unknown) =>
            setStatusMessage(error instanceof Error ? error.message : "Java navigation failed"),
          );
      }),
    );
  };

  const mountWorkingDiff = (instance: editor.IStandaloneDiffEditor) => {
    editorViewStates.clearMounted();
    monacoDiffEditorRef.current = instance;
    editorStatusBarRef.current?.attach(instance.getModifiedEditor());
    if (activeTab?.type === "diff") {
      const modifiedEditor = instance.getModifiedEditor();
      const model = modifiedEditor.getModel();
      const savedCursor = model ? validateCursorPosition(cursorPositions.get(activeTab), model) : undefined;
      if (savedCursor) modifiedEditor.setPosition(savedCursor);
      modifiedEditor.onDidChangeCursorPosition((event) => cursorPositions.update(activeTab, event.position));
    }
    instance.getModifiedEditor().onDidChangeModelContent(() => {
      if (diffRollbackTimer.current) clearTimeout(diffRollbackTimer.current);
      diffRollbackTimer.current = setTimeout(async () => {
        const current = layoutRef.current.editorGroups[0];
        const tab = current?.tabs.find((item) => item.id === current.activeTabId);
        if (!tab || tab.type !== "diff" || !clientRef.current) return;
        const content = instance.getModifiedEditor().getValue();
        const untracked = gitEntries.some(
          (entry) => entry.path === tab.path && entry.indexStatus === "?" && entry.worktreeStatus === "?",
        );
        try {
          if (untracked && !content) await clientRef.current.request("git.rollback", { path: tab.path });
          else {
            selfWriteUntil.current.set(tab.path, Date.now() + 1500);
            await clientRef.current.request("filesystem.writeFile", { path: tab.path, content });
          }
          updateGroup((tabs, active) => ({
            tabs: tabs.map((item) =>
              item.id === tab.id ? { ...item, content, savedContent: content, dirty: false } : item,
            ),
            activeTabId: active,
          }));
          await Promise.all([refreshGit(), refreshTree()]);
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : "Could not rollback change block");
        }
      }, 200);
    });
  };
  return { navigateHistory, runHttpRequest, mountEditor, mountWorkingDiff };
}
