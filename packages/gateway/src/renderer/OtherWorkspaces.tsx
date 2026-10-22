import { useCallback, useEffect, useRef, useState } from "react";
import { FolderTree, LoaderCircle, MoveRight, PlugZap, RefreshCw, X } from "lucide-react";
import { gatewayErrorMessage, useDialogKeyboard } from "./App";
import { WorkspaceMigration } from "./WorkspaceMigration";

export function OtherWorkspaces({
  owner,
  local,
  disabled,
  onMigrated,
}: {
  owner: GatewayWorkspace;
  local: boolean;
  disabled: boolean;
  onMigrated(state: GatewayState): void;
}) {
  const [roots, setRoots] = useState<GatewayCloudRoot[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState<string>();
  const [selected, setSelected] = useState<GatewayCloudRoot>();
  const available = Boolean(window.gateway.listWorkspaceRoots);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    setLoading(true);
    setFailure("");
    void window.gateway
      .listWorkspaceRoots(owner.id)
      .then((value) => {
        if (!disposed) setRoots(value.filter((root) => !root.primary));
      })
      .catch((error) => {
        if (!disposed) setFailure(gatewayErrorMessage(error));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [available, owner.id, owner.directory, revision]);
  const open = async (root: GatewayCloudRoot) => {
    setOpening(root.id);
    setFailure("");
    try {
      await window.gateway.openWorkspaceRoot(owner.id, root.id);
    } catch (error) {
      setFailure(gatewayErrorMessage(error));
    } finally {
      setOpening(undefined);
    }
  };
  if (!available) return null;
  const pendingSource = owner.migrationSource !== owner.directory ? owner.migrationSource : undefined;
  const visible = [...roots];
  if (pendingSource && !visible.some((root) => root.path === pendingSource)) {
    visible.unshift({
      id: "pending-migration",
      alias: pendingSource.split(/[\\/]/).filter(Boolean).at(-1) ?? "Pending workspace",
      path: pendingSource,
      primary: false,
    });
  }
  if (!visible.length && !loading && !failure) return null;
  return (
    <section className="other-workspaces" aria-label={`Other workspaces in ${owner.name}`}>
      <header>
        <span>
          <FolderTree size={14} />
          Other workspaces{visible.length > 0 && <small>{visible.length}</small>}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Refresh registered workspaces"
          aria-label={`Refresh other workspaces in ${owner.name}`}
          disabled={loading || disabled}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={12} />
        </button>
      </header>
      {loading && (
        <p className="other-workspaces-note" role="status">
          <LoaderCircle size={12} className="migration-spinner" />
          Checking registered folders…
        </p>
      )}
      {failure && (
        <p className="other-workspaces-note" role="status">
          {failure}
        </p>
      )}
      {visible.map((root) => (
        <div className="other-workspace-row" key={root.id}>
          <div>
            <strong>{root.alias}</strong>
            <code>{root.path}</code>
          </div>
          <button
            type="button"
            disabled={disabled || Boolean(opening) || root.id === "pending-migration"}
            aria-label={`Open workspace ${root.alias}`}
            title={`Open ${root.alias} in its Core`}
            onClick={() => void open(root)}
          >
            {opening === root.id ? <LoaderCircle size={14} className="migration-spinner" /> : <PlugZap size={14} />}
            <span>Open</span>
          </button>
          <button
            type="button"
            disabled={disabled || Boolean(opening)}
            aria-label={`Migrate workspace ${root.alias}`}
            title={`Migrate ${root.alias}`}
            onClick={() => setSelected(root)}
          >
            <MoveRight size={14} />
            <span>Migrate</span>
          </button>
        </div>
      ))}
      {selected && (
        <RegisteredWorkspaceMigration
          key={selected.id}
          owner={owner}
          root={selected}
          local={local}
          onClose={() => setSelected(undefined)}
          onMigrate={async (destination) => {
            const state = await window.gateway.migrateWorkspace(owner.id, destination, selected.path);
            onMigrated(state);
            setSelected({ ...selected, path: destination });
            setRevision((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}

function RegisteredWorkspaceMigration({
  owner,
  root,
  local,
  onClose,
  onMigrate,
}: {
  owner: GatewayWorkspace;
  root: GatewayCloudRoot;
  local: boolean;
  onClose(): void;
  onMigrate(destination: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  locked.current = busy;
  const close = useCallback(() => {
    if (!locked.current) onClose();
  }, [onClose]);
  useDialogKeyboard(close, `Migrate workspace ${root.alias}`);
  const workspace = {
    ...owner,
    name: root.alias,
    directory: root.path,
    migrationDestination: owner.migrationSource === root.path ? owner.migrationDestination : undefined,
  };
  return (
    <div className="dialog-layer">
      <section className="dialog">
        <header>
          <strong>Migrate {root.alias}</strong>
          <button type="button" disabled={busy} onClick={close} aria-label="Close workspace migration">
            <X size={15} />
          </button>
        </header>
        <p className="dialog-help">
          This folder belongs to {owner.name}. Its Core will stop during the move, and its workspace list will be
          updated automatically.
        </p>
        <WorkspaceMigration
          workspace={workspace}
          local={local}
          sourceDirectory={root.path}
          expandedByDefault
          onBusy={setBusy}
          onMigrate={onMigrate}
        />
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
