import { Folder } from "lucide-react";
import type { WorkspaceRoot } from "@hatopad/protocol";
import { Select } from "./Select";

export function WorkspacePicker({
  roots,
  value,
  disabled,
  projectName,
  onChange,
}: {
  roots: WorkspaceRoot[];
  value: string;
  disabled?: boolean;
  projectName?: string;
  onChange(rootId: string): void;
}) {
  const selected = roots.find((root) => root.id === value);
  const titlebar = projectName !== undefined;
  return (
    <Select
      value={value}
      onValueChange={onChange}
      className={titlebar ? "workspace-identity workspace-picker-title" : "workspace-picker-trigger"}
      title={selected?.path}
      aria-label={titlebar ? "Switch workspace" : "Workspace root"}
      searchable
      disabled={disabled}
      hideChevron={titlebar}
      triggerContent={
        <>
          {titlebar ? <span className="branding-mark titlebar-branding" aria-hidden="true" /> : <Folder size={13} />}
          <span>{projectName ?? selected?.alias ?? "Select workspace"}</span>
        </>
      }
    >
      {roots.map((root) => (
        <option key={root.id} value={root.id} title={root.path}>
          {root.alias}
        </option>
      ))}
    </Select>
  );
}
