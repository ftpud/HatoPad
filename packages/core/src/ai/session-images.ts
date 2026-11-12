import { createHash } from "node:crypto";
import type { AiContentBlock, AiMessage, AiSession } from "@hatopad/protocol";

type Image = Extract<AiContentBlock, { type: "image" }>;
const identities = new WeakMap<Image, { data: string; id: string }>();

export function sessionImageId(image: Image): string {
  const cached = identities.get(image);
  if (cached?.data === image.data) return cached.id;
  const id = createHash("sha256").update(image.mimeType).update("\0").update(image.data).digest("hex");
  identities.set(image, { data: image.data, id });
  return id;
}

/** Image bytes remain in Core and are fetched once on demand, never resent with transcript updates. */
export function deferSessionImages(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as {
    session?: AiSession;
    sessions?: AiSession[];
    updates?: { index: number; message: AiMessage }[];
  };
  const message = (item: AiMessage): AiMessage => ({
    ...item,
    ...(item.content
      ? {
          content: item.content.map((block) =>
            block.type === "image" ? { ...block, data: "", deferred: sessionImageId(block) } : block,
          ),
        }
      : {}),
  });
  const session = (item: AiSession): AiSession => ({ ...item, messages: item.messages.map(message) });
  return {
    ...record,
    ...(record.session ? { session: session(record.session) } : {}),
    ...(record.sessions ? { sessions: record.sessions.map(session) } : {}),
    ...(record.updates
      ? { updates: record.updates.map((entry) => ({ ...entry, message: message(entry.message) })) }
      : {}),
  };
}
