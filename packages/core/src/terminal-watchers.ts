import crypto from "node:crypto";
import path from "node:path";
import type { ServerEvent } from "@hatopad/protocol";
import { CoreError } from "./errors.js";

export const watcherLimits = {
  windowBytes: 65_536,
  pendingBytes: 65_536,
  chunkBytes: 16_384,
  perConnection: 4,
} as const;
type Scope = { rootId: string; workspace: string };
type Watch = Scope & {
  id: string;
  terminalId: string;
  active: boolean;
  pending: string;
  truncated: boolean;
  sequence: number;
  acknowledged: number;
  outstanding: Map<number, number>;
  exitCode?: number;
  exitSent: boolean;
};
/** Independently budgeted watchers never own, resize or write to the PTY. */
export class TerminalWatchers<S extends object> {
  private readonly sockets = new Map<S, Map<string, Watch>>();
  constructor(private readonly send: (socket: S, event: ServerEvent) => boolean) {}
  attach(socket: S, scope: Scope, terminalId: string): string {
    const watches = this.sockets.get(socket) ?? new Map<string, Watch>();
    if (watches.size >= watcherLimits.perConnection)
      throw new CoreError("INVALID_REQUEST", "Too many terminal watchers; detach one first");
    const id = crypto.randomUUID();
    watches.set(id, {
      ...scope,
      workspace: path.resolve(scope.workspace),
      id,
      terminalId,
      active: false,
      pending: "",
      truncated: false,
      sequence: 0,
      acknowledged: 0,
      outstanding: new Map(),
      exitSent: false,
    });
    this.sockets.set(socket, watches);
    return id;
  }
  acknowledge(socket: S, scope: Scope, id: string, sequence: number): void {
    const watch = this.owned(socket, scope, id);
    if (!Number.isSafeInteger(sequence) || sequence < watch.acknowledged || sequence > watch.sequence)
      throw new CoreError("INVALID_REQUEST", "Invalid terminal watcher acknowledgement");
    watch.active = true;
    watch.acknowledged = sequence;
    for (const sent of watch.outstanding.keys()) if (sent <= sequence) watch.outstanding.delete(sent);
    this.flush(socket, watch);
  }
  detach(socket: S, scope: Scope, id: string): void {
    this.owned(socket, scope, id);
    this.sockets.get(socket)?.delete(id);
  }
  disconnect(socket: S): void {
    this.sockets.delete(socket);
  }
  output(workspace: string, terminalId: string, data: string): void {
    for (const [socket, watches] of this.sockets)
      for (const watch of watches.values()) {
        if (
          watch.workspace !== path.resolve(workspace) ||
          watch.terminalId !== terminalId ||
          watch.exitCode !== undefined
        )
          continue;
        const bytes = Buffer.from(watch.pending + data);
        if (bytes.length > watcherLimits.pendingBytes) {
          let start = bytes.length - watcherLimits.pendingBytes;
          while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
          watch.pending = bytes.subarray(start).toString("utf8");
          watch.truncated = true;
        } else watch.pending = bytes.toString("utf8");
        this.flush(socket, watch);
      }
  }
  exit(workspace: string, terminalId: string, exitCode: number): void {
    for (const [socket, watches] of this.sockets)
      for (const watch of watches.values())
        if (watch.workspace === path.resolve(workspace) && watch.terminalId === terminalId) {
          watch.exitCode = exitCode;
          this.flush(socket, watch);
        }
  }
  private owned(socket: S, scope: Scope, id: string): Watch {
    const watch = this.sockets.get(socket)?.get(id);
    if (!watch || watch.rootId !== scope.rootId || watch.workspace !== path.resolve(scope.workspace))
      throw new CoreError("FILE_NOT_FOUND", "Terminal watcher is unavailable in this workspace");
    return watch;
  }
  private flush(socket: S, watch: Watch): void {
    if (!watch.active) return;
    let charged = [...watch.outstanding.values()].reduce((sum, bytes) => sum + bytes, 0);
    while (watch.pending && charged < watcherLimits.windowBytes) {
      const bytes = Buffer.from(watch.pending);
      let end = Math.min(bytes.length, watcherLimits.chunkBytes, watcherLimits.windowBytes - charged);
      if (end < bytes.length) while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
      if (!end) break;
      const data = bytes.subarray(0, end).toString("utf8");
      const sequence = ++watch.sequence;
      if (
        !this.send(socket, {
          type: "terminal.watch.output",
          payload: {
            rootId: watch.rootId,
            watchId: watch.id,
            terminalId: watch.terminalId,
            sequence,
            data,
            truncated: watch.truncated,
          },
        })
      ) {
        this.disconnect(socket);
        return;
      }
      watch.outstanding.set(sequence, end);
      charged += end;
      watch.truncated = false;
      watch.pending = bytes.subarray(end).toString("utf8");
    }
    if (!watch.pending && watch.exitCode !== undefined && !watch.exitSent) {
      watch.exitSent = true;
      if (
        !this.send(socket, {
          type: "terminal.watch.exit",
          payload: { rootId: watch.rootId, watchId: watch.id, terminalId: watch.terminalId, exitCode: watch.exitCode },
        })
      )
        this.disconnect(socket);
    }
  }
}
