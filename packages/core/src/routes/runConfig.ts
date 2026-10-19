import { type Request } from "@hatopad/protocol";
import type { RequestContext } from "./context.js";

export async function handleRunConfigRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { runConfigs, workspacePath } = context;
  switch (request.type) {

    case "runConfig.list": return { configs: await runConfigs.list(workspacePath) };
    case "runConfig.create": return { config: await runConfigs.create(workspacePath, request.payload.scope, request.payload.name, request.payload.commands) };
    case "runConfig.read": return { config: await runConfigs.read(workspacePath, request.payload.scope, request.payload.name) };
    case "runConfig.write": return { config: await runConfigs.write(workspacePath, request.payload.scope, request.payload.name, request.payload.commands) };
    case "runConfig.rename": return { config: await runConfigs.rename(workspacePath, request.payload.scope, request.payload.name, request.payload.newName) };
    case "runConfig.delete": await runConfigs.delete(workspacePath, request.payload.scope, request.payload.name); return {};
    case "runConfig.run": return { config: await runConfigs.run(workspacePath, request.payload.scope, request.payload.name) };
    case "runConfig.stop": return { config: await runConfigs.stop(workspacePath, request.payload.scope, request.payload.name) };
    case "runConfig.restart": return { config: await runConfigs.restart(workspacePath, request.payload.scope, request.payload.name) };
    case "runConfig.openTerminal": return { config: await runConfigs.read(workspacePath, request.payload.scope, request.payload.name) };
  }
}
