/** A credential-free reference. Omitted connectionId follows the server's default. */
export type McpSelection = { serverId: string; connectionId?: string };
export type McpAction = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type McpConnection = {
  id: string;
  name: string;
  hasCredentials: boolean;
};
export type McpLibraryServer = {
  id: string;
  name: string;
  url: string;
  connections: McpConnection[];
  defaultConnectionId: string;
};
export type McpServerInput = Omit<McpLibraryServer, "connections"> & {
  connections: { id: string; name: string; token?: string; headers?: Record<string, string> }[];
};
