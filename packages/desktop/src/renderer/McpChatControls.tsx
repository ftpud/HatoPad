import { useState } from "react";
import type { McpLibraryServer, McpSelection } from "@hatopad/protocol";

export function McpChatControls({
  servers,
  selected,
  editorEnabled,
  disabled,
  onChange,
  onOpen,
}: {
  servers: McpLibraryServer[];
  selected: McpSelection[];
  editorEnabled: boolean;
  disabled?: boolean;
  onChange(selections: McpSelection[], editorEnabled: boolean): Promise<void>;
  onOpen(): void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = async (selections: McpSelection[], editor = editorEnabled) => {
    setSaving(true);
    setError("");
    try {
      await onChange(selections, editor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update MCPs");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="skill-chat-controls"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className={`skill-chat-trigger${open ? " active" : ""}`}
        aria-label="Chat MCP servers"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        MCP <span className="skill-count">{selected.length + Number(editorEnabled)}</span>
      </button>
      {open && (
        <div className="skill-chat-picker mcp-chat-picker">
          <label>
            <input
              type="checkbox"
              aria-label="Enable HatoPad editor MCP"
              checked={editorEnabled}
              disabled={saving || disabled}
              onChange={(event) => void update(selected, event.target.checked)}
            />
            HatoPad editor
          </label>
          {servers.map((server) => {
            const selection = selected.find((item) => item.serverId === server.id);
            return (
              <div key={server.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Enable ${server.name} MCP`}
                    checked={!!selection}
                    disabled={saving || disabled}
                    onChange={(event) =>
                      void update(
                        event.target.checked
                          ? [...selected, { serverId: server.id }]
                          : selected.filter((item) => item.serverId !== server.id),
                      )
                    }
                  />
                  {server.name}
                </label>
                <select
                  aria-label={`${server.name} connection`}
                  value={selection?.connectionId ?? ""}
                  disabled={!selection || saving || disabled}
                  onChange={(event) =>
                    void update(
                      selected.map((item) =>
                        item.serverId === server.id
                          ? { serverId: server.id, ...(event.target.value ? { connectionId: event.target.value } : {}) }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="">
                    Default · {server.connections.find((item) => item.id === server.defaultConnectionId)?.name}
                  </option>
                  {server.connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          {selected
            .filter((selection) => !servers.some((server) => server.id === selection.serverId))
            .map((selection) => (
              <button
                type="button"
                key={selection.serverId}
                disabled={saving || disabled}
                onClick={() => void update(selected.filter((item) => item.serverId !== selection.serverId))}
              >
                Remove unavailable MCP
              </button>
            ))}
          <small>Changes apply next turn. Credentials and connection permissions determine access.</small>
          {error && (
            <span role="alert" className="inline-error">
              {error}
            </span>
          )}
          <button type="button" onClick={onOpen}>
            Manage MCP servers
          </button>
        </div>
      )}
    </div>
  );
}
