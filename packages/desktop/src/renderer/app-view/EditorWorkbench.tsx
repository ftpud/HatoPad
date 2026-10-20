import { selectedLineRange } from "../editor-helpers";
import { DiffEditor } from "@monaco-editor/react";
import {
  ChevronRight,
  Columns2,
  Eye,
  File,
  Folder,
  GitCompareArrows,
  ListTree,
  Pencil,
  Save,
  Workflow,
  X,
} from "lucide-react";
import { editorTabLabel } from "../model";
import { DiffNavigation } from "../DiffNavigation";
import { configureMonacoThemes, monacoTheme } from "../theme";
import { MarkdownPreview } from "../MarkdownPreview";
import { EditorStatusBar } from "../EditorStatusBar";
import { StableEditor } from "../StableEditor";
import { languageByExtension } from "../app-shared";
import type { AppViewContext } from "./view-types";

export function EditorWorkbench({ context }: { context: AppViewContext }) {
  const {
    selectedRootId,
    activeWorkspace,
    selectedTaskId,
    updateGroup,
    harnesses,
    setStatusMessage,
    harnessesLoading,
    status,
    taskSwitching,
    theme,
    highlightTheme,
    uiFontSize,
    activeTab,
    projectGitStatuses,
    openFile,
    group,
    draggedTabId,
    setDraggedTabId,
    moveTab,
    setTabContextMenu,
    closeTab,
    activateEditorTab,
    saveActive,
    monacoEditorRef,
    setEditorGitMenu,
    setQuickOpen,
    mountWorkingDiff,
    editorFontFamily,
    editorLineHeight,
    monacoDiffEditorRef,
    renderMarkdownPre,
    openSkillFile,
    mountEditor,
    editorStatusBarRef,
    httpResult,
    setHttpResult,
    renderWorkflowPanel,
  } = context;
  return (
    <main className="workbench">
      <div className="tabs" role="tablist" aria-label="Open editors">
        {group.tabs.map((tab) => {
          const label = editorTabLabel(tab);
          return (
            <div
              className={`tab ${tab.pinned ? "pinned" : ""} ${tab.id === group.activeTabId ? "active" : ""} ${tab.id === draggedTabId ? "dragging" : ""}`}
              role="tab"
              aria-selected={tab.id === group.activeTabId}
              aria-label={tab.pinned ? `${label} (pinned)` : label}
              tabIndex={tab.id === group.activeTabId ? 0 : -1}
              title={`${label}${tab.pinned ? " · Pinned" : ""} · Ctrl+Tab to switch · Ctrl/Cmd+W to close`}
              key={tab.id}
              draggable
              onDragStart={(event) => {
                setDraggedTabId(tab.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tab.id);
              }}
              onDragEnd={() => setDraggedTabId(undefined)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                moveTab(tab.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setTabContextMenu({
                  x: Math.min(event.clientX, window.innerWidth - 220),
                  y: Math.min(event.clientY, window.innerHeight - 125),
                  tab,
                });
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(tab);
                }
              }}
              onClick={() => void activateEditorTab(tab)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void activateEditorTab(tab);
                }
              }}
            >
              {tab.type === "workflow" ? (
                <Workflow size={14} />
              ) : tab.type === "diff" ? (
                <GitCompareArrows size={14} />
              ) : (
                <File size={14} />
              )}
              <span
                className={
                  tab.type === "file" && tab.rootId === selectedRootId && projectGitStatuses[tab.path]
                    ? `tab-file-name git-${projectGitStatuses[tab.path] === "C" ? "created" : "modified"}`
                    : "tab-file-name"
                }
              >
                {label}
              </span>
              {tab.dirty && <span className="dirty" title="Unsaved changes" />}
              <button
                type="button"
                className="close"
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <div className="tab-spacer" />
        {activeTab?.type === "diff" && (
          <div className="editor-mode-switch" aria-label="Diff layout">
            <button
              className={activeTab.diffMode === "split" ? "active" : ""}
              title="Side-by-side diff"
              onClick={() =>
                updateGroup((tabs, active) => ({
                  tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, diffMode: "split" } : tab)),
                  activeTabId: active,
                }))
              }
            >
              <Columns2 size={14} />
            </button>
            <button
              className={activeTab.diffMode !== "split" ? "active" : ""}
              title="Unified diff"
              onClick={() =>
                updateGroup((tabs, active) => ({
                  tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, diffMode: "unified" } : tab)),
                  activeTabId: active,
                }))
              }
            >
              <ListTree size={14} />
            </button>
          </div>
        )}
        {(activeTab?.type === "file" ||
          activeTab?.type === "useful" ||
          activeTab?.type === "agent" ||
          activeTab?.type === "skill" ||
          activeTab?.type === "workflowDocument") &&
          /\.md$/i.test(activeTab.path) && (
            <div className="editor-mode-switch" aria-label="Markdown mode">
              <button
                className={activeTab.markdownMode !== "preview" ? "active" : ""}
                title="Edit Markdown"
                onClick={() =>
                  updateGroup((tabs, active) => ({
                    tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, markdownMode: "edit" } : tab)),
                    activeTabId: active,
                  }))
                }
              >
                <Pencil size={14} />
              </button>
              <button
                className={activeTab.markdownMode === "preview" ? "active" : ""}
                title="Preview Markdown"
                onClick={() =>
                  updateGroup((tabs, active) => ({
                    tabs: tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, markdownMode: "preview" } : tab)),
                    activeTabId: active,
                  }))
                }
              >
                <Eye size={14} />
              </button>
            </div>
          )}
        <button
          className="save-button"
          title="Save active file"
          disabled={
            (activeTab?.type !== "file" &&
              activeTab?.type !== "useful" &&
              activeTab?.type !== "runConfig" &&
              activeTab?.type !== "agent" &&
              activeTab?.type !== "skill") ||
            !activeTab.dirty
          }
          onClick={() => void saveActive()}
        >
          <Save size={15} />
        </button>
      </div>
      <div
        className="editor-area"
        key={`editor-area:${theme}:${highlightTheme}`}
        onContextMenu={(event) => {
          if (activeTab?.type !== "file" || activeTab.markdownMode === "preview") return;
          event.preventDefault();
          const selection = monacoEditorRef.current?.getSelection();
          const hasSelection = Boolean(selection && !selection.isEmpty());
          setEditorGitMenu({
            x: Math.min(event.clientX, window.innerWidth - 245),
            y: Math.min(event.clientY, window.innerHeight - 85),
            path: activeTab.path,
            ...(hasSelection
              ? { ...selectedLineRange(selection!), content: monacoEditorRef.current?.getModel()?.getValue() }
              : {}),
          });
        }}
      >
        {group.tabs
          .filter((tab) => tab.type === "workflow" && tab.rootId === selectedRootId)
          .map((tab) => (
            <div className="workflow-editor-tab" key={tab.id} hidden={tab.id !== group.activeTabId}>
              {taskSwitching ? (
                <p role="status">Switching workspace…</p>
              ) : tab.workflowTaskId !== selectedTaskId ? (
                <div className="harness-empty">
                  <Workflow size={30} />
                  <strong>This workflow belongs to another task</strong>
                  <button onClick={() => void activateEditorTab(tab)}>Switch to workflow task</button>
                </div>
              ) : harnessesLoading ? (
                <p role="status">Loading workflow…</p>
              ) : !harnesses.some((workflow) => workflow.id === tab.workflowId) ? (
                <div className="harness-empty">
                  <Workflow size={30} />
                  <strong>Workflow unavailable</strong>
                  <span>This workflow may have been deleted.</span>
                </div>
              ) : (
                renderWorkflowPanel(tab)
              )}
            </div>
          ))}
        {!activeTab ? (
          <div className="empty-editor">
            <div className="workspace-welcome">
              <span className="branding-mark welcome-branding" aria-hidden="true" />
              <h1>
                Your workspace,
                <br />
                <span>ready.</span>
              </h1>
              <p>Explore your project, build with an agent, or run a workflow.</p>
              <button onClick={() => setQuickOpen(true)}>
                <Folder size={18} />
                <span>Open a file</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        ) : activeTab.loading ? (
          <div className="empty-editor">Loading {activeTab.title}...</div>
        ) : activeTab.error && !activeTab.content ? (
          <div className="editor-error">{activeTab.error}</div>
        ) : (
          <>
            {activeTab.error && <div className="inline-error">{activeTab.error}</div>}
            {activeTab.type === "workflow" ? null : activeTab.type === "diff" ? (
              <>
                <DiffEditor
                  key={`${activeTab.id}:${activeTab.diffMode ?? "unified"}`}
                  original={activeTab.originalContent ?? ""}
                  modified={activeTab.content}
                  language={languageByExtension[activeTab.path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext"}
                  beforeMount={configureMonacoThemes}
                  theme={monacoTheme(theme, highlightTheme)}
                  onMount={mountWorkingDiff}
                  options={{
                    automaticLayout: true,
                    readOnly: false,
                    originalEditable: false,
                    renderMarginRevertIcon: true,
                    renderSideBySide: activeTab.diffMode === "split",
                    useInlineViewWhenSpaceIsLimited: false,
                    minimap: { enabled: false },
                    fontFamily: editorFontFamily,
                    fontWeight: "normal",
                    fontSize: uiFontSize,
                    lineHeight: editorLineHeight,
                    scrollBeyondLastLine: false,
                  }}
                />
                <DiffNavigation editorRef={monacoDiffEditorRef} />
              </>
            ) : activeTab.markdownMode === "preview" ? (
              <div className="markdown-preview">
                <MarkdownPreview
                  sourcePath={activeTab.type === "skill" ? (activeTab.skillPath ?? "SKILL.md") : activeTab.path}
                  workspacePath={activeTab.type === "skill" ? undefined : activeWorkspace}
                  renderPre={renderMarkdownPre}
                  onOpenFile={(path) =>
                    activeTab.type === "skill"
                      ? void openSkillFile(activeTab.skillId!, "preview", path)
                      : void openFile({ name: path.split("/").pop() ?? path, path, type: "file" })
                  }
                  onOpenExternal={(url) => {
                    void window.desktop
                      ?.openExternal(url)
                      .catch((error: unknown) =>
                        setStatusMessage(error instanceof Error ? error.message : "Could not open external link"),
                      );
                  }}
                  onChange={
                    activeTab.type === "workflowDocument" ||
                    (activeTab.type === "skill" && !!activeTab.skillPath && activeTab.skillPath !== "SKILL.md")
                      ? undefined
                      : (content) =>
                          updateGroup((tabs, active) => ({
                            tabs: tabs.map((tab) =>
                              tab.id === activeTab.id
                                ? { ...tab, content, dirty: content !== tab.savedContent, error: undefined }
                                : tab,
                            ),
                            activeTabId: active,
                          }))
                  }
                >
                  {activeTab.content}
                </MarkdownPreview>
              </div>
            ) : (
              <StableEditor
                key={`${activeTab.type}:${activeTab.usefulScope ?? activeTab.runConfigScope ?? activeTab.agentScope ?? activeTab.skillId ?? "workspace"}:${activeTab.path}`}
                path={
                  activeTab.type === "workflowDocument"
                    ? `${activeTab.id}.md`
                    : activeTab.type === "useful"
                      ? `useful-${activeTab.usefulScope}/${activeTab.path}`
                      : activeTab.type === "runConfig"
                        ? `run-config-${activeTab.runConfigScope}/${activeTab.path}.sh`
                        : activeTab.type === "agent"
                          ? `agent-${activeTab.agentScope}/${activeTab.path}`
                          : activeTab.type === "skill"
                            ? `skill-${activeTab.skillId}/${activeTab.skillPath ?? "SKILL.md"}`
                            : activeTab.path
                }
                language={
                  activeTab.type === "runConfig"
                    ? "shell"
                    : (languageByExtension[activeTab.path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext")
                }
                value={activeTab.content}
                beforeMount={configureMonacoThemes}
                theme={monacoTheme(theme, highlightTheme)}
                onMount={mountEditor}
                options={{
                  readOnly:
                    activeTab.type === "workflowDocument" ||
                    (activeTab.type === "skill" && !!activeTab.skillPath && activeTab.skillPath !== "SKILL.md"),
                  automaticLayout: true,
                  contextmenu: false,
                  minimap: { enabled: false },
                  glyphMargin: activeTab.type === "file" || /\.http$/i.test(activeTab.path),
                  fontFamily: editorFontFamily,
                  fontWeight: "normal",
                  fontSize: uiFontSize,
                  lineHeight: editorLineHeight,
                  scrollBeyondLastLine: false,
                  padding: { top: 10 },
                }}
                onChange={(value) =>
                  updateGroup((tabs, active) => ({
                    tabs: tabs.map((tab) =>
                      tab.id === activeTab.id
                        ? { ...tab, content: value, dirty: value !== tab.savedContent, error: undefined }
                        : tab,
                    ),
                    activeTabId: active,
                  }))
                }
              />
            )}
          </>
        )}
        <EditorStatusBar
          ref={editorStatusBarRef}
          active={Boolean(
            activeTab &&
            activeTab.type !== "workflow" &&
            !activeTab.loading &&
            !(activeTab.error && !activeTab.content) &&
            activeTab.markdownMode !== "preview",
          )}
        />
      </div>
      {httpResult && (
        <section className="http-response-panel">
          <header>
            <span>
              {httpResult.request.method} {httpResult.request.url}
            </span>
            {httpResult.loading ? (
              <small>Sending...</small>
            ) : httpResult.response ? (
              <small className={httpResult.response.status >= 400 ? "error" : "success"}>
                {httpResult.response.status} {httpResult.response.statusText} · {httpResult.response.durationMs} ms
              </small>
            ) : null}
            <button title="Close response" onClick={() => setHttpResult(undefined)}>
              <X size={14} />
            </button>
          </header>
          {httpResult.error ? (
            <div className="http-response-error">{httpResult.error}</div>
          ) : httpResult.response ? (
            <div className="http-response-content">
              <pre className="http-response-headers">
                {Object.entries(httpResult.response.headers)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join("\n")}
              </pre>
              <pre className="http-response-body">{httpResult.response.body}</pre>
            </div>
          ) : (
            <div className="http-response-loading">Waiting for response...</div>
          )}
        </section>
      )}
    </main>
  );
}
