import type { AiProvider, AiPermissionRequest, AiQuestionRequest } from "@hatopad/acp";

export type AttentionOperations = {
  "attention.read": { payload: { provider: AiProvider; taskId?: string; sessionId?: string; requestId: string }; result: { state: "resolved" } | { state: "pending"; sessionId?: string; permission?: AiPermissionRequest; question?: AiQuestionRequest } };
};
