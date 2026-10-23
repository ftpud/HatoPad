import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, FolderOpen, FolderTree, LoaderCircle, MoveRight, RefreshCw, X } from "lucide-react";
import { gatewayErrorMessage, useDialogKeyboard } from "./App";
import { WorkspaceMigration } from "./WorkspaceMigration";

// Last known folders per workspace, so cards render at their final height instead of growing after each lookup.
const rootCacheKey = "gateway.workspaceRoots";
const rootCache = new Map<string, GatewayCloudRoot[]>(readRootCache());
function readRootCache(): [string, GatewayCloudRoot[]][] {
  try {
    return Object.entries(JSON.parse(localStorage.getItem(rootCacheKey) ?? "{}"));
  } catch {
    return [];
  }
}
function cacheRoots(key: string, roots: GatewayCloudRoot[]) {
  rootCache.set(key, roots);
  try {
    localStorage.setItem(rootCacheKey, JSON.stringify(Object.fromEntries(rootCache)));
  } catch {
    // Persistence is a convenience; the in-memory cache still prevents jumps this session.
  }
}

function useWorkspaceRoots(owner: GatewayWorkspace) {
  const cacheKey = `${owner.id}:${owner.directory}`;
  const [roots, setRoots] = useState<GatewayCloudRoot[]>(() => rootCache.get(cacheKey) ?? []);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [revision, setRevision] = useState(0);
  const available = Boolean(window.gateway.listWorkspaceRoots);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    setRoots(rootCache.get(cacheKey) ?? []);
    setLoading(true);
    setFailure("");
    void window.gateway
      .listWorkspaceRoots(owner.id)
      .then((value) => {
        if (disposed) return;
        cacheRoots(cacheKey, value);
        setRoots(value);
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
  }, [available, cacheKey, owner.id, revision]);
  return { available, roots: available ? roots : [], loading, failure, refresh };
}

function directoryName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Every folder a workspace's Core serves, primary first, each opened the same way. */
export function CoreWorkspaceList({
  owner,
  disabled,
  onOpen,
}: {
  owner: GatewayWorkspace;
  disabled: boolean;
  onOpen(rootId: string | undefined): Promise<void>;
}) {
  const { roots } = useWorkspaceRoots(owner);
  const [opening, setOpening] = useState<string>();
  const primary = roots.find((root) => root.primary) ?? {
    id: "primary",
    alias: directoryName(owner.directory),
    path: owner.directory,
    primary: true,
  };
  const entries = [primary, ...roots.filter((root) => !root.primary)];
  const open = async (root: GatewayCloudRoot) => {
    setOpening(root.id);
    try {
      await onOpen(root.primary ? undefined : root.id);
    } finally {
      setOpening(undefined);
    }
  };
  return (
    <ul className="core-workspaces" aria-label={`Workspaces in ${owner.name}`}>
      {entries.map((root) => (
        <li key={root.id}>
          <FolderOpen size={14} aria-hidden="true" />
          <div>
            <strong>{root.alias}</strong>
            <code title={root.path}>{root.path}</code>
          </div>
          <button
            type="button"
            disabled={disabled || Boolean(opening)}
            aria-label={`Open workspace ${root.alias}`}
            title={`Open ${root.path}`}
            onClick={() => void open(root)}
          >
            {opening === root.id ? (
              <LoaderCircle size={14} className="migration-spinner" />
            ) : (
              <ArrowUpRight size={14} aria-hidden="true" />
            )}
            Open
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Migration of the other folders registered in a workspace's Core; lives in workspace options. */
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
  const { available, roots, loading, failure, refresh } = useWorkspaceRoots(owner);
  const [selected, setSelected] = useState<GatewayCloudRoot>();
  if (!available) return null;
  const pendingSource = owner.migrationSource !== owner.directory ? owner.migrationSource : undefined;
  const visible = roots.filter((root) => !root.primary);
  if (pendingSource && !visible.some((root) => root.path === pendingSource)) {
    visible.unshift({
      id: "pending-migration",
      alias: directoryName(pendingSource) || "Pending workspace",
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
          Other workspaces in this Core{visible.length > 0 && <small>{visible.length}</small>}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Refresh registered workspaces"
          aria-label={`Refresh other workspaces in ${owner.name}`}
          disabled={loading || disabled}
          onClick={refresh}
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
            disabled={disabled}
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
            refresh();
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
