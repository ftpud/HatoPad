import type { TerminalSessionSnapshot, TerminalWatchSummary, TerminalWatchSnapshot, TerminalAttachResult } from "../types/terminal.js";

export type TerminalOperations = {
  "terminal.list": { payload: Record<string, never>; result: { terminals: TerminalSessionSnapshot[] } };
  "terminal.create": {
    payload: { cols: number; rows: number; displayName?: string };
    result: TerminalSessionSnapshot;
  };
  "terminal.watch.ack": { payload: { watchId: string; sequence: number }; result: Record<string, never> };
  "terminal.watch.detach": { payload: { watchId: string }; result: Record<string, never> };
  "terminal.watch.list": { payload: Record<string, never>; result: { terminals: TerminalWatchSummary[] } };
  "terminal.watch.attach": { payload: { terminalId: string; maxBytes?: number; follow?: boolean }; result: { state: "available"; terminal: TerminalWatchSnapshot; watchId?: string } | { state: "stale"; reason: "session-unavailable" } };
  "terminal.attach": {
    payload: { terminalId: string };
    result: TerminalAttachResult;
  };
  "terminal.input": {
    payload: { terminalId: string; data: string };
    result: Record<string, never>;
  };
  "terminal.resize": {
    payload: { terminalId: string; cols: number; rows: number };
    result: Record<string, never>;
  };
  "terminal.close": {
    payload: { terminalId: string };
    result: Record<string, never>;
  };
};
