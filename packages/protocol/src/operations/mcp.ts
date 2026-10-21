import type { McpAction, McpLibraryServer, McpSelection, McpServerInput } from "../types/mcp.js";
import type { AiProvider, AiSession } from "@hatopad/acp";

export type McpOperations = {
  "mcp.list": { payload: Record<string, never>; result: { servers: McpLibraryServer[] } };
  "mcp.save": { payload: { server: McpServerInput }; result: { server: McpLibraryServer } };
  "mcp.delete": { payload: { id: string }; result: Record<string, never> };
  "mcp.actions": { payload: McpSelection; result: { actions: McpAction[] } };
  "ai.mcp": {
    payload: { provider?: AiProvider; sessionId: string; selections: McpSelection[]; editorEnabled: boolean };
    result: { session: AiSession };
  };
};
