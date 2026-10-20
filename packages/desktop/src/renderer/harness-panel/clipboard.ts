import type { HarnessBlock } from "@hatopad/protocol";

export function workflowBlockClipboardPayload(block: HarnessBlock) {
  return JSON.stringify({ type: "hatopad-workflow-block", version: 1, block });
}

export function parseWorkflowBlockClipboard(value: string): HarnessBlock | undefined {
  try {
    const parsed = JSON.parse(value) as { type?: unknown; version?: unknown; block?: Partial<HarnessBlock> };
    const block = parsed.block;
    if (
      parsed.type !== "hatopad-workflow-block" ||
      parsed.version !== 1 ||
      !block ||
      typeof block.id !== "string" ||
      typeof block.label !== "string" ||
      typeof block.type !== "string" ||
      typeof block.prompt !== "string" ||
      !block.position ||
      typeof block.position.x !== "number" ||
      typeof block.position.y !== "number"
    )
      return undefined;
    return block as HarnessBlock;
  } catch {
    return undefined;
  }
}

export function nextBlockCopyLabel(label: string, blocks: HarnessBlock[]) {
  const base = `${label} copy`;
  const labels = new Set(blocks.map((item) => item.label));
  if (!labels.has(base)) return base;
  let suffix = 2;
  while (labels.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}
