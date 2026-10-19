import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { boundPermission, boundQuestion } from "../ai/session-bounds.js";
import { permissionTargetWorkspace } from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleAttentionRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, acp, rootWorkspace } = context;
  switch (request.type) {

    case "attention.read": {
      const { provider, taskId, sessionId, requestId } = request.payload;
      if (typeof provider !== "string" || !provider || typeof requestId !== "string" || !requestId || requestId.length > 512 || (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId || sessionId.length > 512))) throw new CoreError("INVALID_REQUEST", "Choose a valid attention target");
      const target = await permissionTargetWorkspace(tasks, rootWorkspace, taskId);
      const session = await acp.get(provider).get(target);
      if (sessionId !== undefined && session.id !== sessionId) return { state: "resolved" };
      if (session.pendingPermission?.id === requestId) return { state: "pending", ...(session.id ? { sessionId: session.id } : {}), permission: boundPermission(session.pendingPermission) };
      if (session.pendingQuestion?.id === requestId) return { state: "pending", ...(session.id ? { sessionId: session.id } : {}), question: boundQuestion(session.pendingQuestion) };
      return { state: "resolved" };
    }
  }
}
