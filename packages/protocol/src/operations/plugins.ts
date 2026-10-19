import type { PluginStatus } from "../types/language.js";

export type PluginsOperations = {
  /** Plugins are installed on the Core host; this lists what was found and whether each loaded. */
  "plugins.list": { payload: Record<string, never>; result: { enabled: boolean; plugins: PluginStatus[] } };
};
