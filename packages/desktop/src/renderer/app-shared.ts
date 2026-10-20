import type { AiProvider, FileColor } from "@hatopad/protocol";
import type { Panel } from "./model";

/** Module-level helpers shared by the workspace shell and its domain hooks. */
export type StatusKind = "progress" | "success" | "error";
export type BottomPanelType = Extract<Panel["type"], "terminal" | "languageOutput" | "problems" | "gitlog">;
export const languageByExtension: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  html: "html",
  css: "css",
  md: "markdown",
  java: "java",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  mta: "yaml",
  mtaext: "yaml",
  xml: "xml",
  cds: "sap-cds",
  http: "http",
  txt: "plaintext",
};
export const fileColorChoices: { id: FileColor; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "orange", label: "Orange" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "gray", label: "Gray" },
];
/** Identifies which workspace, provider and request order an AI session snapshot was fetched for. */
export type AiSnapshotToken = { sequence: number; workspace: string; provider: AiProvider };

/** Setting name under which the AI provider last used for a task (or the root workspace) is stored. */
export function aiProviderTaskKey(taskId?: string): string {
  return `ai.provider.task.${taskId ?? "root"}`;
}
export function aiAgentTaskKey(taskId?: string): string {
  return `ai.agent.task.${taskId ?? "root"}`;
}

export function reviewOutcome(
  action: string,
  result: { applied: string[]; alreadyApplied: string[]; conflicts: { path: string; message: string }[] },
): string {
  const parts = [`${action}: ${result.applied.length} applied`];
  if (result.alreadyApplied.length) parts.push(`${result.alreadyApplied.length} already applied`);
  if (result.conflicts.length)
    parts.push(`${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} left unchanged`);
  return parts.join("; ");
}
