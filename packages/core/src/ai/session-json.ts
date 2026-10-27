import { setImmediate } from "node:timers/promises";
import type { AiMessage, AiSession } from "@hatopad/protocol";
import { sameMessage } from "./session-delta.js";

/** Serialize large transcripts a message at a time; unchanged screenshots are encoded only once. */
export class SessionJson {
  private readonly encoded = new WeakMap<AiMessage, { snapshot: AiMessage; json: string }>();

  serialize(session: AiSession & { _ownerPid?: number }): AsyncIterable<string> {
    const { messages, ...metadata } = session;
    // Capture before awaiting disk IO: a subsequent update must not alter this save's snapshot.
    const snapshots = messages.map((message) => ({ original: message, snapshot: { ...message } }));
    const header = JSON.stringify(metadata);
    const encoded = this.encoded;
    return (async function* () {
      yield `${header.slice(0, -1)},"messages":[`;
      for (let index = 0; index < snapshots.length; index++) {
        await setImmediate();
        const { original, snapshot } = snapshots[index]!;
        let cached = encoded.get(original);
        if (!cached || !sameMessage(cached.snapshot, snapshot)) {
          cached = { snapshot, json: JSON.stringify(snapshot) };
          encoded.set(original, cached);
        }
        if (index) yield ",";
        yield cached.json;
      }
      yield "]}\n";
    })();
  }
}
