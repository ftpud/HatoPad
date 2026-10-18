import { CoreError } from "./errors.js";
import { boundPermission } from "./ai/session-bounds.js";
import { harnessBlockDetailLimits, type HarnessBlockDetail, type HarnessProgress, type HarnessRun } from "@hatopad/protocol";

export const progressLimits = { defaultLog: 20, maxLog: 100, maxMessage: 500, maxError: 500, maxBlocks: 200, maxBytes: 900_000 } as const;

/** Bounded projection of a run for phones: no definition, outputs, prompts or chat transcripts. */
export function projectProgress(run: HarnessRun, logLimit: unknown): HarnessProgress {
  const limit = logLimit ?? progressLimits.defaultLog;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > progressLimits.maxLog) throw new CoreError("INVALID_REQUEST", `logLimit must be an integer from 1 to ${progressLimits.maxLog}`);
  if (run.blocks.length > progressLimits.maxBlocks) throw new CoreError("INVALID_REQUEST", `Workflow has more than ${progressLimits.maxBlocks} blocks; review it in Desktop`);
  const progress: HarnessProgress = {
    id: run.id, harnessId: run.harnessId, status: run.status, createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}), ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.error ? { error: run.error.slice(0, progressLimits.maxError) } : {}),
    blocks: run.blocks.map((block) => {
      const log = (block.log ?? []).slice(-limit).map((entry) => ({ ...entry, message: entry.message.slice(0, progressLimits.maxMessage) }));
      return {
        blockId: block.blockId, status: block.status,
        ...(block.startedAt ? { startedAt: block.startedAt } : {}), ...(block.completedAt ? { completedAt: block.completedAt } : {}),
        ...(block.error ? { error: block.error.slice(0, progressLimits.maxError) } : {}),
        ...(block.pauseId ? { pauseId: block.pauseId } : {}), ...(block.question ? { question: block.question.slice(0, progressLimits.maxMessage), ...(block.question.length > progressLimits.maxMessage ? { questionTruncated: true as const } : {}) } : {}),
        ...(block.pendingPermission ? { pendingPermission: boundPermission(block.pendingPermission) } : {}),
        ...(block.sessionId ? { sessionId: block.sessionId } : {}), ...(block.provider ? { provider: block.provider } : {}),
        log, logTruncated: (block.log?.length ?? 0) > log.length
      };
    })
  };
  if (Buffer.byteLength(JSON.stringify(progress)) > progressLimits.maxBytes) throw new CoreError("INVALID_REQUEST", "Workflow progress is too large to show here; lower logLimit or review it in Desktop");
  return progress;
}

const integer = (value: unknown, fallback: number, min: number, max: number, name: string) => {
  const chosen = value ?? fallback;
  if (typeof chosen !== "number" || !Number.isSafeInteger(chosen) || chosen < min || chosen > max) throw new CoreError("INVALID_REQUEST", `${name} must be an integer from ${min} to ${max}`);
  return chosen;
};

/** Bounded detail for one block: never the definition, prompts or the full transcript. */
export function projectBlockDetail(run: HarnessRun, blockId: unknown, options: { outputChars?: unknown; chatLimit?: unknown; chatBefore?: unknown }): HarnessBlockDetail {
  if (typeof blockId !== "string" || !blockId) throw new CoreError("INVALID_REQUEST", "blockId must be a non-empty string");
  const block = run.blocks.find((item) => item.blockId === blockId);
  if (!block) throw new CoreError("FILE_NOT_FOUND", "Workflow block does not exist in this run");
  const outputLimit = integer(options.outputChars, harnessBlockDetailLimits.defaultOutput, 1, harnessBlockDetailLimits.maxOutput, "outputChars");
  const chatLimit = integer(options.chatLimit, harnessBlockDetailLimits.defaultChat, 1, harnessBlockDetailLimits.maxChat, "chatLimit");
  if (options.chatBefore !== undefined && (typeof options.chatBefore !== "string" || options.chatBefore.length > 128)) throw new CoreError("INVALID_REQUEST", "chatBefore must be a short message id");
  const output = block.output ?? "";
  const chat = block.chatMessages ?? [];
  let end = chat.length;
  if (options.chatBefore !== undefined) { end = chat.findIndex((message) => message.id === options.chatBefore); if (end < 0) throw new CoreError("INVALID_REQUEST", "chatBefore does not match a message in this block"); }
  const start = Math.max(0, end - chatLimit);
  const page = chat.slice(start, end).map((message) => ({ id: message.id, role: message.role, text: message.text.slice(0, harnessBlockDetailLimits.maxChatText), timestamp: message.timestamp, ...(message.text.length > harnessBlockDetailLimits.maxChatText ? { clipped: true as const } : {}) }));
  return {
    blockId, status: block.status, output: output.slice(-outputLimit), outputChars: output.length, outputTruncated: output.length > outputLimit,
    iterations: block.iterations?.length ?? 0, chatMessages: page, ...(start > 0 ? { chatNextBefore: chat[start]!.id } : {})
  };
}
