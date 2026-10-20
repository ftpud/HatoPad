import { type Request } from "@hatopad/protocol";
import { executeHttpRequest } from "../http.js";
import type { RequestContext } from "./context.js";

export async function handleHttpRequest(context: RequestContext, request: Request): Promise<unknown> {
  const {} = context;
  switch (request.type) {
    case "http.execute":
      return executeHttpRequest(
        request.payload.method,
        request.payload.url,
        request.payload.headers,
        request.payload.body,
      );
  }
}
