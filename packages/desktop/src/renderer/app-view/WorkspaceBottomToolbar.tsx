import { CircleAlert, Coffee, GitBranch, Play, SquareTerminal } from "lucide-react";
import type { AppViewContext } from "./view-types";

export function WorkspaceBottomToolbar({ context }: { context: AppViewContext }) {
  const {
    status,
    javaRunning,
    javaOptions,
    layout,
    runConfigs,
    javaDiagnostics,
    toggleTerminalPanel,
    hasUnreadTerminalOutput,
    toggleJavaPanel,
    toggleProblemsPanel,
    toggleGitLogPanel,
    runConfigAction,
    setRunConfigMenu,
  } = context;
  return (
    <footer className="bottom-tool-bar">
      <button
        className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "terminal") ? "active" : ""}`}
        onClick={toggleTerminalPanel}
      >
        <SquareTerminal size={14} />
        <span>Terminal</span>
        {hasUnreadTerminalOutput && (
          <span className="terminal-activity-dot" role="img" aria-label="New terminal output" />
        )}
        {layout.terminalGroup.tabs.length > 0 && (
          <span className="bottom-tool-count">{layout.terminalGroup.tabs.length}</span>
        )}
      </button>
      {javaOptions && (
        <button
          className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "languageOutput") ? "active" : ""}`}
          onClick={toggleJavaPanel}
        >
          <Coffee size={14} />
          <span>Java</span>
          {javaRunning && <span className="running-indicator" />}
        </button>
      )}
      {javaOptions && (
        <button
          className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "problems") ? "active" : ""}`}
          onClick={toggleProblemsPanel}
        >
          <CircleAlert size={14} />
          <span>Problems</span>
          {javaDiagnostics.length > 0 && <span className="bottom-tool-count">{javaDiagnostics.length}</span>}
        </button>
      )}
      <button
        className={`bottom-tool-button ${layout.panels.some((panel) => panel.type === "gitlog") ? "active" : ""}`}
        onClick={toggleGitLogPanel}
      >
        <GitBranch size={14} />
        <span>Git</span>
      </button>
      {runConfigs.map((config, index) => (
        <button
          key={`${config.scope}:${config.name}`}
          className={`bottom-tool-button run-config-entry ${index === 0 ? "first" : ""} ${["starting", "running", "stopping"].includes(config.status) ? "active-run" : ""}`}
          aria-label={`${config.name}, ${config.scope}, ${config.status}`}
          title={`${config.scope} Run Config: ${config.name} (${config.status})`}
          onClick={() =>
            void runConfigAction(
              config,
              config.terminalId && ["starting", "running", "stopping"].includes(config.status) ? "openTerminal" : "run",
            )
          }
          onContextMenu={(event) => {
            event.preventDefault();
            setRunConfigMenu({
              x: Math.min(event.clientX, window.innerWidth - 218),
              y: Math.min(event.clientY, window.innerHeight - 126),
              config,
            });
          }}
        >
          <Play size={12} />
          <span>{config.name}</span>
          <span className={`run-config-indicator ${config.status}`} aria-hidden="true" />
        </button>
      ))}
    </footer>
  );
}
