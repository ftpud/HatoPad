import type {
  AgentFile,
  AiModel,
  AiProvider,
  AiProviderDescriptor,
  HarnessBlock,
  HarnessDefinition,
  HarnessRun,
  HarnessValidationIssue,
  SkillCatalog,
} from "@hatopad/protocol";
import { flowBlockTypes } from "./block-catalog";

export const activeRunStatuses = new Set<HarnessRun["status"]>([
  "queued",
  "running",
  "waiting",
  "awaiting_permission",
  "awaiting_user_input",
  "waiting_timer",
  "retry_scheduled",
]);

export function availabilityIssues(
  draft: HarnessDefinition | undefined,
  providers: AiProviderDescriptor[],
  agents: AgentFile[],
  defaultProvider: AiProvider | undefined,
  modelsByProvider: Record<string, AiModel[]>,
  skillCatalog?: SkillCatalog,
): HarnessValidationIssue[] {
  if (!draft) return [];
  const issues: HarnessValidationIssue[] = [];
  for (const block of draft.blocks) {
    if (
      block.type === "skill" &&
      block.skillId &&
      skillCatalog &&
      (!skillCatalog.skills.some((skill) => skill.id === block.skillId) ||
        !skillCatalog.policy.allowed.includes(block.skillId))
    )
      issues.push({
        code: "invalid-gate",
        blockId: block.id,
        message: `Skill '${block.skillId}' is missing or not allowed in this project`,
      });
    if (flowBlockTypes.includes(block.type) && !["ai", "chatbox", "task_controls"].includes(block.type)) continue;
    const provider = block.provider ?? defaultProvider;
    if (provider && providers.length && !providers.some((item) => item.id === provider))
      issues.push({
        code: "unavailable-provider",
        blockId: block.id,
        message: `Block '${block.label || block.id}' uses unavailable provider '${provider}'`,
      });
    const models = provider ? modelsByProvider[provider] : undefined;
    if (block.model && models && !models.some((model) => model.id === block.model && model.available !== false))
      issues.push({
        code: "unavailable-model",
        blockId: block.id,
        message: `Block '${block.label || block.id}' uses unavailable model '${block.model}'`,
      });
    if (
      block.agent &&
      agents.length &&
      !agents.some((agent) => agent.scope === block.agent!.scope && agent.name === block.agent!.name)
    )
      issues.push({
        code: "unavailable-agent",
        blockId: block.id,
        message: `Block '${block.label || block.id}' uses unavailable agent '${block.agent.name}'`,
      });
  }
  return issues;
}

export function executionBehavior(block: HarnessBlock, edges: HarnessDefinition["edges"]): string {
  if (block.type === "mcp")
    return 'Connected agents discover tools with input {"action":"list"} and invoke them with {"action":"call","name":"tool","arguments":{}}. Calls use the selected connection and pulse the Use connection.';
  if (block.type === "meeting")
    return "Connect agents and chatboxes with Use to share a discussion. Publish adds an attributed message; tail reads recent messages; diff reads messages since each participant’s last read; wait holds until new messages arrive. Publishing does not invoke participants.";
  if (block.type === "task_controls")
    return "Connected agents can create tasks, check status, send prompts using this block’s AI settings, mark tasks active or finished, set commit-message drafts, and rewrite the latest unpushed commit message. Empty direct input lists task status; other direct actions accept JSON.";
  if (block.type === "skill")
    return "Connected agents see this skill’s description and load its instructions on demand. The agent follows the instructions in its own session.";
  if (block.type === "chatbox")
    return "Open this block in View / Run to chat. Each conversation keeps its context and can invoke every outgoing connected block on demand.";
  if (flowBlockTypes.includes(block.type))
    return `Follow connections pass output to each follower. ${edges.some((edge) => edge.from === block.id && edge.type === "use") ? "Use connections make blocks available as MCP tools. " : ""}${edges.some((edge) => edge.from === block.id && edge.type === "path") ? "The AI chooses one path, which receives its final output." : ""}`;
  if (block.watchdog)
    return "Core watchdogs run independently, watch retryable delivery failures, and have no graph connections.";
  const incoming =
    block.join === "any"
      ? "starts when any incoming synchronous path completes"
      : "waits for every incoming synchronous path";
  const outgoing =
    block.routing === "ai" ? "asks the model to choose one named outgoing path" : "starts every outgoing path";
  const edgeBehavior = edges.some((edge) => edge.from === block.id && edge.execution === "async")
    ? " Async paths continue without waiting."
    : "";
  return `This block ${incoming} and ${outgoing}.${edgeBehavior}`;
}

export function previewPrompt(template: string, input: string): string {
  return template.replace(
    /\{\{\s*(input|blocks\.([A-Za-z0-9_-]+)\.output|iteration)\s*\}\}/g,
    (_match, variable: string, blockId?: string) =>
      variable === "input"
        ? input || "[workflow input]"
        : variable === "iteration"
          ? "[iteration]"
          : `[output from ${blockId}]`,
  );
}

export function responsePreview(output?: string, status?: HarnessRun["blocks"][number]["status"]): string {
  if (!output?.trim()) return status === "running" ? "Waiting for response…" : "No response yet";
  const compact = output.trim().replace(/\s+/g, " ");
  return compact.length > 140 ? `${compact.slice(0, 139)}…` : compact;
}

export function workflowDefinitionExport(definition: HarnessDefinition): string {
  return `${JSON.stringify({ format: "hatopad-workflow", version: 1, definition }, redactWorkflowExportValue, 2)}\n`;
}

export function parseWorkflowDefinitionImport(value: string): HarnessDefinition {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("This file is not a supported workflow definition");
  const envelope = parsed as { format?: unknown; version?: unknown; definition?: unknown; harness?: unknown };
  const definition =
    envelope.format === "hatopad-workflow"
      ? envelope.version === 1
        ? envelope.definition
        : envelope.version === 0
          ? (envelope.harness ?? envelope.definition)
          : undefined
      : envelope;
  if (!isWorkflowDefinitionImport(definition)) throw new Error("This file is not a supported workflow definition");
  return structuredClone(definition);
}

export function isWorkflowDefinitionImport(value: unknown): value is HarnessDefinition {
  if (!value || typeof value !== "object") return false;
  const definition = value as Partial<HarnessDefinition>;
  return (
    typeof definition.id === "string" &&
    typeof definition.name === "string" &&
    typeof definition.version === "number" &&
    typeof definition.createdAt === "string" &&
    typeof definition.updatedAt === "string" &&
    Array.isArray(definition.blocks) &&
    definition.blocks.every(
      (block) =>
        block &&
        typeof block.id === "string" &&
        typeof block.label === "string" &&
        typeof block.type === "string" &&
        typeof block.prompt === "string" &&
        (block.autopilot === undefined || typeof block.autopilot === "boolean") &&
        !!block.position &&
        typeof block.position.x === "number" &&
        typeof block.position.y === "number",
    ) &&
    Array.isArray(definition.edges) &&
    definition.edges.every(
      (edge) => edge && typeof edge.id === "string" && typeof edge.from === "string" && typeof edge.to === "string",
    )
  );
}

export function redactWorkflowExportValue(key: string, value: unknown) {
  if (/^(authorization|token|password|secret|api[_-]?key)$/i.test(key)) return "[REDACTED]";
  return typeof value === "string"
    ? value
        .replace(/\b(?:sk|api|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]")
        .replace(/\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    : value;
}

export function downloadWorkflowDefinition(definition: HarnessDefinition): void {
  const url = URL.createObjectURL(new Blob([workflowDefinitionExport(definition)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `workflow-${
    definition.name
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || definition.id
  }.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function workflowRunExport(run: HarnessRun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

export function downloadWorkflowRun(run: HarnessRun): void {
  const url = URL.createObjectURL(new Blob([workflowRunExport(run)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `workflow-run-${run.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
