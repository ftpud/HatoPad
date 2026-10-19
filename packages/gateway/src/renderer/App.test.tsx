import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  CloudPortTunnels,
  ConnectionDialog,
  DiagnosticsCopyButton,
  GatewayErrorNotice,
  RepositoryDialog,
  WorkspaceDialog,
  ProvisioningLog,
  gatewayErrorMessage,
} from "./App";

beforeEach(() => {
  Object.defineProperty(window, "alert", { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cloud port tunneling", () => {
  const core = { id: "core", name: "Cloud", status: "online", access: "owner" as const };
  it("saves distinct local/Core ports and offers run, stop and delete for saved tunnels", async () => {
    const save = vi.fn(async () => undefined),
      action = vi.fn(async () => undefined),
      remove = vi.fn(async () => undefined);
    const item = {
      id: "t",
      connectionId: "cloud:core",
      cloudOrigin: "https://hub.example",
      port: 8080,
      remotePort: 3000,
    };
    render(
      <CloudPortTunnels
        core={core}
        tunnels={[item]}
        runtimes={{}}
        onSave={save}
        onAction={action}
        onRemove={remove}
        onFailure={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Local tunnel port" }), { target: { value: "9000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Core tunnel port" }), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add port" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(9000, 5000));
    expect(screen.getByText("localhost:8080")).toBeTruthy();
    expect(screen.getByText("→ Core localhost:3000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(action).toHaveBeenCalledWith(item, "startPortTunnel");
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud tunnel on port 8080" }));
    expect(remove).toHaveBeenCalledWith(item);
  });
  it("defaults to the same Core port and permits stopping a connecting tunnel", async () => {
    const save = vi.fn(async () => undefined),
      action = vi.fn(async () => undefined);
    const item = { id: "t", connectionId: "cloud:core", port: 3000 };
    render(
      <CloudPortTunnels
        core={core}
        tunnels={[item]}
        runtimes={{ t: { status: "working", message: "Connecting" } }}
        onSave={save}
        onAction={action}
        onRemove={vi.fn()}
        onFailure={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Local tunnel port" }), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add port" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(3000, 3000));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(action).toHaveBeenCalledWith(item, "stopPortTunnel");
  });
});

describe("Gateway dialogs", () => {
  it("discovers remote workspaces on open and fills the form from a selection", async () => {
    window.gateway = {
      discoverWorkspaceDirectories: vi
        .fn()
        .mockResolvedValue(["/home/dev/projects/api", "/home/dev/projects/configured"]),
    } as unknown as Window["gateway"];
    render(
      <WorkspaceDialog
        value={{ remotePort: 7331 }}
        connectionId="connection-1"
        discoverOnOpen
        configuredDirectories={["/home/dev/projects/configured"]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onFailure={vi.fn()}
      />,
    );

    const discovered = await screen.findByRole("combobox", { name: "Discovered workspaces" });
    expect(window.gateway.discoverWorkspaceDirectories).toHaveBeenCalledWith("connection-1");
    expect(screen.queryByRole("option", { name: "/home/dev/projects/configured" })).toBeNull();
    fireEvent.change(discovered, { target: { value: "/home/dev/projects/api" } });
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("api");
    expect((screen.getByRole("textbox", { name: "Remote directory" }) as HTMLInputElement).value).toBe(
      "/home/dev/projects/api",
    );
  });

  it("names the modal, moves focus inside, closes with Escape, and restores focus", () => {
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    const onClose = vi.fn();
    const view = render(
      <ConnectionDialog
        value={{ port: 22, authenticationMethod: "password", password: "", passphrase: "" }}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "New connection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close New connection" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Connection type" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab focus within the dialog", () => {
    render(
      <ConnectionDialog
        value={{ port: 22, authenticationMethod: "password", password: "", passphrase: "" }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const first = screen.getByRole("button", { name: "Close New connection" });
    const last = screen.getByRole("button", { name: "Save connection" });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("offers a local Mac connection without SSH fields", () => {
    render(
      <ConnectionDialog
        value={{ kind: "ssh", port: 22, authenticationMethod: "password", password: "", passphrase: "" }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Connection type" }), { target: { value: "local" } });
    expect(screen.getByText(/run Core and HatoPad directly on this Mac/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  });

  it("chooses a local project directory and derives its name", async () => {
    window.gateway = {
      pickWorkspaceDirectory: vi.fn().mockResolvedValue("/Users/me/Projects/api"),
    } as unknown as Window["gateway"];
    render(
      <WorkspaceDialog
        value={{ remotePort: 7331 }}
        connectionId="local-1"
        local
        onClose={vi.fn()}
        onSave={vi.fn()}
        onFailure={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose local project directory" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Local project directory" }) as HTMLInputElement).value).toBe(
        "/Users/me/Projects/api",
      ),
    );
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("api");
  });
});

describe("connection diagnostics", () => {
  it("copies without blocking and announces success", async () => {
    let finish!: () => void;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<DiagnosticsCopyButton onCopy={onCopy} onFailure={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Copy connection diagnostics" });
    fireEvent.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Copying connection diagnostics");
    finish();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Connection diagnostics copied"));
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("announces and exposes copy failures", async () => {
    const onFailure = vi.fn();
    render(
      <DiagnosticsCopyButton onCopy={() => Promise.reject(new Error("clipboard unavailable"))} onFailure={onFailure} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy connection diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Connection diagnostics could not be copied"),
    );
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "clipboard unavailable" }));
  });
});

describe("Gateway error presentation", () => {
  it("bounds and redacts unexpected error text", () => {
    const message = gatewayErrorMessage(
      new Error(`Error invoking remote method 'gateway:test': Error: password=hunter2 token:abc ${"x".repeat(400)}`),
    );
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("abc");
    expect(message).toContain("password=[redacted]");
    expect(message.length).toBeLessThanOrEqual(320);
  });

  it("renders an assertive, atomic, dismissible floating notice", () => {
    const onDismiss = vi.fn();
    render(<GatewayErrorNotice message="Connection failed" onDismiss={onDismiss} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("routes connection and settings failures out of modal content", async () => {
    const connectionFailure = vi.fn();
    render(
      <ConnectionDialog
        value={{
          name: "Host",
          host: "example.test",
          username: "me",
          port: 22,
          authenticationMethod: "password",
          password: "secret",
          passphrase: "",
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onFailure={connectionFailure}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(connectionFailure).toHaveBeenCalled());
    expect(screen.queryByText(/failed/i)).toBeNull();
    cleanup();

    const settingsFailure = vi.fn();
    render(
      <RepositoryDialog
        value={{ repository: "https://example.test/repo.git", branch: "dev", autoUpdate: true }}
        onClose={vi.fn()}
        onSave={() => Promise.reject(new Error("settings failed"))}
        onFailure={settingsFailure}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(settingsFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "settings failed" })),
    );
    expect(screen.queryByText("settings failed")).toBeNull();
  });

  it("surfaces provisioning, diagnostics, and unexpected failures without browser dialogs", async () => {
    const state = {
      connections: [
        {
          id: "connection-1",
          name: "Server",
          host: "example.test",
          port: 22,
          username: "me",
          authenticationMethod: "agent" as const,
        },
      ],
      workspaces: [
        {
          id: "workspace-1",
          connectionId: "connection-1",
          name: "Project",
          directory: "/srv/project",
          remotePort: 7331,
        },
      ],
      portTunnels: [],
    };
    const gateway = {
      get: vi.fn().mockResolvedValue({
        state,
        repository: { repository: "https://example.test/repo.git", branch: "dev", autoUpdate: true },
        runtimes: {},
        tunnelRuntimes: {},
        connectionRuntimes: {},
      }),
      startServer: vi.fn().mockRejectedValue(new Error("provisioning password=hidden failed")),
      copyDiagnostics: vi.fn().mockRejectedValue(new Error("clipboard failed")),
      onStatus: vi.fn(() => () => undefined),
      onTunnelStatus: vi.fn(() => () => undefined),
      onConnectionStatus: vi.fn(() => () => undefined),
    } as unknown as Window["gateway"];
    window.gateway = gateway;
    const alertSpy = vi.spyOn(window, "alert");
    render(<App />);
    await screen.findByRole("heading", { name: "Project", level: 2 });

    fireEvent.click(screen.getByRole("button", { name: /Start server/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("provisioning password=[redacted] failed"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy connection diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not copy diagnostics: clipboard failed"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

    const unexpected = new Event("unhandledrejection", { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(unexpected, "reason", { value: new Error("render loop failed") });
    window.dispatchEvent(unexpected);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Unexpected Gateway error: render loop failed"),
    );
    expect(unexpected.defaultPrevented).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("Gateway workspace page", () => {
  it("keeps many workspaces and long provisioning output in separate named regions", async () => {
    const workspaces = Array.from({ length: 40 }, (_, index) => ({
      id: `w${index}`,
      connectionId: "local",
      name: `Project ${index}`,
      directory: `/Projects/project-${index}`,
      remotePort: 7331 + index,
    }));
    window.gateway = {
      get: vi.fn().mockResolvedValue({
        state: { connections: [{ id: "local", kind: "local", name: "This Mac" }], workspaces, portTunnels: [] },
        runtimes: {
          w0: {
            status: "working",
            message: "Installing",
            logs: ["FIRST OUTPUT", ...Array.from({ length: 1000 }, (_, index) => `line ${index}`)],
          },
          w39: { status: "server", message: "Ready", logs: ["LAST OUTPUT"] },
        },
        connectionRuntimes: {},
        tunnelRuntimes: {},
      }),
      onStatus: vi.fn(() => () => undefined),
      onTunnelStatus: vi.fn(() => () => undefined),
      onConnectionStatus: vi.fn(() => () => undefined),
    } as unknown as Window["gateway"];
    const view = render(<App />);
    const list = await screen.findByRole("region", { name: "Workspaces" });
    expect(within(list).getAllByRole("article")).toHaveLength(40);
    expect(within(list).queryByText(/FIRST OUTPUT/)).toBeNull();
    expect(screen.getByRole("region", { name: "Provisioning output for Project 0" }).textContent).toContain("line 999");
    fireEvent.click(screen.getByRole("button", { name: "View provisioning log for Project 39" }));
    expect(screen.getByRole("region", { name: "Provisioning output for Project 39" }).textContent).toBe("LAST OUTPUT");
    expect(view.container.querySelector(".topbar")).toBeNull();
  });

  it.each([false, true])("accepts a manually entered missing workspace directory (local=%s)", async (local) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceDialog
        value={{ remotePort: 7331 }}
        connectionId="connection"
        local={local}
        onClose={vi.fn()}
        onSave={onSave}
        onFailure={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "New project" } });
    fireEvent.change(screen.getByRole("textbox", { name: local ? "Local project directory" : "Remote directory" }), {
      target: { value: "/new/parent/project" },
    });
    expect(screen.getByText(/Missing folders, including parent folders, are created when you save/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/new/parent/project", name: "New project" }),
      ),
    );
  });

  it("preserves the reader's scroll position when new log lines arrive", () => {
    const workspace = { id: "w", connectionId: "c", name: "Project", directory: "/project", remotePort: 7331 };
    const runtime = { status: "working" as const, message: "Installing", logs: ["first"] };
    const view = render(
      <ProvisioningLog workspace={workspace} workspaces={[workspace]} runtime={runtime} onSelect={vi.fn()} />,
    );
    const output = screen.getByRole("region", { name: "Provisioning output for Project" });
    Object.defineProperty(output, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(output, "clientHeight", { configurable: true, value: 200 });
    output.scrollTop = 100;
    fireEvent.scroll(output);
    view.rerender(
      <ProvisioningLog
        workspace={workspace}
        workspaces={[workspace]}
        runtime={{ ...runtime, logs: ["first", "second"] }}
        onSelect={vi.fn()}
      />,
    );
    expect(output.scrollTop).toBe(100);
    output.scrollTop = 800;
    fireEvent.scroll(output);
    view.rerender(
      <ProvisioningLog
        workspace={workspace}
        workspaces={[workspace]}
        runtime={{ ...runtime, logs: ["first", "second", "third"] }}
        onSelect={vi.fn()}
      />,
    );
    expect(output.scrollTop).toBe(1000);
  });
});

describe("Early Access Gateway", () => {
  it.each(["source", "bundled"] as const)(
    "shows repository settings only for source deployments (%s)",
    async (distribution) => {
      window.gateway = {
        get: vi.fn().mockResolvedValue({
          state: { connections: [], workspaces: [], portTunnels: [] },
          distribution,
          repository: { repository: "https://example.test/repo.git", branch: "dev", autoUpdate: true },
          runtimes: {},
          connectionRuntimes: {},
          tunnelRuntimes: {},
        }),
        onStatus: vi.fn(() => () => undefined),
        onTunnelStatus: vi.fn(() => () => undefined),
        onConnectionStatus: vi.fn(() => () => undefined),
      } as unknown as Window["gateway"];
      render(<App />);
      await waitFor(() => expect(window.gateway.get).toHaveBeenCalledOnce());
      await waitFor(() =>
        expect(Boolean(screen.queryByRole("button", { name: "Gateway repository settings" }))).toBe(
          distribution === "source",
        ),
      );
    },
  );
  it("offers SSH connections when a local Core runtime is unavailable", () => {
    render(
      <ConnectionDialog
        allowLocal={false}
        value={{ kind: "ssh", password: "", passphrase: "" }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("option", { name: "This Mac" })).toBeNull();
    expect(screen.getByRole("option", { name: "SSH host" })).toBeTruthy();
  });
});

describe("Gateway cloud", () => {
  const account = {
    origin: "https://hub.example",
    user: { id: "u", name: "Cloud User", email: "owner@example.com" },
    cores: [{ id: "remote-core", name: "Cloud machine", status: "online", access: "owner" as const }],
  };
  function bridge(cloud?: GatewayCloudAccount) {
    window.gateway = {
      get: vi.fn().mockResolvedValue({
        state: {
          connections: [{ id: "local", kind: "local", name: "This Mac" }],
          workspaces: [{ id: "w", connectionId: "local", name: "Project", directory: "/project", remotePort: 9000 }],
          portTunnels: [],
        },
        runtimes: { w: { status: "server", message: "Ready" } },
        tunnelRuntimes: {},
        connectionRuntimes: {},
      }),
      cloudSaveOrigin: vi.fn(async (origin: string) => origin),
      cloudCancelSignIn: vi.fn().mockResolvedValue(undefined),
      cloudGet: vi.fn().mockResolvedValue(cloud),
      cloudAutostartInfo: vi.fn().mockResolvedValue({ state: "off" }),
      cloudSetAutostart: vi
        .fn()
        .mockResolvedValue({ state: "on", detail: "Starts at boot (systemd user service with lingering)." }),
      cloudCoreUpdateInfo: vi
        .fn()
        .mockResolvedValue({ available: false, updateNeeded: false, reason: "No saved management connection" }),
      cloudUpdateCore: vi.fn(),
      cloudListCores: vi
        .fn()
        .mockResolvedValue([{ id: "cloud-root", alias: "Cloud project", path: "/srv/project", primary: true }]),
      cloudConnect: vi.fn().mockResolvedValue(account),
      cloudOpen: vi.fn().mockResolvedValue(undefined),
      cloudDisconnect: vi.fn().mockResolvedValue(undefined),
      cloudAddServer: vi.fn().mockResolvedValue(account),
      onStatus: () => () => undefined,
      onTunnelStatus: () => () => undefined,
      onConnectionStatus: () => () => undefined,
    } as unknown as Window["gateway"];
  }
  it("connects to cloud, adds cloud servers beside saved connections, and opens one", async () => {
    bridge();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect to cloud" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Cloud URL" }), { target: { value: "https://hub.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    expect(window.gateway.cloudConnect).toHaveBeenCalledWith("https://hub.example");
    expect(screen.getByRole("button", { name: "This Mac, local Mac" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Connect to Cloud project" }));
    await waitFor(() => expect(window.gateway.cloudOpen).toHaveBeenCalledWith("remote-core", "cloud-root"));
    expect(window.gateway.cloudListCores).toHaveBeenCalledWith("remote-core");
    expect(screen.getByText("/srv/project")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Cloud machine/ })).toBeNull());
    expect(screen.getByRole("button", { name: "This Mac, local Mac" })).toBeTruthy();
  });
  it("preloads cloud Cores before selection and retains them when switching servers", async () => {
    bridge(account);
    render(<App />);
    await waitFor(() => expect(window.gateway.cloudListCores).toHaveBeenCalledWith("remote-core"));
    expect(screen.queryByText("/srv/project")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    expect(await screen.findByText("/srv/project")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "This Mac, local Mac" }));
    fireEvent.click(screen.getByRole("button", { name: /Cloud machine/ }));
    expect(screen.getByText("/srv/project")).toBeTruthy();
    expect(window.gateway.cloudListCores).toHaveBeenCalledTimes(1);
  });
  it("can cancel while waiting for browser sign-in", async () => {
    bridge();
    let cancel!: () => void;
    vi.mocked(window.gateway.cloudConnect).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          cancel = () => reject(new Error("Cloud sign-in was cancelled."));
        }),
    );
    vi.mocked(window.gateway.cloudCancelSignIn).mockImplementation(async () => {
      cancel();
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Connect to cloud" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Cloud URL" }), { target: { value: "https://hub.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("button", { name: "Waiting in your browser…" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(window.gateway.cloudCancelSignIn).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("lets an owner turn start-on-boot on after confirmation and shows what it guarantees", async () => {
    bridge(account);
    const confirmation = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmation);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    const toggle = await screen.findByRole("switch", { name: "Start on boot" });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(window.gateway.cloudSetAutostart).toHaveBeenCalledWith(expect.any(String), true));
    expect(confirmation).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Starts at boot \(systemd user service with lingering\)/)).toBeTruthy();
  });
  it("never offers start-on-boot to a Core operator", async () => {
    bridge({ ...account, cores: [{ ...account.cores[0]!, access: "operator" as const }] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    await screen.findByRole("heading", { name: "Cloud machine" });
    expect(screen.queryByRole("switch", { name: "Start on boot" })).toBeNull();
    expect(window.gateway.cloudAutostartInfo).not.toHaveBeenCalled();
  });
  it("does not change start-on-boot when the owner declines the confirmation", async () => {
    bridge(account);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    const toggle = await screen.findByRole("switch", { name: "Start on boot" });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);
    expect(window.gateway.cloudSetAutostart).not.toHaveBeenCalled();
  });
  it("updates a cloud Core to the selected Gateway bundle using the compact action", async () => {
    bridge(account);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const release = "b".repeat(40) + "-node137-bundle-test";
    const info = {
      available: true,
      updateNeeded: true,
      bundledVersion: "0.2.0",
      bundledRelease: release,
      currentRelease: "old-release",
    };
    vi.mocked(window.gateway.cloudCoreUpdateInfo).mockResolvedValue(info);
    vi.mocked(window.gateway.cloudUpdateCore).mockImplementation(async () => {
      vi.mocked(window.gateway.cloudCoreUpdateInfo).mockResolvedValue({
        ...info,
        updateNeeded: false,
        currentRelease: release,
      });
      return { ...info, updateNeeded: false, currentRelease: release };
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    const update = await screen.findByRole("button", { name: "Update cloud Core" });
    await waitFor(() => expect(update.hasAttribute("disabled")).toBe(false));
    expect(update.textContent).toBe("");
    expect(update.title).toContain("0.2.0");
    fireEvent.click(update);
    await waitFor(() => expect(window.gateway.cloudUpdateCore).toHaveBeenCalledWith("remote-core", release));
    await waitFor(() => expect(update.hasAttribute("disabled")).toBe(true));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Core will restart"));
  });
  it("explains when a cloud Core cannot be updated from this Gateway", async () => {
    bridge(account);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    const update = await screen.findByRole("button", { name: "Update cloud Core" });
    await waitFor(() => expect(update.title).toBe("No saved management connection"));
    expect(update.hasAttribute("disabled")).toBe(true);
    expect((await screen.findByText("Update check failed")).getAttribute("title")).toBe(
      "No saved management connection",
    );
    expect(window.gateway.cloudCoreUpdateInfo).toHaveBeenCalledTimes(1);
    expect(window.gateway.cloudUpdateCore).not.toHaveBeenCalled();
  });
  it("can retry update discovery while an incompatible Core's workspace request is still pending", async () => {
    bridge(account);
    vi.mocked(window.gateway.cloudListCores).mockImplementation(() => new Promise(() => {}));
    vi.mocked(window.gateway.cloudCoreUpdateInfo).mockRejectedValueOnce(
      new Error("Error invoking remote method 'gateway:cloudCoreUpdateInfo': Error: SSH command interrupted"),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    expect((await screen.findByText("Update check failed")).getAttribute("title")).toBe("SSH command interrupted");
    vi.mocked(window.gateway.cloudCoreUpdateInfo).mockResolvedValue({
      available: true,
      updateNeeded: true,
      bundledRelease: "a".repeat(40),
      tag: "core-protocol-19-v0.1.42",
      source: "git",
      branch: "dev",
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh cloud Cores" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update cloud Core" }).hasAttribute("disabled")).toBe(false),
    );
  });
  it("offers an available update when the Core is offline", async () => {
    bridge({ ...account, cores: [{ ...account.cores[0]!, status: "offline" }] });
    vi.mocked(window.gateway.cloudCoreUpdateInfo).mockResolvedValue({
      available: true,
      updateNeeded: true,
      bundledRelease: "a".repeat(40),
      tag: "core-protocol-19-v0.1.42",
      source: "git",
      branch: "dev",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update cloud Core" }).hasAttribute("disabled")).toBe(false),
    );
    expect(window.gateway.cloudListCores).not.toHaveBeenCalled();
  });
  it("keeps cloud actions icon-only and exposes tooltips and accessible names", async () => {
    bridge(account);
    render(<App />);
    for (const name of ["Cloud settings", "Refresh cloud", "Disconnect", "Add to cloud"]) {
      const button = await screen.findByRole("button", { name });
      expect(button.textContent).toBe("");
      expect(button.getAttribute("title")).toBeTruthy();
      expect(button.querySelector("svg")).toBeTruthy();
    }
  });
  it("does not try to connect to an offline cloud server", async () => {
    bridge({ ...account, cores: [{ ...account.cores[0]!, status: "offline" }] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    expect(await screen.findByText(/Server is offline/)).toBeTruthy();
    expect(window.gateway.cloudListCores).not.toHaveBeenCalled();
    expect(window.gateway.cloudOpen).not.toHaveBeenCalled();
  });
  it("shows Core discovery errors and can retry loading the list", async () => {
    bridge(account);
    vi.mocked(window.gateway.cloudListCores).mockRejectedValueOnce(new Error("Relay disconnected"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Cloud machine/ }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Relay disconnected");
    fireEvent.click(screen.getByRole("button", { name: "Refresh cloud Cores" }));
    expect(await screen.findByRole("button", { name: "Connect to Cloud project" })).toBeTruthy();
  });
  it("loads a locally saved cloud URL while signed out and saves changes without signing in", async () => {
    bridge();
    vi.mocked(window.gateway.get).mockResolvedValue({
      state: { connections: [], workspaces: [], portTunnels: [] },
      cloudOrigin: "https://saved.example",
      repository: { repository: "", branch: "", autoUpdate: false },
      runtimes: {},
      connectionRuntimes: {},
      tunnelRuntimes: {},
    });
    render(<App />);
    await waitFor(() => expect(window.gateway.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Connect to cloud" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Cloud URL" }) as HTMLInputElement).value).toBe(
        "https://saved.example",
      ),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Cloud URL" }), {
      target: { value: "https://custom.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save URL" }));
    await waitFor(() => expect(window.gateway.cloudSaveOrigin).toHaveBeenCalledWith("https://custom.example"));
    expect(window.gateway.cloudConnect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Connect to cloud" }));
    expect((screen.getByRole("textbox", { name: "Cloud URL" }) as HTMLInputElement).value).toBe(
      "https://custom.example",
    );
  });
  it("allows changing the cloud domain from a signed-in account", async () => {
    bridge(account);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cloud settings" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Cloud URL" }), {
      target: { value: "https://other.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save URL" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Cloud machine/ })).toBeNull());
    expect(window.gateway.cloudSaveOrigin).toHaveBeenCalledWith("https://other.example");
    expect(screen.getByRole("button", { name: "This Mac, local Mac" })).toBeTruthy();
  });
  it("adds a running saved server to the signed-in cloud account", async () => {
    bridge(account);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to cloud" }));
    await waitFor(() => expect(window.gateway.cloudAddServer).toHaveBeenCalledWith("w"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("owner@example.com"));
  });
  it("keeps a server local when adding to cloud is cancelled", async () => {
    bridge(account);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to cloud" }));
    expect(window.gateway.cloudAddServer).not.toHaveBeenCalled();
  });
});
