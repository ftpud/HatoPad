import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

it("mounts the workspace controller while disconnected and keeps connection inputs live", () => {
  localStorage.clear();
  render(<App />);
  expect(screen.getByRole("heading", { name: "HatoPad" })).toBeDefined();
  const host = screen.getByLabelText("Host") as HTMLInputElement;
  fireEvent.change(host, { target: { value: "127.0.0.2" } });
  expect(host.value).toBe("127.0.0.2");
  const port = screen.getByLabelText("Port") as HTMLInputElement;
  fireEvent.change(port, { target: { value: "7332" } });
  expect(port.value).toBe("7332");
});
