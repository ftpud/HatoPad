import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import type { RequestContext } from "./context.js";

export async function handleTaskGitRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { acp, workspacePath, checkpoints } = context;
  switch (request.type) {
    case "taskGit.summary":
      return checkpoints.summary(request.payload.limit, request.payload.offset);
    case "taskGit.files":
      return checkpoints.files(
        request.payload.checkpointId,
        request.payload.direction,
        request.payload.limit,
        request.payload.offset,
      );
    case "taskGit.revert": {
      const sessions = await Promise.all(acp.list().map((provider) => acp.get(provider.id).get(workspacePath)));
      if (sessions.some((session) => session.status === "in_progress" || session.status === "user_prompt"))
        throw new CoreError("INVALID_REQUEST", "Stop the running task agent before reverting a checkpoint");
      return checkpoints.revert(request.payload.checkpointId, request.payload.paths);
    }
    case "taskGit.history":
      return { checkpoints: await checkpoints.history() };
    case "taskGit.diff":
      return checkpoints.diff(request.payload.checkpointId, request.payload.path);
    case "taskGit.review": {
      const sessions = await Promise.all(acp.list().map((provider) => acp.get(provider.id).get(workspacePath)));
      if (sessions.some((session) => session.status === "in_progress" || session.status === "user_prompt"))
        throw new CoreError("INVALID_REQUEST", "Stop the running task agent before applying a checkpoint");
      return checkpoints.review(request.payload.checkpointId, request.payload.paths);
    }
    case "taskGit.restore": {
      const sessions = await Promise.all(acp.list().map((provider) => acp.get(provider.id).get(workspacePath)));
      if (sessions.some((session) => session.status === "in_progress" || session.status === "user_prompt"))
        throw new CoreError("INVALID_REQUEST", "Stop the running task agent before restoring a checkpoint");
      return checkpoints.restore(request.payload.checkpointId);
    }
  }
}
