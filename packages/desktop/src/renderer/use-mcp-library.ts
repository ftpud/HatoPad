import { useCallback, useState, type MutableRefObject } from "react";
import type { McpLibraryServer, McpSelection, McpServerInput } from "@hatopad/protocol";
import type { CoreClient } from "./client";

export function useMcpLibrary(clientRef: MutableRefObject<CoreClient | undefined>) {
  const [mcpServers, setMcpServers] = useState<McpLibraryServer[]>([]);
  const [mcpLibraryAvailable, setMcpLibraryAvailable] = useState(false);
  const [mcpUnavailableReason, setMcpUnavailableReason] = useState<string>();
  const requireClient = (oauth = false) => {
    const client = clientRef.current;
    if (!client || !client.isConnected()) throw new Error("Backend is disconnected");
    if (!client.supports("mcp.library")) throw new Error("Update Core to use MCP servers and chat MCP controls.");
    if (oauth && !client.supports("mcp.oauth")) throw new Error("Update Core to use MCP OAuth sign-in.");
    return client;
  };
  const refreshMcps = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const root = client.getRoot();
    const available = client.supports("mcp.library");
    const servers = available ? (await client.request("mcp.list", {})).servers : [];
    if (canApply() && clientRef.current === client && client.isConnected() && root === client.getRoot()) {
      setMcpServers(servers);
      setMcpLibraryAvailable(available);
      setMcpUnavailableReason(available ? undefined : "Update Core to use MCP servers and chat MCP controls.");
    }
  }, []);
  const mcpActions = {
    save: async (server: McpServerInput) => {
      const client = requireClient();
      const result = await client.request("mcp.save", { server });
      await refreshMcps(client);
      return result.server;
    },
    delete: async (id: string) => {
      const client = requireClient();
      await client.request("mcp.delete", { id });
      await refreshMcps(client);
    },
    signIn: async (selection: McpSelection, port?: number, signal?: AbortSignal) => {
      const client = requireClient(true);
      const desktop = window.desktop;
      if (!desktop?.mcpOAuthPrepare || !desktop.mcpOAuthWait || !desktop.mcpOAuthCancel)
        throw new Error("Update HatoPad Desktop to use browser OAuth sign-in.");
      const root = client.getRoot();
      const callback = await desktop.mcpOAuthPrepare(port);
      let flowId: string | undefined;
      const abort = () => {
        void desktop.mcpOAuthCancel!(callback.id);
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (signal?.aborted) throw new Error("OAuth sign-in cancelled");
        const flow = await client.request(
          "mcp.oauth.start",
          { ...selection, redirectUri: callback.redirectUri },
          { timeoutMs: 90000 },
        );
        flowId = flow.flowId;
        if (signal?.aborted || root !== client.getRoot() || clientRef.current !== client)
          throw new Error("OAuth sign-in cancelled because the workspace changed.");
        const waiting = desktop.mcpOAuthWait(callback.id, flow.state);
        void waiting.catch(() => {});
        await desktop.openExternal(flow.authorizationUrl);
        const callbackUrl = await waiting;
        if (signal?.aborted || root !== client.getRoot() || clientRef.current !== client)
          throw new Error("OAuth sign-in cancelled because the workspace changed.");
        await client.request("mcp.oauth.finish", { flowId, callbackUrl }, { timeoutMs: 60000 });
        flowId = undefined;
        await refreshMcps(client);
      } finally {
        signal?.removeEventListener("abort", abort);
        await desktop.mcpOAuthCancel(callback.id).catch(() => {});
        if (flowId && clientRef.current === client && client.getRoot() === root && client.isConnected())
          await client.request("mcp.oauth.cancel", { flowId }).catch(() => {});
      }
    },
    disconnect: async (selection: McpSelection) => {
      const client = requireClient(true);
      await client.request("mcp.oauth.disconnect", selection);
      await refreshMcps();
    },
    discover: async (selection: McpSelection) => {
      const client = requireClient();
      return (await client.request("mcp.actions", selection)).actions;
    },
  };
  return { mcpServers, setMcpServers, refreshMcps, mcpActions, mcpLibraryAvailable, mcpUnavailableReason };
}
