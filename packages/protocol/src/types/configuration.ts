import type { AiAgentPreset, AiAgent } from "@hatopad/acp";

/** Optional tool downloaded to the Core host on demand (Settings → Tools). */
export type ToolInstallation = { id: string; name: string; description: string; status: "installed" | "not_installed" | "installing" | "removing"; version?: string; /** The version this Core installs. */ availableVersion: string; requires?: string[]; location?: string; /** Download progress, 0-100, while installing. */ progress?: number; error?: string };

export type UsefulFileScope = "global" | "local";

export type UsefulFile = { scope: UsefulFileScope; name: string };

export type RunConfigScope = "global" | "local";

export type RunConfigStatus = "idle" | "starting" | "running" | "stopping" | "succeeded" | "failed";

export type RunConfig = { scope: RunConfigScope; name: string; commands: string; status: RunConfigStatus; terminalId?: string; exitCode?: number };

export type SkillScope = "global" | "local" | "workspace";

export type SkillFile = { id: string; scope: SkillScope; name: string; title: string; description?: string; path: string };

export type SkillPolicy = { allowed: string[]; defaults: string[]; /** Missing skill entries allow any agent; null permits chats with no preset. */ agents?: Record<string, (AiAgentPreset | null)[]> };

export function skillAllowedForAgent(policy: SkillPolicy, id: string, agent?: AiAgentPreset | null): boolean {
  if (!policy.allowed.includes(id)) return false;
  const choices = policy.agents?.[id];
  return choices === undefined || choices.some((choice) => choice === null ? !agent : !!agent && choice.scope === agent.scope && choice.name === agent.name);
}

export type SkillCatalog = { skills: SkillFile[]; policy: SkillPolicy; policyStorage?: "local" | "workspace"; /** Compatibility for checkout skills formerly named local/name. */ legacyIds?: Record<string, string> };

export function resolveSkillIds(catalog: SkillCatalog, ids: string[]): string[] {
  return [...new Set(ids.map((id) => catalog.legacyIds?.[id] ?? id))];
}

export type AgentFileScope = "global" | "local" | "workspace";

export type AgentFileReference = { scope: AgentFileScope; name: string };

export type AgentFile = { scope: AgentFileScope; name: string; agent: AiAgent };
