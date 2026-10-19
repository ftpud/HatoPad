import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { permissionTargetWorkspace } from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleTimersRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, acp, aiTimers, schedules, rootWorkspace, ownedTimers, assertTimerOwner } = context;
  switch (request.type) {

    case "timers.create": {
      const { provider, prompt, seconds, dueAt, taskId } = request.payload;
      if (typeof provider !== "string" || !provider || typeof prompt !== "string" || !prompt.trim() || prompt.length > 64_000 || (seconds === undefined) === (dueAt === undefined)) throw new CoreError("INVALID_REQUEST", "Choose a provider, prompt and exactly one timer time");
      acp.get(provider);
      if (dueAt !== undefined && typeof dueAt !== "string") throw new CoreError("INVALID_REQUEST", "Timer time must be an ISO timestamp");
      const due = seconds !== undefined ? Date.now() + seconds * 1000 : Date.parse(dueAt!);
      if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 1 || seconds > 604_800)) throw new CoreError("INVALID_REQUEST", "Timer delay must be 1 second to 7 days");
      if (!Number.isFinite(due) || due <= Date.now() || due > Date.now() + 604_800_000) throw new CoreError("INVALID_REQUEST", "Timer time must be in the next 7 days");
      const target = await permissionTargetWorkspace(tasks, rootWorkspace, taskId);
      return { timer: await aiTimers.scheduleAt(target, provider, prompt, new Date(due).toISOString()) };
    }
    case "timers.list": {
      if (request.payload.rootScoped !== undefined && typeof request.payload.rootScoped !== "boolean") throw new CoreError("INVALID_REQUEST", "rootScoped must be boolean");
      if (!request.payload.rootScoped) return { timers: await aiTimers.list() };
      const registry = await tasks.list(), timerTargets = new Map(registry.tasks.map(task => [tasks.taskPath(task.id), task.id]));
      return { timers: (await ownedTimers()).map(timer => ({ ...timer, ...(timerTargets.get(timer.workspace) ? { taskId: timerTargets.get(timer.workspace) } : {}) })) };
    }
    case "timers.cancel": { if (request.payload.rootScoped === true) await assertTimerOwner(request.payload.timerId); return { cancelled: await aiTimers.cancel(request.payload.timerId) }; }
    case "timers.fire": { if (request.payload.rootScoped === true) await assertTimerOwner(request.payload.timerId); return { fired: await aiTimers.fireById(request.payload.timerId) }; }
    case "timers.cancelAll": {
      let pausedSchedules = 0;
      for (const schedule of schedules.list()) if (schedule.enabled) { await schedules.setEnabled(schedule.id, false); pausedSchedules += 1; }
      return { cancelled: await aiTimers.cancelAll(), pausedSchedules };
    }
  }
}
