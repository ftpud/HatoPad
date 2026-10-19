import type { AgentFile } from "../types/configuration.js";
import type { WorkspaceSchedule, ScheduleSummary, ScheduleInput } from "../types/automation.js";

export type SchedulesOperations = {
  "schedules.agents": { payload: { taskId?: string }; result: { agents: AgentFile[] } };
  "schedules.list": { payload: Record<string, never>; result: { schedules: WorkspaceSchedule[] } };
  "schedules.page": { payload: { limit?: number; cursor?: string; query?: string }; result: { items: ScheduleSummary[]; total: number; revision: string; nextCursor?: string; restarted?: boolean } };
  "schedules.read": { payload: { scheduleId: string }; result: { schedule: WorkspaceSchedule } };
  "schedules.create": { payload: ScheduleInput; result: { schedule: WorkspaceSchedule } };
  "schedules.update": { payload: { scheduleId: string; input: ScheduleInput; enabled: boolean; expectedRevision: string }; result: { schedule: WorkspaceSchedule } };
  "schedules.enabled": { payload: { scheduleId: string; enabled: boolean }; result: { schedule: WorkspaceSchedule } };
  "schedules.delete": { payload: { scheduleId: string }; result: { deleted: boolean } };
  "schedules.fire": { payload: { scheduleId: string }; result: { fired: boolean } };
};
