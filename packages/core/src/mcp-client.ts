import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

type Connection = { client: Promise<Client>; users: number; idle?: NodeJS.Timeout };
const connections = new Map<string, Connection>();

export async function connectMcpClient(
  url: string,
  headers: Record<string, string>,
  authProvider?: OAuthClientProvider,
  onUnauthorized?: (response: Response) => void,
): Promise<Client> {
  const request: typeof fetch = async (target, init) => {
    const response = await fetch(target, init);
    if (response.status === 401) onUnauthorized?.(response);
    return response;
  };
  let client = new Client({ name: "hatopad", version: "0.1.0" });
  const connecting = new AbortController();
  const timeout = setTimeout(() => connecting.abort(), 15000);
  try {
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          authProvider,
          fetch: request,
          requestInit: { headers, signal: connecting.signal },
        }),
        { timeout: 15000 },
      );
    } catch (error) {
      await client.close().catch(() => {});
      if (!(error instanceof StreamableHTTPError) || ![404, 405].includes(error.code ?? 0)) throw error;
      client = new Client({ name: "hatopad", version: "0.1.0" });
      await client.connect(
        new SSEClientTransport(new URL(url), {
          authProvider,
          fetch: request,
          requestInit: { headers, signal: connecting.signal },
          eventSourceInit: {
            fetch: (target, init) =>
              request(target, {
                ...init,
                signal: connecting.signal,
                headers: init?.headers,
              }),
          },
        }),
        { timeout: 15000 },
      );
    }
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function close(connection: Connection) {
  clearTimeout(connection.idle);
  const client = await connection.client.catch(() => undefined);
  const transport = client?.transport;
  if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        transport.terminateSession().catch(() => {}),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
  await client?.close().catch(() => {});
}

/** Reuse initialized MCP sessions, including stateful remote servers, across tool calls. */
export async function useMcpClient<T>(
  key: string,
  url: string,
  headers: Record<string, string>,
  use: (client: Client) => Promise<T>,
  authProvider?: OAuthClientProvider,
): Promise<T> {
  let connection = connections.get(key);
  if (!connection) {
    connection = { client: connectMcpClient(url, headers, authProvider), users: 0 };
    connections.set(key, connection);
  }
  const selected = connection;
  clearTimeout(selected.idle);
  selected.users++;
  try {
    return await use(await selected.client);
  } catch (error) {
    // Retire a broken session. Never retry a tool call: its side effects may already have happened.
    if (connections.get(key) === selected) connections.delete(key);
    throw error;
  } finally {
    selected.users--;
    if (!selected.users) {
      if (connections.get(key) !== selected) await close(selected);
      else {
        selected.idle = setTimeout(() => {
          if (connections.get(key) === selected) connections.delete(key);
          void close(selected);
        }, 300000);
        selected.idle.unref();
      }
    }
  }
}

export async function closeMcpConnections() {
  const selected = [...connections.values()];
  connections.clear();
  await Promise.all(selected.map(close));
}
