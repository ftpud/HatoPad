import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";
import { chooseSelect } from "./select-test-helpers";

afterEach(cleanup);

describe("Select", () => {
  it("supports groups, fragments, numeric values and text-only option values without native controls", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <label>
        Configuration
        <Select value={1} onValueChange={onValueChange}>
          <option value="" disabled>
            Choose configuration
          </option>
          <optgroup label="Project">
            <>
              <option value={1}>Development</option>
              <option>Production</option>
            </>
          </optgroup>
          <optgroup label="Unavailable" disabled>
            <option value="disabled">Blocked</option>
          </optgroup>
        </Select>
      </label>,
    );
    expect(container.querySelector("select, option, optgroup")).toBeNull();
    const control = screen.getByRole("combobox", { name: "Configuration" });
    fireEvent.click(control);
    expect(screen.getByRole("option", { name: "Development" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Blocked" }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
    chooseSelect(control, "Production");
    expect(onValueChange).toHaveBeenCalledWith("Production");
    expect(document.activeElement).toBe(control);
  });

  it("navigates past disabled options with arrows, Home, End and typeahead", () => {
    const onValueChange = vi.fn();
    render(
      <Select aria-label="Mode" value="a" onValueChange={onValueChange}>
        <option value="a">Alpha</option>
        <option value="b" disabled>
          Beta
        </option>
        <option value="c">Charlie</option>
      </Select>,
    );
    const control = screen.getByRole("combobox");
    fireEvent.keyDown(control, { key: "ArrowDown" });
    fireEvent.keyDown(control, { key: "ArrowDown" });
    expect(document.getElementById(control.getAttribute("aria-activedescendant")!)?.textContent).toBe("Charlie");
    fireEvent.keyDown(control, { key: "Home" });
    expect(document.getElementById(control.getAttribute("aria-activedescendant")!)?.textContent).toBe("Alpha");
    fireEvent.keyDown(control, { key: "End" });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("c");
    fireEvent.keyDown(control, { key: "a" });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("searches longer lists including descriptions and handles no matches", () => {
    const onValueChange = vi.fn();
    render(
      <Select aria-label="Agent" value="0" onValueChange={onValueChange}>
        {Array.from({ length: 9 }, (_, i) => (
          <option key={i} value={i} title={i === 8 ? "Code reviewer" : undefined}>
            Agent {i}
          </option>
        ))}
      </Select>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Agent" }));
    const search = screen.getByRole("combobox", { name: "Search Agent" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "missing" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByText("No matching options")).toBeTruthy();
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "reviewer" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("8");
  });

  it("preserves required form validation, a single label target, and submitted values", () => {
    const onValueChange = vi.fn();
    const view = (value: string, disabled = false) => (
      <form aria-label="Settings">
        <label>
          Provider
          <Select required name="provider" value={value} disabled={disabled} onValueChange={onValueChange}>
            <option value="" disabled>
              Choose provider
            </option>
            <option value="local">Local</option>
          </Select>
        </label>
        <button>Save</button>
      </form>
    );
    const { rerender } = render(view(""));
    const form = screen.getByRole("form") as HTMLFormElement;
    const control = screen.getByLabelText("Provider");
    expect(form.checkValidity()).toBe(false);
    expect(document.activeElement).toBe(control);
    chooseSelect(control, "local");
    expect(onValueChange).toHaveBeenCalledWith("local");
    rerender(view("local"));
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get("provider")).toBe("local");
    rerender(view("", true));
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).has("provider")).toBe(false);
  });

  it("keeps popups inside modals, closes on Escape before the dialog, and restores focus", () => {
    const onDialogKey = vi.fn();
    render(
      <section role="dialog" aria-modal="true" aria-label="Settings" onKeyDown={onDialogKey}>
        <Select aria-label="Mode" value="a" searchable onValueChange={vi.fn()}>
          <option value="a">Alpha</option>
        </Select>
      </section>,
    );
    const control = screen.getByRole("combobox", { name: "Mode" });
    fireEvent.click(control);
    expect(screen.getByRole("dialog").contains(screen.getByRole("listbox"))).toBe(true);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search Mode" }), { key: "Escape" });
    expect(onDialogKey).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(control);
    fireEvent.click(control);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search Mode" }), { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clamps the popup to the viewport and opens above controls near the bottom", () => {
    render(
      <Select aria-label="Mode" value="a" onValueChange={vi.fn()}>
        <option value="a">Alpha</option>
      </Select>,
    );
    const control = screen.getByRole("combobox");
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue({
      left: window.innerWidth - 10,
      top: window.innerHeight - 40,
      bottom: window.innerHeight - 10,
      width: 180,
    } as DOMRect);
    fireEvent.click(control);
    const popup = screen.getByRole("listbox").parentElement!;
    expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(parseFloat(popup.style.top)).toBeLessThan(window.innerHeight - 40);
  });
});
