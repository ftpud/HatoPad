import { useCallback, useState, type MutableRefObject } from "react";
import type { McpLibraryServer, McpSelection, McpServerInput } from "@hatopad/protocol";
import type { CoreClient } from "./client";

export function useMcpLibrary(clientRef: MutableRefObject<CoreClient | undefined>) {
  const [mcpServers, setMcpServers] = useState<McpLibraryServer[]>([]);
  const refreshMcps = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const root = client.getRoot();
    const { servers } = await client.request("mcp.list", {});
    if (canApply() && clientRef.current === client && client.isConnected() && root === client.getRoot())
      setMcpServers(servers);
  }, []);
  const mcpActions = {
    save: async (server: McpServerInput) => {
      const client = clientRef.current;
      if (!client) throw new Error("Backend is disconnected");
      const result = await client.request("mcp.save", { server });
      await refreshMcps(client);
      return result.server;
    },
    delete: async (id: string) => {
      const client = clientRef.current;
      if (!client) throw new Error("Backend is disconnected");
      await client.request("mcp.delete", { id });
      await refreshMcps(client);
    },
    discover: async (selection: McpSelection) => {
      if (!clientRef.current) throw new Error("Backend is disconnected");
      return (await clientRef.current.request("mcp.actions", selection)).actions;
    },
  };
  return { mcpServers, setMcpServers, refreshMcps, mcpActions };
}
