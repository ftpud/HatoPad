import type { AiSession } from "@hatopad/protocol";

/** Newest messages requested while an agent streams; older ones rarely change mid-turn. */
export const AI_STREAM_TAIL = 100;

/**
 * Splice a bounded `ai.get` tail onto the transcript already shown. Returns `undefined`
 * when the tail cannot be anchored (different session, or a gap), so the caller reloads in full.
 */
export function mergeAiSessionTail(previous: AiSession, tail: AiSession): AiSession | undefined {
  if (!tail.omittedMessages) return tail;
  if (!previous.id || previous.id !== tail.id) return undefined;
  const first = tail.messages[0];
  if (!first) return undefined;
  const index = previous.messages.findIndex((message) => message.id === first.id);
  if (index < 0) return undefined;
  const { omittedMessages: _omitted, ...session } = tail;
  return {
    ...session,
    ...(previous.omittedMessages ? { omittedMessages: previous.omittedMessages } : {}),
    messages: [...previous.messages.slice(0, index), ...tail.messages],
  };
}
