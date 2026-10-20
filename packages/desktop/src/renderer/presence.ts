import type { CoreClient } from "./client";

/** Interval well within the Core's presence lease, so a visible window never lapses between reports. */
export const presenceReportIntervalMs = 20_000;

/**
 * Tell the connected Core whether this window is visible, so remote notifications can
 * skip work the user is already watching. Best effort: older Cores and lost connections are ignored.
 */
export function startPresenceReporting(current: () => CoreClient | undefined, doc: Document = document): () => void {
  const report = () => {
    const client = current();
    if (!client?.isConnected() || !client.supports("client.presence")) return;
    void client.request("client.presence", { visible: doc.visibilityState === "visible" }).catch(() => undefined);
  };
  const timer = setInterval(() => {
    if (doc.visibilityState === "visible") report();
  }, presenceReportIntervalMs);
  doc.addEventListener("visibilitychange", report);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", report);
  };
}
