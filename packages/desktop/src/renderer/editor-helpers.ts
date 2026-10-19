import type { GitDiffHunk } from "@hatopad/protocol";
import type { editor } from "monaco-editor";

export const gitHunkDecorations = (hunks: GitDiffHunk[]): editor.IModelDeltaDecoration[] => hunks.map((hunk) => {
  const start = Math.max(1, hunk.modifiedStart);
  const end = Math.max(start, start + Math.max(1, hunk.modifiedLines) - 1);
  const kind = hunk.originalLines === 0 ? "added" : hunk.modifiedLines === 0 ? "deleted" : "modified";
  return { range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: `git-change-marker ${kind}`, hoverMessage: { value: "Click the gutter marker to inspect this change" } } };
});

export type ParsedHttpRequest = { line: number; method: string; url: string; headers: Record<string, string>; body?: string };

export function keyboardResize(event: { key: string; shiftKey: boolean; preventDefault(): void }, value: number, update: (value: number) => void, minimum: number, maximum: number, reverse = false) {
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 50 : 10;
  update(Math.max(minimum, Math.min(maximum, value + direction * step * (reverse ? -1 : 1))));
}

export function parseHttpRequests(content: string): ParsedHttpRequest[] {
  const lines = content.split("\n"); const requests: ParsedHttpRequest[] = [];
  let blockStart = 0;
  for (let end = 0; end <= lines.length; end += 1) {
    if (end < lines.length && !/^\s*###(?:\s.*)?$/.test(lines[end]!)) continue;
    const block = lines.slice(blockStart, end); let index = 0;
    while (index < block.length && (!block[index]!.trim() || /^\s*(#(?!##)|\/\/)/.test(block[index]!))) index += 1;
    const match = block[index]?.match(/^\s*([A-Za-z]+)\s+(\S+)\s*(?:HTTP\/\d(?:\.\d)?)?\s*$/);
    if (match) {
      const line = blockStart + index + 1; const headers: Record<string, string> = {}; index += 1;
      while (index < block.length && block[index]!.trim()) { const header = block[index]!.match(/^\s*([^:#][^:]*):\s*(.*)$/); if (header) headers[header[1]!.trim()] = header[2]!.trim(); index += 1; }
      while (index < block.length && !block[index]!.trim()) index += 1;
      const body = block.slice(index).join("\n").trimEnd(); requests.push({ line, method: match[1]!.toUpperCase(), url: match[2]!, headers, ...(body ? { body } : {}) });
    }
    blockStart = end + 1;
  }
  return requests;
}

/** A selection ending at column 1 of a line does not include that line. */
export function selectedLineRange(selection: { startLineNumber: number; endLineNumber: number; endColumn: number }): { startLine: number; endLine: number } {
  const endLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber;
  return { startLine: selection.startLineNumber, endLine };
}
