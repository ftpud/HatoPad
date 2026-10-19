import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./settings";

export function readStackSizes(workspace: string, setting: string): Record<string, number[]> {
  try {
    const parsed: unknown = JSON.parse(readWorkspaceSetting(workspace, setting) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}

export function ResizablePanelStack({
  children,
  workspace,
  setting,
  ids,
}: {
  children: ReactNode;
  workspace: string;
  setting: string;
  ids: string[];
}) {
  const items = Children.toArray(children);
  const rootRef = useRef<HTMLDivElement>(null);
  const [savedSizes, setSavedSizes] = useState<Record<string, number[]>>(() => readStackSizes(workspace, setting));
  // The workspace is only known once the connection is established, so stored sizes are re-read
  // whenever it changes instead of staying on whatever was available when the stack first mounted.
  useEffect(() => {
    setSavedSizes(readStackSizes(workspace, setting));
  }, [workspace, setting]);
  const signature = ids.join("|");
  const stored = savedSizes[signature];
  const sizes =
    stored?.length === items.length && stored.every((size) => Number.isFinite(size) && size > 0)
      ? stored
      : Array.from({ length: items.length }, () => 1 / Math.max(1, items.length));
  const saveSizes = (next: number[]) =>
    setSavedSizes((current) => {
      const updated = { ...current, [signature]: next };
      writeWorkspaceSetting(workspace, setting, JSON.stringify(updated));
      return updated;
    });
  const beginResize = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const available = bounds.height - (items.length - 1) * 5;
    const startY = event.clientY;
    const start = sizes;
    const combined = start[index]! + start[index + 1]!;
    const move = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientY - startY) / Math.max(1, available);
      const minimum = Math.min(0.45, 70 / Math.max(1, available));
      const first = Math.max(minimum, Math.min(combined - minimum, start[index]! + delta));
      saveSizes(
        start.map((value, itemIndex) =>
          itemIndex === index ? first : itemIndex === index + 1 ? combined - first : value,
        ),
      );
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const keyboardStackResize = (event: React.KeyboardEvent, index: number) => {
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const combined = sizes[index]! + sizes[index + 1]!;
    const step = event.shiftKey ? 0.1 : 0.025;
    const first = Math.max(0.1, Math.min(combined - 0.1, sizes[index]! + direction * step));
    saveSizes(
      sizes.map((value, itemIndex) =>
        itemIndex === index ? first : itemIndex === index + 1 ? combined - first : value,
      ),
    );
  };
  return (
    <div className="resizable-panel-stack" ref={rootRef}>
      {items.map((item, index) => (
        <div
          className="resizable-panel-item"
          key={isValidElement(item) && item.key != null ? item.key : index}
          style={{ flexGrow: sizes[index] ?? 1 / Math.max(1, items.length) }}
        >
          {item}
          {index < items.length - 1 && (
            <div
              className="focused-panel-divider"
              role="separator"
              aria-label={`Resize ${ids[index] ?? "upper"} panel`}
              aria-orientation="horizontal"
              aria-valuemin={10}
              aria-valuemax={90}
              aria-valuenow={Math.round((sizes[index] ?? 0.5) * 100)}
              tabIndex={0}
              onKeyDown={(event) => keyboardStackResize(event, index)}
              onPointerDown={(event) => beginResize(event, index)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
