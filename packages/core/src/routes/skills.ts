import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { SkillsStore } from "../skills.js";
import type { RequestContext } from "./context.js";

export async function handleSkillsRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { rootWorkspace, workspacePath } = context;
  switch (request.type) {
    case "skills.list":
      return new SkillsStore(undefined, rootWorkspace).list(workspacePath);
    case "skills.read":
      return {
        content: await new SkillsStore(undefined, rootWorkspace).readResource(
          request.payload.id,
          workspacePath,
          request.payload.path,
        ),
      };
    case "skills.write":
      await new SkillsStore(undefined, rootWorkspace).write(request.payload.id, workspacePath, request.payload.content);
      return {};
    case "skills.delete":
      await new SkillsStore(undefined, rootWorkspace).delete(request.payload.id, workspacePath);
      return {};
    case "skills.policy.moveToLocal":
      await new SkillsStore(undefined, rootWorkspace).movePolicyToLocal(workspacePath);
      return {};
    case "skills.policy":
      await new SkillsStore(undefined, rootWorkspace).writePolicy(workspacePath, request.payload);
      return {};
  }
}
