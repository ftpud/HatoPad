import type { AiMessage, AiSession, AiStatus } from "@hatopad/protocol";

export function summarizeAiSessions(sessions: AiSession[]): {
  status: AiStatus;
  preview: string;
  pendingPermission: boolean;
} {
  const active = sessions.find((session) => session.status === "in_progress" || session.status === "user_prompt");
  const latest = [...sessions].sort((left, right) => lastTimestamp(right).localeCompare(lastTimestamp(left)))[0];
  const session = active ?? latest;
  if (!session) return { status: "idle", preview: "", pendingPermission: false };
  const messages = sessions.flatMap((item) => item.messages);
  const latestMessage = (candidates: AiMessage[]) =>
    candidates.reduce<AiMessage | undefined>(
      (latest, message) =>
        !latest || Date.parse(message.timestamp) >= Date.parse(latest.timestamp) ? message : latest,
      undefined,
    );
  const message =
    latestMessage(messages.filter((item) => item.role === "assistant" && item.text.trim())) ??
    latestMessage(messages.filter((item) => item.role === "activity" && item.text.trim())) ??
    latestMessage(messages);
  return {
    status: session.status,
    preview: message?.text.replace(/\s+/g, " ").trim().slice(0, 180) ?? "",
    pendingPermission: sessions.some(
      (item) => item.pendingPermission !== undefined || item.pendingQuestion !== undefined,
    ),
  };
}

function lastTimestamp(session: AiSession): string {
  return session.messages.at(-1)?.timestamp ?? "";
}
