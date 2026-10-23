import { chooseSelect } from "./select-test-helpers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { McpPanel } from "./McpPanel";
import { McpChatControls } from "./McpChatControls";
import type { McpLibraryServer, McpServerInput } from "@hatopad/protocol";

afterEach(cleanup);

it("offers generic OAuth registration settings and starts browser sign-in after saving", async () => {
  const actions = {
    save: vi.fn().mockResolvedValue({}),
    discover: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    signIn: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
  render(<McpPanel servers={[]} actions={actions} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByTitle("Add MCP server"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Example MCP" } });
  fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://example.test/mcp" } });
  chooseSelect(screen.getByLabelText("Authentication for Connection"), "oauth");
  expect(screen.queryByLabelText("Bearer token")).toBeNull();
  fireEvent.change(screen.getByLabelText("OAuth client ID"), { target: { value: "registered-client" } });
  fireEvent.change(screen.getByLabelText("OAuth client secret"), { target: { value: "private-secret" } });
  fireEvent.change(screen.getByLabelText("Scopes"), { target: { value: "tools:read" } });
  fireEvent.change(screen.getByLabelText("Callback port"), { target: { value: "54321" } });
  fireEvent.click(screen.getByText("Save & sign in"));
  await waitFor(() => expect(actions.signIn).toHaveBeenCalledOnce());
  const saved = actions.save.mock.calls[0]![0];
  expect(saved.connections[0]).toMatchObject({
    authType: "oauth",
    oauth: { clientId: "registered-client", clientSecret: "private-secret", scope: "tools:read", redirectPort: 54321 },
  });
  expect(actions.signIn).toHaveBeenCalledWith(
    { serverId: saved.id, connectionId: saved.connections[0].id },
    54321,
    expect.any(AbortSignal),
  );
});
const server: McpLibraryServer = {
  id: "github",
  name: "GitHub",
  url: "https://example.test/mcp",
  defaultConnectionId: "bot",
  connections: [
    { id: "bot", name: "Bot", hasCredentials: true },
    { id: "user", name: "Personal", hasCredentials: false },
  ],
};

it("creates a URL server with multiple named connections and a chosen default", async () => {
  const actions = {
    signIn: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    save: vi.fn<(server: McpServerInput) => Promise<McpLibraryServer>>().mockResolvedValue(server),
    discover: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  render(<McpPanel servers={[]} actions={actions} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByTitle("Add MCP server"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "GitHub" } });
  fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: server.url } });
  fireEvent.change(screen.getByLabelText("Connection name"), { target: { value: "Bot" } });
  fireEvent.change(screen.getByLabelText("Bearer token"), { target: { value: "private-token" } });
  fireEvent.click(screen.getByText("Add connection"));
  fireEvent.change(screen.getAllByLabelText("Connection name")[1]!, { target: { value: "Personal" } });
  fireEvent.click(screen.getAllByRole("radio")[1]!);
  fireEvent.click(screen.getByText("Save MCP server"));
  await waitFor(() => expect(actions.save).toHaveBeenCalledOnce());
  const saved = actions.save.mock.calls[0]![0];
  expect(saved).toMatchObject({
    name: "GitHub",
    url: server.url,
    connections: [{ name: "Bot", token: "private-token" }, { name: "Personal" }],
  });
  expect(saved.defaultConnectionId).toBe(saved.connections[1]!.id);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("retains saved credentials on edit and displays discovered actions", async () => {
  const actions = {
    signIn: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    save: vi.fn<(server: McpServerInput) => Promise<McpLibraryServer>>().mockResolvedValue(server),
    discover: vi.fn().mockResolvedValue([{ name: "list_issues", inputSchema: { type: "object" } }]),
    delete: vi.fn(),
  };
  render(<McpPanel servers={[server]} actions={actions} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByTitle("Edit GitHub"));
  expect((screen.getAllByLabelText("Bearer token")[0] as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getAllByText("Save & retrieve actions")[0]!);
  await waitFor(() => expect(screen.getAllByText("list_issues")).toHaveLength(2));
  expect(actions.save.mock.calls[0]![0].connections[0]).not.toHaveProperty("token");
  expect(actions.discover).toHaveBeenCalledWith({ serverId: "github", connectionId: "bot" });
});

it("toggles the internal MCP and uses the default connection when enabling an external server", async () => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <McpChatControls servers={[server]} selected={[]} editorEnabled onChange={onChange} onOpen={vi.fn()} />,
  );
  fireEvent.click(screen.getByLabelText("Chat MCP servers"));
  fireEvent.click(screen.getByLabelText("Enable GitHub MCP"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ serverId: "github" }], true));
  view.rerender(
    <McpChatControls
      servers={[server]}
      selected={[{ serverId: "github" }]}
      editorEnabled
      onChange={onChange}
      onOpen={vi.fn()}
    />,
  );
  chooseSelect(screen.getByLabelText("GitHub connection"), "user");
  await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ serverId: "github", connectionId: "user" }], true));
  fireEvent.click(screen.getByLabelText("Enable HatoPad editor MCP"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ serverId: "github" }], false));
});

it("explains when Core needs updating without offering unsupported actions", () => {
  const actions = { save: vi.fn(), delete: vi.fn(), discover: vi.fn(), signIn: vi.fn(), disconnect: vi.fn() };
  render(
    <McpPanel
      servers={[]}
      actions={actions}
      onRefresh={vi.fn()}
      unavailableReason="Update Core to use MCP servers and chat MCP controls."
    />,
  );
  expect(screen.getByText("Update Core to use MCP servers and chat MCP controls.")).toBeTruthy();
  expect(screen.queryByTitle("Add MCP server")).toBeNull();
});
