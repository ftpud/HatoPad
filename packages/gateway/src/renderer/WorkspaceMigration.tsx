import { useState } from "react";
import { ArrowRight, Check, FolderInput, FolderOpen, LoaderCircle, MoveRight } from "lucide-react";
import { gatewayErrorMessage } from "./App";

type Preview = Awaited<ReturnType<Window["gateway"]["previewWorkspaceMigration"]>>;
export function WorkspaceMigration({
  workspace,
  local,
  disabled = false,
  onBusy,
  onMigrate,
}: {
  workspace: GatewayWorkspace;
  local: boolean;
  disabled?: boolean;
  onBusy(busy: boolean): void;
  onMigrate(destination: string): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(Boolean(workspace.migrationDestination));
  const [destination, setDestination] = useState(workspace.migrationDestination ?? "");
  const [preview, setPreview] = useState<Preview>();
  const [phase, setPhase] = useState<"idle" | "checking" | "moving" | "done">("idle");
  const [failure, setFailure] = useState("");
  const busy = phase === "checking" || phase === "moving";
  const changeDestination = (value: string) => {
    setDestination(value);
    setPreview(undefined);
    setFailure("");
  };
  const check = async () => {
    setPhase("checking");
    setFailure("");
    onBusy(true);
    try {
      setPreview(await window.gateway.previewWorkspaceMigration(workspace.id, destination.trim()));
    } catch (error) {
      setFailure(gatewayErrorMessage(error));
    } finally {
      setPhase("idle");
      onBusy(false);
    }
  };
  const move = async () => {
    if (!preview) return;
    setPhase("moving");
    setFailure("");
    onBusy(true);
    try {
      await onMigrate(preview.destination);
      setPhase("done");
    } catch (error) {
      setFailure(gatewayErrorMessage(error));
      setPhase("idle");
      setPreview(undefined);
    } finally {
      onBusy(false);
    }
  };
  const browse = async () => {
    try {
      const parent = await window.gateway.pickWorkspaceDirectory();
      if (parent)
        changeDestination(
          parent.replace(/[\\/]$/, "") + "/" + workspace.directory.split(/[\\/]/).filter(Boolean).at(-1),
        );
    } catch (error) {
      setFailure(gatewayErrorMessage(error));
    }
  };
  return (
    <section className={`workspace-migration ${expanded ? "is-expanded" : ""}`} aria-label="Project migration">
      <div className="migration-heading">
        <span className="migration-icon">
          <FolderInput size={19} />
        </span>
        <div>
          <strong>Migrate project</strong>
          <p>Bring your project and HatoPad data to a new home.</p>
        </div>
        {!expanded && (
          <button type="button" disabled={disabled} onClick={() => setExpanded(true)}>
            Migrate… <ArrowRight size={13} />
          </button>
        )}
      </div>
      {disabled && <p className="migration-hint migration-save-hint">Save your workspace settings before migrating.</p>}
      {expanded && phase !== "done" && (
        <div className="migration-content">
          {workspace.migrationDestination && (
            <p className="migration-hint">
              A previous migration is pending. Review this destination to recover its status and finish updating
              Gateway.
            </p>
          )}
          <div className="migration-location">
            <span>Current directory</span>
            <code>{workspace.directory}</code>
          </div>
          <label>
            Destination directory
            <div className="file-picker">
              <input
                value={destination}
                disabled={busy || disabled}
                onChange={(event) => changeDestination(event.target.value)}
                placeholder={local ? "/Users/me/Projects/new-name" : "/home/user/projects/new-name"}
                autoComplete="off"
                spellCheck={false}
              />
              {local && (
                <button
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => void browse()}
                  title="Choose destination parent folder"
                  aria-label="Choose destination parent folder"
                >
                  <FolderOpen size={16} />
                </button>
              )}
            </div>
          </label>
          <p className="migration-hint">
            Use a new folder name inside an existing parent directory on this {local ? "computer" : "SSH server"}. The
            destination must not exist and must be on the same filesystem.
          </p>
          {preview && (
            <div className="migration-review">
              <div className="migration-route">
                <MoveRight size={17} />
                <code>{preview.destination}</code>
              </div>
              <div className="migration-preserved">
                <Check size={14} />
                <span>Project files, Git history and HatoPad settings</span>
              </div>
              <div className="migration-preserved">
                <Check size={14} />
                <span>
                  {preview.taskWorkspaces} task {preview.taskWorkspaces === 1 ? "workspace" : "workspaces"} and their
                  saved conversations
                </span>
              </div>
              <p>
                Core will stop for the move. Save your editor changes and finish running work first. Start Core again
                when migration completes.
              </p>
              <p>Commands and external tools with hardcoded paths may need updating.</p>
            </div>
          )}
          {failure && (
            <p className="migration-error" role="alert">
              {failure}
            </p>
          )}
          <div className="migration-actions">
            <span role="status" aria-live="polite">
              {busy && (
                <>
                  <LoaderCircle size={14} className="migration-spinner" />
                  {phase === "checking" ? "Checking destination…" : "Moving project and saved state…"}
                </>
              )}
            </span>
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => {
                setExpanded(false);
                setPreview(undefined);
                setFailure("");
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || disabled || !destination.trim() || destination.trim() === workspace.directory}
              onClick={() => void (preview ? move() : check())}
            >
              {phase === "moving"
                ? "Migrating…"
                : phase === "checking"
                  ? "Checking…"
                  : preview
                    ? "Migrate project"
                    : "Review migration"}
            </button>
          </div>
        </div>
      )}
      {phase === "done" && (
        <div className="migration-success" role="status">
          <Check size={17} />
          <div>
            <strong>Project moved successfully</strong>
            <p>Your files and HatoPad data are ready. Start Core to reopen the project.</p>
          </div>
        </div>
      )}
    </section>
  );
}
