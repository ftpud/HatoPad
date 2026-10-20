import type { HarnessBlock, HarnessBlockRun, HarnessMeetingMessage, HarnessRun } from "@hatopad/protocol";

/** Event-driven subscriptions; registering is synchronous to avoid lost updates. */
export class MeetingUpdates {
  private readonly listeners = new Set<{
    runId: string;
    blockId: string;
    finish(status: "updated" | "timed_out" | "cancelled"): void;
  }>();

  wait(runId: string, blockId: string, timeoutMs: number): Promise<"updated" | "timed_out" | "cancelled"> {
    return new Promise((resolve) => {
      const listener = {
        runId,
        blockId,
        finish: (status: "updated" | "timed_out" | "cancelled") => {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(status);
        },
      };
      const timer = setTimeout(() => listener.finish("timed_out"), timeoutMs);
      this.listeners.add(listener);
    });
  }

  publish(runId: string, blockId: string): void {
    for (const listener of this.listeners)
      if (listener.runId === runId && listener.blockId === blockId) listener.finish("updated");
  }

  cancel(runId?: string): void {
    for (const listener of this.listeners)
      if (runId === undefined || listener.runId === runId) listener.finish("cancelled");
  }
}

/** Synchronous mutations are atomic between callers; all state is saved with its run. */
export function useMeeting(state: HarnessBlockRun, caller: HarnessBlock, args: Record<string, unknown>) {
  const action = args.action ?? "diff";
  if (!["publish", "tail", "diff"].includes(String(action)))
    throw new Error("Meeting action must be publish, tail, or diff");
  const lines = args.lines ?? 20;
  if (typeof lines !== "number" || !Number.isInteger(lines) || lines < 1 || lines > 50)
    throw new Error("Meeting lines must be from 1 to 50");
  const after = args.after;
  if (
    after !== undefined &&
    (action !== "diff" || typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)
  )
    throw new Error("Meeting after must be a nonnegative sequence number with action diff");
  const meeting = state.meeting ?? { sequence: 0, messages: [], cursors: {} };
  if (typeof after === "number" && after > meeting.sequence)
    throw new Error("Meeting after exceeds the latest sequence number");
  if (action === "publish") {
    const text = args.message ?? args.input;
    if (typeof text !== "string" || !text.trim() || text.length > 10000)
      throw new Error("Meeting publish needs a message of 1 to 10000 characters");
    const message: HarnessMeetingMessage = {
      sequence: meeting.sequence + 1,
      blockId: caller.id,
      author: caller.label,
      provider: caller.provider,
      model: caller.model,
      text,
      timestamp: new Date().toISOString(),
    };
    if (JSON.stringify(message).length > 16000)
      throw new Error("Meeting message exceeds the 16000 character serialized limit");
    meeting.sequence = message.sequence;
    meeting.messages = [...meeting.messages, message].slice(-1000);
    state.meeting = meeting;
    return { published: message.sequence, latestSequence: meeting.sequence };
  }
  const savedCursor = Object.hasOwn(meeting.cursors, caller.id) ? meeting.cursors[caller.id]! : 0;
  const cursor = typeof after === "number" ? after : savedCursor;
  const candidates =
    action === "tail"
      ? meeting.messages.slice(-lines)
      : meeting.messages.filter((message) => message.sequence > cursor);
  const messages: HarnessMeetingMessage[] = [];
  let size = 0;
  // Bound serialized output before advancing the cursor so unread messages are never lost
  // to generic workflow context truncation, including heavily escaped message text.
  for (const message of action === "tail" ? [...candidates].reverse() : candidates) {
    const length = JSON.stringify(message).length;
    if (messages.length >= lines || size + length > 16000) break;
    if (action === "tail") messages.unshift(message);
    else messages.push(message);
    size += length;
  }
  const next = messages.at(-1)?.sequence ?? (action === "tail" ? meeting.sequence : cursor);
  meeting.cursors = { ...meeting.cursors, [caller.id]: Math.max(savedCursor, next) };
  state.meeting = meeting;
  return {
    messages,
    cursor: next,
    latestSequence: meeting.sequence,
    hasMore: next < meeting.sequence,
    historyTruncated: action === "diff" && cursor < (meeting.messages[0]?.sequence ?? 1) - 1,
  };
}

/** Append one notice per participant transition, shared by every connected room. */
export function publishMeetingStatusChanges(run: HarnessRun, previous: Map<string, string>): string[] {
  const definition = run.definition;
  if (!definition) return [];
  const changedRooms = new Set<string>();
  const descriptions: Record<string, string> = {
    running: "started activity",
    succeeded: "is idle",
    waiting_timer: "is waiting for a timer",
    failed: "stopped with an error",
    cancelled: "was stopped",
    blocked: "is blocked",
    awaiting_permission: "is waiting for permission",
    awaiting_user_input: "is waiting for input",
    retry_scheduled: "is waiting to retry",
    waiting: "is waiting",
    queued: "is queued",
  };
  for (const participant of definition.blocks) {
    if (participant.type !== "ai" && participant.type !== "chatbox") continue;
    const state = run.blocks.find((block) => block.blockId === participant.id);
    if (!state) continue;
    const before = previous.get(participant.id);
    previous.set(participant.id, state.status);
    if (before === state.status || (before === undefined && state.status !== "running")) continue;
    const description = descriptions[state.status];
    if (!description) continue;
    const roomIds = new Set(
      definition.edges
        .filter((edge) => edge.from === participant.id && (edge.type === "use" || participant.type === "chatbox"))
        .map((edge) => edge.to),
    );
    for (const room of definition.blocks) {
      if (room.type !== "meeting" || !roomIds.has(room.id)) continue;
      const meetingState = run.blocks.find((block) => block.blockId === room.id);
      if (!meetingState) continue;
      useMeeting(
        meetingState,
        {
          ...participant,
          provider: state.provider ?? state.chatSettings?.provider ?? participant.provider,
          model: state.chatSettings?.model ?? participant.model,
        },
        {
          action: "publish",
          message: `[Status] ${participant.label.slice(0, 200)} ${description}.`,
        },
      );
      meetingState.output = meetingState
        .meeting!.messages.map((message) => `[${message.sequence}] ${message.author}: ${message.text}`)
        .join("\n\n")
        .slice(-200000);
      changedRooms.add(room.id);
    }
  }
  return [...changedRooms];
}
