import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);
it("navigates available actions and skips disabled items", () => {
  render(
    <ContextMenu className="context-menu">
      <button>Open</button>
      <button disabled>Rename</button>
      <button>Copy path</button>
    </ContextMenu>,
  );
  expect(document.activeElement).toBe(screen.getByText("Open"));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Copy path"));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
  expect(document.activeElement).toBe(screen.getByText("Open"));
});
it("dismisses through the owning overlay and restores keyboard focus", () => {
  const close = vi.fn();
  const owner = document.createElement("button");
  document.body.append(owner);
  owner.focus();
  render(
    <div className="context-menu-layer" onMouseDown={close}>
      <ContextMenu className="context-menu">
        <button>Open</button>
      </ContextMenu>
    </div>,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(owner);
  owner.remove();
});
it("flips a submenu left and shifts it up when it would leave the window", () => {
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
  render(
    <ContextMenu className="context-menu">
      <div className="context-submenu-trigger">
        <button>Color</button>
        <ContextMenu className="context-menu context-submenu">
          <button>Red</button>
        </ContextMenu>
      </div>
    </ContextMenu>,
  );
  const [, submenu] = screen.getAllByRole("menu");
  vi.spyOn(submenu!, "getBoundingClientRect").mockReturnValue({
    left: 1206,
    right: 1406,
    top: 645,
    bottom: 905,
    width: 200,
    height: 260,
  } as DOMRect);
  fireEvent.mouseEnter(submenu!.parentElement!);
  expect(submenu!.style.right).toBe("calc(100% - 2px)");
  expect(submenu!.style.left).toBe("auto");
  expect(submenu!.style.top).toBe("-117px");
});
