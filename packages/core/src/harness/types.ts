import type { HarnessBlock, HarnessEdge, HarnessRun, HarnessChildTask, AiSession } from "@hatopad/protocol";
import { ExecutionScheduler } from "./scheduler.js";

export type Dispatch = (block: HarnessBlock, prompt: string, context: { runId: string; blockId: string; attemptId: string; iteration: number; instructions?: string; skillAgent?: HarnessBlock["agent"] | null; started(workspace: string): Promise<void>; activity(session: AiSession, waitingUntil?: string): Promise<void>; assertActive(): void }) => Promise<AiSession>;

export type Append = (block: HarnessBlock, prompt: string, context: { runId: string; blockId: string; workspace: string; activity?(session: AiSession, waitingUntil?: string): Promise<void> }) => Promise<AiSession>;

export type Interrupt = (provider: string, context: { runId: string; blockId: string; workspace?: string }) => Promise<void>;

export type ResolvePermission = (provider: string, workspace: string, requestId: string, optionId?: string) => Promise<AiSession>;

export type AnswerQuestion = (provider: string, workspace: string, input: string) => Promise<AiSession>;

export type FireTimer = (provider: string, workspace: string) => Promise<boolean>;

export type ActiveExecution = { run: HarnessRun; blocks: HarnessBlock[]; edges: HarnessEdge[]; outputs: Map<string, string>; dispatch: Dispatch; append: Append; defaultProvider: string; background: Set<Promise<void>>; stackInvocations: Map<string, number>; loopInvocations: Map<string, number>; turnClaims: Map<string, string>; flowBusy?: Set<string>; flowFinishing?: Map<string, Promise<void>>; scheduler: ExecutionScheduler };

export type RecoveryPolicy = { maxAttempts: number; transportBackoffMs: number; maxElapsedMs?: number; jitterRatio?: number; random?: () => number };

export type ResolvedRecoveryPolicy = Required<RecoveryPolicy>;

export type HarnessRecoveryInspector = {
  binding?(run: HarnessRun): Promise<void>;
  session(provider: string, workspace: string): Promise<AiSession | undefined>;
  timer(runId: string, blockId: string, provider: string, workspace: string): Promise<boolean>;
  child?(child: HarnessChildTask): Promise<boolean>;
};
