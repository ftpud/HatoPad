import type { AiSession, ProtocolOperations } from "@hatopad/protocol";

/** Apply changed positions rather than guessing overlap from tool ids (which agents may reuse). */
export function mergeAiSessionDelta(
  previous: AiSession,
  result: ProtocolOperations["ai.get"]["result"],
): AiSession | undefined {
  if (result.updates === undefined) return result.session;
  if (!previous.id || previous.id !== result.session.id || result.messageCount === undefined) return undefined;
  const messages = previous.messages.slice();
  for (const { index, message } of result.updates) {
    if (!Number.isSafeInteger(index) || index < 0 || index > messages.length) return undefined;
    messages[index] = message;
  }
  if (messages.length !== result.messageCount) return undefined;
  return { ...result.session, messages };
}
