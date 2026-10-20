import { type Request } from "@hatopad/protocol";
import { pluginsDirectory } from "../plugins/loader.js";
import type { RequestContext } from "./context.js";

export async function handlePluginsRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { services } = context;
  switch (request.type) {
    case "plugins.list":
      return { enabled: pluginsDirectory() !== undefined, plugins: services.plugins };
  }
}
