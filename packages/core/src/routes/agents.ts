import { type Request } from "@hatopad/protocol";
import type { RequestContext } from "./context.js";

export async function handleAgentsRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { agents, workspacePath } = context;
  switch (request.type) {

    case "agents.list": return { agents: await agents.list(workspacePath) };
    case "agents.read": return { content: await agents.read(request.payload.scope, request.payload.name, workspacePath) };
    case "agents.create": await agents.create(request.payload.scope, request.payload.name, workspacePath); return {};
    case "agents.write": await agents.write(request.payload.scope, request.payload.name, request.payload.content, workspacePath); return {};
    case "agents.rename": return { name: await agents.rename(request.payload.scope, request.payload.name, request.payload.newName, workspacePath) };
    case "agents.delete": await agents.delete(request.payload.scope, request.payload.name, workspacePath); return {};
  }
}
