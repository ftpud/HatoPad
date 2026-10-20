import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { automationPage, summarizeTrigger } from "../automation-page.js";
import { CoreError } from "../errors.js";
import { validateTrigger } from "../triggers.js";
import type { RequestContext } from "./context.js";

export async function handleTriggersRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { triggers, rootWorkspace, validateActionTarget, assertAutomationOwner, automationInput } = context;
  switch (request.type) {
    case "triggers.page":
      return automationPage(
        "triggers",
        request.rootId!,
        triggers.list(true).filter((item) => item.rootId === request.rootId),
        summarizeTrigger,
        request.payload,
      );
    case "triggers.read": {
      const id = request.payload.triggerId;
      if (typeof id !== "string" || !id || id.length > 128) throw new CoreError("INVALID_REQUEST", "Choose a trigger");
      const trigger = triggers.list(true).find((item) => item.id === id && item.rootId === request.rootId);
      if (!trigger) throw new CoreError("FILE_NOT_FOUND", "Trigger is unavailable in this root");
      return { trigger };
    }
    case "triggers.update": {
      automationInput(request.payload.input, "trigger");
      validateTrigger(request.payload.input);
      await validateActionTarget(request.payload.input);
      assertAutomationOwner("trigger", request.payload.triggerId);
      if (typeof request.payload.expectedRevision !== "string" || !request.payload.expectedRevision)
        throw new CoreError("INVALID_REQUEST", "Expected revision is required");
      const input = request.payload.input;
      return {
        trigger: await triggers.update(
          request.payload.triggerId,
          { ...input, source: { ...input.source, path: path.resolve(rootWorkspace, input.source.path) } },
          request.payload.enabled,
          request.payload.expectedRevision,
          request.rootId!,
        ),
      };
    }
    case "triggers.history": {
      assertAutomationOwner("trigger", request.payload.triggerId);
      return triggers.history(request.payload.triggerId, request.payload.limit, request.payload.before);
    }
    case "triggers.list":
      return { triggers: triggers.list(true).filter((item) => item.rootId === request.rootId) };
    case "triggers.create": {
      automationInput(request.payload, "trigger");
      validateTrigger(request.payload);
      await validateActionTarget(request.payload);
      const source = { ...request.payload.source, path: path.resolve(rootWorkspace, request.payload.source.path) };
      return { trigger: await triggers.create(request.rootId!, { ...request.payload, source }) };
    }
    case "triggers.enabled": {
      assertAutomationOwner("trigger", request.payload.triggerId);
      return { trigger: await triggers.setEnabled(request.payload.triggerId, request.payload.enabled) };
    }
    case "triggers.delete": {
      assertAutomationOwner("trigger", request.payload.triggerId);
      return { deleted: await triggers.delete(request.payload.triggerId) };
    }
    case "triggers.fire": {
      assertAutomationOwner("trigger", request.payload.triggerId);
      return { fired: await triggers.fire(request.payload.triggerId) };
    }
  }
}
