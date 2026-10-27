import { randomUUID } from "node:crypto";
import type { AiMessage, AiSession, ProtocolOperations } from "@hatopad/protocol";

type Snapshot = { epoch: string; revision: number; messages: { message: AiMessage; revision: number }[] };

/** Messages are updated in place by ACP; retain their field values, not their mutable object identities. */
export function sameMessage(left: AiMessage, right: AiMessage): boolean {
  const keys = Object.keys(left) as (keyof AiMessage)[];
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => {
      if (left[key] === right[key]) return true;
      if (key !== "content" || !left.content || !right.content || left.content.length !== right.content.length)
        return false;
      return left.content.every((block, index) => {
        const other = right.content![index]!;
        const fields = Object.keys(block) as (keyof typeof block)[];
        return fields.length === Object.keys(other).length && fields.every((field) => block[field] === other[field]);
      });
    })
  );
}

/** Bounded per-provider cursor history. A lost cursor always recovers with a full snapshot. */
export class SessionDeltas {
  private readonly snapshots = new Map<string, Snapshot & { sessionId?: string }>();

  get(workspace: string, session: AiSession, after?: string): ProtocolOperations["ai.get"]["result"] {
    let snapshot = this.snapshots.get(workspace);
    if (
      !snapshot ||
      snapshot.sessionId !== session.id ||
      snapshot.messages.length > session.messages.length ||
      snapshot.messages.some((entry, index) => entry.message.id !== session.messages[index]?.id)
    ) {
      snapshot = { epoch: randomUUID(), revision: 0, messages: [], sessionId: session.id };
    }
    snapshot.revision++;
    const revision = snapshot.revision;
    snapshot.messages = session.messages.map((message, index) => {
      const previous = snapshot.messages[index];
      return previous && sameMessage(previous.message, message) ? previous : { message: { ...message }, revision };
    });
    this.snapshots.delete(workspace);
    this.snapshots.set(workspace, snapshot);
    if (this.snapshots.size > 32) this.snapshots.delete(this.snapshots.keys().next().value!);
    const cursor = `${snapshot.epoch}:${revision}`;
    const prefix = `${snapshot.epoch}:`;
    const since = after?.startsWith(prefix) ? Number(after.slice(prefix.length)) : NaN;
    if (!Number.isSafeInteger(since) || since < 1 || since >= revision) return { session, cursor };
    return {
      session: { ...session, messages: [] },
      cursor,
      messageCount: session.messages.length,
      updates: snapshot.messages.flatMap((entry, index) =>
        entry.revision > since ? [{ index, message: entry.message }] : [],
      ),
    };
  }
}
