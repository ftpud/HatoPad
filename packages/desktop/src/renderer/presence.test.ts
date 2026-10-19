import { afterEach, describe, expect, it, vi } from "vitest";
import { presenceReportIntervalMs, startPresenceReporting } from "./presence";
import type { CoreClient } from "./client";

function fakeClient(capable = true) {
  const sent: unknown[] = [];
  const client = { isConnected: () => true, supports: (capability: string) => capable && capability === "client.presence", request: vi.fn(async (_type: string, payload: unknown) => { sent.push(payload); return {}; }) };
  return { client: client as unknown as CoreClient, sent };
}
function fakeDocument() {
  const listeners = new Set<() => void>();
  const doc = { visibilityState: "visible", addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
  return { doc: doc as unknown as Document & { visibilityState: string }, change: (state: string) => { doc.visibilityState = state; for (const listener of listeners) listener(); }, listeners };
}

describe("presence reporting", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("reports visibility changes and refreshes only while visible", () => {
    vi.useFakeTimers();
    const { client, sent } = fakeClient(); const page = fakeDocument();
    const stop = startPresenceReporting(() => client, page.doc);
    vi.advanceTimersByTime(presenceReportIntervalMs); expect(sent).toEqual([{ visible: true }]);
    page.change("hidden"); expect(sent.at(-1)).toEqual({ visible: false });
    vi.advanceTimersByTime(presenceReportIntervalMs * 3); expect(sent).toHaveLength(2);
    stop(); expect(page.listeners.size).toBe(0);
  });
  it("stays quiet with older Cores", () => {
    vi.useFakeTimers();
    const { client, sent } = fakeClient(false); const page = fakeDocument();
    const stop = startPresenceReporting(() => client, page.doc);
    page.change("hidden"); vi.advanceTimersByTime(presenceReportIntervalMs); expect(sent).toHaveLength(0); stop();
  });
});
