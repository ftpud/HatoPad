import type { AiMessage, AiSession } from "@hatopad/protocol";
import { CoreError } from "../errors.js";

export const messagePageLimits = { defaultMessages: 30, maxMessages: 100, defaultText: 4000, maxText: 20_000 } as const;

export interface MessagePage {
  messages: AiMessage[];
  clipped: string[];
  nextBefore?: string;
}

function bounded(value: unknown, fallback: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new CoreError("INVALID_REQUEST", `${name} must be an integer from 1 to ${max}`);
  return value;
}

/** Newest-first window over a session's messages, oldest-to-newest within the page. Never mutates the session. */
export function pageMessages(session: Pick<AiSession, "messages">, request: { before?: unknown; limit?: unknown; maxTextLength?: unknown }): MessagePage {
  const limit = bounded(request.limit, messagePageLimits.defaultMessages, messagePageLimits.maxMessages, "limit");
  const maxText = bounded(request.maxTextLength, messagePageLimits.defaultText, messagePageLimits.maxText, "maxTextLength");
  if (request.before !== undefined && (typeof request.before !== "string" || !request.before || request.before.length > 128)) throw new CoreError("INVALID_REQUEST", "before must be a message id");
  let end = session.messages.length;
  if (request.before !== undefined) {
    end = session.messages.findIndex((message) => message.id === request.before);
    if (end < 0) throw new CoreError("INVALID_REQUEST", "before message was not found; reload the newest page");
  }
  const start = Math.max(0, end - limit);
  const clipped: string[] = [];
  const messages = session.messages.slice(start, end).map(({ content: _content, ...message }) => {
    if (message.text.length <= maxText) return message;
    clipped.push(message.id);
    return { ...message, text: message.text.slice(0, maxText) };
  });
  return { messages, clipped, ...(start > 0 ? { nextBefore: session.messages[start]!.id } : {}) };
}
