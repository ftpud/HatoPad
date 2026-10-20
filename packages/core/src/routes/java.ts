import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import type { RequestContext } from "./context.js";

export async function handleJavaRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { javaOf } = context;
  switch (request.type) {
    case "java.loadMavenProject": {
      if (typeof request.payload.pomPath !== "string")
        throw new CoreError("INVALID_REQUEST", "pomPath must be a string");
      return javaOf().java.loadMavenProject(request.payload.pomPath);
    }
    case "java.configuration.read":
      return javaOf().java.readConfiguration();
    case "java.configuration.save":
      return javaOf().java.saveConfiguration(request.payload.content, request.payload.expectedRevision);
    case "java.tools.check":
      return { checks: await javaOf().java.checkTools(request.payload.content) };
    case "java.getOptions":
      return { options: await javaOf().java.getOptions() };
    case "java.addSourceRoot": {
      if (typeof request.payload.path !== "string") throw new CoreError("INVALID_REQUEST", "path must be a string");
      return javaOf().java.addSourceRoot(request.payload.path);
    }
    case "java.getProjectTree":
      return { tree: await javaOf().java.getProjectTree() };
    case "java.workspaceSymbols": {
      const result = await javaOf().jdt.workspaceSymbols(request.payload.query, request.payload.limit);
      return { ...result, symbols: result.symbols.map((symbol) => ({ ...symbol, rootId: request.rootId })) };
    }
    case "java.listMainClasses":
      return { classes: await javaOf().java.listMainClasses() };
    case "java.addRunConfiguration": {
      if (typeof request.payload.name !== "string" || typeof request.payload.mainClass !== "string")
        throw new CoreError("INVALID_REQUEST", "name and mainClass must be strings");
      return { options: await javaOf().java.addRunConfiguration(request.payload.name, request.payload.mainClass) };
    }
    case "java.selectRunConfiguration": {
      if (typeof request.payload.id !== "string") throw new CoreError("INVALID_REQUEST", "id must be a string");
      return { options: await javaOf().java.selectRunConfiguration(request.payload.id) };
    }
    case "java.build":
      await javaOf().java.build();
      return {};
    case "java.run":
      await javaOf().java.run();
      return {};
    case "java.stop":
      javaOf().java.stop();
      return {};
    case "java.debug.setBreakpoints":
      await javaOf().java.setDebugBreakpoints(request.payload.breakpoints);
      return {};
    case "java.debug.start":
      await javaOf().java.debug(request.payload.breakpoints);
      return {};
    case "java.debug.applyChanges":
      return javaOf().java.applyDebugChanges();
    case "java.debug.variables":
      return javaOf().java.debugVariables(request.payload.reference, request.payload.start);
    case "java.debug.command":
      javaOf().java.debugCommand(request.payload.command);
      return {};
    case "java.check":
      return {
        diagnostics: (await javaOf().java.check()).map((diagnostic) => ({ ...diagnostic, rootId: request.rootId })),
      };
    case "java.completeType": {
      if (typeof request.payload.prefix !== "string") throw new CoreError("INVALID_REQUEST", "prefix must be a string");
      return { suggestions: await javaOf().java.completeType(request.payload.prefix) };
    }
    case "java.completion":
      return {
        items: await javaOf().jdt.completion(
          request.payload.path,
          request.payload.content,
          request.payload.line,
          request.payload.column,
        ),
      };
    case "java.definition":
      return {
        locations: (
          await javaOf().jdt.definition(
            request.payload.path,
            request.payload.content,
            request.payload.line,
            request.payload.column,
          )
        ).map((location) => ({ ...location, rootId: request.rootId })),
      };
    case "java.references":
      return {
        locations: (
          await javaOf().jdt.references(
            request.payload.path,
            request.payload.content,
            request.payload.line,
            request.payload.column,
          )
        ).map((location) => ({ ...location, rootId: request.rootId })),
      };
    case "java.semanticTokens":
      return { tokens: await javaOf().jdt.semanticTokens(request.payload.path, request.payload.content) };
  }
}
