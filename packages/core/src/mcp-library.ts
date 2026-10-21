import crypto from "node:crypto";
import path from "node:path";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { useMcpClient } from "./mcp-client.js";
import type {
  McpAction,
  McpLibraryServer,
  McpSelection,
  McpServerInput,
  HarnessBlock,
  AiSession,
} from "@hatopad/protocol";
import { CoreError } from "./errors.js";
import { stateHome } from "./state-home.js";

type StoredServer = Omit<McpLibraryServer, "connections"> & {
  connections: { id: string; name: string; token?: string; headers?: Record<string, string> }[];
};
const writes = new Map<string, Promise<unknown>>();
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
function invalid(message: string): never {
  throw new CoreError("INVALID_REQUEST", message);
}

/** Project library in private Core state. Public records never contain authentication material. */
export class McpLibrary {
  readonly file: string;
  constructor(
    rootWorkspace: string,
    stateDirectory = process.env.HATOPAD_STATE_DIR ?? path.join(stateHome(), "workspaces"),
  ) {
    this.file = path.join(
      stateDirectory,
      "mcp",
      crypto.createHash("sha256").update(path.resolve(rootWorkspace)).digest("hex"),
      "servers.json",
    );
  }
  private async read(): Promise<StoredServer[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  private public(server: StoredServer): McpLibraryServer {
    return {
      ...server,
      connections: server.connections.map(({ id, name, token, headers }) => ({
        id,
        name,
        hasCredentials: Boolean(token || Object.keys(headers ?? {}).length),
      })),
    };
  }
  async list(): Promise<McpLibraryServer[]> {
    return (await this.read()).map((server) => this.public(server));
  }
  private async mutate(change: (servers: StoredServer[]) => void) {
    const previous = writes.get(this.file) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        const servers = await this.read();
        change(servers);
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        await chmod(path.dirname(this.file), 0o700);
        const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(servers), { mode: 0o600, flag: "wx" });
          await rename(temp, this.file);
        } finally {
          await rm(temp, { force: true });
        }
      });
    writes.set(this.file, pending);
    try {
      await pending;
    } finally {
      if (writes.get(this.file) === pending) writes.delete(this.file);
    }
  }
  async save(input: McpServerInput): Promise<McpLibraryServer> {
    if (!input || !validId(input.id) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)
      invalid("Enter a server name and valid ID");
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      invalid("Enter an HTTP or HTTPS MCP URL");
    }
    if (!["http:", "https:"].includes(url!.protocol) || url!.username || url!.password || url!.hash)
      invalid("Use an HTTP or HTTPS URL without embedded credentials or fragments");
    if (!Array.isArray(input.connections) || input.connections.length < 1 || input.connections.length > 30)
      invalid("Add between 1 and 30 connections");
    const ids = new Set<string>();
    for (const connection of input.connections) {
      if (
        !connection ||
        !validId(connection.id) ||
        ids.has(connection.id) ||
        typeof connection.name !== "string" ||
        !connection.name.trim() ||
        connection.name.length > 120
      )
        invalid("Connections need unique IDs and names");
      ids.add(connection.id);
      if (
        connection.token !== undefined &&
        (typeof connection.token !== "string" || connection.token.length > 16000 || /[\r\n]/.test(connection.token))
      )
        invalid("Invalid bearer token");
      if (
        connection.headers !== undefined &&
        (!connection.headers ||
          typeof connection.headers !== "object" ||
          Array.isArray(connection.headers) ||
          Object.entries(connection.headers).some(
            ([key, value]) =>
              !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
              typeof value !== "string" ||
              value.length > 16000 ||
              /[\r\n]/.test(value) ||
              ["host", "content-length", "connection"].includes(key.toLowerCase()),
          ))
      )
        invalid("Enter valid HTTP headers");
    }
    if (!ids.has(input.defaultConnectionId)) invalid("Choose a default connection");
    let saved!: StoredServer;
    await this.mutate((servers) => {
      const index = servers.findIndex((server) => server.id === input.id);
      const old = servers[index];
      saved = {
        id: input.id,
        name: input.name.trim(),
        url: url!.href,
        defaultConnectionId: input.defaultConnectionId,
        connections: input.connections.map((connection) => {
          const prior = old?.url === url!.href ? old.connections.find((item) => item.id === connection.id) : undefined;
          return {
            id: connection.id,
            name: connection.name.trim(),
            token: connection.token ?? prior?.token,
            headers: connection.headers ?? prior?.headers,
          };
        }),
      };
      if (index < 0) servers.push(saved);
      else servers[index] = saved;
    });
    return this.public(saved);
  }
  async delete(id: string) {
    await this.mutate((servers) => {
      const index = servers.findIndex((server) => server.id === id);
      if (index >= 0) servers.splice(index, 1);
    });
  }
  async validateSelections(selections: McpSelection[]) {
    if (!Array.isArray(selections) || selections.length > 100) invalid("Choose valid MCP connections");
    const servers = await this.list();
    const seen = new Set<string>();
    return selections.map((selection) => {
      const server = servers.find((server) => server.id === selection?.serverId);
      if (
        !server ||
        seen.has(server.id) ||
        (selection.connectionId !== undefined &&
          !server.connections.some((connection) => connection.id === selection.connectionId))
      )
        invalid("MCP server or connection no longer exists");
      seen.add(server.id);
      return { serverId: server.id, ...(selection.connectionId ? { connectionId: selection.connectionId } : {}) };
    });
  }
  private async connected<T>(selection: McpSelection, use: (client: Client) => Promise<T>): Promise<T> {
    const server = (await this.read()).find((server) => server.id === selection.serverId);
    const connection = server?.connections.find(
      (connection) => connection.id === (selection.connectionId ?? server.defaultConnectionId),
    );
    if (!server || !connection) invalid("MCP server or connection no longer exists");
    const headers = {
      ...connection.headers,
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
    };
    const key = `${this.file}:${server.id}:${connection.id}:${crypto
      .createHash("sha256")
      .update(JSON.stringify([server.url, headers]))
      .digest("hex")}`;
    try {
      return await useMcpClient(key, server.url, headers, use);
    } catch (error) {
      // Transport errors may include URLs, headers or response bodies. Never expose them to chat/logs.
      if (
        (error as { code?: number }).code === 401 ||
        /unauthorized|401/i.test(error instanceof Error ? error.message : "")
      )
        throw new CoreError("INVALID_REQUEST", "MCP authentication failed. Update this connection's credentials.");
      throw new CoreError(
        "INVALID_REQUEST",
        "MCP request failed. Check the server URL, connection permissions and availability.",
      );
    }
  }
  async actions(selection: McpSelection): Promise<McpAction[]> {
    return this.connected(selection, async (client) => {
      if (!client.getServerCapabilities()?.tools) return [];
      const actions: McpAction[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: 15000 });
        actions.push(...result.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
        cursor = result.nextCursor;
        if (!cursor) return actions;
      }
      throw new Error("Too many MCP tool pages");
    });
  }
  async call(selection: McpSelection, name: string, args: Record<string, unknown>) {
    if (typeof name !== "string" || !name || !args || typeof args !== "object" || Array.isArray(args))
      invalid("Choose an MCP action and object arguments");
    return this.connected(selection, (client) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: 300000 }),
    );
  }
}

export async function executeWorkflowMcp(
  block: HarnessBlock,
  input: string,
  rootWorkspace: string,
  assertActive: () => void,
): Promise<AiSession> {
  assertActive();
  if (!block.mcp) invalid("Choose an MCP server for this block");
  const request = input.trim() ? JSON.parse(input) : { action: "list" };
  if (!request || typeof request !== "object" || Array.isArray(request)) invalid("MCP input must be an object");
  const library = new McpLibrary(rootWorkspace);
  let output: unknown;
  if (request.action === "list") output = { actions: await library.actions(block.mcp) };
  else if (request.action === "call") output = await library.call(block.mcp, request.name, request.arguments ?? {});
  else invalid("MCP input must be {action: list} or {action: call, name, arguments}");
  assertActive();
  return {
    id: crypto.randomUUID(),
    status: "idle",
    messages: [
      { id: crypto.randomUUID(), role: "assistant", text: JSON.stringify(output), timestamp: new Date().toISOString() },
    ],
  } as AiSession;
}
