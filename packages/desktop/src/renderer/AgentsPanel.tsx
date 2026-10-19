import { Bot, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { AgentFile, AgentFileScope } from "@hatopad/protocol";
import { type EditorTab } from "./model";

export function agentKey(agent: Pick<AgentFile, "scope" | "name">): string { return `${agent.scope}:${agent.name}`; }

export function AgentsPanel({ agents, activeTab, onRefresh, onOpen, onCreate, onRename, onDelete }: { agents: AgentFile[]; activeTab?: EditorTab; onRefresh(): void; onOpen(file: AgentFile): void; onCreate(scope: "global" | "local"): void; onRename(file: AgentFile): void; onDelete(file: AgentFile): void }) {
  return <><header className="panel-header"><span>Agents</span><button title="Refresh agents" onClick={onRefresh}><RefreshCw size={14} /></button></header><div className="useful-files-list"><AgentSection title="Global" scope="global" {...{ agents, activeTab, onOpen, onCreate, onRename, onDelete }} /><AgentSection title="Local" scope="local" {...{ agents, activeTab, onOpen, onCreate, onRename, onDelete }} /><AgentSection title="Workspace (.agents)" scope="workspace" {...{ agents, activeTab, onOpen, onCreate, onRename, onDelete }} /></div></>;
}

export function AgentPicker({ agents, value, disabled, onChange }: { agents: AgentFile[]; value: string; disabled: boolean; onChange(value: string): void }) {
  return <select className="ai-agent-picker" aria-label="AI agent" title="Agent preset" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">No agent</option>{(["global", "local", "workspace"] as const).map((scope) => { const scoped = agents.filter((agent) => agent.scope === scope); return scoped.length ? <optgroup key={scope} label={scope === "workspace" ? "Workspace" : scope[0]!.toUpperCase() + scope.slice(1)}>{scoped.map((agent) => <option key={agentKey(agent)} value={agentKey(agent)}>{agent.agent.name}</option>)}</optgroup> : null; })}</select>;
}

export function AgentSection({ title, scope, agents, activeTab, onOpen, onCreate, onRename, onDelete }: { title: string; scope: AgentFileScope; agents: AgentFile[]; activeTab?: EditorTab; onOpen(file: AgentFile): void; onCreate(scope: "global" | "local"): void; onRename(file: AgentFile): void; onDelete(file: AgentFile): void }) {
  const scoped = agents.filter((agent) => agent.scope === scope);
  return <section className="useful-section"><header><span>{title}</span>{scope !== "workspace" && <button title={`Create ${title} agent`} onClick={() => onCreate(scope)}><Plus size={14} /></button>}</header>
    {scoped.length === 0 ? <div className="useful-empty">No agents</div> : scoped.map((file) => <div key={file.name} className={`useful-row ${activeTab?.type === "agent" && activeTab.agentScope === scope && activeTab.path === file.name || activeTab?.type === "file" && scope === "workspace" && activeTab.path === `.agents/${file.name}` ? "selected" : ""}`}><button className="useful-open" title={file.agent.description ?? file.agent.name} onClick={() => onOpen(file)}><Bot className="agent-kind-icon" size={14} /><span>{file.agent.name}</span></button>{scope !== "workspace" && <><button title={`Rename ${file.name}`} onClick={() => onRename(file)}><Pencil size={12} /></button><button title={`Delete ${file.name}`} onClick={() => onDelete(file)}><Trash2 size={12} /></button></>}</div>)}
  </section>;
}

export function AgentDialog({ mode, initialName, scope, onClose, onSave }: { mode: "create" | "rename"; initialName: string; scope: "global" | "local"; onClose(): void; onSave(name: string): Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => { if (!name.trim() || saving) return; setSaving(true); setError(""); try { await onSave(name.trim()); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save agent"); setSaving(false); } };
  return <div className="dialog-overlay" onMouseDown={() => { if (!saving) onClose(); }}><section className="run-config-dialog useful-file-dialog" role="dialog" aria-modal="true" aria-label={`${mode} agent`} onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{mode === "create" ? "Create" : "Rename"} Agent</h2><span>{scope === "global" ? "Global" : "Local"}</span></div><button title="Close" disabled={saving} onClick={onClose}><X size={15} /></button></header><form onSubmit={(event) => { event.preventDefault(); void save(); }}><label>File name<input autoFocus value={name} disabled={saving} maxLength={180} placeholder="reviewer.md" onChange={(event) => setName(event.target.value)} /></label>{mode === "create" && <small>A Markdown agent template will be created.</small>}{error && <div className="find-error">{error}</div>}<footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving || !name.trim()}>{saving ? "Saving..." : mode === "create" ? "Create" : "Rename"}</button></footer></form></section></div>;
}
