import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CoreClient } from "./client";
import { useMcpLibrary } from "./use-mcp-library";

afterEach(() => {
  cleanup();
  delete window.desktop;
});
it("relays the Desktop browser callback to the same remote Core without exposing tokens", async () => {
  const callbackUrl = "http://127.0.0.1:54321/mcp/oauth/callback?state=state&code=code";
  const desktop = {
    mcpOAuthPrepare: vi
      .fn()
      .mockResolvedValue({ id: "local", redirectUri: "http://127.0.0.1:54321/mcp/oauth/callback" }),
    mcpOAuthWait: vi.fn().mockResolvedValue(callbackUrl),
    mcpOAuthCancel: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
  };
  window.desktop = desktop as unknown as Window["desktop"];
  const request = vi.fn(async (type: string) =>
    type === "mcp.oauth.start"
      ? { flowId: "flow", authorizationUrl: "https://identity.example/authorize", state: "state" }
      : type === "mcp.list"
        ? { servers: [] }
        : {},
  );
  const client = {
    request,
    supports: () => true,
    getRoot: () => "root",
    isConnected: () => true,
  } as unknown as CoreClient;
  const { result } = renderHook(() => useMcpLibrary({ current: client }));
  await act(async () => result.current.mcpActions.signIn({ serverId: "example", connectionId: "personal" }));
  expect(desktop.mcpOAuthWait).toHaveBeenCalledWith("local", "state");
  expect(desktop.openExternal).toHaveBeenCalledWith("https://identity.example/authorize");
  expect(request).toHaveBeenCalledWith("mcp.oauth.finish", { flowId: "flow", callbackUrl }, { timeoutMs: 60000 });
  expect(desktop.mcpOAuthCancel).toHaveBeenCalledWith("local");
});

it("does not complete a sign-in after the user switches projects", async () => {
  let root = "first";
  const desktop = {
    mcpOAuthPrepare: vi
      .fn()
      .mockResolvedValue({ id: "local", redirectUri: "http://127.0.0.1:54321/mcp/oauth/callback" }),
    mcpOAuthWait: vi.fn(async () => {
      root = "second";
      return "http://127.0.0.1:54321/mcp/oauth/callback?state=state&code=code";
    }),
    mcpOAuthCancel: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
  };
  window.desktop = desktop as unknown as Window["desktop"];
  const request = vi
    .fn()
    .mockResolvedValue({ flowId: "flow", authorizationUrl: "https://identity.example/authorize", state: "state" });
  const client = {
    request,
    supports: () => true,
    getRoot: () => root,
    isConnected: () => true,
  } as unknown as CoreClient;
  const { result } = renderHook(() => useMcpLibrary({ current: client }));
  await expect(result.current.mcpActions.signIn({ serverId: "example" })).rejects.toThrow("workspace changed");
  expect(request.mock.calls.some(([type]) => type === "mcp.oauth.finish")).toBe(false);
  expect(desktop.mcpOAuthCancel).toHaveBeenCalledWith("local");
});

it("skips MCP requests on older Cores and explains how to enable them", async () => {
  const request = vi.fn();
  const client = {
    request,
    supports: () => false,
    getRoot: () => "root",
    isConnected: () => true,
  } as unknown as CoreClient;
  const { result } = renderHook(() => useMcpLibrary({ current: client }));
  await act(async () => result.current.refreshMcps());
  expect(request).not.toHaveBeenCalled();
  expect(result.current.mcpLibraryAvailable).toBe(false);
  expect(result.current.mcpUnavailableReason).toContain("Update Core");
  await expect(result.current.mcpActions.discover({ serverId: "example" })).rejects.toThrow("Update Core");
  await expect(result.current.mcpActions.signIn({ serverId: "example" })).rejects.toThrow("Update Core");
  expect(request).not.toHaveBeenCalled();
});

it("enables MCP controls after reconnecting to a Core with MCP support", async () => {
  let supported = false;
  const request = vi.fn().mockResolvedValue({ servers: [] });
  const client = {
    request,
    supports: () => supported,
    getRoot: () => "root",
    isConnected: () => true,
  } as unknown as CoreClient;
  const { result } = renderHook(() => useMcpLibrary({ current: client }));
  await act(async () => result.current.refreshMcps());
  expect(result.current.mcpUnavailableReason).toContain("Update Core");
  supported = true;
  await act(async () => result.current.refreshMcps());
  expect(request).toHaveBeenCalledWith("mcp.list", {});
  expect(result.current.mcpLibraryAvailable).toBe(true);
  expect(result.current.mcpUnavailableReason).toBeUndefined();
});
