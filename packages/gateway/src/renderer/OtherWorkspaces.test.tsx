import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreWorkspaceList, OtherWorkspaces } from "./OtherWorkspaces";
const owner = {
  id: "core-one",
  connectionId: "server",
  name: "HatoPad",
  directory: "/projects/HatoPad",
  remotePort: 7331,
};
const main = { id: "main", alias: "HatoPad", path: owner.directory, primary: true };
const extra = { id: "hub", alias: "VibeHub", path: "/projects/VibeHub", primary: false };
afterEach(cleanup);
function setup(view: "links" | "migrate" = "migrate") {
  const state: GatewayState = { connections: [], workspaces: [owner], portTunnels: [] };
  window.gateway = {
    listWorkspaceRoots: vi.fn(async () => [main, extra]),
    previewWorkspaceMigration: vi.fn(async () => ({
      source: extra.path,
      destination: "/projects/HatoHub",
      taskWorkspaces: 1,
      stateEntries: 4,
    })),
    migrateWorkspace: vi.fn(async () => state),
    openWorkspaceRoot: vi.fn(async () => undefined),
  } as unknown as Window["gateway"];
  const onMigrated = vi.fn();
  const onOpen = vi.fn(async () => undefined);
  render(
    view === "links" ? (
      <CoreWorkspaceList owner={owner} disabled={false} onOpen={onOpen} />
    ) : (
      <OtherWorkspaces owner={owner} local={false} disabled={false} onMigrated={onMigrated} />
    ),
  );
  return { onMigrated, onOpen, state };
}
describe("additional Core workspaces", () => {
  it("lists the primary and registered folders as equal rows that open through their Core", async () => {
    const { onOpen } = setup("links");
    const hub = await screen.findByRole("button", { name: "Open workspace VibeHub" });
    expect(hub.getAttribute("title")).toContain(extra.path);
    expect(screen.queryByRole("button", { name: /Migrate/ })).toBeNull();
    fireEvent.click(hub);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("hub"));
    fireEvent.click(screen.getByRole("button", { name: "Open workspace HatoPad" }));
    await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith(undefined));
  });
  it("keeps migration in workspace options without quick-open buttons", async () => {
    setup();
    await screen.findByText("VibeHub");
    expect(screen.getByText(extra.path)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open workspace VibeHub" })).toBeNull();
  });
  it("reviews and migrates the additional folder without replacing the primary workspace", async () => {
    const { onMigrated, state } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Migrate workspace VibeHub" }));
    const dialog = screen.getByRole("dialog", { name: "Migrate workspace VibeHub" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Destination directory" }), {
      target: { value: "/projects/HatoHub" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review migration" }));
    await within(dialog).findByText("1 task workspace and their saved conversations");
    expect(window.gateway.previewWorkspaceMigration).toHaveBeenCalledWith("core-one", "/projects/HatoHub", extra.path);
    fireEvent.click(within(dialog).getByRole("button", { name: "Migrate project" }));
    await within(dialog).findByText("Project moved successfully");
    expect(window.gateway.migrateWorkspace).toHaveBeenCalledWith("core-one", "/projects/HatoHub", extra.path);
    expect(onMigrated).toHaveBeenCalledWith(state);
    expect(state.workspaces[0]?.directory).toBe(owner.directory);
  });
  it("refreshes available workspaces when returning to Gateway", async () => {
    setup("links");
    await screen.findByRole("button", { name: "Open workspace VibeHub" });
    vi.mocked(window.gateway.listWorkspaceRoots).mockResolvedValue([
      main,
      extra,
      { id: "land", alias: "VibeLand", path: "/projects/VibeLand", primary: false },
    ]);
    fireEvent.focus(window);
    await screen.findByRole("button", { name: "Open workspace VibeLand" });
  });
  it("shows an actionable discovery failure without hiding the owning workspace", async () => {
    setup();
    vi.mocked(window.gateway.listWorkspaceRoots).mockRejectedValue(
      Error("Update this Core to list additional workspaces."),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Refresh other workspaces in HatoPad" }));
    await screen.findByText("Update this Core to list additional workspaces.");
  });
});
