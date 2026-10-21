import type { McpAction, McpLibraryServer, McpSelection, McpServerInput } from "../types/mcp.js";
import type { AiProvider, AiSession } from "@hatopad/acp";

export type McpOperations = {
  "mcp.list": { payload: Record<string, never>; result: { servers: McpLibraryServer[] } };
  "mcp.save": { payload: { server: McpServerInput }; result: { server: McpLibraryServer } };
  "mcp.delete": { payload: { id: string }; result: Record<string, never> };
  "mcp.actions": { payload: McpSelection; result: { actions: McpAction[] } };
  "mcp.oauth.start": {
    payload: McpSelection & { redirectUri: string };
    result: { flowId: string; authorizationUrl: string; state: string };
  };
  "mcp.oauth.finish": { payload: { flowId: string; callbackUrl: string }; result: Record<string, never> };
  "mcp.oauth.cancel": { payload: { flowId: string }; result: Record<string, never> };
  "mcp.oauth.disconnect": { payload: McpSelection; result: Record<string, never> };
  "ai.mcp": {
    payload: { provider?: AiProvider; sessionId: string; selections: McpSelection[]; editorEnabled: boolean };
    result: { session: AiSession };
  };
};
