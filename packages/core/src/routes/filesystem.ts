import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { optionalByteLimit, renameWorkspacePaths } from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleFilesystemRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { filesystem, search, workspaceState } = context;
  switch (request.type) {
    case "filesystem.listTree":
      return { tree: await filesystem.listTree(request.payload.includeIgnored === true) };
    case "filesystem.snapshot":
      return { entries: await filesystem.snapshot(request.payload.paths) };
    case "filesystem.listDirectory": {
      const { path: directoryPath = "", limit = 50, cursor } = request.payload;
      if (typeof directoryPath !== "string" || directoryPath.length > 4096 || directoryPath.includes("\0"))
        throw new CoreError("INVALID_REQUEST", "path must be a workspace-relative string");
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new CoreError("INVALID_REQUEST", "limit must be an integer from 1 to 100");
      if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 1024))
        throw new CoreError("INVALID_REQUEST", "cursor must be a short string");
      return filesystem.listDirectory(directoryPath, limit, cursor);
    }
    case "filesystem.readFile": {
      if (typeof request.payload.path !== "string") throw new CoreError("INVALID_REQUEST", "path must be a string");
      const file = await filesystem.read(request.payload.path, optionalByteLimit(request.payload.maxBytes));
      return { path: request.payload.path, ...file };
    }
    case "filesystem.writeFile": {
      if (typeof request.payload.path !== "string" || typeof request.payload.content !== "string")
        throw new CoreError("INVALID_REQUEST", "path and content must be strings");
      const file = await filesystem.write(
        request.payload.path,
        request.payload.content,
        request.payload.expectedRevision,
        request.payload.force === true,
        request.payload.create === true,
      );
      return { path: request.payload.path, ...file };
    }
    case "filesystem.createFile": {
      if (typeof request.payload.path !== "string") throw new CoreError("INVALID_REQUEST", "path must be a string");
      await filesystem.createFile(request.payload.path);
      return { path: request.payload.path };
    }
    case "filesystem.createDirectory": {
      if (typeof request.payload.path !== "string") throw new CoreError("INVALID_REQUEST", "path must be a string");
      await filesystem.createDirectory(request.payload.path);
      return { path: request.payload.path };
    }
    case "filesystem.rename": {
      if (typeof request.payload.path !== "string" || typeof request.payload.newPath !== "string")
        throw new CoreError("INVALID_REQUEST", "path and newPath must be strings");
      const options = await workspaceState.load();
      await filesystem.rename(request.payload.path, request.payload.newPath);
      try {
        await workspaceState.save(renameWorkspacePaths(options, request.payload.path, request.payload.newPath));
      } catch (error) {
        await filesystem.rename(request.payload.newPath, request.payload.path).catch(() => undefined);
        throw error;
      }
      return { path: request.payload.newPath };
    }
    case "filesystem.transferPreflight":
      return filesystem.transferPreflight(
        request.payload.kind,
        request.payload.items,
        request.payload.overwritePaths,
        request.payload.openFiles,
        request.payload.dirtyFiles,
      );
    case "filesystem.transferApply": {
      const result = await filesystem.transferApply(
        request.payload.kind,
        request.payload.items,
        request.payload.overwritePaths,
        request.payload.openFiles,
        request.payload.dirtyFiles,
        request.payload.confirmed,
      );
      if (request.payload.kind === "move" && result.completed.length) {
        let options = await workspaceState.load();
        for (const item of result.completed) options = renameWorkspacePaths(options, item.source, item.destination);
        await workspaceState.save(options);
      }
      return result;
    }
    case "filesystem.previewDelete":
      return filesystem.previewDelete(request.payload.path);
    case "filesystem.delete":
      return filesystem.delete(request.payload.path, request.payload.permanent === true);
    case "filesystem.restore":
      return { path: await filesystem.restore(request.payload.recoveryId) };
    case "filesystem.search": {
      if (
        typeof request.payload.query !== "string" ||
        typeof request.payload.path !== "string" ||
        typeof request.payload.matchCase !== "boolean"
      )
        throw new CoreError("INVALID_REQUEST", "query, path, and matchCase are required");
      const result = await search.search(request.payload.query, request.payload.path, request.payload.matchCase, {
        include: request.payload.include,
        exclude: request.payload.exclude,
        filesOnly: request.payload.filesOnly,
      });
      return { ...result, matches: result.matches.map((match) => ({ ...match, rootId: request.rootId })) };
    }
    case "filesystem.replacePreview": {
      if (
        typeof request.payload.query !== "string" ||
        typeof request.payload.replacement !== "string" ||
        typeof request.payload.path !== "string" ||
        typeof request.payload.matchCase !== "boolean"
      )
        throw new CoreError("INVALID_REQUEST", "query, replacement, path, and matchCase are required");
      return search.previewReplace(
        request.payload.query,
        request.payload.replacement,
        request.payload.path,
        request.payload.matchCase,
        { include: request.payload.include, exclude: request.payload.exclude },
      );
    }
    case "filesystem.replaceApply": {
      if (typeof request.payload.previewId !== "string" || typeof request.payload.confirmed !== "boolean")
        throw new CoreError("INVALID_REQUEST", "previewId and confirmed are required");
      return search.applyReplace(request.payload.previewId, request.payload.confirmed);
    }
  }
}
