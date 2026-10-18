import { CoreError } from "./errors.js";
import { boundPermission } from "./ai/session-bounds.js";
import type { HarnessProgress, HarnessRun } from "@remote-ide/protocol";

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
