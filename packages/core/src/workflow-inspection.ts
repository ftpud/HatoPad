import type { HarnessRun } from "@hatopad/protocol";
import { CoreError } from "./errors.js";
/** Paged document/output reads never include block prompts or workflow definitions. */
export function workflowOutputPage(
  run: HarnessRun,
  blockId: unknown,
  options: { offset?: unknown; maxChars?: unknown },
) {
  if (typeof blockId !== "string" || !blockId || blockId.length > 128)
    throw new CoreError("INVALID_REQUEST", "Choose a workflow block");
  const offset = options.offset ?? 0,
    maxChars = options.maxChars ?? 16_000;
  if (
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof maxChars !== "number" ||
    !Number.isSafeInteger(maxChars) ||
    maxChars < 1 ||
    maxChars > 32_000
  )
    throw new CoreError("INVALID_REQUEST", "Choose a valid workflow output page");
  const state = run.blocks.find((block) => block.blockId === blockId);
  if (!state) throw new CoreError("FILE_NOT_FOUND", "Workflow block is unavailable in this run");
  const block = run.definition?.blocks.find((block) => block.id === blockId),
    output = state.output ?? "";
  return {
    blockId,
    title: (block?.label ?? blockId).slice(0, 180),
    type: block?.type ?? "text",
    status: state.status,
    content: output.slice(offset, offset + maxChars),
    totalChars: output.length,
    ...(offset + maxChars < output.length ? { nextOffset: offset + maxChars } : {}),
  };
}
