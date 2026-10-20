import { listProjectApps, killProjectApp } from "../project-processes.js";
import { type Request } from "@hatopad/protocol";
import type { RequestContext } from "./context.js";

export async function handleProcessesRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, rootWorkspace } = context;
  switch (request.type) {
    case "processes.list":
      return { processes: await listProjectApps(rootWorkspace, tasks) };
    case "processes.kill":
      return { killed: await killProjectApp(rootWorkspace, request.payload.processId) };
  }
}
