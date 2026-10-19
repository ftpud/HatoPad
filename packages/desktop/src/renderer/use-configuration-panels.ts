import { useState } from "react";
import type {
  AgentFile,
  HarnessDefinition,
  HarnessRun,
  HarnessStateDiagnostic,
  RunConfig,
  UsefulFile,
} from "@hatopad/protocol";

export function useConfigurationPanels() {
  const [usefulFiles, setUsefulFiles] = useState<UsefulFile[]>([]);

  const [runConfigs, setRunConfigs] = useState<RunConfig[]>([]);

  const [agents, setAgents] = useState<AgentFile[]>([]);

  const [harnesses, setHarnesses] = useState<HarnessDefinition[]>([]);

  const [harnessRuns, setHarnessRuns] = useState<HarnessRun[]>([]);

  const [harnessDiagnostics, setHarnessDiagnostics] = useState<HarnessStateDiagnostic[]>([]);

  const [selectedAgentKey, setSelectedAgentKey] = useState("");

  const [harnessesLoading, setHarnessesLoading] = useState(false);

  const [harnessRunsLoading, setHarnessRunsLoading] = useState(false);
  return {
    usefulFiles,
    setUsefulFiles,
    runConfigs,
    setRunConfigs,
    agents,
    setAgents,
    harnesses,
    setHarnesses,
    harnessRuns,
    setHarnessRuns,
    harnessDiagnostics,
    setHarnessDiagnostics,
    selectedAgentKey,
    setSelectedAgentKey,
    harnessesLoading,
    setHarnessesLoading,
    harnessRunsLoading,
    setHarnessRunsLoading,
  };
}
