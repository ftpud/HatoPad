import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TerminalSnapshot } from "./process-manager.js";

export type SavedTerminal = TerminalSnapshot & { workspace: string };

/** Atomic, private snapshots. A restored process is historical, never relaunched. */
export class TerminalStateStore {
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly file: string) {}

  load(): SavedTerminal[] {
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(saved)) throw new Error("Invalid terminal state");
      return saved.filter(
        (item): item is SavedTerminal =>
          item &&
          typeof item === "object" &&
          typeof item.terminalId === "string" &&
          /^[0-9a-f-]{36}$/i.test(item.terminalId) &&
          typeof item.workspace === "string" &&
          path.isAbsolute(item.workspace) &&
          typeof item.output === "string" &&
          (item.status === "running" || item.status === "exited") &&
          (item.displayName === undefined || typeof item.displayName === "string") &&
          (item.exitCode === undefined || Number.isInteger(item.exitCode)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("[core] Could not restore terminal history", error);
      return [];
    }
  }

  schedule(snapshot: () => SavedTerminal[]): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush(snapshot());
    }, 250);
    this.timer.unref();
  }

  flush(snapshot: SavedTerminal[]): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      renameSync(temporary, this.file);
    } catch (error) {
      console.warn("[core] Could not save terminal history", error);
    }
  }
}
