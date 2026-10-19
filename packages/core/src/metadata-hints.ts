import type { ServerEvent } from '@hatopad/protocol';
type Hint = Extract<ServerEvent, { type: 'harness.changed' | 'tasks.changed' | 'ai.changed' | 'taskGit.changed' | 'git.changed' | 'timers.changed' | 'automation.changed' | 'processes.changed' }>;
/** Invalidation hints are replaceable; responses, prompts and terminal bytes never enter this queue. */
export class MetadataHintBatcher {
  private readonly pending = new Map<string, Hint>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  constructor(private readonly send: (event: Hint) => void, private readonly delay = 50) {}
  enqueue(event: Hint): void {
    if (this.closed) return;
    const payload = event.payload as { rootId?: string; runId?: string; kind?: string };
    const key = [event.type, payload.rootId ?? '*', payload.runId ?? '', payload.kind ?? ''].join('\0');
    if (!this.pending.has(key) && this.pending.size >= 256) this.flush();
    this.pending.set(key, event);
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.delay); this.timer.unref(); }
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    const hints = [...this.pending.values()]; this.pending.clear();
    if (!this.closed) for (const hint of hints) this.send(hint);
  }
  dispose(): void { this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.pending.clear(); }
}
