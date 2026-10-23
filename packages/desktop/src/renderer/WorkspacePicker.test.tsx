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
    const { container } = render(
      <WorkspacePicker roots={roots} value="one" projectName="My project" onChange={onChange} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Switch workspace" });
    expect(trigger.textContent).toBe("My project");
    expect(container.querySelector("select")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: /First project/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByRole("combobox", { name: "Search Switch workspace" }), {
      target: { value: "/work/second" },
    });
    expect(screen.queryByRole("option", { name: /First project/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Second project/ }));
    expect(onChange).toHaveBeenCalledWith("two");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports keyboard selection and Escape with focus restoration", () => {
    const onChange = vi.fn();
    render(<WorkspacePicker roots={roots} value="one" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Workspace root" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = screen.getByRole("combobox", { name: "Search Workspace root" });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(document.getElementById(search.getAttribute("aria-activedescendant")!)?.textContent).toContain(
      "Second project",
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("two");
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search Workspace root" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses outside the portal, ignores the current root, and closes when disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorkspacePicker roots={roots} value="one" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Workspace root" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /First project/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("combobox", { name: "Search Workspace root" }), { target: { value: "missing" } });
    expect(screen.getByText("No matching options")).toBeTruthy();
    rerender(<WorkspacePicker roots={roots} value="one" disabled onChange={onChange} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});
