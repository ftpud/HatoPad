import "./workflow-transcript.css";
import { useHarnessEditor } from "./harness-panel/useHarnessEditor";
import { HarnessEditorView } from "./harness-panel/HarnessEditorView";
import type { HarnessPanelProps } from "./harness-panel/types";

export function HarnessPanel(props: HarnessPanelProps) {
  return <HarnessEditorView model={useHarnessEditor(props)} />;
}

export type { HarnessPanelProps } from "./harness-panel/types";

export { workflowBlockClipboardPayload } from "./harness-panel/clipboard";

export { PauseResolution } from "./harness-panel/PauseResolution";

export { BlockRunDetails } from "./harness-panel/BlockRunDetails";

export { WorkflowMessage } from "./harness-panel/WorkflowRunOutput";

export type { WorkflowBlockAlignment } from "./harness-panel/geometry";

export {
  dragPosition,
  fitCanvasViewport,
  minimapViewport,
  minimapScrollPosition,
  alignBlocks,
  autoLayoutBlocks,
  edgePath,
} from "./harness-panel/geometry";

export {
  responsePreview,
  workflowDefinitionExport,
  parseWorkflowDefinitionImport,
  workflowRunExport,
} from "./harness-panel/definition";
