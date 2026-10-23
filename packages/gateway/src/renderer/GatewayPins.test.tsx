import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { cloudPinKey } from "./PinButton";

afterEach(cleanup);
function bridge() {
  let saved: GatewayState = {
    connections: [
      { id: "a", kind: "local", name: "Alpha", host: "", port: 22, username: "", authenticationMethod: "agent" },
      {
        id: "b",
        kind: "ssh",
        name: "Beta",
        host: "host.test",
        port: 22,
        username: "me",
        authenticationMethod: "agent",
      },
    ],
    workspaces: [
      { id: "one", connectionId: "a", name: "First project", directory: "/one", remotePort: 7331 },
      { id: "two", connectionId: "a", name: "Second project", directory: "/two", remotePort: 7332 },
    ],
    portTunnels: [],
    pins: { connections: [], workspaces: [] },
  };
  const account: GatewayCloudAccount = {
    origin: "https://cloud.test",
    user: { id: "u", name: "Owner", email: "owner@test" },
    cores: [
      { id: "first", name: "First server", status: "online", access: "operator" },
      { id: "second", name: "Second server", status: "online", access: "operator" },
    ],
  };
  window.gateway = {
    get: vi.fn(async () => ({
      state: structuredClone(saved),
      runtimes: {},
      tunnelRuntimes: {},
      connectionRuntimes: {},
      distribution: "bundled",
    })),
    openWorkspaceRoot: vi.fn(async () => undefined),
    cloudGet: vi.fn(async () => account),
    cloudListCores: vi.fn(async () => [
      { id: "root-a", alias: "First root", path: "/first", primary: true },
      { id: "root-b", alias: "Second root", path: "/second", primary: false },
    ]),
    setPinned: vi.fn(async (kind: "connection" | "workspace", id: string, pinned: boolean) => {
      const collection = kind === "connection" ? "connections" : "workspaces";
      saved.pins![collection] = saved.pins![collection].filter((value) => value !== id);
      if (pinned) saved.pins![collection].push(id);
      return structuredClone(saved);
    }),
    onStatus: () => () => undefined,
    onTunnelStatus: () => () => undefined,
    onConnectionStatus: () => () => undefined,
  } as unknown as Window["gateway"];
  return { account };
}
describe("Gateway layout and pins", () => {
  it("places Cloud servers after the main area in a separate right sidebar", async () => {
    bridge();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "Cloud servers panel" });
    expect(screen.getByRole("main").nextElementSibling).toBe(panel);
    expect(within(panel).getByRole("button", { name: /First server/ })).toBeTruthy();
    const left = document.querySelector(".gateway-shell > aside")!;
    expect(left.querySelector(".cloud-account")).toBeNull();
    expect(within(left as HTMLElement).getByRole("button", { name: "Alpha, local Mac" })).toBeTruthy();
  });
  it("opens a primary workspace with one action", async () => {
    bridge();
    render(<App />);
    const heading = await screen.findByRole("heading", { name: "First project" });
    fireEvent.click(within(heading.closest("article")!).getByRole("button", { name: "Open workspace one" }));
    await waitFor(() => expect(window.gateway.openWorkspaceRoot).toHaveBeenCalledWith("one"));
  });
  it("pins connections without switching them and restores ordering after reopening Gateway", async () => {
    bridge();
    const view = render(<App />);
    const beta = await screen.findByRole("group", { name: "Beta" });
    fireEvent.click(within(beta).getByRole("button", { name: "Pin connection" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Alpha, local Mac" }).getAttribute("aria-pressed")).toBe("true"),
    );
    const connections = document.querySelector('[aria-label="Connections"].connection-list') as HTMLElement;
    await waitFor(() => expect(within(connections).getAllByRole("group")[0]?.getAttribute("aria-label")).toBe("Beta"));
    expect(window.gateway.setPinned).toHaveBeenCalledWith("connection", "b", true);
    view.unmount();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Beta, .*me at host.test/ }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(
      within(screen.getByRole("group", { name: "Beta" })).getByRole("button", { name: "Unpin connection" }),
    ).toBeTruthy();
  });
  it("pins and unpins workspaces while preserving the order of unpinned items", async () => {
    bridge();
    render(<App />);
    const heading = await screen.findByRole("heading", { name: "Second project" });
    fireEvent.click(within(heading.closest("article")!).getByRole("button", { name: "Pin workspace" }));
    const list = screen.getByRole("region", { name: "Workspaces" });
    await waitFor(() => expect(within(list).getAllByRole("article")[0]?.textContent).toContain("Second project"));
    fireEvent.click(within(list).getByRole("button", { name: "Unpin workspace" }));
    await waitFor(() => expect(within(list).getAllByRole("article")[0]?.textContent).toContain("First project"));
  });
  it("scopes Cloud server and root pins to their Cloud origin and server", async () => {
    const { account } = bridge();
    render(<App />);
    const server = await screen.findByRole("group", { name: "Second server" });
    fireEvent.click(within(server).getByRole("button", { name: "Pin server" }));
    await waitFor(() =>
      expect(window.gateway.setPinned).toHaveBeenCalledWith("connection", cloudPinKey(account.origin, "second"), true),
    );
    fireEvent.click(within(server).getByRole("button", { name: /Second server/ }));
    const root = await screen.findByRole("heading", { name: "Second root" });
    fireEvent.click(within(root.closest("article")!).getByRole("button", { name: "Pin workspace" }));
    await waitFor(() =>
      expect(window.gateway.setPinned).toHaveBeenCalledWith(
        "workspace",
        cloudPinKey(account.origin, "second", "root-b"),
        true,
      ),
    );
    expect(
      within(screen.getByRole("region", { name: "Cloud Cores" })).getAllByRole("article")[0]?.textContent,
    ).toContain("Second root");
  });
});
