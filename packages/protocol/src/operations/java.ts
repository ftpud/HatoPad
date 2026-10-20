import type {
  JavaProjectOptions,
  JavaProjectNode,
  JavaToolCheck,
  RootedWorkspaceSymbol,
  JavaMainClass,
  JavaBreakpoint,
  JavaApplyChangesResult,
  JavaDebugVariable,
  RootedJavaDiagnostic,
  JavaTypeSuggestion,
  JavaLspCompletion,
  RootedJavaLspLocation,
  JavaSemanticToken,
} from "../types/java.js";
import type { FileRevision } from "../types/filesystem.js";

export type JavaOperations = {
  "java.loadMavenProject": {
    payload: { pomPath: string };
    result: { options: JavaProjectOptions; tree: JavaProjectNode[] };
  };
  "java.configuration.read": {
    payload: Record<string, never>;
    result: { path: string; content: string; revision?: FileRevision; template: string };
  };
  "java.configuration.save": {
    payload: { content: string; expectedRevision?: FileRevision };
    result: { options: JavaProjectOptions; content: string; revision: FileRevision };
  };
  "java.tools.check": {
    payload: { content: string };
    result: { checks: JavaToolCheck[] };
  };
  "java.getOptions": {
    payload: Record<string, never>;
    result: { options?: JavaProjectOptions };
  };
  "java.addSourceRoot": {
    payload: { path: string };
    result: { options: JavaProjectOptions; tree: JavaProjectNode[] };
  };
  "java.getProjectTree": {
    payload: Record<string, never>;
    result: { tree: JavaProjectNode[] };
  };
  "java.workspaceSymbols": {
    payload: { query: string; limit?: number };
    result: { symbols: RootedWorkspaceSymbol[]; truncated: boolean };
  };
  "java.listMainClasses": {
    payload: Record<string, never>;
    result: { classes: JavaMainClass[] };
  };
  "java.addRunConfiguration": {
    payload: { name: string; mainClass: string };
    result: { options: JavaProjectOptions };
  };
  "java.selectRunConfiguration": {
    payload: { id: string };
    result: { options: JavaProjectOptions };
  };
  "java.build": {
    payload: Record<string, never>;
    result: Record<string, never>;
  };
  "java.run": {
    payload: Record<string, never>;
    result: Record<string, never>;
  };
  "java.stop": {
    payload: Record<string, never>;
    result: Record<string, never>;
  };
  "java.debug.setBreakpoints": {
    payload: { breakpoints: JavaBreakpoint[] };
    result: Record<string, never>;
  };
  "java.debug.start": {
    payload: { breakpoints: JavaBreakpoint[] };
    result: Record<string, never>;
  };
  "java.debug.applyChanges": {
    payload: Record<string, never>;
    result: JavaApplyChangesResult;
  };
  "java.debug.variables": {
    payload: { reference: string; start?: number };
    result: { variables: JavaDebugVariable[]; nextStart?: number };
  };
  "java.debug.command": {
    payload: { command: "continue" | "stepInto" | "stepOver" | "stepOut" };
    result: Record<string, never>;
  };
  "java.check": {
    payload: Record<string, never>;
    result: { diagnostics: RootedJavaDiagnostic[] };
  };
  "java.completeType": {
    payload: { prefix: string };
    result: { suggestions: JavaTypeSuggestion[] };
  };
  "java.completion": {
    payload: { path: string; content: string; line: number; column: number };
    result: { items: JavaLspCompletion[] };
  };
  "java.definition": {
    payload: { path: string; content: string; line: number; column: number };
    result: { locations: RootedJavaLspLocation[] };
  };
  "java.references": {
    payload: { path: string; content: string; line: number; column: number };
    result: { locations: RootedJavaLspLocation[] };
  };
  "java.semanticTokens": { payload: { path: string; content: string }; result: { tokens: JavaSemanticToken[] } };
};
