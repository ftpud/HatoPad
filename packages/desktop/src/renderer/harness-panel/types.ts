import type {
  AgentFile,
  AiModel,
  AiProvider,
  AiProviderDescriptor,
  HarnessChatSettings,
  HarnessAppState,
  HarnessDefinition,
  HarnessRun,
  HarnessStateDiagnostic,
  HarnessValidationIssue,
  SkillCatalog,
} from "@hatopad/protocol";

export type MinimapCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type HarnessPanelProps = {
  designOnly?: boolean;
  onOpenWorkflow?(workflow: HarnessDefinition): void;
  harnesses: HarnessDefinition[];
  runs: HarnessRun[];
  diagnostics?: HarnessStateDiagnostic[];
  providers: AiProviderDescriptor[];
  agents: AgentFile[];
  mcpServers?: import("@hatopad/protocol").McpLibraryServer[];
  skillCatalog?: SkillCatalog;
  onRefreshSkills?(): Promise<void>;
  defaultProvider?: AiProvider;
  onLoadModels?(provider: AiProvider): Promise<AiModel[]>;
  onValidate?(harness: HarnessDefinition): Promise<{ valid: boolean; issues: HarnessValidationIssue[] }>;
  onCreate(name: string, template?: "five-minute-check-in" | "git-review-commit"): Promise<HarnessDefinition>;
  onReadRun?(runId: string): Promise<HarnessRun>;
  onRead?(id: string): Promise<HarnessDefinition>;
  onSave(harness: HarnessDefinition): Promise<HarnessDefinition>;
  onDelete(id: string): Promise<void>;
  onRun(harnessId: string, input: string, startBlockId?: string, rerunRunId?: string): Promise<HarnessRun>;
  onTestBlock?(definition: HarnessDefinition, blockId: string, input: string): Promise<HarnessRun>;
  onReadApp?(harnessId: string, blockId: string, runId?: string): Promise<HarnessAppState>;
  onOpenAppTerminal?(harnessId: string, blockId: string, runId?: string): Promise<void>;
  onAutopilot?(runId: string, blockId: string, sessionId: string, enabled: boolean): Promise<HarnessRun>;
  onSteerChat?(runId: string, blockId: string, sessionId: string, input: string): Promise<HarnessRun>;
  onKillApp?(harnessId: string, blockId: string, runId?: string): Promise<void>;
  onChat?(
    harnessId: string,
    blockId: string,
    input: string,
    runId?: string,
    settings?: HarnessChatSettings,
  ): Promise<HarnessRun>;
  onAppendRun?(runId: string, input: string): Promise<HarnessRun>;
  onResolvePermission?(
    runId: string,
    blockId: string,
    sessionId: string,
    pauseId: string,
    requestId: string,
    optionId?: string,
  ): Promise<HarnessRun>;
  onAnswerQuestion?(
    runId: string,
    blockId: string,
    sessionId: string,
    pauseId: string,
    input: string,
  ): Promise<HarnessRun>;
  onResumePause?(runId: string, blockId: string, pauseId: string): Promise<HarnessRun>;
  onRetryPause?(runId: string, blockId: string, pauseId: string): Promise<HarnessRun>;
  onCancelPause?(runId: string, blockId: string, pauseId: string): Promise<HarnessRun>;
  onCancelRun(runId: string): Promise<void>;
  onDeleteRun?(runId: string): Promise<void>;
  onError(message: string): void;
};

export type ChatboxOptions = {
  providers?: AiProviderDescriptor[];
  defaultProvider?: AiProvider;
  onLoadModels?(provider: AiProvider): Promise<AiModel[]>;
};
