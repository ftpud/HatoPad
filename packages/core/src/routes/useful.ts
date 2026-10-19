import { boundedNote } from "../bounded-note.js";
import { type Request } from "@hatopad/protocol";
import type { RequestContext } from "./context.js";

export async function handleUsefulRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { usefulFiles } = context;
  switch (request.type) {

    case "useful.list": return { files: await usefulFiles.list() };
    case "useful.read": {
      if (request.payload.maxBytes !== undefined) boundedNote("", request.payload.maxBytes);
      const content = await usefulFiles.read(request.payload.scope, request.payload.name);
      return request.payload.maxBytes === undefined ? { content } : boundedNote(content, request.payload.maxBytes);
    }
    case "useful.create": await usefulFiles.create(request.payload.scope, request.payload.name); return {};
    case "useful.write": await usefulFiles.write(request.payload.scope, request.payload.name, request.payload.content); return {};
    case "useful.rename": await usefulFiles.rename(request.payload.scope, request.payload.name, request.payload.newName); return {};
    case "useful.delete": await usefulFiles.delete(request.payload.scope, request.payload.name); return {};
  }
}
