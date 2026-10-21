import type { Request } from "@hatopad/protocol";
import type { RequestContext } from "./context.js";
import { McpLibrary } from "../mcp-library.js";
import { CoreError } from "../errors.js";

export async function handleMcpRequest(context: RequestContext, request: Request): Promise<unknown> {
  const library = new McpLibrary(context.rootWorkspace);
  switch (request.type) {
    case "mcp.list":
      return { servers: await library.list() };
    case "mcp.save":
      return { server: await library.save(request.payload.server) };
    case "mcp.delete":
      await library.delete(request.payload.id);
      return {};
    case "mcp.oauth.start":
      return library.startOAuth(request.payload, request.payload.redirectUri);
    case "mcp.oauth.finish":
      await library.finishOAuth(request.payload.flowId, request.payload.callbackUrl);
      return {};
    case "mcp.oauth.cancel":
      library.cancelOAuth(request.payload.flowId);
      return {};
    case "mcp.oauth.disconnect":
      await library.disconnectOAuth(request.payload);
      return {};
    case "mcp.actions":
      return { actions: await library.actions(request.payload) };
    case "ai.mcp": {
      if (typeof request.payload.editorEnabled !== "boolean" || typeof request.payload.sessionId !== "string")
        throw new CoreError("INVALID_REQUEST", "Choose valid chat MCP settings");
      const selections = await library.validateSelections(request.payload.selections);
      return {
        session: await context.acp
          .get(request.payload.provider)
          .setMcp(context.workspacePath, selections, request.payload.editorEnabled, request.payload.sessionId),
      };
    }
  }
}
