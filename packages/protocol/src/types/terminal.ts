

export type WorkspaceTerminalOptions = { tabs: { displayName: string; terminalId?: string }[]; activeTabIndex?: number; panelOpen: boolean };

export type TerminalSessionSnapshot = { terminalId: string; status: "running" | "exited"; output: string; exitCode?: number; displayName?: string };

/** Resolution is always against the currently selected workspace. A stale ID means Core no longer owns that process. */
/** Content-free terminal metadata for watchers; `outputBytes` is the size of Core's retained scrollback. */
export type TerminalWatchSummary = { terminalId: string; status: "running" | "exited"; exitCode?: number; displayName?: string; outputBytes: number };

/** Bounded replay: the newest `maxBytes` of retained output. `truncated` means older scrollback was omitted. */
export type TerminalWatchSnapshot = TerminalWatchSummary & { output: string; truncated: boolean };

export const terminalWatchLimits = { defaultBytes: 65_536, minBytes: 1_024, maxBytes: 262_144 } as const;

export type TerminalAttachResult = { state: "available"; session: TerminalSessionSnapshot } | { state: "stale"; reason: "session-unavailable" };
