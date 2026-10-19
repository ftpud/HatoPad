import type { WorkspaceRootId } from "./workspace.js";
import type { TerminalSessionSnapshot } from "./terminal.js";
import type { LanguageDebugState } from "./language.js";
import type { JavaDebugState } from "./java.js";
import type { RunConfig } from "./configuration.js";

export type SupervisionEvent = { id: string; sequence: number; rootId: WorkspaceRootId; kind: 'task-created' | 'task-finished' | 'task-reopened' | 'task-archived' | 'task-deleted' | 'workflow-completed' | 'workflow-failed' | 'commit-made' | 'timer-fired' | 'trigger-fired'; at: string; taskId?: string; runId?: string };

export type TriggerFileEvent = "created" | "changed" | "deleted";

export type FilesystemChangedEvent = {
  type: "filesystem.changed";
  payload: { rootId: WorkspaceRootId; paths: string[]; overflow: boolean; health: "healthy" | "degraded"; message?: string };
};

export type TerminalOpenedEvent = { type: "terminal.opened"; payload: { rootId: WorkspaceRootId; workspace: string; session: TerminalSessionSnapshot } };

export type TerminalOutputEvent = {
  type: "terminal.output";
  payload: { rootId: WorkspaceRootId; terminalId: string; data: string };
};

export type TerminalExitEvent = {
  type: "terminal.exit";
  payload: { rootId: WorkspaceRootId; terminalId: string; exitCode: number };
};

export type GitChangedEvent = { type: "git.changed"; payload: { rootId: WorkspaceRootId } };

export type TaskGitChangedEvent = { type: "taskGit.changed"; payload: { rootId: WorkspaceRootId } };

export type LanguageSemanticChangedEvent = { type: "language.semantic.changed"; payload: { rootId: WorkspaceRootId; language: string } };

export type LanguageOutputEvent = { type: "language.output"; payload: { rootId: WorkspaceRootId; language: string; data: string; stream: "stdout" | "stderr" } };

export type LanguageExitEvent = { type: "language.exit"; payload: { rootId: WorkspaceRootId; language: string; exitCode: number | null; signal?: string | null } };

export type LanguageDebugStateEvent = { type: "language.debug.state"; payload: LanguageDebugState & { rootId: WorkspaceRootId; language: string } };

/** Language-neutral events carry the originating root and service id. */
export type LanguageServerEvent = LanguageSemanticChangedEvent | LanguageOutputEvent | LanguageExitEvent | LanguageDebugStateEvent;

export type JavaSemanticChangedEvent = { type: "java.semantic.changed"; payload: { rootId: WorkspaceRootId } };

export type JavaOutputEvent = { type: "java.output"; payload: { rootId: WorkspaceRootId; data: string } };

export type JavaExitEvent = { type: "java.exit"; payload: { rootId: WorkspaceRootId; exitCode: number | null; signal: string | null } };

export type JavaDebugStateEvent = { type: "java.debug.state"; payload: JavaDebugState & { rootId: WorkspaceRootId } };

/** Timers belong to the whole Core workspace group, including internal workflow sessions. */
export type TimersChangedEvent = { type: "timers.changed"; payload: { rootId?: WorkspaceRootId } };

export type AiChangedEvent = { type: "ai.changed"; payload: { rootId: WorkspaceRootId } };

export type TasksChangedEvent = { type: "tasks.changed"; payload: { rootId: WorkspaceRootId } };

export type CommitMessageChangedEvent = { type: "commit-message.changed"; payload: { rootId: WorkspaceRootId; workspace?: string; message: string } };

export type RunConfigChangedEvent = { type: "runConfig.changed"; payload: { rootId: WorkspaceRootId; configs: RunConfig[] } };

export type HarnessChangedEvent = { type: "harness.changed"; payload: { rootId: WorkspaceRootId; runId: string } };

export type WorkflowDocumentEvent = { type: "workflow.document"; payload: { rootId: WorkspaceRootId; runId: string; blockId: string; title: string; content: string } };

export type ConfigurationChangedEvent = { type: "configuration.changed"; payload: { rootId: WorkspaceRootId; resource: string; global: boolean } };

export type ProcessesChangedEvent = { type: "processes.changed"; payload: Record<string, never> };

export type TerminalWatchOutputEvent = { type: "terminal.watch.output"; payload: { rootId: WorkspaceRootId; watchId: string; terminalId: string; sequence: number; data: string; truncated: boolean } };

export type TerminalWatchExitEvent = { type: "terminal.watch.exit"; payload: { rootId: WorkspaceRootId; watchId: string; terminalId: string; exitCode: number } };

export type AutomationChangedEvent = { type: "automation.changed"; payload: { rootId?: WorkspaceRootId; kind: "schedule" | "trigger" } };

export type ServerEvent = AutomationChangedEvent | TerminalWatchOutputEvent | TerminalWatchExitEvent | LanguageServerEvent | ProcessesChangedEvent | ConfigurationChangedEvent | TimersChangedEvent | WorkflowDocumentEvent | FilesystemChangedEvent | TerminalOpenedEvent | TerminalOutputEvent | TerminalExitEvent | GitChangedEvent | TaskGitChangedEvent | JavaSemanticChangedEvent | JavaOutputEvent | JavaExitEvent | JavaDebugStateEvent | AiChangedEvent | TasksChangedEvent | CommitMessageChangedEvent | RunConfigChangedEvent | HarnessChangedEvent;
