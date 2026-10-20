import type { HarnessFailureReason } from "@hatopad/protocol";
import { AiProviderError, normalizeAiFailure, type AiFailure } from "@hatopad/acp";
import { HarnessSchemaError } from "../harness-graph.js";
import type { AiUsage } from "@hatopad/acp";
import { Cancelled } from "./errors.js";
import { ResolvedRecoveryPolicy } from "./types.js";

export const activeStatuses = new Set([
  "queued",
  "running",
  "waiting",
  "awaiting_permission",
  "awaiting_user_input",
  "waiting_timer",
  "retry_scheduled",
]);

export const pauseStatuses = new Set([
  "awaiting_permission",
  "awaiting_user_input",
  "waiting_timer",
  "retry_scheduled",
]);

export const providerActiveStatuses = new Set([
  "running",
  "awaiting_permission",
  "awaiting_user_input",
  "waiting_timer",
]);

export function isActiveStatus(status: string): boolean {
  return activeStatuses.has(status);
}

export function isRecoverableWorkflowError(message: string): boolean {
  return isRetryableFailure(classifyWorkflowFailure(message));
}

export function classifyWorkflowFailure(error: unknown): HarnessFailureReason {
  if (error instanceof Cancelled) return "cancelled";
  if (error instanceof HarnessSchemaError) return "schema_validation";
  return workflowFailure(error).kind;
}

export function workflowFailure(error: unknown): AiFailure {
  if (error instanceof Cancelled) return { kind: "cancelled", message: error.message || "Workflow cancelled" };
  if (error instanceof HarnessSchemaError) return { kind: "permanent", message: error.message };
  if (error instanceof AiProviderError) return (error as AiProviderError).failure;
  if (isAiFailure(error)) return error;
  return normalizeAiFailure(error);
}

export function isAiFailure(value: unknown): value is AiFailure {
  return Boolean(value && typeof value === "object" && "kind" in value && "message" in value);
}

export function isRetryableFailure(reason: HarnessFailureReason): boolean {
  return reason === "quota_exhausted" || reason === "transient_transport";
}

export function retryDue(value?: string): boolean {
  return value === undefined || Date.parse(value) <= Date.now();
}

export function nextRetryAt(
  reason: HarnessFailureReason,
  attempts: number,
  policy: ResolvedRecoveryPolicy,
  startedAt?: string,
  providerRetryAfter?: string,
): string | undefined {
  if (providerRetryAfter && Date.parse(providerRetryAfter) > Date.now())
    return withinRetryBudget(providerRetryAfter, startedAt, policy) ? providerRetryAfter : undefined;
  if (reason !== "transient_transport") return undefined;
  const base = policy.transportBackoffMs * 2 ** attempts;
  const jitter = base * policy.jitterRatio * (policy.random() * 2 - 1);
  const value = new Date(Date.now() + Math.max(0, base + jitter)).toISOString();
  return withinRetryBudget(value, startedAt, policy) ? value : undefined;
}

export function retryBudgetExhausted(startedAt: string | undefined, policy: ResolvedRecoveryPolicy): boolean {
  return startedAt !== undefined && Date.now() - Date.parse(startedAt) >= policy.maxElapsedMs;
}

export function withinRetryBudget(
  value: string,
  startedAt: string | undefined,
  policy: ResolvedRecoveryPolicy,
): boolean {
  return startedAt === undefined || Date.parse(value) - Date.parse(startedAt) <= policy.maxElapsedMs;
}

export function nextWatchdogReset(usage?: AiUsage, now = Date.now()): string {
  const windows = [usage?.accountQuota?.primary, usage?.accountQuota?.secondary].filter(
    (window) => window !== undefined,
  );
  const exhausted = windows.filter((window) => window.remainingPercent <= 0 || window.usedPercent >= 100);
  const candidates = (exhausted.length ? exhausted : windows)
    .map((window) => Date.parse(window.resetsAt ?? ""))
    .filter((time) => Number.isFinite(time) && time > now);
  if (exhausted.length && candidates.length !== exhausted.length) return new Date(now + 300_000).toISOString();
  const topLevel = Date.parse(usage?.resetsAt ?? "");
  if (!windows.length && topLevel > now) candidates.push(topLevel);
  return new Date(
    candidates.length ? (exhausted.length ? Math.max(...candidates) : Math.min(...candidates)) : now + 300_000,
  ).toISOString();
}
