import type { AiContinuationTimer } from "../types/automation.js";
import type { AiProvider } from "@hatopad/acp";

export type TimersOperations = {
  "timers.list": { payload: { rootScoped?: boolean }; result: { timers: AiContinuationTimer[] } };
  "timers.create": { payload: { taskId?: string; provider: AiProvider; prompt: string; seconds?: number; dueAt?: string }; result: { timer: AiContinuationTimer } };
  "timers.cancel": { payload: { timerId: string; rootScoped?: boolean }; result: { cancelled: boolean } };
  "timers.fire": { payload: { timerId: string; rootScoped?: boolean }; result: { fired: boolean } };
  "timers.cancelAll": { payload: Record<string, never>; result: { cancelled: number; pausedSchedules: number } };
};
