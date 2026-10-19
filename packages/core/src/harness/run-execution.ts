import crypto from "node:crypto";
import type { HarnessBlock, HarnessEdge, HarnessRun } from "@hatopad/protocol";
import { harnessExecutionEdges, isHarnessFlow } from "../harness-graph.js";
import { Dispatch, Append } from "./types.js";
import { ExecutionScheduler, blockReadiness } from "./scheduler.js";
import { isActiveStatus, workflowFailure, classifyWorkflowFailure, isRetryableFailure, nextRetryAt, retryBudgetExhausted, pauseStatuses } from "./recovery.js";
import { Cancelled, BlockedCorrection } from "./errors.js";
import type { HarnessRunner } from "../harness-runner.js";

type ExecuteHost = {
  concurrency: HarnessRunner["concurrency"];
  runActivityStatus: HarnessRunner["runActivityStatus"];
  executions: HarnessRunner["executions"];
  assertActive: HarnessRunner["assertActive"];
  schedulingReady: HarnessRunner["schedulingReady"];
  log: HarnessRunner["log"];
  executeFlow: HarnessRunner["executeFlow"];
  recordCompletedOperation: HarnessRunner["recordCompletedOperation"];
  update: HarnessRunner["update"];
  suspended: HarnessRunner["suspended"];
  cancelled: HarnessRunner["cancelled"];
  executeBlock: HarnessRunner["executeBlock"];
  policy: HarnessRunner["policy"];
  meetingUpdates: HarnessRunner["meetingUpdates"];
  retryEntries: HarnessRunner["retryEntries"];
  flowInvocations: HarnessRunner["flowInvocations"];
  activeRuns: HarnessRunner["activeRuns"];
  activeProviders: HarnessRunner["activeProviders"];
};

export async function harnessExecute(host: ExecuteHost, run: HarnessRun, blocks: HarnessBlock[], edges: HarnessEdge[], order: string[], dispatch: Dispatch, defaultProvider: string, append: Append, recovering = false, startBlockId?: string): Promise<void> {
    edges = harnessExecutionEdges({ blocks, edges });
    const outputs = new Map(run.blocks.flatMap((state) => state.status === "succeeded" && state.output !== undefined ? [[state.blockId, state.output] as const] : []));
    for (const state of run.blocks) state.activeToolCalls = undefined;
    const concurrency = run.definition?.settings?.concurrency ?? host.concurrency;
    run.status = host.runActivityStatus(run); run.startedAt ??= new Date().toISOString(); const background = new Set<Promise<void>>(); host.executions.set(run.id, { run, blocks, edges, outputs, dispatch, append, defaultProvider, background, stackInvocations: new Map(), loopInvocations: new Map(), turnClaims: new Map(), scheduler: new ExecutionScheduler(concurrency, () => host.assertActive(run.id), () => host.schedulingReady(run.id)) });
    if (recovering) for (const state of run.blocks) if (isActiveStatus(state.status)) host.log(state, "lifecycle", "Core restarted and reconciled this workflow stage");
    const running = new Map<string, Promise<{ blockId: string; error?: unknown }>>();
    try {
      if (isHarnessFlow({ blocks, edges })) {
        await host.executeFlow(host.executions.get(run.id)!, startBlockId);
        run.status = "succeeded"; run.completedAt = new Date().toISOString(); await host.recordCompletedOperation(run, "terminal_outcome", "terminal:succeeded", undefined, { status: "succeeded" }); await host.update(run); return;
      }
      await host.update(run);
      while (running.size || background.size || run.blocks.some((block) => isActiveStatus(block.status))) {
        if (host.suspended || host.cancelled.has(run.id)) throw new Cancelled();
        let changed = false;
        if (run.paused) { await host.schedulingReady(run.id); }
        for (const blockId of order) {
          if (running.size >= concurrency) break;
          const state = run.blocks.find((item) => item.blockId === blockId)!;
          if (!["queued", "waiting"].includes(state.status)) continue;
          const readiness = blockReadiness(blockId, blocks, edges, run.blocks);
          if (readiness === "wait") { if (state.status !== "waiting") { state.status = "waiting"; host.log(state, "lifecycle", "Waiting for upstream blocks"); await host.recordCompletedOperation(run, "dependency_decision", `dependency:${blockId}:wait:${state.attempts?.length ?? 0}`, blockId, { decision: "wait" }); changed = true; } continue; }
          if (readiness === "skip") { state.status = "skipped"; state.completedAt = new Date().toISOString(); await host.recordCompletedOperation(run, "dependency_decision", `dependency:${blockId}:skip:${state.attempts?.length ?? 0}`, blockId, { decision: "skip" }); changed = true; continue; }
          await host.recordCompletedOperation(run, "dependency_decision", `dependency:${blockId}:ready:${state.attempts?.length ?? 0}`, blockId, { decision: "ready" });
          const block = blocks.find((item) => item.id === blockId)!; state.status = "running"; changed = true;
          const task = host.executeBlock(run, block, blocks, edges, outputs, dispatch, defaultProvider).then(() => ({ blockId }), async (error) => {
            const failure = workflowFailure(error); const reason = classifyWorkflowFailure(error);
            if (host.cancelled.has(run.id) || (!blocks.some((item) => item.watchdog) && reason !== "schema_validation")) return { blockId, error };
            let message = failure.message;
            state.error = message; state.failureReason = reason;
            if (isRetryableFailure(reason)) state.retryStartedAt ??= new Date().toISOString();
            const policy = host.policy(run);
            state.retryAt = nextRetryAt(reason, state.recoveryAttempts ?? 0, policy, state.retryStartedAt, failure.retryAfter);
            const cannotSchedule = reason === "transient_transport" && state.retryAt === undefined;
            const exhausted = cannotSchedule || retryBudgetExhausted(state.retryStartedAt, policy) || (state.recoveryAttempts ?? 0) >= policy.maxAttempts;
            state.status = (isRetryableFailure(reason) && !exhausted) || reason === "schema_validation" ? "retry_scheduled" : "failed";
            if (exhausted && isRetryableFailure(reason)) { message += " Automatic retry budget exhausted; retry this block manually after resolving the provider issue."; state.error = message; }
            state.pauseId = state.status === "retry_scheduled" ? crypto.randomUUID() : undefined;
            run.status = host.runActivityStatus(run);
            host.log(state, "error", message); await host.update(run);
            return { blockId };
          });
          running.set(blockId, task);
        }
        if (changed) await host.update(run);
        if (!running.size) {
          if (background.size) { await Promise.race(background); continue; }
          if (run.blocks.some((block) => pauseStatuses.has(block.status))) { await new Promise((resolve) => setTimeout(resolve, 250)); continue; }
          if (run.blocks.some((block) => ["queued", "waiting"].includes(block.status))) throw new Error("Harness could not resolve its remaining paths");
          break;
        }
        let tick: ReturnType<typeof setTimeout> | undefined;
        const completed = await Promise.race([...running.values(), new Promise<undefined>((resolve) => { tick = setTimeout(() => resolve(undefined), 250); })]);
        if (tick) clearTimeout(tick);
        if (completed) { running.delete(completed.blockId); if (completed.error) throw completed.error; }
      }
      if (host.cancelled.has(run.id)) throw new Cancelled();
      const blocked = run.blocks.find((block) => block.status === "blocked"); if (blocked) throw new BlockedCorrection(blocked.error ?? "Workflow correction cycle is blocked");
      const failed = run.blocks.find((block) => block.status === "failed"); if (failed) throw new Error(failed.error ?? "Asynchronous workflow block failed");
      const incompleteFeatures = run.features?.filter((feature) => feature.status !== "completed") ?? [];
      if (incompleteFeatures.length) throw new Error(`Workflow delivery is blocked: planned features were not completed: ${incompleteFeatures.map((feature) => `${feature.id} (${feature.status})`).join(", ")}`);
      run.status = "succeeded"; run.completedAt = new Date().toISOString(); await host.recordCompletedOperation(run, "terminal_outcome", `terminal:${run.status}`, undefined, { status: run.status, completedAt: run.completedAt }); await host.update(run);
    } catch (error) {
      const cancelled = error instanceof Cancelled || host.cancelled.has(run.id); run.status = cancelled ? "cancelled" : error instanceof BlockedCorrection ? "blocked" : "failed"; run.error = cancelled ? undefined : error instanceof Error ? error.message : String(error); run.completedAt = new Date().toISOString();
      for (const block of run.blocks) if (isActiveStatus(block.status)) { block.status = cancelled ? "cancelled" : block.status === "running" ? "failed" : "cancelled"; if (block.status === "failed") { block.error = run.error; block.failureReason = classifyWorkflowFailure(error); } }
      await host.recordCompletedOperation(run, "terminal_outcome", `terminal:${run.status}`, undefined, { status: run.status, error: run.error, completedAt: run.completedAt }); await host.update(run);
    } finally {
      await Promise.allSettled([...running.values(), ...background]);
      if (host.cancelled.has(run.id)) {
        const completedAt = run.completedAt ?? new Date().toISOString(); run.status = "cancelled"; run.completedAt = completedAt; run.error = undefined;
        for (const block of run.blocks) if (isActiveStatus(block.status)) { block.status = "cancelled"; block.completedAt = completedAt; block.error = undefined; }
        await host.update(run);
      }
      host.meetingUpdates.cancel(run.id);
      host.retryEntries.delete(run.id); host.flowInvocations.delete(run.id); host.cancelled.delete(run.id); host.activeRuns.delete(run.id); host.activeProviders.delete(run.id); host.executions.delete(run.id);
    }
  }
