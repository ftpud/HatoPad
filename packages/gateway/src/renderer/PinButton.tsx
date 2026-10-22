import { useState } from "react";
import { Pin } from "lucide-react";

/** Stable ordering inside each group preserves the user's familiar unpinned list. */
export function pinnedFirst<T>(items: readonly T[], key: (item: T) => string, pins: readonly string[] = []): T[] {
  const selected = new Set(pins);
  return [...items.filter((item) => selected.has(key(item))), ...items.filter((item) => !selected.has(key(item)))];
}
export const cloudPinKey = (origin: string, core: string, root?: string) =>
  JSON.stringify([origin, core, ...(root ? [root] : [])]);

export function PinButton({
  pinned,
  kind,
  name,
  onToggle,
  onFailure,
}: {
  pinned: boolean;
  kind: "connection" | "server" | "workspace";
  name: string;
  onToggle(pinned: boolean): Promise<void>;
  onFailure(reason: unknown): void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`icon-button pin-button ${pinned ? "is-pinned" : ""}`}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${kind}`}
      aria-description={name}
      aria-pressed={pinned}
      title={pinned ? `Unpin ${name}` : `Pin ${name} to top`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onToggle(!pinned)
          .catch(onFailure)
          .finally(() => setBusy(false));
      }}
    >
      <Pin size={13} fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}
