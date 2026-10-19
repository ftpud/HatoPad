import type { ToolInstallation } from "../types/configuration.js";

export type ToolsOperations = {
  "tools.list": { payload: Record<string, never>; result: { tools: ToolInstallation[] } };
  /** Installs or updates a tool (and missing prerequisites). Returns at once; poll `tools.list` for completion. */
  "tools.install": { payload: { tool: string }; result: { tools: ToolInstallation[] } };
  "tools.uninstall": { payload: { tool: string }; result: { tools: ToolInstallation[] } };
};
