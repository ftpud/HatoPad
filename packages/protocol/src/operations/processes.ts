import type { ManagedWorkflowApp } from "../types/workflow.js";

export type ProcessesOperations = {
  "processes.list": { payload: Record<string, never>; result: { processes: ManagedWorkflowApp[] } };
  "processes.kill": { payload: { processId: string }; result: { killed: boolean } };
};
