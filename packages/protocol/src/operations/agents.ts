import type { AgentFile, AgentFileScope } from "../types/configuration.js";

export type AgentsOperations = {
  "agents.list": { payload: Record<string, never>; result: { agents: AgentFile[] } };
  "agents.read": { payload: { scope: AgentFileScope; name: string }; result: { content: string } };
  "agents.create": { payload: { scope: Exclude<AgentFileScope, "workspace">; name: string }; result: Record<string, never> };
  "agents.write": { payload: { scope: AgentFileScope; name: string; content: string }; result: Record<string, never> };
  "agents.rename": { payload: { scope: Exclude<AgentFileScope, "workspace">; name: string; newName: string }; result: { name: string } };
  "agents.delete": { payload: { scope: Exclude<AgentFileScope, "workspace">; name: string }; result: Record<string, never> };
};
