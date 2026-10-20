import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RunConfig, UsefulFile, UsefulFileScope } from "@hatopad/protocol";
import { type EditorTab } from "./model";
import { FileKindIcon } from "./FileKindIcon";

export function UsefulFileSection({
  title,
  scope,
  files,
  activeTab,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  title: string;
  scope: UsefulFileScope;
  files: UsefulFile[];
  activeTab?: EditorTab;
  onOpen(file: UsefulFile): void;
  onCreate(scope: UsefulFileScope): void;
  onRename(file: UsefulFile): void;
  onDelete(file: UsefulFile): void;
}) {
  const scoped = files.filter((file) => file.scope === scope);
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  useEffect(() => {
    const listener = (event: Event) => setConfigs((event as CustomEvent<RunConfig[]>).detail);
    window.addEventListener("hatopad:run-configs", listener);
    window.dispatchEvent(new Event("hatopad:request-run-configs"));
    return () => window.removeEventListener("hatopad:run-configs", listener);
  }, []);
  return (
    <section className="useful-section">
      <header>
        <span>{title}</span>
        <button title={`Create ${title} file`} onClick={() => onCreate(scope)}>
          <Plus size={14} />
        </button>
        <button
          title={`Create ${title} Run Config`}
          onClick={() => window.dispatchEvent(new CustomEvent("hatopad:create-run-config", { detail: scope }))}
        >
          <Play size={13} />
          <Plus size={9} />
        </button>
      </header>
      {scoped.length === 0 ? (
        <div className="useful-empty">No files</div>
      ) : (
        scoped.map((file) => (
          <div
            key={file.name}
            className={`useful-row ${activeTab?.type === "useful" && activeTab.usefulScope === scope && activeTab.path === file.name ? "selected" : ""}`}
          >
            <button className="useful-open" title={file.name} onClick={() => void onOpen(file)}>
              <FileKindIcon name={file.name} />
              <span>{file.name}</span>
            </button>
            <button title={`Rename ${file.name}`} onClick={() => onRename(file)}>
              <Pencil size={12} />
            </button>
            <button title={`Delete ${file.name}`} onClick={() => onDelete(file)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))
      )}
      {configs
        .filter((config) => config.scope === scope)
        .map((config) => (
          <div
            key={`run:${config.name}`}
            className={`useful-row run-config-useful-row ${activeTab?.type === "runConfig" && activeTab.runConfigScope === scope && activeTab.path === config.name ? "selected" : ""}`}
          >
            <button
              className="useful-open"
              title={`${config.name} (${config.status})`}
              onClick={() => window.dispatchEvent(new CustomEvent("hatopad:open-run-config", { detail: config }))}
            >
              <Play className={`run-config-icon ${config.status}`} size={14} />
              <span>{config.name}</span>
            </button>
            <button
              title={`Rename ${config.name}`}
              onClick={() => window.dispatchEvent(new CustomEvent("hatopad:rename-run-config", { detail: config }))}
            >
              <Pencil size={12} />
            </button>
            <button
              title={`Delete ${config.name}`}
              onClick={() => window.dispatchEvent(new CustomEvent("hatopad:delete-run-config", { detail: config }))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
    </section>
  );
}

export function UsefulFileDialog({
  mode,
  initialName,
  scope,
  onClose,
  onSave,
}: {
  mode: "create" | "rename";
  initialName: string;
  scope: UsefulFileScope;
  onClose(): void;
  onSave(name: string): Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save useful file");
      setSaving(false);
    }
  };
  return (
    <div
      className="dialog-overlay"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <section
        className="run-config-dialog useful-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${mode} useful file`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{mode === "create" ? "Create" : "Rename"} Useful File</h2>
            <span>{scope === "global" ? "Global" : "Local"}</span>
          </div>
          <button title="Close" disabled={saving} onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            File name
            <input
              autoFocus
              value={name}
              disabled={saving}
              maxLength={180}
              placeholder="notes.md"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error && <div className="find-error">{error}</div>}
          <footer>
            <button type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={saving || !name.trim()}>
              {saving ? "Saving..." : mode === "create" ? "Create" : "Rename"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
