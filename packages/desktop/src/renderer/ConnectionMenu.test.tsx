import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectionMenu } from "./ConnectionMenu";
afterEach(cleanup);
it("keeps address and disconnect within connection details", () => {
  const disconnect = vi.fn();
  render(<ConnectionMenu host="127.0.0.1" port="7331" connected onDisconnect={disconnect} />);
  expect(screen.queryByText("127.0.0.1:7331")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Core connection" }));
  expect(screen.getByText("127.0.0.1:7331")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(disconnect).toHaveBeenCalledOnce();
});
it("closes on Escape and returns focus to its control", () => {
  render(<ConnectionMenu host="server" port="7331" connected={false} onDisconnect={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Core connection" });
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it("labels a cloud connection with an icon and its cloud origin instead of the loopback bridge", () => {
  render(<ConnectionMenu host="127.0.0.1" port="41234" cloudOrigin="https://hub.example" connected onDisconnect={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Core connection" });
  expect(screen.getByText("Cloud")).toBeTruthy();
  expect(screen.queryByText("Local Core")).toBeNull();
  expect(trigger.querySelector("svg.lucide-cloud")).toBeTruthy();
  expect(trigger.title).toBe("Connected to https://hub.example");
  fireEvent.click(trigger);
  expect(screen.getByText("Cloud workspace")).toBeTruthy();
  expect(screen.getByText("https://hub.example")).toBeTruthy();
  expect(screen.queryByText("127.0.0.1:41234")).toBeNull();
});
it("keeps cloud identity when disconnected while showing Offline", () => {
  render(<ConnectionMenu host="127.0.0.1" port="41234" cloudOrigin="https://hub.example" connected={false} onDisconnect={vi.fn()} />);
  expect(screen.getByText("Offline")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Core connection" }).querySelector("svg.lucide-cloud")).toBeTruthy();
});
