import type { TerminalSessionSnapshot, TerminalWatchSnapshot, TerminalWatchSummary } from "@hatopad/protocol";

export const watchSummary = (session: TerminalSessionSnapshot): TerminalWatchSummary => ({ terminalId: session.terminalId, status: session.status, ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}), ...(session.displayName ? { displayName: session.displayName } : {}), outputBytes: Buffer.byteLength(session.output) });
/** Newest `maxBytes` of scrollback, cut on a character boundary so replay never starts mid-sequence. */
export function watchSnapshot(session: TerminalSessionSnapshot, maxBytes: number): TerminalWatchSnapshot {
  const bytes = Buffer.from(session.output);
  if (bytes.length <= maxBytes) return { ...watchSummary(session), output: session.output, truncated: false };
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return { ...watchSummary(session), output: bytes.subarray(start).toString("utf8"), truncated: true };
}
