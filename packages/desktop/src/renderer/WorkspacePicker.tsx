import { Check, ChevronDown, Folder, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceRoot } from "@hatopad/protocol";

export function WorkspacePicker({
  roots,
  value,
  disabled,
  projectName,
  onChange,
}: {
  roots: WorkspaceRoot[];
  value: string;
  disabled?: boolean;
  projectName?: string;
  onChange(rootId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 360, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = roots.find((root) => root.id === value);
  const titlebar = projectName !== undefined;
  const visible = roots.filter((root) =>
    `${root.alias} ${root.path}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const choose = (rootId: string) => {
    close(true);
    if (!disabled && rootId !== value) onChange(rootId);
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const positionMenu = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      const top = Math.min(rect.bottom + 6, window.innerHeight - 160);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(8, top),
        width,
        maxHeight: Math.max(0, window.innerHeight - Math.max(8, top) - 8),
      });
    };
    positionMenu();
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", positionMenu);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [disabled, value]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={titlebar ? "workspace-identity workspace-picker-title" : "workspace-picker-trigger"}
        title={selected?.path}
        aria-label={titlebar ? "Switch workspace" : "Workspace root"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {titlebar ? <span className="branding-mark titlebar-branding" aria-hidden="true" /> : <Folder size={13} />}
        <span>{projectName ?? selected?.alias ?? "Select workspace"}</span>
        {!titlebar && <ChevronDown size={12} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            className="workspace-picker-menu"
            role="dialog"
            aria-label="Switch workspace"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-workspace-row]")];
                const index = rows.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  index < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : rows.length - 1
                    : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                rows[next]?.focus();
              }
            }}
          >
            <strong>Switch workspace</strong>
            <label className="workspace-picker-search">
              <Search size={14} />
              <input
                autoFocus
                aria-label="Find a workspace"
                placeholder="Find a workspace…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && visible[0]) {
                    event.preventDefault();
                    choose(visible[0].id);
                  }
                }}
              />
            </label>
            <div className="workspace-picker-list" role="menu" aria-label="Workspaces">
              {visible.map((root) => (
                <button
                  key={root.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={root.id === value}
                  data-workspace-row
                  title={root.path}
                  onClick={() => choose(root.id)}
                >
                  <Folder size={15} />
                  <span>
                    <span>{root.alias}</span>
                    <small>{root.path}</small>
                  </span>
                  {root.id === value && <Check size={15} />}
                </button>
              ))}
              {!visible.length && <p>No workspaces match your search.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
