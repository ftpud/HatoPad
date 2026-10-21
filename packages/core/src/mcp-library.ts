import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  McpOAuthProvider,
  McpSignInRequired,
  beginOAuth,
  completeOAuth,
  rememberOAuth,
  takeOAuth,
  cancelOAuth,
  oauthError,
  oauthFetch,
  type StoredOAuth,
  type PendingOAuth,
} from "./mcp-oauth.js";
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
  connections: {
    id: string;
    name: string;
    token?: string;
    headers?: Record<string, string>;
    authType?: "token" | "oauth";
    oauth?: StoredOAuth;
  }[];
};
const writes = new Map<string, Promise<unknown>>();
const oauthQueues = new Map<string, Promise<unknown>>();
async function serializeOAuth<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = oauthQueues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(operation);
  oauthQueues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (oauthQueues.get(key) === pending) oauthQueues.delete(key);
  }
}
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
      connections: server.connections.map(({ id, name, token, headers, authType, oauth }) => ({
        id,
        name,
        hasCredentials: Boolean(token || oauth?.tokens || Object.keys(headers ?? {}).length),
        authType: authType ?? "token",
        ...(authType === "oauth" && oauth
          ? {
              oauth: {
                clientId: oauth.clientId,
                scope: oauth.scope,
                redirectPort: oauth.redirectPort,
                connected: Boolean(oauth.tokens),
                hasClientSecret: Boolean(oauth.clientSecret),
                expiresAt: oauth.expiresAt,
              },
            }
          : {}),
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
      if (connection.authType !== undefined && !["token", "oauth"].includes(connection.authType))
        invalid("Choose token or OAuth authentication");
      if (connection.oauth !== undefined) {
        if (!connection.oauth || typeof connection.oauth !== "object" || Array.isArray(connection.oauth))
          invalid("Invalid OAuth settings");
        for (const key of ["clientId", "clientSecret", "scope"] as const)
          if (
            connection.oauth[key] !== undefined &&
            (typeof connection.oauth[key] !== "string" ||
              connection.oauth[key]!.length > 16000 ||
              /[\r\n]/.test(connection.oauth[key]!))
          )
            invalid("Invalid OAuth settings");
        const port = connection.oauth.redirectPort;
        if (port !== undefined && (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))))
          invalid("OAuth callback port must be 0 (automatic) or 1024–65535");
      }
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
          const authType = connection.authType ?? prior?.authType ?? "token";
          if (
            authType === "oauth" &&
            Object.keys(connection.headers ?? prior?.headers ?? {}).some((key) => key.toLowerCase() === "authorization")
          )
            invalid("OAuth supplies the Authorization header; remove it from custom headers");
          const config = {
            clientId: connection.oauth?.clientId ?? prior?.oauth?.clientId,
            clientSecret: connection.oauth?.clientSecret ?? prior?.oauth?.clientSecret,
            scope: connection.oauth?.scope ?? prior?.oauth?.scope,
            redirectPort: connection.oauth?.redirectPort ?? prior?.oauth?.redirectPort,
          };
          const unchanged =
            prior?.authType === "oauth" &&
            JSON.stringify(config) ===
              JSON.stringify({
                clientId: prior.oauth?.clientId,
                clientSecret: prior.oauth?.clientSecret,
                scope: prior.oauth?.scope,
                redirectPort: prior.oauth?.redirectPort,
              });
          return {
            id: connection.id,
            name: connection.name.trim(),
            authType,
            token: authType === "oauth" ? undefined : (connection.token ?? prior?.token),
            ...(authType === "oauth"
              ? { oauth: unchanged ? prior!.oauth : { ...config, generation: crypto.randomUUID() } }
              : {}),
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
  private async selected(selection: McpSelection) {
    const server = (await this.read()).find((server) => server.id === selection?.serverId);
    const connection = server?.connections.find(
      (connection) => connection.id === (selection.connectionId ?? server.defaultConnectionId),
    );
    if (!server || !connection) invalid("MCP server or connection no longer exists");
    return { server, connection };
  }
  private oauthAccess(selection: McpSelection, generation: string) {
    const check = (servers: StoredServer[]) => {
      const connection = servers
        .find((server) => server.id === selection.serverId)
        ?.connections.find((connection) => connection.id === selection.connectionId);
      if (connection?.authType !== "oauth" || connection.oauth?.generation !== generation)
        throw new McpSignInRequired();
      return connection.oauth;
    };
    return {
      read: async () => check(await this.read()),
      update: async (change: (oauth: StoredOAuth) => void) => this.mutate((servers) => change(check(servers))),
    };
  }
  async startOAuth(selection: McpSelection, redirectUri: string) {
    const { server, connection } = await this.selected(selection);
    if (connection.authType !== "oauth" || !connection.oauth)
      invalid("Choose OAuth authentication for this connection");
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      invalid("Invalid OAuth callback URL");
    }
    if (
      redirect!.protocol !== "http:" ||
      redirect!.hostname !== "127.0.0.1" ||
      !redirect!.port ||
      redirect!.pathname !== "/mcp/oauth/callback" ||
      redirect!.search ||
      redirect!.hash ||
      redirect!.username ||
      redirect!.password ||
      (connection.oauth.redirectPort && Number(redirect!.port) !== connection.oauth.redirectPort)
    )
      invalid("Use the Desktop loopback OAuth callback");
    const flow: PendingOAuth = {
      file: this.file,
      serverId: server.id,
      connectionId: connection.id,
      generation: connection.oauth.generation,
      serverUrl: server.url,
      oauth: { ...structuredClone(connection.oauth), tokens: undefined, expiresAt: undefined },
      interaction: { redirectUri: redirect!.href, state: crypto.randomBytes(32).toString("base64url") },
      expiresAt: Date.now() + 300000,
    };
    // DCR servers can require an exact redirect URI, including the ephemeral port.
    // Re-register in the pending flow without disturbing an existing usable grant.
    if (!flow.oauth.clientId && flow.oauth.redirectUri && flow.oauth.redirectUri !== redirect!.href)
      delete flow.oauth.registration;
    try {
      await beginOAuth(flow, connection.headers ?? {});
    } catch (error) {
      throw oauthError(error);
    }
    return {
      flowId: rememberOAuth(flow),
      authorizationUrl: flow.interaction.authorizationUrl!,
      state: flow.interaction.state,
    };
  }
  async finishOAuth(flowId: string, callbackUrl: string) {
    const flow = takeOAuth(this.file, flowId);
    const selection = { serverId: flow.serverId, connectionId: flow.connectionId };
    await serializeOAuth(`${this.file}:${flow.serverId}:${flow.connectionId}`, async () => {
      const access = this.oauthAccess(selection, flow.generation);
      await access.read();
      try {
        await completeOAuth(flow, callbackUrl);
      } catch (error) {
        throw oauthError(error);
      }
      await access.update((oauth) => Object.assign(oauth, flow.oauth));
    });
  }
  cancelOAuth(flowId: string) {
    cancelOAuth(this.file, flowId);
  }
  async disconnectOAuth(selection: McpSelection) {
    const { server, connection } = await this.selected(selection);
    if (!connection.oauth) return;
    await serializeOAuth(`${this.file}:${server.id}:${connection.id}`, () =>
      this.oauthAccess({ serverId: server.id, connectionId: connection.id }, connection.oauth!.generation).update(
        (oauth) => {
          delete oauth.tokens;
          delete oauth.expiresAt;
          oauth.generation = crypto.randomUUID();
        },
      ),
    );
  }
  private async connected<T>(selection: McpSelection, use: (client: Client) => Promise<T>): Promise<T> {
    const { server, connection } = await this.selected(selection);
    if (connection.authType === "oauth" && connection.oauth) {
      return serializeOAuth(`${this.file}:${server.id}:${connection.id}`, async () => {
        const access = this.oauthAccess(
          { serverId: server.id, connectionId: connection.id },
          connection.oauth!.generation,
        );
        const oauth = await access.read();
        if (!oauth.tokens) throw new McpSignInRequired();
        const provider = new McpOAuthProvider(access, oauth);
        try {
          if (oauth.expiresAt !== undefined && oauth.expiresAt < Date.now() + 30000) {
            if (!oauth.tokens.refresh_token) throw new McpSignInRequired();
            await auth(provider, { serverUrl: server.url, scope: oauth.scope, fetchFn: oauthFetch });
          }
          return await useMcpClient(
            `${this.file}:${server.id}:${connection.id}:oauth:${oauth.generation}:${crypto
              .createHash("sha256")
              .update(JSON.stringify(connection.headers ?? {}))
              .digest("hex")}`,
            server.url,
            connection.headers ?? {},
            use,
            provider,
          );
        } catch (error) {
          if (error instanceof McpSignInRequired) throw error;
          throw new Error("MCP OAuth request failed. Sign in again if this connection has expired or was revoked.");
        }
      });
    }
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
