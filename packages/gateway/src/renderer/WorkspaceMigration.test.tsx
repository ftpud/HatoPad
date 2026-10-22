import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDialog } from "./App";

const workspace = { id: "project", connectionId: "local", name: "API", directory: "/projects/api", remotePort: 7331 };
const preview = { source: workspace.directory, destination: "/projects/backend", taskWorkspaces: 2, stateEntries: 9 };
afterEach(cleanup);
function setup(
  onMigrate = vi.fn(async () => ({ ...workspace, directory: preview.destination })),
  value: GatewayWorkspace = workspace,
) {
  window.gateway = {
    previewWorkspaceMigration: vi.fn(async () => preview),
    pickWorkspaceDirectory: vi.fn(async () => "/new-parent"),
  } as unknown as Window["gateway"];
  const onClose = vi.fn();
  render(
    <WorkspaceDialog
      value={value}
      connectionId="local"
      local
      onClose={onClose}
      onSave={vi.fn()}
      onFailure={vi.fn()}
      onMigrate={onMigrate}
    />,
  );
  return { onMigrate, onClose };
}
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "Migrate…" }));
  const input = screen.getByRole("textbox", { name: "Destination directory" });
  input.focus();
  fireEvent.change(input, { target: { value: preview.destination } });
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole("button", { name: "Review migration" }));
  await screen.findByText("2 task workspaces and their saved conversations");
}
describe("workspace migration settings", () => {
  it("reviews the move before executing it and updates the saved directory after success", async () => {
    const { onMigrate } = setup();
    await review();
    expect(window.gateway.previewWorkspaceMigration).toHaveBeenCalledWith("project", preview.destination);
    expect(onMigrate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Migrate project" }));
    await screen.findByText("Project moved successfully");
    expect(onMigrate).toHaveBeenCalledWith(preview.destination);
    expect((screen.getByRole("textbox", { name: "Local project directory" }) as HTMLInputElement).value).toBe(
      preview.destination,
    );
  });
  it("prevents closing or changing settings while moving and explains failures inline", async () => {
    let reject!: (error: Error) => void;
    const onMigrate = vi.fn(
      () =>
        new Promise<GatewayWorkspace>((_, fail) => {
          reject = fail;
        }),
    );
    const { onClose } = setup(onMigrate);
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Migrate project" }));
    await screen.findByText("Moving project and saved state…");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save workspace" }) as HTMLButtonElement).disabled).toBe(true);
    reject(Error("The destination already exists."));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("destination already exists");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Review migration" }) as HTMLButtonElement).disabled).toBe(false),
    );
  });
  it("requires saving edited workspace settings before starting migration", () => {
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Backend" } });
    expect((screen.getByRole("button", { name: "Migrate…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Save your workspace settings before migrating.")).toBeTruthy();
  });
  it("invalidates the review when the destination changes", async () => {
    const { onMigrate } = setup();
    await review();
    fireEvent.change(screen.getByRole("textbox", { name: "Destination directory" }), {
      target: { value: "/projects/another" },
    });
    expect(screen.queryByRole("button", { name: "Migrate project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review migration" })).toBeTruthy();
    expect(onMigrate).not.toHaveBeenCalled();
  });
  it("restores the destination of a pending migration after reopening settings", () => {
    setup(undefined, { ...workspace, migrationDestination: preview.destination });
    expect((screen.getByRole("textbox", { name: "Destination directory" }) as HTMLInputElement).value).toBe(
      preview.destination,
    );
    expect(screen.getByText(/A previous migration is pending/)).toBeTruthy();
  });
  it("uses the chosen parent directory while preserving the project folder name", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Migrate…" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose destination parent folder" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Destination directory" }) as HTMLInputElement).value).toBe(
        "/new-parent/api",
      ),
    );
  });
});
