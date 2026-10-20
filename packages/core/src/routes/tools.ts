import { type Request } from "@hatopad/protocol";
import { toolInstallations } from "../tools.js";
import type { RequestContext } from "./context.js";

export async function handleToolsRequest(context: RequestContext, request: Request): Promise<unknown> {
  const {} = context;
  switch (request.type) {
    case "tools.list":
      return { tools: await toolInstallations.list() };
    case "tools.install":
    case "tools.uninstall": {
      const change =
        request.type === "tools.install"
          ? toolInstallations.install(request.payload.tool)
          : toolInstallations.uninstall(request.payload.tool);
      void change.catch(() => {}); // Failures are reported through `tools.list`.
      return { tools: await toolInstallations.list() };
    }
  }
}
