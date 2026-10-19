import type { RunConfig, RunConfigScope } from "../types/configuration.js";

export type RunConfigOperations = {
  "runConfig.list": { payload: Record<string, never>; result: { configs: RunConfig[] } };
  "runConfig.create": { payload: { scope: RunConfigScope; name: string; commands: string }; result: { config: RunConfig } };
  "runConfig.read": { payload: { scope: RunConfigScope; name: string }; result: { config: RunConfig } };
  "runConfig.write": { payload: { scope: RunConfigScope; name: string; commands: string }; result: { config: RunConfig } };
  "runConfig.rename": { payload: { scope: RunConfigScope; name: string; newName: string }; result: { config: RunConfig } };
  "runConfig.delete": { payload: { scope: RunConfigScope; name: string }; result: Record<string, never> };
  "runConfig.run": { payload: { scope: RunConfigScope; name: string }; result: { config: RunConfig } };
  "runConfig.stop": { payload: { scope: RunConfigScope; name: string }; result: { config: RunConfig } };
  "runConfig.restart": { payload: { scope: RunConfigScope; name: string }; result: { config: RunConfig } };
  "runConfig.openTerminal": { payload: { scope: RunConfigScope; name: string }; result: { config: RunConfig } };
};
