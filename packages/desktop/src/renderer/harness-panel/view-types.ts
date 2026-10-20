import type { ReactNode } from "react";
import type { HarnessEditorModel } from "./useHarnessEditor";

export type HarnessViewContext = HarnessEditorModel & { workflowSettingsFields: ReactNode; runActions: ReactNode };
