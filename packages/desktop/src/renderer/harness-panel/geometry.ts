import type { HarnessBlock, HarnessDefinition } from "@hatopad/protocol";

export const BLOCK_WIDTH = 176;

export const BLOCK_HEIGHT = 116;

export function dragPosition(
  clientX: number,
  clientY: number,
  canvasLeft: number,
  canvasTop: number,
  scrollLeft: number,
  scrollTop: number,
  grabX: number,
  grabY: number,
  zoom = 1,
): HarnessBlock["position"] {
  return {
    x: Math.max(8, (clientX - canvasLeft + scrollLeft) / zoom - grabX),
    y: Math.max(8, (clientY - canvasTop + scrollTop) / zoom - grabY),
  };
}

export function fitCanvasViewport(
  blocks: HarnessBlock[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
  axis?: "horizontal" | "vertical",
): { zoom: number; scrollLeft: number; scrollTop: number } {
  const left = Math.min(...blocks.map((block) => block.position.x));
  const top = Math.min(...blocks.map((block) => block.position.y));
  const right = Math.max(...blocks.map((block) => block.position.x + BLOCK_WIDTH));
  const bottom = Math.max(...blocks.map((block) => block.position.y + BLOCK_HEIGHT));
  const width = right - left;
  const height = bottom - top;
  const zoom = Math.max(
    0.25,
    Math.min(
      2,
      axis === "vertical" ? Infinity : viewportWidth / (width + padding * 2),
      axis === "horizontal" ? Infinity : viewportHeight / (height + padding * 2),
    ),
  );
  return {
    zoom,
    scrollLeft: Math.max(0, (left + width / 2) * zoom - viewportWidth / 2),
    scrollTop: Math.max(0, (top + height / 2) * zoom - viewportHeight / 2),
  };
}

export function minimapViewport(
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  viewport: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const width = canvasWidth * zoom;
  const height = canvasHeight * zoom;
  return {
    left: Math.max(0, Math.min(100, (viewport.left / width) * 100)),
    top: Math.max(0, Math.min(100, (viewport.top / height) * 100)),
    width: Math.max(0, Math.min(100, (viewport.width / width) * 100)),
    height: Math.max(0, Math.min(100, (viewport.height / height) * 100)),
  };
}

export function minimapScrollPosition(
  x: number,
  y: number,
  minimapWidth: number,
  minimapHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const contentWidth = canvasWidth * zoom;
  const contentHeight = canvasHeight * zoom;
  return {
    left: Math.max(0, Math.min(contentWidth - viewportWidth, (x / minimapWidth) * contentWidth - viewportWidth / 2)),
    top: Math.max(
      0,
      Math.min(contentHeight - viewportHeight, (y / minimapHeight) * contentHeight - viewportHeight / 2),
    ),
  };
}

export type WorkflowBlockAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

export function alignBlocks(
  blocks: HarnessBlock[],
  selectedIds: string[],
  alignment: WorkflowBlockAlignment,
): HarnessBlock[] {
  const selected = blocks.filter((block) => selectedIds.includes(block.id));
  if (selected.length < 2) return blocks;
  const left = Math.min(...selected.map((block) => block.position.x));
  const right = Math.max(...selected.map((block) => block.position.x + BLOCK_WIDTH));
  const top = Math.min(...selected.map((block) => block.position.y));
  const bottom = Math.max(...selected.map((block) => block.position.y + BLOCK_HEIGHT));
  return blocks.map((block) => {
    if (!selectedIds.includes(block.id)) return block;
    const position = { ...block.position };
    if (alignment === "left") position.x = left;
    if (alignment === "center") position.x = (left + right - BLOCK_WIDTH) / 2;
    if (alignment === "right") position.x = right - BLOCK_WIDTH;
    if (alignment === "top") position.y = top;
    if (alignment === "middle") position.y = (top + bottom - BLOCK_HEIGHT) / 2;
    if (alignment === "bottom") position.y = bottom - BLOCK_HEIGHT;
    return { ...block, position };
  });
}

/** Arrange executable connections from left to right while retaining a stable order for cycles and disconnected blocks. */
export function autoLayoutBlocks(blocks: HarnessBlock[], edges: HarnessDefinition["edges"]): HarnessBlock[] {
  const order = new Map(blocks.map((block, index) => [block.id, index]));
  const blockIds = new Set(order.keys());
  // Tool and loop links do not establish a downstream execution rank.
  const layoutEdges = edges.filter(
    (edge) =>
      !edge.loop && edge.type !== "use" && blockIds.has(edge.from) && blockIds.has(edge.to) && edge.from !== edge.to,
  );
  const incoming = new Map(blocks.map((block) => [block.id, 0]));
  const outgoing = new Map(blocks.map((block) => [block.id, [] as string[]]));
  for (const edge of layoutEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const rank = new Map(blocks.map((block) => [block.id, 0]));
  const ready = blocks.filter((block) => incoming.get(block.id) === 0).map((block) => block.id);
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const id = ready[cursor]!;
    for (const target of outgoing.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1));
      const remaining = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  const columns = new Map<number, HarnessBlock[]>();
  for (const block of blocks) {
    const column = rank.get(block.id) ?? 0;
    const items = columns.get(column) ?? [];
    items.push(block);
    columns.set(column, items);
  }
  return blocks.map((block) => {
    const column = rank.get(block.id) ?? 0;
    const row = columns
      .get(column)!
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
      .findIndex((item) => item.id === block.id);
    return { ...block, position: { x: 32 + column * 260, y: 32 + row * 160 } };
  });
}

export function edgePath(from: HarnessBlock, to: HarnessBlock, loop = false, lane = 0): string {
  return edgeGeometry(from, to, loop, lane).path;
}

export function cubicEdge(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
) {
  return {
    path: `M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`,
    // Evaluate the same cubic at its midpoint and leave space above the stroke.
    label: { x: (x0 + 3 * x1 + 3 * x2 + x3) / 8, y: (y0 + 3 * y1 + 3 * y2 + y3) / 8 - 7 },
  };
}

export function edgeGeometry(from: HarnessBlock, to: HarnessBlock, loop = false, lane = 0) {
  const fromCenter = { x: from.position.x + BLOCK_WIDTH / 2, y: from.position.y + BLOCK_HEIGHT / 2 };
  const toCenter = { x: to.position.x + BLOCK_WIDTH / 2, y: to.position.y + BLOCK_HEIGHT / 2 };
  const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);
  // Return connections can be ordinary follow links without the legacy loop flag.
  // Route them around the cards so they do not retrace the forward connection.
  const backward = horizontal ? toCenter.x <= fromCenter.x : toCenter.y <= fromCenter.y;
  if (loop || backward) {
    const clearance = 72 + lane * 2;
    if (horizontal && from.id !== to.id) {
      const startY = from.position.y + BLOCK_HEIGHT;
      const endY = to.position.y + BLOCK_HEIGHT;
      const bendY = Math.max(startY, endY) + clearance;
      return cubicEdge(fromCenter.x, startY, fromCenter.x, bendY, toCenter.x, bendY, toCenter.x, endY);
    }
    const startX = from.position.x + BLOCK_WIDTH;
    const endX = to.position.x + BLOCK_WIDTH;
    const bendX = Math.max(startX, endX) + clearance;
    const startY = fromCenter.y - (from.id === to.id ? 24 : 0);
    const endY = toCenter.y + (from.id === to.id ? 24 : 0);
    return cubicEdge(startX, startY, bendX, startY, bendX, endY, endX, endY);
  }
  if (horizontal) {
    const direction = toCenter.x >= fromCenter.x ? 1 : -1;
    const startX = fromCenter.x + (direction * BLOCK_WIDTH) / 2;
    const endX = toCenter.x - (direction * BLOCK_WIDTH) / 2;
    const bend = Math.max(36, Math.abs(endX - startX) / 2);
    return cubicEdge(
      startX,
      fromCenter.y,
      startX + direction * bend,
      fromCenter.y + lane * 2,
      endX - direction * bend,
      toCenter.y + lane * 2,
      endX,
      toCenter.y,
    );
  }
  const direction = toCenter.y >= fromCenter.y ? 1 : -1;
  const startY = fromCenter.y + (direction * BLOCK_HEIGHT) / 2;
  const endY = toCenter.y - (direction * BLOCK_HEIGHT) / 2;
  const bend = Math.max(36, Math.abs(endY - startY) / 2);
  return cubicEdge(
    fromCenter.x,
    startY,
    fromCenter.x,
    startY + direction * bend,
    toCenter.x,
    endY - direction * bend,
    toCenter.x,
    endY,
  );
}
