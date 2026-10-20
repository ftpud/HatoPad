import { useRef, useState } from "react";
import type {
  SkillCatalog,
  AiContinuationTimer,
  AiModel,
  AiProvider,
  AiProviderDescriptor,
  AiSession,
  AiTaskSummary,
  AiUsage,
  WorkspaceSchedule,
  WorkspaceTrigger,
} from "@hatopad/protocol";
import { readSetting } from "./settings";
import { type AiAttachment } from "./AiPanel";

/** Owns the AiSessionState state for the workspace shell. */
export function useAiSessionState() {
  const [aiSession, setAiSession] = useState<AiSession>({
    model: "gpt-5.6-sol",
    reasoning: "low",
    status: "idle",
    messages: [],
  });
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog>({ skills: [], policy: { allowed: [], defaults: [] } });
  const [aiSessions, setAiSessions] = useState<AiSession[]>([]);
  const [aiProvider, setAiProvider] = useState<AiProvider>(() => readSetting("aiProvider") ?? "");
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  // True from the moment the provider changes until its own model list arrives, so the picker never shows another provider's models.
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
  const [aiProviders, setAiProviders] = useState<AiProviderDescriptor[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage>();
  const [aiAttachments, setAiAttachments] = useState<Record<string, AiAttachment[]>>({});
  const emptyAiSummary: AiTaskSummary = {
    status: "idle",
    preview: "",
    additions: 0,
    deletions: 0,
    pendingPermission: false,
  };
  const [aiStatuses, setAiStatuses] = useState<{ root: AiTaskSummary; tasks: Record<string, AiTaskSummary> }>({
    root: emptyAiSummary,
    tasks: {},
  });
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [triggers, setTriggers] = useState<WorkspaceTrigger[]>([]);
  const [activeTimers, setActiveTimers] = useState<AiContinuationTimer[]>([]);
  const aiStatusesRequested = useRef(0);
  const aiStatusesApplied = useRef(0);
  const aiSessionRequested = useRef(0);
  const aiSessionApplied = useRef(0);
  return {
    aiSession,
    setAiSession,
    skillCatalog,
    setSkillCatalog,
    aiSessions,
    setAiSessions,
    aiProvider,
    setAiProvider,
    aiModels,
    setAiModels,
    aiModelsLoading,
    setAiModelsLoading,
    aiProviders,
    setAiProviders,
    aiUsage,
    setAiUsage,
    aiAttachments,
    setAiAttachments,
    emptyAiSummary,
    aiStatuses,
    setAiStatuses,
    schedules,
    setSchedules,
    triggers,
    setTriggers,
    activeTimers,
    setActiveTimers,
    aiStatusesRequested,
    aiStatusesApplied,
    aiSessionRequested,
    aiSessionApplied,
  };
}
