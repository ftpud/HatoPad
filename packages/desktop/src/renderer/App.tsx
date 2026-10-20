import { useAppOrchestration } from "./use-app-orchestration";
import { AppPresentation } from "./app-view/AppPresentation";

export function App() {
  return <AppPresentation model={useAppOrchestration()} />;
}

export { TaskRow } from "./TaskRow";
export { TaskCheckpointHistory, CheckpointHandoff } from "./TaskCheckpointHistory";
export { keyboardResize, selectedLineRange } from "./editor-helpers";
