import { Select } from "./Select";
import { useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
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
  unavailableReason,
}: {
  servers: McpLibraryServer[];
  actions: Actions;
  onRefresh(): Promise<void>;
  disabled?: boolean;
  unavailableReason?: string;
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
  const updateConnection = (connectionId: string, patch: Partial<ConnectionDraft>) =>
    draft &&
    setDraft({
      ...draft,
      connections: draft.connections.map((item) => (item.id === connectionId ? { ...item, ...patch } : item)),
    });
  if (unavailableReason)
    return (
      <div className="mcp-panel">
        <div className="mcp-empty">
          <Server size={22} />
          <p>{unavailableReason}</p>
        </div>
      </div>
    );
  const isNew = draft ? !servers.some((server) => server.id === draft.id) : false;
  return (
    <>
      <header className="panel-header">
        <span>MCP servers</span>
        <div className="panel-header-actions">
          <button title="Refresh MCP servers" disabled={busy || disabled} onClick={() => void perform(onRefresh)}>
            <RefreshCw size={14} className={busy && !draft ? "mcp-spin" : undefined} />
          </button>
          <button title="Add MCP server" disabled={busy || disabled} onClick={() => edit()}>
            <Plus size={14} />
          </button>
        </div>
      </header>
      <div className="mcp-library">
        <div className="mcp-server mcp-server-builtin">
          <header>
            <span className="mcp-server-icon">
              <Plug size={14} />
            </span>
            <div className="mcp-server-title">
              <strong>HatoPad editor</strong>
              <small>Always available in workflows; selectable in chat.</small>
            </div>
            <span className="mcp-badge">Built in</span>
          </header>
        </div>
        {servers.map((server) => (
          <section className="mcp-server" key={server.id}>
            <header>
              <span className="mcp-server-icon">
                <Server size={14} />
              </span>
              <div className="mcp-server-title">
                <strong>{server.name}</strong>
                <small className="mcp-url" title={server.url}>
                  {server.url}
                </small>
              </div>
              <div className="mcp-server-actions">
                <button title={`Edit ${server.name}`} disabled={busy || disabled} onClick={() => edit(server)}>
                  <Pencil size={13} />
                </button>
                <button
                  className="danger"
                  title={`Delete ${server.name}`}
                  disabled={busy || disabled}
                  onClick={() => void perform(() => actions.delete(server.id))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </header>
            <ul className="mcp-connections">
              {server.connections.map((connection) => {
                const oauth = connection.authType === "oauth";
                const status = oauth
                  ? connection.oauth?.connected
                    ? { tone: "ok", label: "Signed in" }
                    : { tone: "warn", label: "Sign-in required" }
                  : connection.hasCredentials
                    ? { tone: "ok", label: "Token saved" }
                    : { tone: "idle", label: "No credentials" };
                return (
                  <li key={connection.id}>
                    <span className={`mcp-status-dot ${status.tone}`} title={status.label} />
                    <div className="mcp-connection-info">
                      <span>
                        {connection.name}
                        {connection.id === server.defaultConnectionId && <em className="mcp-badge">Default</em>}
                      </span>
                      <small>
                        {oauth ? "OAuth" : "Token"} · {status.label}
                      </small>
                    </div>
                    <div className="mcp-connection-actions">
                      {oauth && (
                        <button
                          title={connection.oauth?.connected ? "Reconnect" : "Sign in"}
                          disabled={busy || disabled}
                          onClick={() =>
                            void perform(() =>
                              signIn(
                                { serverId: server.id, connectionId: connection.id },
                                connection.oauth?.redirectPort,
                              ),
                            )
                          }
                        >
                          <LogIn size={13} />
                          {connection.oauth?.connected ? "Reconnect" : "Sign in"}
                        </button>
                      )}
                      {oauth && connection.oauth?.connected && (
                        <button
                          title="Disconnect"
                          disabled={busy || disabled}
                          onClick={() =>
                            void perform(() => actions.disconnect({ serverId: server.id, connectionId: connection.id }))
                          }
                        >
                          <LogOut size={13} />
                        </button>
                      )}
                      <button
                        title={`Retrieve available actions for ${connection.name}`}
                        disabled={busy || disabled}
                        onClick={() => void discover(server, connection.id)}
                      >
                        <Wrench size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {server.connections.map(
              (connection) =>
                discovered[connection.id] && (
                  <McpActionList key={connection.id} title={connection.name} actions={discovered[connection.id]!} />
                ),
            )}
          </section>
        ))}
        {!servers.length && (
          <div className="mcp-empty">
            <Server size={22} />
            <p>Add an MCP URL to connect external tools.</p>
            <button className="primary" disabled={busy || disabled} onClick={() => edit()}>
              <Plus size={14} /> Add MCP server
            </button>
          </div>
        )}
        {!draft && signingIn && (
          <div className="mcp-notice">
            <Loader2 size={13} className="mcp-spin" /> Waiting for browser sign-in…
            <button onClick={() => loginAbort.current?.abort()}>Cancel sign-in</button>
          </div>
        )}
        {!draft && error && (
          <p role="alert" className="mcp-error">
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
              <div>
                <h2>{isNew ? "Add MCP server" : "Edit MCP server"}</h2>
                <span>Streamable HTTP and legacy SSE servers</span>
              </div>
              <button type="button" aria-label="Close MCP dialog" disabled={busy} onClick={() => setDraft(undefined)}>
                <X size={16} />
              </button>
            </header>
            <div className="mcp-dialog-body">
              <section className="mcp-dialog-section">
                <label>
                  Name
                  <input
                    required
                    autoFocus
                    value={draft.name}
                    maxLength={120}
                    placeholder="GitHub"
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
              </section>
              <div className="mcp-section-heading">
                <div>
                  <h3>Connections</h3>
                  <small>Each connection has its own credentials. Chats and workflows use the default.</small>
                </div>
                <button
                  type="button"
                  disabled={busy || draft.connections.length >= 30}
                  onClick={() => setDraft({ ...draft, connections: [...draft.connections, newConnection()] })}
                >
                  <Plus size={13} /> Add connection
                </button>
              </div>
              {draft.connections.map((connection) => (
                <fieldset key={connection.id} disabled={busy} className="mcp-connection-card">
                  <legend className="visually-hidden">{connection.name}</legend>
                  <div className="mcp-connection-card-header">
                    <span className="mcp-server-icon">
                      {connection.authType === "oauth" ? <ShieldCheck size={13} /> : <KeyRound size={13} />}
                    </span>
                    <strong>{connection.name || "Untitled connection"}</strong>
                    <label className="mcp-default">
                      <input
                        type="radio"
                        name="default-connection"
                        checked={draft.defaultConnectionId === connection.id}
                        onChange={() => setDraft({ ...draft, defaultConnectionId: connection.id })}
                      />
                      Default
                    </label>
                    <button
                      type="button"
                      className="mcp-icon-button danger"
                      title="Remove connection"
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
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mcp-field-grid">
                    <label>
                      Connection name
                      <input
                        required
                        value={connection.name}
                        maxLength={120}
                        onChange={(event) => updateConnection(connection.id, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      Authentication
                      <Select
                        aria-label={`Authentication for ${connection.name}`}
                        value={connection.authType}
                        onValueChange={(selectedValue) =>
                          updateConnection(connection.id, {
                            authType: selectedValue as "token" | "oauth",
                            token: "",
                            headersText: "{}",
                            hasCredentials: false,
                          })
                        }
                      >
                        <option value="token">Bearer token / headers</option>
                        <option value="oauth">OAuth (browser sign-in)</option>
                      </Select>
                    </label>
                  </div>
                  {connection.authType === "oauth" ? (
                    <>
                      <div className="mcp-field-grid">
                        <label>
                          OAuth client ID
                          <input
                            value={connection.clientId}
                            placeholder="Automatic registration"
                            onChange={(event) => updateConnection(connection.id, { clientId: event.target.value })}
                          />
                        </label>
                        <label>
                          OAuth client secret
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={connection.clientSecret}
                            placeholder={connection.hasClientSecret ? "Saved secret retained" : "Optional"}
                            onChange={(event) => updateConnection(connection.id, { clientSecret: event.target.value })}
                          />
                        </label>
                        <label>
                          Scopes
                          <input
                            value={connection.scope}
                            placeholder="Server defaults if blank"
                            onChange={(event) => updateConnection(connection.id, { scope: event.target.value })}
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
                            onChange={(event) => updateConnection(connection.id, { redirectPort: event.target.value })}
                          />
                        </label>
                      </div>
                      <small className="mcp-hint">
                        Register <code>http://127.0.0.1:{connection.redirectPort || "PORT"}/mcp/oauth/callback</code>{" "}
                        with your OAuth app and set a fixed port if it requires an exact callback URL. Servers without
                        automatic registration require a client ID and may require a client secret.
                      </small>
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
                        onChange={(event) => updateConnection(connection.id, { token: event.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    Custom headers (JSON)
                    <textarea
                      value={connection.headersText}
                      placeholder={'{"X-API-Key":"…"}'}
                      spellCheck={false}
                      onChange={(event) => updateConnection(connection.id, { headersText: event.target.value })}
                    />
                  </label>
                  <div className="mcp-buttons">
                    {connection.authType === "oauth" && (
                      <button
                        type="button"
                        className="primary"
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
                    )}
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
                        updateConnection(connection.id, {
                          token: "",
                          headersText: "{}",
                          hasCredentials: false,
                          clientSecret: "",
                          hasClientSecret: false,
                        })
                      }
                    >
                      Clear credentials
                    </button>
                  </div>
                  {discovered[connection.id] && (
                    <McpActionList title="Available actions" actions={discovered[connection.id]!} />
                  )}
                </fieldset>
              ))}
              {signingIn && (
                <div className="mcp-notice">
                  <Loader2 size={13} className="mcp-spin" /> Waiting for browser sign-in…
                  <button type="button" onClick={() => loginAbort.current?.abort()}>
                    Cancel sign-in
                  </button>
                </div>
              )}
              {error && (
                <p role="alert" className="mcp-error">
                  {error}
                </p>
              )}
            </div>
            <footer>
              <button type="button" disabled={busy} onClick={() => setDraft(undefined)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
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
    <details open className="mcp-actions">
      <summary>
        {title} · {actions.length} actions
      </summary>
      {actions.map((action) => (
        <details key={action.name}>
          <summary>{action.name}</summary>
          {action.description && <p>{action.description}</p>}
          <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
        </details>
      ))}
      {!actions.length && <p>This server exposes no actions.</p>}
    </details>
  );
}
