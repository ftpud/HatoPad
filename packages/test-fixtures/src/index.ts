import { fileURLToPath } from "node:url";

/** Absolute path of the scripted ACP agent (run it with `process.execPath`). */
export const fakeAgentPath = fileURLToPath(new URL("../agent/fake-agent.mjs", import.meta.url));

/** Prompt keywords understood by the fixture agent. */
export const fixturePrompts = { permission: "PERMISSION", question: "QUESTION", edit: "EDIT", slow: "SLOW" } as const;

export interface FixtureProviderDefinition {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  models: { id: string; name: string; reasoningLevels: string[] }[];
  options: { id: string; name: string; description: string; type: "boolean"; defaultValue: boolean }[];
}

/**
 * Provider definition for Core's `HATOPAD_PROVIDER_DEFINITIONS_DIR`: write it as `<id>.json`
 * in that directory and start Core with the variable set. The definition declares the
 * `askQuestions` option; enable it in the session configuration before sending a `QUESTION` prompt.
 */
export function fixtureProviderDefinition(id = "fixture-agent"): FixtureProviderDefinition {
  return {
    id,
    name: "Fixture agent",
    description: "Scripted test agent shipped with @hatopad/test-fixtures",
    command: process.execPath,
    args: [fakeAgentPath],
    models: [{ id: "model-a", name: "MODEL-A", reasoningLevels: ["low"] }],
    options: [{ id: "askQuestions", name: "Questions", description: "Let the agent ask form questions", type: "boolean", defaultValue: false }]
  };
}
