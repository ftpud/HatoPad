import { Select } from "../Select";
import {
  CopyPlus,
  SquareStack,
  ClipboardPaste,
  Copy,
  Download,
  Redo2,
  Save,
  Settings2,
  Undo2,
  Upload,
} from "lucide-react";
import type { HarnessBlock } from "@hatopad/protocol";
import { downloadWorkflowDefinition } from "./definition";
import { flowBlockTypes, blockTypeLabels } from "./block-catalog";
import type { HarnessViewContext } from "./view-types";

export function HarnessToolbar({ context }: { context: HarnessViewContext }) {
  const {
    draft,
    dirty,
    validationIssues,
    input,
    setDraft,
    addBlock,
    saving,
    save,
    undoStack,
    undo,
    redoStack,
    redo,
    importInputRef,
    importWorkflow,
    duplicate,
    block,
    duplicateBlock,
    copyBlock,
    copiedBlock,
    pasteBlock,
    workflowSettingsOpen,
    selectedEdge,
    setSelectedBlockId,
    setSelectedBlockIds,
    setSelectedEdgeId,
    setWorkflowSettingsOpen,
  } = context;
  if (!draft) return null;
  return (
    <div className="harness-toolbar">
      <input
        aria-label="Workflow name"
        placeholder="Name your workflow…"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <Select
        aria-label="Add block type"
        value=""
        onValueChange={(selectedValue) => {
          if (selectedValue) addBlock(selectedValue as HarnessBlock["type"]);
        }}
      >
        <option value="">+ Add block</option>
        {flowBlockTypes.map((type) => (
          <option key={type} value={type}>
            {blockTypeLabels[type]}
          </option>
        ))}
      </Select>
      <button
        title="Save workflow"
        disabled={!dirty || saving || validationIssues.length > 0}
        onClick={() => void save()}
      >
        <Save size={14} /> {saving ? "Saving" : "Save"}
      </button>
      <span className="harness-tool-group" role="group" aria-label="Edit history">
        <button title="Undo workflow edit" aria-label="Undo workflow edit" disabled={!undoStack.length} onClick={undo}>
          <Undo2 size={15} aria-hidden="true" />
        </button>
        <button title="Redo workflow edit" aria-label="Redo workflow edit" disabled={!redoStack.length} onClick={redo}>
          <Redo2 size={15} aria-hidden="true" />
        </button>
      </span>
      <span className="harness-tool-group" role="group" aria-label="Workflow files">
        <button title="Export workflow" aria-label="Export workflow" onClick={() => downloadWorkflowDefinition(draft)}>
          <Download size={15} aria-hidden="true" />
        </button>
        <button
          title="Import workflow"
          aria-label="Import workflow"
          disabled={saving}
          onClick={() => importInputRef.current?.click()}
        >
          <Upload size={15} aria-hidden="true" />
        </button>
        <input
          ref={importInputRef}
          aria-label="Import workflow file"
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void importWorkflow(event.currentTarget.files?.[0])}
        />
        <button
          title="Duplicate workflow"
          aria-label="Duplicate workflow"
          disabled={saving}
          onClick={() => void duplicate()}
        >
          <CopyPlus size={15} aria-hidden="true" />
        </button>
      </span>
      <span className="harness-tool-group" role="group" aria-label="Block clipboard">
        <button
          title="Duplicate selected block"
          aria-label="Duplicate selected block"
          disabled={!block}
          onClick={duplicateBlock}
        >
          <SquareStack size={15} aria-hidden="true" />
        </button>
        <button
          title="Copy selected block"
          aria-label="Copy selected block"
          disabled={!block}
          onClick={() => void copyBlock()}
        >
          <Copy size={15} aria-hidden="true" />
        </button>
        <button
          title="Paste workflow block"
          aria-label="Paste workflow block"
          disabled={!copiedBlock}
          onClick={() => void pasteBlock()}
        >
          <ClipboardPaste size={15} aria-hidden="true" />
        </button>
      </span>
      <button
        className={`harness-settings-toggle${workflowSettingsOpen && !block && !selectedEdge ? " active" : ""}`}
        title="Workflow settings"
        aria-label="Workflow settings"
        aria-pressed={workflowSettingsOpen && !block && !selectedEdge}
        onClick={() => {
          setSelectedBlockId(undefined);
          setSelectedBlockIds([]);
          setSelectedEdgeId(undefined);
          setWorkflowSettingsOpen((open) => !(open && !block && !selectedEdge));
        }}
      >
        <Settings2 size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
