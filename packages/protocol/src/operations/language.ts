import type {
  LanguageDescriptor,
  LanguageExtra,
  LanguageToolCheck,
  LanguageProjectNode,
  LanguageRunTarget,
  LanguageBreakpoint,
  LanguageDebugVariable,
  LanguageDebugCommand,
  RootedLanguageDiagnostic,
  LanguageCompletion,
  RootedLanguageLocation,
  LanguageSemanticToken,
} from "../types/language.js";
import type { FileRevision } from "../types/filesystem.js";
import type { RootedWorkspaceSymbol } from "../types/java.js";
import type { TerminalSessionSnapshot } from "../types/terminal.js";

export type LanguageOperations = {
  /** Registry discovery is root-scoped like all language operations. */
  "language.list": { payload: Record<string, never>; result: { languages: LanguageDescriptor[] } };
  "language.load": { payload: { language: string; extra?: LanguageExtra }; result: { options: LanguageExtra } };
  "language.options": { payload: { language: string }; result: { options: LanguageExtra } };
  "language.configuration.read": {
    payload: { language: string };
    result: { path: string; content: string; revision?: FileRevision; template?: string };
  };
  "language.configuration.save": {
    payload: { language: string; content: string; expectedRevision?: FileRevision };
    result: { content: string; revision: FileRevision; options?: LanguageExtra };
  };
  "language.tools.check": { payload: { language: string; content?: string }; result: { checks: LanguageToolCheck[] } };
  "language.addSourceRoot": { payload: { language: string; path: string }; result: Record<string, never> };
  "language.projectTree": { payload: { language: string }; result: { tree: LanguageProjectNode[] } };
  "language.symbols": {
    payload: { language: string; query: string; limit?: number };
    result: { symbols: RootedWorkspaceSymbol[]; truncated?: boolean };
  };
  "language.listRunTargets": { payload: { language: string }; result: { targets: LanguageRunTarget[] } };
  "language.addRunConfiguration": {
    payload: { language: string; name: string; target: string };
    result: { options: LanguageExtra };
  };
  "language.selectRunConfiguration": { payload: { language: string; id: string }; result: { options: LanguageExtra } };
  "language.removeRunConfiguration": { payload: { language: string; id: string }; result: { options: LanguageExtra } };
  "language.build": { payload: { language: string }; result: Record<string, never> };
  "language.run": { payload: { language: string }; result: { terminal: TerminalSessionSnapshot } };
  "language.stop": { payload: { language: string }; result: Record<string, never> };
  "language.debug.setBreakpoints": {
    payload: { language: string; breakpoints: LanguageBreakpoint[] };
    result: Record<string, never>;
  };
  "language.debug.start": {
    payload: { language: string; breakpoints: LanguageBreakpoint[] };
    result: Record<string, never>;
  };
  "language.debug.applyChanges": { payload: { language: string }; result: LanguageExtra };
  "language.debug.variables": {
    payload: { language: string; reference: string; start?: number };
    result: { variables: LanguageDebugVariable[]; nextStart?: number };
  };
  "language.debug.command": {
    payload: { language: string; command: LanguageDebugCommand };
    result: Record<string, never>;
  };
  "language.check": { payload: { language: string }; result: { diagnostics: RootedLanguageDiagnostic[] } };
  "language.lsp.completion": {
    payload: { language: string; path: string; content: string; line: number; column: number };
    result: { items: LanguageCompletion[] };
  };
  "language.lsp.definition": {
    payload: { language: string; path: string; content: string; line: number; column: number };
    result: { locations: RootedLanguageLocation[] };
  };
  "language.lsp.references": {
    payload: { language: string; path: string; content: string; line: number; column: number };
    result: { locations: RootedLanguageLocation[] };
  };
  "language.lsp.semanticTokens": {
    payload: { language: string; path: string; content: string };
    result: { tokens: LanguageSemanticToken[] };
  };
};
