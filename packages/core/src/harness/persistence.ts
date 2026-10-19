import { publishMeetingStatusChanges } from "../workflow-meeting.js";
import type { HarnessRun, HarnessOperation, HarnessOperationKind } from "@hatopad/protocol";
import { operationId, journalValue } from "./context.js";
import type { HarnessRunner } from "../harness-runner.js";

type UpdateHost = {
  suspended: HarnessRunner["suspended"];
  meetingParticipantStatuses: HarnessRunner["meetingParticipantStatuses"];
  executions: HarnessRunner["executions"];
  updateQueue: HarnessRunner["updateQueue"];
  store: HarnessRunner["store"];
  changed: HarnessRunner["changed"];
  meetingUpdates: HarnessRunner["meetingUpdates"];
};

export async function harnessUpdate(host: UpdateHost, run: HarnessRun): Promise<void> {
    if (host.suspended) return;
    let statuses = host.meetingParticipantStatuses.get(run);
    if (!statuses) { statuses = new Map(); host.meetingParticipantStatuses.set(run, statuses); }
    const changedRooms = publishMeetingStatusChanges(run, statuses);
    const execution = host.executions.get(run.id);
    for (const roomId of changedRooms) execution?.outputs.set(roomId, run.blocks.find((block) => block.blockId === roomId)!.output!);
    const limit = run.definition?.settings?.logLimitEntries ?? 500;
    for (const block of run.blocks) if (block.log && block.log.length > limit) block.log = block.log.slice(-limit);
    const snapshot = structuredClone(run); const next = host.updateQueue.then(async () => { await host.store.saveRun(snapshot); host.changed(run.id); });
    host.updateQueue = next.catch(() => undefined); await next;
    for (const roomId of changedRooms) host.meetingUpdates.publish(run.id, roomId);
  }

type BeginOperationHost = {
  update: HarnessRunner["update"];
};

export async function harnessBeginOperation(host: BeginOperationHost, run: HarnessRun, kind: HarnessOperationKind, idempotencyKey: string, blockId?: string, input?: unknown, attemptId?: string): Promise<HarnessOperation> {
    const existing = run.operations?.find((operation) => operation.idempotencyKey === idempotencyKey); if (existing) return existing;
    const now = new Date().toISOString(); const operation: HarnessOperation = { id: operationId(run.id, idempotencyKey), idempotencyKey, kind, status: "intent", createdAt: now, updatedAt: now, ...(blockId ? { blockId } : {}), ...(attemptId ? { attemptId } : {}), ...(input === undefined ? {} : { input: journalValue(input) }) };
    run.operations = [...(run.operations ?? []), operation]; await host.update(run); return operation;
  }

type FinishOperationHost = {
  update: HarnessRunner["update"];
};

export async function harnessFinishOperation(host: FinishOperationHost, run: HarnessRun, operation: HarnessOperation, status: "succeeded" | "failed", result?: unknown, error?: unknown): Promise<void> {
    operation.status = status; operation.updatedAt = new Date().toISOString(); operation.result = result === undefined ? undefined : journalValue(result); operation.error = status === "failed" ? (error instanceof Error ? error.message : String(error)).slice(-20_000) : undefined; await host.update(run);
  }

type RecordCompletedOperationHost = {
  finishOperation: HarnessRunner["finishOperation"];
  update: HarnessRunner["update"];
};

export async function harnessRecordCompletedOperation(host: RecordCompletedOperationHost, run: HarnessRun, kind: HarnessOperationKind, idempotencyKey: string, blockId: string | undefined, result: unknown, attemptId?: string): Promise<void> {
    const existing = run.operations?.find((operation) => operation.idempotencyKey === idempotencyKey);
    if (existing?.status === "succeeded") return;
    if (existing) { await host.finishOperation(run, existing, "succeeded", result); return; }
    const now = new Date().toISOString(); const operation: HarnessOperation = { id: operationId(run.id, idempotencyKey), idempotencyKey, kind, status: "succeeded", createdAt: now, updatedAt: now, result: journalValue(result), ...(blockId ? { blockId } : {}), ...(attemptId ? { attemptId } : {}) };
    run.operations = [...(run.operations ?? []), operation]; await host.update(run);
  }
