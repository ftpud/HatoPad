import { createHash, randomBytes } from "node:crypto";
import type { SupervisionEvent } from "@hatopad/protocol";
import { CoreError } from "./errors.js";
/** Ephemeral metadata only: no prompts, output, paths, commands or credentials. */
export class SupervisionFeed {
  readonly startedAt = new Date().toISOString();
  private readonly epoch = randomBytes(8).toString("hex");
  private sequence = 0;
  private readonly events: SupervisionEvent[] = [];
  private readonly keys = new Map<string, true>();
  private dropped = false;
  push(
    kind: SupervisionEvent["kind"],
    rootId: string,
    target: { taskId?: string; runId?: string } = {},
    key?: string,
  ): void {
    if (key && this.keys.has(key)) return;
    if (key) {
      this.keys.set(key, true);
      if (this.keys.size > 400) this.keys.delete(this.keys.keys().next().value!);
    }
    this.events.unshift({
      id: `${this.epoch}.${++this.sequence}`,
      sequence: this.sequence,
      rootId,
      kind,
      at: new Date().toISOString(),
      ...target,
    });
    if (this.events.length > 200) {
      this.events.pop();
      this.dropped = true;
    }
  }
  page(request: { limit?: unknown; cursor?: unknown; rootId?: unknown }) {
    const limit = request.limit ?? 30;
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (request.rootId !== undefined &&
        (typeof request.rootId !== "string" || !request.rootId || request.rootId.length > 128))
    )
      throw new CoreError("INVALID_REQUEST", "Choose a valid activity page");
    const revision = createHash("sha256")
      .update(`${this.epoch}:${request.rootId ?? "*"}`)
      .digest("hex")
      .slice(0, 16);
    let before = Number.MAX_SAFE_INTEGER,
      restarted = false;
    if (request.cursor !== undefined) {
      if (typeof request.cursor !== "string" || !/^[0-9a-f]{16}\.\d{1,16}$/.test(request.cursor))
        throw new CoreError("INVALID_REQUEST", "Invalid activity cursor");
      const [epoch, position] = request.cursor.split(".");
      if (epoch === revision) before = Number(position);
      else restarted = true;
    }
    const all = this.events.filter(
        (event) => (!request.rootId || event.rootId === request.rootId) && event.sequence < before,
      ),
      events = all.slice(0, limit);
    return {
      events,
      startedAt: this.startedAt,
      truncated: this.dropped,
      ...(restarted ? { restarted: true } : {}),
      ...(all.length > events.length ? { nextCursor: `${revision}.${events.at(-1)!.sequence}` } : {}),
    };
  }
}
