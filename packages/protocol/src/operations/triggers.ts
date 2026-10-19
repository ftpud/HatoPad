import type { TriggerFireRecord, WorkspaceTrigger, TriggerSummary, TriggerInput } from "../types/automation.js";

export type TriggersOperations = {
  "triggers.history": { payload: { triggerId: string; limit?: number; before?: string }; result: { entries: TriggerFireRecord[]; nextBefore?: string } };
  "triggers.list": { payload: Record<string, never>; result: { triggers: WorkspaceTrigger[] } };
  "triggers.page": { payload: { limit?: number; cursor?: string; query?: string }; result: { items: TriggerSummary[]; total: number; revision: string; nextCursor?: string; restarted?: boolean } };
  "triggers.read": { payload: { triggerId: string }; result: { trigger: WorkspaceTrigger } };
  "triggers.create": { payload: TriggerInput; result: { trigger: WorkspaceTrigger } };
  "triggers.update": { payload: { triggerId: string; input: TriggerInput; enabled: boolean; expectedRevision: string }; result: { trigger: WorkspaceTrigger } };
  "triggers.enabled": { payload: { triggerId: string; enabled: boolean }; result: { trigger: WorkspaceTrigger } };
  "triggers.delete": { payload: { triggerId: string }; result: { deleted: boolean } };
  "triggers.fire": { payload: { triggerId: string }; result: { fired: boolean } };
};
