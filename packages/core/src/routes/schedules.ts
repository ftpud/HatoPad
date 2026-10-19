import { type Request } from "@hatopad/protocol";
import { automationPage, summarizeSchedule } from "../automation-page.js";
import { CoreError } from "../errors.js";
import { validateSchedule } from "../schedules.js";
import type { RequestContext } from "./context.js";

export async function handleSchedulesRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, agents, schedules, rootWorkspace, validateActionTarget, assertAutomationOwner, automationInput } = context;
  switch (request.type) {

    case "schedules.agents": {
      const task = request.payload.taskId ? (await tasks.list()).tasks.find((item) => item.id === request.payload.taskId) : undefined;
      if (request.payload.taskId && !task) throw new CoreError("FILE_NOT_FOUND", "Task no longer exists");
      return { agents: await agents.list(task ? tasks.taskPath(task.id) : rootWorkspace) };
    }
    case "schedules.page": return automationPage("schedules", request.rootId!, schedules.list(true).filter(item => item.rootId === request.rootId), summarizeSchedule, request.payload);
    case "schedules.read": {
      const id = request.payload.scheduleId; if (typeof id !== "string" || !id || id.length > 128) throw new CoreError("INVALID_REQUEST", "Choose a schedule");
      const schedule = schedules.list(true).find(item => item.id === id && item.rootId === request.rootId); if (!schedule) throw new CoreError("FILE_NOT_FOUND", "Schedule is unavailable in this root");
      return { schedule };
    }
    case "schedules.list": return { schedules: schedules.list(true).filter(item => item.rootId === request.rootId) };
    case "schedules.create": {
      automationInput(request.payload, "schedule");
      validateSchedule(request.payload);
      await validateActionTarget(request.payload);
      return { schedule: await schedules.create(request.rootId!, request.payload) };
    }
    case "schedules.update": {
      automationInput(request.payload.input, "schedule");
      validateSchedule(request.payload.input); await validateActionTarget(request.payload.input);
      return { schedule: await schedules.update(request.payload.scheduleId, request.rootId!, request.payload.input, request.payload.enabled, request.payload.expectedRevision) };
    }
    case "schedules.enabled": { assertAutomationOwner("schedule", request.payload.scheduleId); return { schedule: await schedules.setEnabled(request.payload.scheduleId, request.payload.enabled) }; }
    case "schedules.delete": { assertAutomationOwner("schedule", request.payload.scheduleId); return { deleted: await schedules.delete(request.payload.scheduleId) }; }
    case "schedules.fire": { assertAutomationOwner("schedule", request.payload.scheduleId); return { fired: await schedules.fire(request.payload.scheduleId, true) }; }
  }
}
