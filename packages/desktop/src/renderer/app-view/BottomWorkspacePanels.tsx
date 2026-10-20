import { TerminalPanel } from "../TerminalPanel";
import { languageClient } from "../language-client";
import { JavaPanel } from "../plugins/languages/java";
import { ProblemsPanel } from "../ProblemsPanel";
import { GitLogPanel } from "../GitLogPanel";
import type { AppViewContext } from "./view-types";

export function BottomWorkspacePanels({ context }: { context: AppViewContext }) {
  const {
    selectedRootId,
    status,
    clientRef,
    javaRunning,
    theme,
    uiFontSize,
    uiLineHeight,
    refreshGit,
    javaOptions,
    refreshTree,
    setGitConflictPath,
    group,
    layout,
    terminalPanelOpen,
    markUnreadTerminalOutput,
    terminalFontFamily,
    terminalHeight,
    runConfigs,
    activateTerminalTab,
    createTerminal,
    closeTerminal,
    renameTerminal,
    duplicateTerminal,
    moveTerminal,
    updateTerminalGroup,
    beginTerminalResize,
    registerTerminalWriter,
    languages,
    javaPanelHeight,
    javaLog,
    javaDebugState,
    setShowRunConfigurationDialog,
    applyJavaChanges,
    runJavaAction,
    debugJava,
    stopJava,
    commandJavaDebugger,
    setJavaLog,
    beginJavaResize,
    setJavaPanelHeight,
    problemsHeight,
    javaDiagnostics,
    javaChecking,
    checkJava,
    openDiagnostic,
    beginProblemsResize,
    gitLogHeight,
    gitRevision,
    beginGitLogResize,
  } = context;
  return (
    <div className="workspace-bottom-panels">
      {layout.terminalGroup.tabs.length > 0 && (
        <TerminalPanel
          visible={terminalPanelOpen}
          onActivity={markUnreadTerminalOutput}
          theme={theme}
          fontFamily={terminalFontFamily}
          fontSize={uiFontSize}
          lineHeight={uiLineHeight}
          client={clientRef.current!}
          group={layout.terminalGroup}
          height={terminalHeight}
          highlightedTerminalIds={
            new Set(
              runConfigs
                .filter((config) => ["starting", "running", "stopping"].includes(config.status))
                .flatMap((config) => (config.terminalId ? [config.terminalId] : [])),
            )
          }
          onActivate={activateTerminalTab}
          onCreate={() => void createTerminal()}
          onClose={closeTerminal}
          onRename={renameTerminal}
          onDuplicate={(tab) => void duplicateTerminal(tab)}
          onMove={moveTerminal}
          onRecoveryShown={(tabId) =>
            updateTerminalGroup((group) => ({
              ...group,
              tabs: group.tabs.map((tab) => (tab.id === tabId ? { ...tab, recovery: undefined } : tab)),
            }))
          }
          onResizeStart={beginTerminalResize}
          registerWriter={registerTerminalWriter}
        />
      )}
      {layout.panels.some((panel) => panel.type === "languageOutput") &&
        javaOptions &&
        languages.find((language) => language.id === "java") && (
          <JavaPanel
            key={`java-panel:${selectedRootId}`}
            capabilities={languages.find((language) => language.id === "java")!.capabilities}
            height={javaPanelHeight}
            log={javaLog}
            running={javaRunning}
            options={javaOptions}
            debugState={javaDebugState}
            onConfigure={() => setShowRunConfigurationDialog(true)}
            onApplyChanges={applyJavaChanges}
            onInspect={(reference, start) =>
              languageClient(clientRef.current!, "java").debugVariables(reference, start)
            }
            onBuild={() => void runJavaAction("language.build")}
            onRun={() => void runJavaAction("language.run")}
            onDebug={() => void debugJava()}
            onStop={() => void stopJava()}
            onDebugCommand={(command) => void commandJavaDebugger(command)}
            onClear={() => setJavaLog("")}
            onResizeStart={beginJavaResize}
            onHeightChange={setJavaPanelHeight}
          />
        )}
      {layout.panels.some((panel) => panel.type === "problems") && javaOptions && (
        <ProblemsPanel
          language="java"
          height={problemsHeight}
          diagnostics={javaDiagnostics}
          checking={javaChecking}
          onRefresh={() => void checkJava()}
          onOpen={(diagnostic) => void openDiagnostic(diagnostic)}
          onResizeStart={beginProblemsResize}
        />
      )}
      {layout.panels.some((panel) => panel.type === "gitlog") && (
        <GitLogPanel
          client={clientRef.current!}
          height={gitLogHeight}
          revision={gitRevision}
          onResizeStart={beginGitLogResize}
          onRepositoryChanged={() => {
            void Promise.all([refreshGit(), refreshTree()]);
          }}
          onMergeConflict={() => {
            void clientRef.current
              ?.request("git.conflicts", {})
              .then((conflicts) => setGitConflictPath(conflicts.files[0]?.path ?? ""));
          }}
        />
      )}
    </div>
  );
}
