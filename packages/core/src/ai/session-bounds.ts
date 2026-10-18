import type { AiPermissionRequest, AiQuestionField, AiQuestionRequest, AiSession } from "@remote-ide/protocol";
import { CoreError } from "../errors.js";

export const sessionListLimits = { defaultSessions: 30, maxSessions: 100, maxResponseMessages: 100 } as const;

/** Keep only the newest `limit` messages; record how many were left out. Never mutates the input. */
export function limitSessionMessages(session: AiSession, limit: number): AiSession {
  const bounded = boundPending(session);
  if (bounded.messages.length <= limit) return bounded;
  return { ...bounded, messages: limit === 0 ? [] : bounded.messages.slice(-limit), omittedMessages: bounded.messages.length - limit };
}

const clip = (value: string, max: number) => value.length > max ? value.slice(0, max) : value;
const pendingLimits = { title: 200, details: 2000, optionName: 200, options: 20, message: 1000, fields: 30, label: 300, choices: 50 } as const;

/** Clip display text of a pending permission. Identities (`id`, `toolCallId`, `optionId`) are never altered. */
export function boundPermission(request: AiPermissionRequest): AiPermissionRequest {
  const truncated = request.title.length > pendingLimits.title || (request.details?.length ?? 0) > pendingLimits.details || request.options.length > pendingLimits.options || request.options.some((option) => option.name.length > pendingLimits.optionName);
  return { ...request, title: clip(request.title, pendingLimits.title), ...(request.details !== undefined ? { details: clip(request.details, pendingLimits.details) } : {}), options: request.options.slice(0, pendingLimits.options).map((option) => ({ ...option, name: clip(option.name, pendingLimits.optionName) })), ...(truncated ? { truncated: true as const } : {}) };
}

/** Clip display text of a pending question; field ids, types and choice values stay intact so answers remain valid. */
export function boundQuestion(request: AiQuestionRequest): AiQuestionRequest {
  const field = (item: AiQuestionField): AiQuestionField => ({
    ...item,
    ...(item.title !== undefined ? { title: clip(item.title, pendingLimits.label) } : {}),
    ...(item.description !== undefined ? { description: clip(item.description, pendingLimits.label) } : {}),
    ...(item.choices ? { choices: item.choices.slice(0, pendingLimits.choices).map((choice) => ({ ...choice, label: clip(choice.label, pendingLimits.label), ...(choice.description !== undefined ? { description: clip(choice.description, pendingLimits.label) } : {}) })) } : {})
  });
  const long = (value: string | undefined) => (value?.length ?? 0) > pendingLimits.label;
  const truncated = request.message.length > pendingLimits.message || request.fields.length > pendingLimits.fields
    || request.fields.some((item) => long(item.title) || long(item.description) || (item.choices?.length ?? 0) > pendingLimits.choices || item.choices?.some((choice) => long(choice.label) || long(choice.description)));
  return { ...request, message: clip(request.message, pendingLimits.message), fields: request.fields.slice(0, pendingLimits.fields).map(field), ...(truncated ? { truncated: true as const } : {}) };
}

export function boundPending<T extends Pick<AiSession, "pendingPermission" | "pendingQuestion">>(session: T): T {
  if (!session.pendingPermission && !session.pendingQuestion) return session;
  return { ...session, ...(session.pendingPermission ? { pendingPermission: boundPermission(session.pendingPermission) } : {}), ...(session.pendingQuestion ? { pendingQuestion: boundQuestion(session.pendingQuestion) } : {}) };
}

/** Apply a connection's `sessionMessageLimit` to every AiSession in a response (`session` / `sessions`). */
export function boundSessionsInResult(result: unknown, limit: number | undefined): unknown {
  if (limit === undefined || typeof result !== "object" || result === null) return result;
  const record = result as { session?: AiSession; sessions?: AiSession[] };
  if (!record.session && !record.sessions) return result;
  return {
    ...record,
    ...(record.session ? { session: limitSessionMessages(record.session, limit) } : {}),
    ...(Array.isArray(record.sessions) ? { sessions: record.sessions.map((session) => limitSessionMessages(session, limit)) } : {})
  };
}

export function validSessionMessageLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > sessionListLimits.maxResponseMessages) throw new CoreError("INVALID_REQUEST", `sessionMessageLimit must be an integer from 0 to ${sessionListLimits.maxResponseMessages}`);
  return value;
}

/** Paged session metadata. `summary` drops transcripts; `before` is a session id from `nextBefore`. */
export function pageSessions(sessions: AiSession[], request: { summary?: unknown; limit?: unknown; before?: unknown }): { sessions: AiSession[]; nextBefore?: string } {
  if (request.summary !== undefined && typeof request.summary !== "boolean") throw new CoreError("INVALID_REQUEST", "summary must be a boolean");
  const paged = request.limit !== undefined || request.before !== undefined;
  const limit = request.limit ?? sessionListLimits.defaultSessions;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > sessionListLimits.maxSessions) throw new CoreError("INVALID_REQUEST", `limit must be an integer from 1 to ${sessionListLimits.maxSessions}`);
  if (request.before !== undefined && (typeof request.before !== "string" || !request.before)) throw new CoreError("INVALID_REQUEST", "before must be a session id");
  let start = 0;
  if (request.before !== undefined) {
    const index = sessions.findIndex((session) => session.id === request.before);
    if (index < 0) throw new CoreError("INVALID_REQUEST", "before session was not found; reload the first page");
    start = index + 1;
  }
  const selected = paged || request.summary === true ? sessions.slice(start, start + limit) : sessions;
  const next = start + selected.length;
  const nextBefore = (paged || request.summary === true) && next < sessions.length ? selected.at(-1)?.id : undefined;
  return { sessions: request.summary === true ? selected.map((session) => limitSessionMessages(session, 0)) : selected, ...(nextBefore ? { nextBefore } : {}) };
}
