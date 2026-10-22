import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "./WorkspacePicker";

const roots = [
  { id: "one", alias: "First project", path: "/work/first", primary: true },
  { id: "two", alias: "Second project", path: "/work/second", primary: false },
];
afterEach(cleanup);

describe("WorkspacePicker", () => {
  it("keeps the title label and switches through a searchable custom menu", () => {
    const onChange = vi.fn();
    render(<WorkspacePicker roots={roots} value="one" projectName="My project" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger.textContent).toBe("My project");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: /First project/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/work/second" } });
    expect(screen.queryByRole("menuitemradio", { name: /First project/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Second project/ }));
    expect(onChange).toHaveBeenCalledWith("two");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports keyboard selection and Escape with focus restoration", () => {
    const onChange = vi.fn();
    render(<WorkspacePicker roots={roots} value="one" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Workspace root" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    const second = screen.getByRole("menuitemradio", { name: /Second project/ });
    expect(document.activeElement).toBe(second);
    fireEvent.click(second);
    expect(onChange).toHaveBeenCalledWith("two");
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses outside the portal, ignores the current root, and closes when disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorkspacePicker roots={roots} value="one" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Workspace root" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /First project/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing" } });
    expect(screen.getByText("No workspaces match your search.")).toBeTruthy();
    rerender(<WorkspacePicker roots={roots} value="one" disabled onChange={onChange} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});
