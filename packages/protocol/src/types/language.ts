import type { WorkspaceRootId } from "./workspace.js";

/** Language-neutral wire data; Core service implementations must not be imported here. */
export type LanguageExtra = Record<string, unknown>;

export type LanguageCapabilities = { projectTree: boolean; build: boolean; run: boolean; debug: boolean; lsp: boolean; workspaceSymbols: boolean; configuration: boolean; runConfigurations?: boolean; sourceRoots?: boolean };

export type PluginStatus = { id: string; version?: string; name?: string; state: "loaded" | "failed"; error?: string; providers: string[]; languages: string[] };

export type LanguageDescriptor = { id: string; name: string; extensions: string[]; projectMarkers: string[]; capabilities: LanguageCapabilities };

export type LanguageProjectNode = { name: string; path: string; type: string; sourceKind?: "source" | "test"; children?: LanguageProjectNode[]; extra?: LanguageExtra };

export type LanguageToolCheck = { tool: string; executable: string; ok: boolean; message: string };

export type LanguageDiagnostic = { path: string; line: number; column: number; severity: "error" | "warning"; message: string };

export type RootedLanguageDiagnostic = LanguageDiagnostic & { rootId: WorkspaceRootId; language: string };

export type LanguageRange = { startLine: number; startColumn: number; endLine: number; endColumn: number };

export type LanguageCompletion = { label: string; detail?: string; insertText: string; range?: LanguageRange; additionalTextEdits: { range: LanguageRange; text: string }[] };

export type LanguageLocation = { path: string } & LanguageRange;

export type RootedLanguageLocation = LanguageLocation & { rootId: WorkspaceRootId; language: string };

export type LanguageSemanticToken = LanguageRange & { type: string; modifiers: string[] };

export type LanguageRunTarget = { id: string; name: string; path?: string; extra?: LanguageExtra };

export type LanguageBreakpoint = { path: string; line: number; extra?: LanguageExtra };

export type LanguageDebugVariable = { name: string; value: string; reference?: string; type?: string; indexedCount?: number; extra?: LanguageExtra };

export type LanguageDebugState = { status: "starting" | "running" | "paused" | "stopped"; path?: string; line?: number; frame?: string; variables: LanguageDebugVariable[]; stopReason?: string; inspectionError?: string; busy?: boolean; extra?: LanguageExtra };

export type LanguageDebugCommand = "continue" | "stepOver" | "stepInto" | "stepOut";
