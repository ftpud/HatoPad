import { Check, ChevronDown, Search } from "lucide-react";
import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Choice = { value: string; label: string; disabled: boolean; group?: string; description?: string };
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange" | "children"> & {
  value?: string | number;
  onValueChange(value: string): void;
  children: ReactNode;
  required?: boolean;
  searchable?: boolean;
  triggerContent?: ReactNode;
  hideChevron?: boolean;
};

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "";
    })
    .join("");
}

// Options remain declarative JSX data; no native select, option or optgroup is mounted.
function choicesFrom(children: ReactNode, group?: string, disabled = false): Choice[] {
  return Children.toArray(children).flatMap((child): Choice[] => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
        title?: string;
      }>(child)
    )
      return [];
    if (child.type === Fragment) return choicesFrom(child.props.children, group, disabled);
    if (child.type === "optgroup")
      return choicesFrom(child.props.children, child.props.label, disabled || !!child.props.disabled);
    if (child.type !== "option") return [];
    const label = child.props.label ?? textContent(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        group,
        disabled: disabled || !!child.props.disabled,
        description: child.props.title,
      },
    ];
  });
}

/** A controlled, single-choice dropdown shared by the renderer's forms and toolbars. */
export const Select = forwardRef<HTMLButtonElement, Props>(function Select(
  {
    value,
    onValueChange,
    children,
    disabled,
    required,
    searchable,
    className = "",
    id,
    name,
    form,
    onKeyDown,
    onClick,
    triggerContent,
    hideChevron,
    ...props
  },
  forwardedRef,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-options`;
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const [ownerForm, setOwnerForm] = useState<HTMLFormElement | null>(null);
  useLayoutEffect(() => {
    setOwnerForm(trigger.current?.form ?? null);
    setPortalRoot(trigger.current?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body);
  }, [form]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [label, setLabel] = useState("Choices");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 });
  const typeAhead = useRef({ text: "", time: 0 });
  const choices = useMemo(() => choicesFrom(children), [children]);
  const selected = choices.find((choice) => choice.value === String(value ?? ""));
  const hasSearch = searchable ?? choices.length > 7;
  const visible = useMemo(
    () =>
      choices.filter((choice) =>
        `${choice.label} ${choice.group ?? ""} ${choice.description ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [choices, query],
  );
  const activeChoice = visible[active];
  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  };
  const choose = (choice?: Choice) => {
    if (!choice || choice.disabled || disabled) return;
    close(true);
    if (choice.value !== String(value ?? "")) onValueChange(choice.value);
  };
  const show = (last = false) => {
    if (disabled) return;
    setPortalRoot(trigger.current?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body);
    setQuery("");
    const current = choices.findIndex((choice) => choice.value === String(value ?? "") && !choice.disabled);
    const enabled = choices.map((choice, index) => (choice.disabled ? -1 : index)).filter((index) => index >= 0);
    setActive(current >= 0 ? current : ((last ? enabled.at(-1) : enabled[0]) ?? -1));
    setLabel(props["aria-label"] ?? trigger.current?.labels?.[0]?.textContent?.trim() ?? props.title ?? "Choices");
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, hasSearch ? 280 : 200), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const upwards = below < 200 && above > below;
      const maxHeight = Math.max(0, Math.min(360, upwards ? above : below));
      const height = Math.min(popup.current?.scrollHeight ?? maxHeight, maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(8, upwards ? rect.top - height - 6 : rect.bottom + 6),
        width,
        maxHeight,
      });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener("resize", reposition);
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) reposition();
    };
    document.addEventListener("scroll", scroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, hasSearch]);

  useEffect(() => {
    if (!open) return;
    if (hasSearch) search.current?.focus();
    const outside = (event: Event) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "Tab") close(true);
    };
    window.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      window.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, hasSearch]);
  useEffect(() => {
    close();
  }, [disabled, value]);
  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      close(true);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Enter" || (event.key === " " && event.target !== search.current)) {
      event.preventDefault();
      event.stopPropagation();
      if (open) choose(activeChoice);
      else show();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        show(event.key === "ArrowUp" || event.key === "End");
        return;
      }
      const enabled = visible.map((choice, index) => (choice.disabled ? -1 : index)).filter((index) => index >= 0);
      const current = enabled.indexOf(active);
      const index =
        event.key === "Home"
          ? enabled[0]
          : event.key === "End"
            ? enabled.at(-1)
            : enabled[
                (current + (event.key === "ArrowDown" ? 1 : enabled.length - 1) + enabled.length) % enabled.length
              ];
      setActive(index ?? -1);
      return;
    }
    if (
      event.target !== search.current &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - typeAhead.current.time < 700 ? typeAhead.current.text : "";
      const text = previous + event.key.toLowerCase();
      typeAhead.current = { text, time: now };
      if (!open) show();
      const list = open ? visible : choices;
      const index = list.findIndex((choice) => !choice.disabled && choice.label.toLowerCase().startsWith(text));
      if (index >= 0) setActive(index);
    }
  };

  return (
    <>
      <button
        {...props}
        ref={(element) => {
          trigger.current = element;
          if (typeof forwardedRef === "function") forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        form={form}
        id={controlId}
        type="button"
        role="combobox"
        value={value ?? ""}
        className={`select-trigger ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !hasSearch && activeChoice ? `${listId}-${active}` : undefined}
        aria-required={required || undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            if (open) close();
            else show();
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) keyDown(event);
        }}
      >
        {triggerContent ?? <span className="select-value">{selected?.label ?? "Select…"}</span>}
        {!hideChevron && <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {(required || name) &&
        ownerForm &&
        createPortal(
          <input
            className="select-form-value"
            aria-hidden="true"
            tabIndex={-1}
            form={form}
            name={name}
            value={selected?.disabled && !selected.value ? "" : (selected?.value ?? "")}
            required={required}
            disabled={disabled}
            readOnly={!required}
            onChange={() => {}}
            onInvalid={(event) => {
              event.preventDefault();
              trigger.current?.focus();
              show();
            }}
          />,
          ownerForm,
        )}
      {open &&
        createPortal(
          <div
            ref={popup}
            className="select-popup"
            data-select-popup
            style={position}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={keyDown}
            onClick={(event) => event.stopPropagation()}
          >
            {hasSearch && (
              <div className="select-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={search}
                  role="combobox"
                  aria-label={`Search ${label}`}
                  placeholder="Search…"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeChoice ? `${listId}-${active}` : undefined}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    const needle = event.target.value.trim().toLowerCase();
                    const filtered = choices.filter((choice) =>
                      `${choice.label} ${choice.group ?? ""} ${choice.description ?? ""}`
                        .toLowerCase()
                        .includes(needle),
                    );
                    setActive(filtered.findIndex((choice) => !choice.disabled));
                  }}
                />
              </div>
            )}
            <div id={listId} role="listbox" aria-label={label} className="select-options">
              {visible.map((choice, index) => (
                <Fragment key={`${choice.group ?? ""}:${choice.value}`}>
                  {choice.group && choice.group !== visible[index - 1]?.group && (
                    <div className="select-group" role="presentation">
                      {choice.group}
                    </div>
                  )}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={choice.value === String(value ?? "")}
                    aria-disabled={choice.disabled || undefined}
                    data-value={choice.value}
                    data-active={index === active}
                    title={choice.description}
                    className="select-option"
                    onPointerMove={() => {
                      if (!choice.disabled) setActive(index);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.preventDefault();
                      choose(choice);
                    }}
                  >
                    <span>
                      <span>{choice.label}</span>
                      {choice.description && <small>{choice.description}</small>}
                    </span>
                    {choice.value === String(value ?? "") && <Check size={14} aria-hidden="true" />}
                  </div>
                </Fragment>
              ))}
              {!visible.length && <p className="select-empty">No matching options</p>}
            </div>
          </div>,
          portalRoot ?? document.body,
        )}
    </>
  );
});
