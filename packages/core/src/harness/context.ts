import crypto from "node:crypto";
import type { HarnessDefinition, HarnessBlock, HarnessEdge, AiSession } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { contextPreview, WORKFLOW_CONTEXT_CHARS } from "../workflow-context.js";

export function connectedInput(
  blockId: string,
  harnessInput: string,
  blocks: HarnessBlock[],
  edges: HarnessEdge[],
  outputs: ReadonlyMap<string, string>,
): string {
  const predecessors = edges.filter((edge) => edge.to === blockId && !edge.loop).map((edge) => edge.from);
  if (!predecessors.length) return harnessInput;
  const available = predecessors
    .map((id) => ({ id, output: outputs.get(id) }))
    .filter((item): item is { id: string; output: string } => item.output !== undefined);
  if (available.length === 1) return available[0]!.output;
  const target = blocks.find((block) => block.id === blockId);
  const bounded = available.length > 1 && ["ai", "chatbox"].includes(target?.type ?? "") && !target?.inputSchema;
  const share = Math.max(0, Math.floor(WORKFLOW_CONTEXT_CHARS / Math.max(1, available.length)) - 100);
  return available
    .map(({ id, output }) => {
      const label = blocks.find((block) => block.id === id)?.label ?? id;
      return `## ${bounded ? label.slice(0, 100) : label}\n${bounded ? contextPreview(output, share) : output}`;
    })
    .join("\n\n");
}

export function blocksById(blocks: HarnessBlock[], id: string): HarnessBlock {
  const block = blocks.find((item) => item.id === id);
  if (!block) throw new CoreError("INVALID_REQUEST", `Correction owner block '${id}' no longer exists`);
  return block;
}

export function operationId(runId: string, idempotencyKey: string): string {
  return crypto.createHash("sha256").update(`${runId}\0${idempotencyKey}`).digest("hex").slice(0, 32);
}

export function journalValue(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  if (serialized.length <= 50_000) return JSON.parse(serialized) as unknown;
  return { truncated: true, bytes: Buffer.byteLength(serialized), preview: serialized.slice(0, 49_000) };
}

export function chatResponse(session: AiSession, turnUserId?: string | null): string {
  const lastUser =
    turnUserId === undefined
      ? session.messages.map((message) => message.role).lastIndexOf("user")
      : session.messages.findIndex((message) => message.id === turnUserId);
  return session.messages
    .slice(lastUser + 1)
    .filter((message) => message.role === "assistant")
    .map((message) => message.text)
    .join("\n\n")
    .slice(-200_000);
}

/** Test a draft block with its connected tools, without advancing follow/path steps. */
export function isolatedBlockDefinition(definition: HarnessDefinition, blockId: string): HarnessDefinition {
  if (!definition.blocks.some((block) => block.id === blockId))
    throw new CoreError("INVALID_REQUEST", "Selected workflow block does not exist");
  const ids = new Set([blockId]);
  const tools = definition.edges.filter(
    (edge) => edge.type === "use" || definition.blocks.find((block) => block.id === edge.from)?.type === "chatbox",
  );
  for (let size = -1; size !== ids.size;) {
    size = ids.size;
    for (const edge of tools) if (ids.has(edge.from)) ids.add(edge.to);
  }
  return {
    ...structuredClone(definition),
    blocks: structuredClone(definition.blocks.filter((block) => ids.has(block.id))),
    edges: tools.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => ({ ...edge, type: "use" })),
  };
}

export /** Skill catalogues expose when to use a skill; its instructions load on demand. */
function workflowBlockDescription(block: HarnessBlock | undefined): string | undefined {
  const description =
    block?.type === "meeting"
      ? "Shared meeting chat for this workflow run. Use action publish with message (or input) to post; tail with lines (1–50) to read recent messages; diff to read new messages since your own last read; wait to sleep until unread messages arrive (timeout_seconds defaults to the connection timeout). Optional after selects a sequence. Wait returns messages with status updated or timed_out. Read pages while hasMore is true. Messages include author and sequence; each participant has an independent durable cursor. Keeps the latest 1000 messages and reports historyTruncated if older unread messages were removed. Publishing does not invoke other agents. Use status to list connected peers and their online/block status. Use shake with peer_block_id and optional message to notify an active AI peer or start an idle peer turn; only peers connected to this room can be shaken."
      : block?.type === "mcp"
        ? 'External MCP tools. Call workflow_use_block with input JSON {"action":"list"} to discover tools, then {"action":"call","name":"TOOL_NAME","arguments":{...}} to invoke one using this block’s connection.'
        : block?.type === "skill"
          ? block.description
          : block?.type === "terminal_control"
            ? 'Only for long-running apps and services. Do not spawn agents in terminals. List first and reuse existing terminals whenever possible; avoid spawning new terminals unnecessarily. Control terminals in this task workspace. Pass JSON in input: {"action":"list"}, {"action":"open","name":"Server"}, {"action":"open_and_run","name":"Server","command":"npm run dev"}, {"action":"write","terminal_id":"ID","data":"command\\n"}, or {"action":"read","terminal_id":"ID","lines":100}. open_and_run appends a newline automatically and returns the terminalId immediately. Writes are raw input; include a newline to execute commands.'
            : block?.type === "task_controls"
              ? "Create tasks, check task and AI status, send prompts with the designed AI settings, set tasks active or finished, set commit-message drafts, and rewrite the latest unpushed commit message."
              : (block?.description ?? block?.prompt);
  return description && description.length > 512
    ? `${description.slice(0, 512)}… (preview; use the block to load its content)`
    : description;
}

export function taskControlsMetadata(block: HarnessBlock | undefined, defaultProvider: string) {
  return block?.type === "task_controls"
    ? {
        actions: [
          "create",
          "create_and_start",
          "status",
          "prompt",
          "set_status",
          "set_commit_message",
          "update_commit_message",
        ],
        provider: block.provider ?? defaultProvider,
        model: block.model,
        reasoning: block.reasoning,
      }
    : undefined;
}
