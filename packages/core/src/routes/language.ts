import { runLanguageInTerminal, hasLanguageTerminalRun, stopLanguageTerminalRun } from "../language/terminal.js";
import { type Request } from "@hatopad/protocol";
import { handleLanguageRequest } from "../language/routes.js";
import type { RequestContext } from "./context.js";

export async function handleLanguageDomainRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { services, terminalHost, workspacePath } = context;
  switch (request.type) {

    case "language.options": return { options: { ...await services.languages.get(request.payload.language).options(), terminalRunning: hasLanguageTerminalRun(terminalHost, workspacePath, request.payload.language) } };
    case "language.stop": {
      if (stopLanguageTerminalRun(terminalHost, workspacePath, request.payload.language)) return {};
      return handleLanguageRequest(services.languages.registry, services.languages, request.rootId, request);
    }
    case "language.run": return runLanguageInTerminal(services.languages.require(request.payload.language, "run"), terminalHost, workspacePath);
    case "language.list": case "language.load": case "language.configuration.read": case "language.configuration.save": case "language.tools.check": case "language.addSourceRoot": case "language.projectTree": case "language.symbols": case "language.listRunTargets": case "language.addRunConfiguration": case "language.selectRunConfiguration": case "language.removeRunConfiguration": case "language.build": case "language.debug.setBreakpoints": case "language.debug.start": case "language.debug.applyChanges": case "language.debug.variables": case "language.debug.command": case "language.check": case "language.lsp.completion": case "language.lsp.definition": case "language.lsp.references": case "language.lsp.semanticTokens":
      return handleLanguageRequest(services.languages.registry, services.languages, request.rootId, request);
  }
}
