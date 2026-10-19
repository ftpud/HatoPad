import { terminalWatchLimits, type Request } from "@hatopad/protocol";
import { watchSnapshot, watchSummary } from "../terminal-watch.js";
import { CoreError } from "../errors.js";
import type { RequestContext } from "./context.js";

export async function handleTerminalRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { terminalHost, runConfigs, workspacePath } = context;
  switch (request.type) {

    case "terminal.list": return { terminals: terminalHost.list(workspacePath) };
    case "terminal.create": {
      return terminalHost.create(workspacePath, request.payload.cols, request.payload.rows, workspacePath, request.payload.displayName);
    }
    case "terminal.watch.ack": case "terminal.watch.detach": throw new CoreError("INVALID_REQUEST", "Terminal watcher requires a connection");
    case "terminal.watch.list": return { terminals: terminalHost.list(workspacePath).map(watchSummary) };
    case "terminal.watch.attach": {
      const { terminalId, maxBytes, follow } = request.payload;
      if (follow !== undefined && typeof follow !== "boolean") throw new CoreError("INVALID_REQUEST", "follow must be a boolean");
      if (typeof terminalId !== "string") throw new CoreError("INVALID_REQUEST", "terminalId must be a string");
      if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < terminalWatchLimits.minBytes || maxBytes > terminalWatchLimits.maxBytes)) throw new CoreError("INVALID_REQUEST", `maxBytes must be an integer from ${terminalWatchLimits.minBytes} to ${terminalWatchLimits.maxBytes}`);
      const session = terminalHost.attach(workspacePath, terminalId);
      if (!session) return { state: "stale" as const, reason: "session-unavailable" as const };
      return { state: "available" as const, terminal: watchSnapshot(session, maxBytes ?? terminalWatchLimits.defaultBytes) };
    }
    case "terminal.attach": {
      if (typeof request.payload.terminalId !== "string") throw new CoreError("INVALID_REQUEST", "terminalId must be a string");
      const session = terminalHost.attach(workspacePath, request.payload.terminalId);
      return session ? { state: "available" as const, session } : { state: "stale" as const, reason: "session-unavailable" as const };
    }
    case "terminal.input": {
      if (typeof request.payload.terminalId !== "string" || typeof request.payload.data !== "string") throw new CoreError("INVALID_REQUEST", "terminalId and data must be strings");
      terminalHost.input(workspacePath, request.payload.terminalId, request.payload.data);
      return {};
    }
    case "terminal.resize": {
      if (typeof request.payload.terminalId !== "string") throw new CoreError("INVALID_REQUEST", "terminalId must be a string");
      terminalHost.resize(workspacePath, request.payload.terminalId, request.payload.cols, request.payload.rows);
      return {};
    }
    case "terminal.close": {
      if (typeof request.payload.terminalId !== "string") throw new CoreError("INVALID_REQUEST", "terminalId must be a string");
      runConfigs.onTerminalClosed(workspacePath, request.payload.terminalId);
      terminalHost.close(workspacePath, request.payload.terminalId);
      return {};
    }
  }
}
