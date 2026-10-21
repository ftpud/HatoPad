import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Plug, RefreshCw, Trash2, X } from "lucide-react";
import type { McpAction, McpLibraryServer, McpServerInput } from "@hatopad/protocol";
import type { useMcpLibrary } from "./use-mcp-library";

type Actions = ReturnType<typeof useMcpLibrary>["mcpActions"];
type ConnectionDraft = {
  id: string;
  name: string;
  token: string;
  headersText: string;
  hasCredentials: boolean;
  authType: "token" | "oauth";
  clientId: string;
  clientSecret: string;
  scope: string;
  redirectPort: string;
  hasClientSecret: boolean;
};
const newConnection = (): ConnectionDraft => ({
  id: crypto.randomUUID(),
  name: "Connection",
  token: "",
  headersText: "",
  hasCredentials: false,
  authType: "token",
  clientId: "",
  clientSecret: "",
  scope: "",
  redirectPort: "",
  hasClientSecret: false,
});
type Draft = Omit<McpServerInput, "connections"> & { connections: ReturnType<typeof newConnection>[] };

export function McpPanel({
  servers,
  actions,
  onRefresh,
  disabled,
}: {
  servers: McpLibraryServer[];
  actions: Actions;
  onRefresh(): Promise<void>;
  disabled?: boolean;
}) {
  const loginAbort = useRef<AbortController>();
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => () => loginAbort.current?.abort(), []);
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discovered, setDiscovered] = useState<Record<string, McpAction[]>>({});
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP request failed");
    } finally {
      setBusy(false);
    }
  };
  const edit = (server?: McpLibraryServer) => {
    setError("");
    setDiscovered({});
    const connection = newConnection();
    setDraft(
      server
        ? {
            ...server,
            connections: server.connections.map((item) => ({
              ...item,
              token: "",
              headersText: "",
              authType: item.authType ?? "token",
              clientId: item.oauth?.clientId ?? "",
              clientSecret: "",
              scope: item.oauth?.scope ?? "",
              redirectPort: item.oauth?.redirectPort ? String(item.oauth.redirectPort) : "",
              hasClientSecret: item.oauth?.hasClientSecret ?? false,
            })),
          }
        : { id: crypto.randomUUID(), name: "", url: "", connections: [connection], defaultConnectionId: connection.id },
    );
  };
  const save = async () => {
    if (!draft) return;
    await actions.save({
      id: draft.id,
      name: draft.name,
      url: draft.url,
      defaultConnectionId: draft.defaultConnectionId,
      connections: draft.connections.map(
        ({
          id,
          name,
          token,
          headersText,
          hasCredentials,
          authType,
          clientId,
          clientSecret,
          scope,
          redirectPort,
          hasClientSecret,
        }) => ({
          id,
          name,
          authType,
          ...(authType === "oauth"
            ? {
                oauth: {
                  clientId,
                  scope,
                  redirectPort: redirectPort ? Number(redirectPort) : 0,
                  ...(clientSecret || !hasClientSecret ? { clientSecret } : {}),
                },
              }
            : {}),
          ...(token || !hasCredentials ? { token } : {}),
          ...(headersText.trim() ? { headers: JSON.parse(headersText) } : {}),
        }),
      ),
    });
  };
  const signIn = async (selection: { serverId: string; connectionId: string }, port?: number) => {
    const controller = new AbortController();
    loginAbort.current = controller;
    setSigningIn(true);
    try {
      await actions.signIn(selection, port, controller.signal);
      const tools = await actions.discover(selection);
      setDiscovered((current) => ({ ...current, [selection.connectionId]: tools }));
    } finally {
      setSigningIn(false);
      loginAbort.current = undefined;
    }
  };
  const discover = (server: McpLibraryServer, connectionId = server.defaultConnectionId) =>
    perform(async () => {
      const tools = await actions.discover({ serverId: server.id, connectionId });
      setDiscovered((current) => ({ ...current, [connectionId]: tools }));
    });
  return (
    <>
      <header className="panel-header">
        <span>MCP servers</span>
        <button title="Refresh MCP servers" disabled={busy || disabled} onClick={() => void perform(onRefresh)}>
          <RefreshCw size={14} />
        </button>
        <button title="Add MCP server" disabled={busy || disabled} onClick={() => edit()}>
          <Plus size={14} />
        </button>
      </header>
      <div className="mcp-library">
        <div className="mcp-server">
          <strong>
            <Plug size={14} /> HatoPad editor
          </strong>
          <small>Built in · always available in workflows; selectable in chat.</small>
        </div>
        {servers.map((server) => (
          <section className="mcp-server" key={server.id}>
            <header>
              <strong>{server.name}</strong>
              <button title={`Edit ${server.name}`} disabled={busy || disabled} onClick={() => edit(server)}>
                <Pencil size={13} />
              </button>
              <button
                title={`Delete ${server.name}`}
                disabled={busy || disabled}
                onClick={() => void perform(() => actions.delete(server.id))}
              >
                <Trash2 size={13} />
              </button>
            </header>
            <small className="mcp-url">{server.url}</small>
            <select
              aria-label={`Inspect connection for ${server.name}`}
              defaultValue=""
              disabled={busy || disabled}
              onChange={(event) => {
                if (event.target.value) void discover(server, event.target.value);
              }}
            >
              <option value="">Retrieve available actions…</option>
              {server.connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                  {connection.id === server.defaultConnectionId ? " (default)" : ""}
                </option>
              ))}
            </select>
            {server.connections
              .filter((connection) => connection.authType === "oauth")
              .map((connection) => (
                <div key={`oauth-${connection.id}`} className="mcp-buttons">
                  <small>
                    {connection.name}: {connection.oauth?.connected ? "Connected with OAuth" : "Sign-in required"}
                  </small>
                  <button
                    disabled={busy || disabled}
                    onClick={() =>
                      void perform(() =>
                        signIn({ serverId: server.id, connectionId: connection.id }, connection.oauth?.redirectPort),
                      )
                    }
                  >
                    {connection.oauth?.connected ? "Reconnect" : "Sign in"}
                  </button>
                  {connection.oauth?.connected && (
                    <button
                      disabled={busy || disabled}
                      onClick={() =>
                        void perform(() => actions.disconnect({ serverId: server.id, connectionId: connection.id }))
                      }
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              ))}
            {server.connections.map(
              (connection) =>
                discovered[connection.id] && (
                  <McpActionList key={connection.id} title={connection.name} actions={discovered[connection.id]!} />
                ),
            )}
          </section>
        ))}
        {!servers.length && <p>Add an MCP URL to connect external tools.</p>}
        <button disabled={busy || disabled} onClick={() => edit()}>
          <Plus size={14} /> Add MCP server
        </button>
        {!draft && signingIn && <button onClick={() => loginAbort.current?.abort()}>Cancel sign-in</button>}
        {!draft && error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </div>
      {draft && (
        <div className="dialog-overlay">
          <form
            className="run-config-dialog mcp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="MCP server"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.stopPropagation();
                setDraft(undefined);
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await save();
                setDraft(undefined);
              });
            }}
          >
            <header>
              <h2>MCP server</h2>
              <button type="button" aria-label="Close MCP dialog" disabled={busy} onClick={() => setDraft(undefined)}>
                <X size={16} />
              </button>
            </header>
            <label>
              Name
              <input
                required
                autoFocus
                value={draft.name}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              Server URL
              <input
                required
                type="url"
                placeholder="https://example.com/mcp"
                value={draft.url}
                disabled={busy}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    url: event.target.value,
                    connections: draft.connections.map((item) => ({
                      ...item,
                      token: "",
                      headersText: "{}",
                      hasCredentials: false,
                    })),
                  });
                  setDiscovered({});
                }}
              />
            </label>
            <p>Streamable HTTP and legacy SSE. Choose browser OAuth sign-in or a bearer token for each connection.</p>
            {draft.connections.map((connection) => (
              <fieldset key={connection.id} disabled={busy}>
                <legend>{connection.name}</legend>
                <label>
                  Connection name
                  <input
                    required
                    value={connection.name}
                    maxLength={120}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        connections: draft.connections.map((item) =>
                          item.id === connection.id ? { ...item, name: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Authentication
                  <select
                    aria-label={`Authentication for ${connection.name}`}
                    value={connection.authType}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        connections: draft.connections.map((item) =>
                          item.id === connection.id
                            ? {
                                ...item,
                                authType: event.target.value as "token" | "oauth",
                                token: "",
                                headersText: "{}",
                                hasCredentials: false,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="token">Bearer token / headers</option>
                    <option value="oauth">OAuth (browser sign-in)</option>
                  </select>
                </label>
                {connection.authType === "oauth" ? (
                  <>
                    <label>
                      OAuth client ID
                      <input
                        value={connection.clientId}
                        placeholder="Automatic registration when supported"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            connections: draft.connections.map((item) =>
                              item.id === connection.id ? { ...item, clientId: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      OAuth client secret
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={connection.clientSecret}
                        placeholder={
                          connection.hasClientSecret
                            ? "Saved secret retained unless replaced"
                            : "Optional; required by some registered apps"
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            connections: draft.connections.map((item) =>
                              item.id === connection.id ? { ...item, clientSecret: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Scopes
                      <input
                        value={connection.scope}
                        placeholder="Space-separated; server defaults if blank"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            connections: draft.connections.map((item) =>
                              item.id === connection.id ? { ...item, scope: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Callback port
                      <input
                        type="number"
                        min="1024"
                        max="65535"
                        value={connection.redirectPort}
                        placeholder="Automatic"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            connections: draft.connections.map((item) =>
                              item.id === connection.id ? { ...item, redirectPort: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <small>
                      Register http://127.0.0.1:{connection.redirectPort || "PORT"}/mcp/oauth/callback with your OAuth
                      app. Set a fixed port if it requires an exact callback URL. Servers without automatic registration
                      require a client ID and may require a client secret.
                    </small>
                    <button
                      type="button"
                      onClick={() =>
                        void perform(async () => {
                          await save();
                          await signIn(
                            { serverId: draft.id, connectionId: connection.id },
                            connection.redirectPort ? Number(connection.redirectPort) : undefined,
                          );
                        })
                      }
                    >
                      Save & sign in
                    </button>
                  </>
                ) : (
                  <label>
                    Bearer token
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={connection.token}
                      placeholder={
                        connection.hasCredentials ? "Saved credentials retained unless replaced" : "Optional"
                      }
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          connections: draft.connections.map((item) =>
                            item.id === connection.id ? { ...item, token: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                )}
                <label>
                  Custom headers (JSON)
                  <textarea
                    value={connection.headersText}
                    placeholder={'{"X-API-Key":"…"}'}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        connections: draft.connections.map((item) =>
                          item.id === connection.id ? { ...item, headersText: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="mcp-default">
                  <input
                    type="radio"
                    name="default-connection"
                    checked={draft.defaultConnectionId === connection.id}
                    onChange={() => setDraft({ ...draft, defaultConnectionId: connection.id })}
                  />
                  Default connection
                </label>
                <div className="mcp-buttons">
                  <button
                    type="button"
                    onClick={() =>
                      void perform(async () => {
                        await save();
                        const tools = await actions.discover({ serverId: draft.id, connectionId: connection.id });
                        setDiscovered((current) => ({ ...current, [connection.id]: tools }));
                      })
                    }
                  >
                    Save & retrieve actions
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        connections: draft.connections.map((item) =>
                          item.id === connection.id
                            ? {
                                ...item,
                                token: "",
                                headersText: "{}",
                                hasCredentials: false,
                                clientSecret: "",
                                hasClientSecret: false,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    Clear credentials
                  </button>
                  <button
                    type="button"
                    disabled={draft.connections.length === 1}
                    onClick={() => {
                      const remaining = draft.connections.filter((item) => item.id !== connection.id);
                      setDraft({
                        ...draft,
                        connections: remaining,
                        defaultConnectionId:
                          draft.defaultConnectionId === connection.id ? remaining[0]!.id : draft.defaultConnectionId,
                      });
                    }}
                  >
                    Remove
                  </button>
                </div>
                {discovered[connection.id] && (
                  <McpActionList title="Available actions" actions={discovered[connection.id]!} />
                )}
              </fieldset>
            ))}
            <button
              type="button"
              disabled={busy || draft.connections.length >= 30}
              onClick={() => setDraft({ ...draft, connections: [...draft.connections, newConnection()] })}
            >
              Add connection
            </button>
            {signingIn && (
              <button type="button" onClick={() => loginAbort.current?.abort()}>
                Cancel sign-in
              </button>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <footer>
              <button type="button" disabled={busy} onClick={() => setDraft(undefined)}>
                Cancel
              </button>
              <button type="submit" disabled={busy}>
                {busy ? "Working…" : "Save MCP server"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}

function McpActionList({ title, actions }: { title: string; actions: McpAction[] }) {
  return (
    <details open>
      <summary>
        {title} · {actions.length} actions
      </summary>
      {actions.map((action) => (
        <details key={action.name}>
          <summary>{action.name}</summary>
          <p>{action.description}</p>
          <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
        </details>
      ))}
      {!actions.length && <p>This server exposes no actions.</p>}
    </details>
  );
}
