import type { HarnessBlock, HarnessEdge, HarnessRun } from "@hatopad/protocol";

export function blockReadiness(blockId: string, blocks: HarnessBlock[], edges: HarnessEdge[], states: HarnessRun["blocks"]): "ready" | "wait" | "skip" {
  const incoming = edges.filter((edge) => edge.to === blockId && !edge.loop); if (!incoming.length) return "ready";
  const resolved = incoming.map((edge) => {
    const source = blocks.find((block) => block.id === edge.from)!; const state = states.find((item) => item.blockId === edge.from)!;
    if (state.status === "skipped") return "inactive";
    if (state.status !== "succeeded") return "pending";
    return source.routing === "ai" && state.selectedRoute !== edge.label ? "inactive" : "active";
  });
  const join = blocks.find((block) => block.id === blockId)?.join ?? "all";
  if (join === "any" && resolved.includes("active")) return "ready";
  if (resolved.includes("pending")) return "wait";
  if (!resolved.includes("active")) return "skip";
  return "ready";
}

export class ExecutionScheduler {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly serial = new Map<string, Promise<void>>();
  private readonly owners = new Map<string, { permit: boolean }>();

  constructor(private readonly limit: number, private readonly assertActive: () => void, private readonly schedulingReady: () => Promise<void> = async () => {}) {}

  async turn<T>(blockId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.serial.get(blockId) ?? Promise.resolve();
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.serial.set(blockId, tail);
    const owner = { permit: false };
    try {
      await previous.catch(() => undefined);
      this.assertActive(); await this.schedulingReady(); await this.acquire();
      owner.permit = true; this.owners.set(blockId, owner);
      this.assertActive(); await this.schedulingReady();
      return await work();
    } finally {
      if (owner.permit) this.release();
      if (this.owners.get(blockId) === owner) this.owners.delete(blockId);
      unlock();
      if (this.serial.get(blockId) === tail) this.serial.delete(blockId);
    }
  }

  async suspend<T>(blockId: string, work: () => Promise<T>): Promise<T> {
    const owner = this.owners.get(blockId);
    if (!owner?.permit) return work();
    owner.permit = false;
    this.release();
    try { return await work(); }
    finally {
      // A timed-out caller may have finished its turn while the child continued.
      if (this.owners.get(blockId) === owner) {
        await this.acquire();
        if (this.owners.get(blockId) === owner) owner.permit = true;
        else this.release();
        this.assertActive();
      }
    }
  }

  async nestedTurn<T>(blockId: string, work: () => Promise<T>): Promise<T> {
    const suspended = this.owners.get(blockId);
    if (!suspended || suspended.permit) return this.turn(blockId, work);
    await this.acquire();
    const owner = { permit: true };
    this.owners.set(blockId, owner);
    try {
      this.assertActive();
      await this.schedulingReady();
      return await work();
    } finally {
      if (owner.permit) this.release();
      if (this.owners.get(blockId) === owner) this.owners.set(blockId, suspended);
    }
  }

  async control<T>(blockId: string, work: () => Promise<T>): Promise<T> {
    const owner = this.owners.get(blockId);
    if (!owner) return this.turn(blockId, work);
    if (!owner.permit) return this.nestedTurn(blockId, work);
    this.assertActive();
    return work();
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) { this.active += 1; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
    else this.active -= 1;
  }
}
