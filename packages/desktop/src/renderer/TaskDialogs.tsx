import { GitBranch, GitCompareArrows, GitMerge, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GitBranch as GitBranchInfo, WorkspaceTask } from "@hatopad/protocol";
import { CoreClient } from "./client";

export function MergeTaskDialog({ task, onClose, onMerge }: { task: WorkspaceTask; onClose(): void; onMerge(strategy: "merge" | "smart"): void }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  return <div className="dialog-overlay" onMouseDown={onClose}>
    <section className="run-config-dialog merge-task-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-task-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id="merge-task-title">Merge task to main workspace</h2><span>{task.name}</span></div><button title="Close" onClick={onClose}><X size={15} /></button></header>
      <div className="merge-task-content">
        <div className="merge-task-intro"><GitMerge size={22} /><div><strong>Ready to integrate this task?</strong><span>All task changes will be committed first.</span></div></div>
        <div className="merge-task-options">
          <button onClick={() => onMerge("merge")}><span className="merge-option-icon"><GitMerge size={17} /></span><span><strong>Commit and merge</strong><small>Commit the task, then merge it normally. Main must have no uncommitted changes.</small></span></button>
          <button className="recommended" autoFocus onClick={() => onMerge("smart")}><span className="merge-option-icon"><GitCompareArrows size={17} /></span><span><strong>Smart merge <em>Recommended</em></strong><small>Preserve local main changes, rebase the task onto main, then restore your work.</small></span></button>
        </div>
        <footer><button onClick={onClose}>Cancel</button></footer>
      </div>
    </section>
  </div>;
}

export function CreateTaskDialog({ client, onClose, onCreate }: { client: CoreClient; onClose(): void; onCreate(branch: string, existing?: { remote: boolean }): Promise<void> }) {
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [selected, setSelected] = useState<GitBranchInfo>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [onClose, saving]);
  useEffect(() => {
    let current = true;
    void client.request("git.branches", {}).then((result) => { if (current) setBranches(result.branches); }).catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : "Could not load branches"); });
    return () => { current = false; };
  }, [client]);
  const suggestions = useMemo(() => {
    const query = branch.trim().toLowerCase();
    return branches.filter((item) => !item.current && (!query || item.name.toLowerCase().includes(query))).slice(0, 8);
  }, [branch, branches]);
  const create = async () => {
    if (!branch.trim() || saving) return;
    setSaving(true); setError("");
    try { await onCreate(branch.trim(), selected ? { remote: selected.remote } : undefined); onClose(); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create task"); setSaving(false); }
  };
  return <div className="dialog-overlay" onMouseDown={() => { if (!saving) onClose(); }}>
    <section className="run-config-dialog task-create-dialog" role="dialog" aria-modal="true" aria-label="Create task" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2>Create Task</h2><span>A separate workspace copy will be created for this branch.</span></div><button title="Close" disabled={saving} onClick={onClose}><X size={15} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label>Branch name<input autoFocus value={branch} disabled={saving} onChange={(event) => { setBranch(event.target.value); setSelected(undefined); }} maxLength={200} placeholder="feature/my-task" /></label>
        {suggestions.length > 0 && <div className="task-branch-help" role="listbox" aria-label="Existing branches">{suggestions.map((item) => <button type="button" role="option" aria-selected={selected?.name === item.name} className={selected?.name === item.name ? "selected" : ""} key={`${item.remote ? "remote" : "local"}:${item.name}`} onClick={() => { setBranch(item.name); setSelected(item); }}><GitBranch size={13} /><span>{item.name}</span><small>{item.remote ? "remote" : "existing"}</small></button>)}</div>}
        <div className="task-branch-mode">{selected ? <>Use existing {selected.remote ? "remote " : ""}branch <strong>{selected.name}</strong></> : <>Create new branch <strong>{branch.trim() || "..."}</strong></>}</div>
        {error && <div className="find-error">{error}</div>}
        <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving || !branch.trim()}>{saving ? "Creating..." : "Create"}</button></footer>
      </form>
    </section>
  </div>;
}
