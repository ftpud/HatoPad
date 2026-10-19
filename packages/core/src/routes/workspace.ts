import path from "node:path";
import { type FileTreeNode, type Request } from "@hatopad/protocol";
import type { RequestContext } from "./context.js";

export async function handleWorkspaceRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { rootWorkspace, filesystem, workspaceState, workspacePath } = context;
  switch (request.type) {

    case "workspace.open": {
      const tree = request.payload.includeTree === false ? (await filesystem.initialize(workspacePath), [] as FileTreeNode[]) : await filesystem.open(workspacePath, request.payload.includeIgnored === true);
      return { workspace: filesystem.getWorkspace(), projectName: path.basename(path.resolve(rootWorkspace)), tree, options: await workspaceState.load() };
    }
    case "workspace.saveOptions": {
      await workspaceState.save(request.payload.options);
      return {};
    }
  }
}
