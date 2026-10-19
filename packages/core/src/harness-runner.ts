import crypto from "node:crypto";
import { MeetingUpdates } from "./workflow-meeting.js";
import type { HarnessDefinition, HarnessBlock, HarnessConnectionTrace, HarnessBlockRun, HarnessEdge, HarnessRun, HarnessLogEntry, HarnessChildTask, HarnessPauseStatus, HarnessOperation, HarnessOperationKind, HarnessFeature, HarnessCorrectionCycle, AiSession } from "@hatopad/protocol";
import { findAutopilotOption } from "@hatopad/acp";
import { CoreError } from "./errors.js";
import { isHarnessFlow, HarnessSchemaError, parseHarnessData, validateHarness } from "./harness-graph.js";
import type { HarnessStore } from "./harnesses.js";
import type { AiUsage } from "@hatopad/acp";
import { type FetchCursors } from "./workflow-fetch.js";
import { contextHash, contextResult } from "./workflow-context.js";
import { ActiveExecution, ResolvedRecoveryPolicy, RecoveryPolicy, AnswerQuestion, Dispatch, Append, HarnessRecoveryInspector, Interrupt, ResolvePermission, FireTimer } from "./harness/types.js";
import { validFeature, hasFeatureCycle, readyFeatures, parseReviewReport, parseCorrectionRevision } from "./harness/review.js";
import { journalValue, isolatedBlockDefinition, connectedInput, chatResponse, blocksById, operationId } from "./harness/context.js";
import { classifyWorkflowFailure, isRetryableFailure, retryDue, retryBudgetExhausted, nextRetryAt, nextWatchdogReset, isActiveStatus, providerActiveStatuses, isRecoverableWorkflowError } from "./harness/recovery.js";
import { Cancelled, RunDurationExceeded } from "./harness/errors.js";
import { blockReadiness } from "./harness/scheduler.js";
import { harnessExecute } from "./harness/run-execution.js";
import { harnessCallFlowTool, harnessFetchUnread } from "./harness/flow-tools.js";
import { harnessExecuteFlow } from "./harness/flow-execution.js";
import { harnessExecuteBlock } from "./harness/block-execution.js";
import { harnessUpdate, harnessBeginOperation, harnessFinishOperation, harnessRecordCompletedOperation } from "./harness/persistence.js";

export class HarnessRunner {
  private readonly meetingParticipantStatuses = new WeakMap<HarnessRun, Map<string, string>>();
  private readonly meetingUpdates = new MeetingUpdates();
  private readonly flowInvocations = new Map<string, (id: string, input: string, ancestors?: string[]) => Promise<string>>();
  private readonly appToolCalls = new Map<string, Promise<unknown>>();
  private readonly contextReads = new Map<string, { sessionId?: string; outputs: Map<string, string>; reads: Map<string, string>; fetched: FetchCursors }>();
  private readonly agentStarts = new Set<string>();
  private readonly resumingChats = new Set<string>();
  // Steering adds user messages inside a turn; it must not move the transcript boundary.
  private readonly chatTurnUsers = new WeakMap<HarnessRun["blocks"][number], string | null>();
  private readonly latestChatResponse = new WeakMap<HarnessBlockRun, string>();
  private readonly chatResponsePrefix = new WeakMap<HarnessBlockRun, string>();
  private readonly chatSteeringDeliveries = new WeakMap<HarnessBlockRun, Promise<void>>();
  private chatAdmissionQueue = Promise.resolve();
  private readonly flowAnswers = new Map<string, (answer: string) => void>();
  private readonly cancelled = new Set<string>();
  private readonly retryAdmissions = new Set<string>();
  private readonly retryEntries = new Map<string, string[]>();
  private suspended = false;
  private readonly executionTasks = new Set<Promise<void>>();
  /** Freeze durable snapshots so restart recovery sees in-flight operations, not a false cancellation. */
  async suspend(): Promise<void> { this.suspended = true; this.meetingUpdates.cancel(); await this.updateQueue; }
  async drain(): Promise<void> { await Promise.all([...this.executionTasks]); }
  private launchExecution(...args: Parameters<HarnessRunner["execute"]>): void {
    if (this.suspended) return;
    const pending = this.execute(...args);
    this.executionTasks.add(pending);
    void pending.finally(() => this.executionTasks.delete(pending)).catch((error) => console.error("[core] Workflow finalization failed", error));
  }

  private readonly activeRuns = new Set<string>();
  private readonly activeProviders = new Map<string, Set<string>>();
  private readonly executions = new Map<string, ActiveExecution>();
  private readonly resolvingPauses = new Set<string>();
  private readonly operationsInFlight = new Map<string, Promise<unknown>>();
  private updateQueue = Promise.resolve();
  private readonly recovery: ResolvedRecoveryPolicy;
  constructor(private readonly store: HarnessStore, private readonly changed: (runId: string) => void, private readonly concurrency = 4, recovery: RecoveryPolicy = { maxAttempts: 3, transportBackoffMs: 5_000 }, private readonly openDocument?: (document: { runId: string; blockId: string; title: string; content: string }) => void, private readonly steerAgent?: AnswerQuestion) {
    this.recovery = { maxElapsedMs: 15 * 60_000, jitterRatio: 0.2, random: Math.random, ...recovery };
  }

  isFlowBlock(runId: string, blockId: string): boolean { return this.executions.get(runId)?.blocks.some((block) => block.id === blockId && ["ai", "chatbox"].includes(block.type)) ?? false; }

  isActive(runId: string): boolean { return !this.suspended && this.activeRuns.has(runId) && !this.cancelled.has(runId); }

  async registerChild(runId: string, child: Omit<HarnessChildTask, "recoveryAttempts">): Promise<void> {
    const execution = this.executions.get(runId);
    if (!execution || !this.isActive(runId)) throw new Error("Workflow is no longer active");
    execution.run.children ??= [];
    if (!execution.run.children.some((item) => item.taskId === child.taskId && item.provider === child.provider)) {
      const limit = execution.run.definition?.settings?.maxChildTasks ?? 100;
      if (execution.run.children.length >= limit) throw new CoreError("INVALID_REQUEST", `Workflow reached its limit of ${limit} child task${limit === 1 ? "" : "s"}`);
      execution.run.children.push({ ...child, recoveryAttempts: 0 });
    }
    await this.recordCompletedOperation(execution.run, "child_registration", `child:${child.taskId}:${child.provider}`, child.blockId, { taskId: child.taskId, provider: child.provider, workspace: child.workspace });
    await this.update(execution.run);
  }

  async planFeatures(runId: string, planned: Array<{ id: string; prompt: string; prerequisites?: string[] }>): Promise<HarnessFeature[]> {
    const execution = this.activeExecution(runId);
    if (!planned.length || planned.some((feature) => !validFeature(feature))) throw new CoreError("INVALID_REQUEST", "Each planned feature needs a unique ID, prompt, and valid prerequisite IDs");
    const ids = new Set(planned.map((feature) => feature.id));
    if (ids.size !== planned.length || planned.some((feature) => (feature.prerequisites ?? []).some((dependency) => dependency === feature.id || !ids.has(dependency)))) throw new CoreError("INVALID_REQUEST", "Feature prerequisites must refer to another planned feature and cannot include themselves");
    if (hasFeatureCycle(planned)) throw new CoreError("INVALID_REQUEST", "Feature prerequisites contain a cycle");
    if (execution.run.features?.length) {
      const current = JSON.stringify(execution.run.features.map(({ id, prompt, prerequisites }) => ({ id, prompt, prerequisites })));
      const requested = JSON.stringify(planned.map(({ id, prompt, prerequisites = [] }) => ({ id, prompt, prerequisites })));
      if (current !== requested) throw new CoreError("INVALID_REQUEST", "The workflow feature plan is already durable and cannot be replaced mid-run");
      return structuredClone(execution.run.features);
    }
    execution.run.features = planned.map((feature) => ({ id: feature.id, prompt: feature.prompt, prerequisites: [...feature.prerequisites ?? []], status: "planned" }));
    await this.recordCompletedOperation(execution.run, "tool_command", "feature-plan", undefined, { features: execution.run.features });
    await this.update(execution.run);
    return structuredClone(execution.run.features);
  }

  async dispatchFeature(runId: string, featureId: string, taskId: string): Promise<HarnessFeature> {
    const execution = this.activeExecution(runId); const existing = execution.run.features?.find((item) => item.id === featureId);
    if (existing?.status === "dispatched" && existing.taskId === taskId) return structuredClone(existing);
    const feature = this.readyFeature(execution, featureId);
    feature.status = "dispatched"; feature.taskId = taskId;
    await this.recordCompletedOperation(execution.run, "tool_command", `feature-dispatch:${featureId}`, undefined, { featureId, taskId });
    await this.update(execution.run); return structuredClone(feature);
  }

  async completeFeature(runId: string, taskId: string, commit: string): Promise<{ completed: HarnessFeature; ready: HarnessFeature[] }> {
    const execution = this.activeExecution(runId); const feature = execution.run.features?.find((item) => item.taskId === taskId);
    if (!feature) throw new CoreError("INVALID_REQUEST", `Task '${taskId}' is not assigned to a planned feature`);
    if (feature.status === "completed") return { completed: structuredClone(feature), ready: readyFeatures(execution.run.features ?? []) };
    if (feature.status !== "dispatched" || !/^[0-9a-f]{7,64}$/i.test(commit)) throw new CoreError("INVALID_REQUEST", "Only a dispatched feature with a merged commit can complete");
    feature.status = "completed"; feature.commit = commit;
    await this.recordCompletedOperation(execution.run, "tool_command", `feature-complete:${feature.id}`, undefined, { featureId: feature.id, taskId, commit });
    await this.update(execution.run); return { completed: structuredClone(feature), ready: readyFeatures(execution.run.features ?? []) };
  }

  async runOperation<T>(runId: string, blockId: string, kind: HarnessOperationKind, idempotencyKey: string, input: unknown, effect: () => Promise<T>, reconcile?: () => Promise<T | null | undefined>): Promise<T> {
    const execution = this.executions.get(runId);
    if (!execution || !this.isActive(runId)) throw new Error("Workflow is no longer active");
    const key = `${blockId}:${idempotencyKey}`; const localKey = `${runId}:${key}`;
    const existing = execution.run.operations?.find((operation) => operation.idempotencyKey === key);
    if (existing?.status === "succeeded") return structuredClone(existing.result) as T;
    const inFlight = this.operationsInFlight.get(localKey); if (inFlight) return await inFlight as T;
    const work = (async () => {
      if (existing?.status === "intent") {
        const recovered = await reconcile?.();
        this.assertActive(runId);
        if (recovered === undefined) throw new CoreError("INVALID_REQUEST", `Operation '${idempotencyKey}' has an unresolved outcome; recovery must reconcile it before retrying`);
        // null means reconciliation proved that the external effect never began,
        // so replay is safe. undefined deliberately preserves the blocked intent.
        if (recovered !== null) { await this.finishOperation(execution.run, existing, "succeeded", recovered); return recovered; }
      }
      const operation = existing ?? await this.beginOperation(execution.run, kind, key, blockId, input);
      if (existing) { operation.status = "intent"; operation.error = undefined; operation.result = undefined; operation.input = journalValue(input); operation.updatedAt = new Date().toISOString(); await this.update(execution.run); }
      let result: T;
      try { this.assertActive(runId); result = await effect(); this.assertActive(runId); }
      catch (error) { operation.error = (error instanceof Error ? error.message : String(error)).slice(-20_000); operation.updatedAt = new Date().toISOString(); await this.update(execution.run); throw error; }
      await this.finishOperation(execution.run, operation, "succeeded", result); return result;
    })();
    this.operationsInFlight.set(localKey, work);
    try { return await work; } finally { if (this.operationsInFlight.get(localKey) === work) this.operationsInFlight.delete(localKey); }
  }

  async runTimerOperation<T>(runId: string, blockId: string, idempotencyKey: string, input: unknown, effect: () => Promise<T>, reconcile?: () => Promise<T | null | undefined>): Promise<T> {
    const execution = this.executions.get(runId);
    if (!execution || !this.isActive(runId)) throw new Error("Workflow is no longer active");
    return execution.scheduler.control(blockId, () => this.runOperation(runId, blockId, "timer_fire", idempotencyKey, input, async () => {
      const state = execution.run.blocks.find((block) => block.blockId === blockId);
      if (this.isFlowBlock(runId, blockId) && state?.status === "waiting_timer") { state.status = "running"; state.waitingUntil = undefined; state.pauseId = undefined; execution.run.status = this.runActivityStatus(execution.run); await this.update(execution.run); }
      return effect();
    }, reconcile));
  }

  async recordTool(runId: string, blockId: string, name: string, args: Record<string, unknown>, result?: unknown, error?: unknown): Promise<void> {
    const execution = this.executions.get(runId); if (!execution) return;
    const key = `tool:${name}:${crypto.randomUUID()}`; const operation = await this.beginOperation(execution.run, "tool_command", key, blockId, { name, args });
    await this.finishOperation(execution.run, operation, error === undefined ? "succeeded" : "failed", result, error);
  }

  async recoverChildren(runId: string, inspect: (child: HarnessChildTask) => Promise<AiSession | undefined>, resume: (child: HarnessChildTask, session: AiSession) => Promise<unknown>): Promise<void> {
    const execution = this.executions.get(runId);
    if (!execution || !this.isActive(runId)) return;
    const policy = this.policy(execution.run);
    for (const child of execution.run.children ?? []) {
      if (!this.isActive(runId)) return;
      const state = execution.run.blocks.find((block) => block.blockId === child.blockId)!;
      try {
        this.assertActive(runId);
        const session = await inspect(child);
        this.assertActive(runId);
        if (!session || session.status !== "error" || child.recoveryAttempts >= policy.maxAttempts) continue;
        const fallback = session.messages.filter((message) => message.role === "error" || message.role === "assistant").slice(-2).map((message) => message.text).join("\n");
        child.failureReason = classifyWorkflowFailure(session.failure ?? fallback);
        child.retryStartedAt ??= new Date().toISOString();
        if (!isRetryableFailure(child.failureReason) || !retryDue(child.retryAt) || retryBudgetExhausted(child.retryStartedAt, policy) || !this.isActive(runId)) continue;
        child.recoveryAttempts += 1; child.recoveryError = undefined; child.retryAt = undefined;
        this.log(state, "lifecycle", `Resuming child ${child.taskId} after ${child.failureReason}, attempt ${child.recoveryAttempts}/${policy.maxAttempts}`);
        await this.update(execution.run);
        this.assertActive(runId);
        await resume(child, session);
        this.assertActive(runId);
      } catch (error) {
        if (error instanceof Cancelled) return;
        child.recoveryError = error instanceof Error ? error.message : String(error);
        child.failureReason = classifyWorkflowFailure(error);
        child.retryAt = nextRetryAt(child.failureReason, child.recoveryAttempts, policy, child.retryStartedAt);
        this.log(state, "error", `Child ${child.taskId} recovery: ${child.recoveryError}`);
      }
      await this.update(execution.run);
    }
  }

  async watch(runId: string, blockId: string, usage: () => Promise<AiUsage>, recoverChildren: () => Promise<void> = async () => undefined): Promise<AiSession> {
    const execution = this.executions.get(runId);
    const state = execution?.run.blocks.find((item) => item.blockId === blockId);
    if (!execution || !state) throw new Error("Workflow is no longer active");
    this.log(state, "lifecycle", "Core watchdog started; no AI session or model tokens required");
    while (this.isActive(runId) && !this.deliveryIsTerminal(execution)) {
      const snapshot = await usage().catch(() => undefined);
      if (!this.isActive(runId)) break;
      if (this.deliveryIsTerminal(execution)) break;
      state.waitingUntil = nextWatchdogReset(snapshot);
      this.log(state, "lifecycle", `Core watchdog sleeping until ${state.waitingUntil}`);
      await this.update(execution.run);
      while (this.isActive(runId) && !this.deliveryIsTerminal(execution) && Date.now() < Date.parse(state.waitingUntil)) await new Promise((resolve) => setTimeout(resolve, 250));
      if (!this.isActive(runId)) break;
      if (this.deliveryIsTerminal(execution)) break;
      await this.schedulingReady(runId);
      await recoverChildren();
      if (!this.isActive(runId)) break;
      const { resumed } = await this.resumeFailed(runId, blockId);
      this.log(state, "lifecycle", `Core watchdog woke; queued ${resumed.length} eligible failed stages`);
      state.waitingUntil = undefined;
      await this.update(execution.run);
    }
    if (this.isActive(runId) && this.deliveryIsTerminal(execution)) {
      state.waitingUntil = undefined;
      this.log(state, "lifecycle", "Core watchdog stopped because delivery reached a terminal state");
      await this.update(execution.run);
      return { model: "core", reasoning: "none", status: "done", messages: [] };
    }
    throw new Cancelled();
  }

  async readRun(runId: string): Promise<HarnessRun | undefined> {
    const live = this.executions.get(runId)?.run;
    return live ? structuredClone(live) : (await this.store.runs()).find((run) => run.id === runId);
  }

  async start(harnessId: string, input: string, dispatch: Dispatch, defaultProvider = "codex", append?: Append, startBlockId?: string, rerunRunId?: string, testDefinition?: HarnessDefinition, workspace?: string, prepareDefinition?: (definition: HarnessDefinition) => Promise<HarnessDefinition>, binding?: HarnessRun["binding"], chatSettings?: { blockId: string; settings: import("@hatopad/protocol").HarnessChatSettings }): Promise<HarnessRun> {
    if (this.suspended) throw new CoreError("INVALID_REQUEST", "Core is shutting down");
    const source = rerunRunId ? (await this.store.runs()).find((run) => run.id === rerunRunId) : undefined;
    if (rerunRunId && !source) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
    if (rerunRunId && !source?.definition) throw new CoreError("INVALID_REQUEST", "This workflow run has no frozen definition to rerun");
    input = source?.input ?? input;
    if (input.length > 100_000) throw new CoreError("INVALID_REQUEST", "Harness input must contain 1–100,000 characters");
    let harness = testDefinition ? isolatedBlockDefinition(testDefinition, startBlockId!) : source?.definition ?? await this.store.read(harnessId);
    if (prepareDefinition) harness = await prepareDefinition(structuredClone(harness));
    const validation = validateHarness(harness);
    if (!validation.valid) throw new CoreError("INVALID_REQUEST", validation.issues.map((issue) => issue.message).join("; "));
    const starts = harness.blocks.filter((block) => block.type === "start_button" || block.type === "start_input");
    if (startBlockId) {
      const selected = harness.blocks.find((block) => block.id === startBlockId);
      if (!selected) throw new CoreError("INVALID_REQUEST", "Selected workflow block does not exist");
      if (selected.type === "start_button") input = selected.prompt;
      if (!testDefinition && !input.trim()) throw new CoreError("INVALID_REQUEST", "Enter text to start the flow");
    } else if (starts.length) {
      if (starts.length !== 1) throw new CoreError("INVALID_REQUEST", "Select a flow start block");
      startBlockId = starts[0]!.id;
      if (starts[0]!.type === "start_button") input = starts[0]!.prompt;
      if (!input.trim()) throw new CoreError("INVALID_REQUEST", "Enter text to start the flow");
    }
    const createdAt = new Date().toISOString();
    const run: HarnessRun = { binding: source?.binding ?? binding, workspace: binding?.workspace ?? source?.workspace ?? workspace, id: crypto.randomUUID(), harnessId, harnessVersion: harness.version, input: input.trim(), status: "queued", createdAt, blocks: validation.order.map((blockId) => ({ blockId, status: "queued" })), operations: [] };
    if (chatSettings) {
      const state = run.blocks.find((item) => item.blockId === chatSettings.blockId);
      const block = harness.blocks.find((item) => item.id === chatSettings.blockId);
      if (state && block?.type === "chatbox") state.chatSettings = { ...chatSettings.settings, model: chatSettings.settings.model === undefined ? block.model : chatSettings.settings.model || undefined };
    }
    run.definition = structuredClone(harness);
    run.executionPlan = { version: 1, createdAt, definitionVersion: harness.version, order: [...validation.order], blocks: validation.order.map((blockId) => ({ blockId, incoming: harness.edges.filter((edge) => edge.to === blockId).map((edge) => edge.id), outgoing: harness.edges.filter((edge) => edge.from === blockId).map((edge) => edge.id) })) };
    await this.store.createRun(run, harness.settings?.maxActiveRuns ?? 4); this.changed(run.id);
    this.activeRuns.add(run.id); this.launchExecution(run, harness.blocks, harness.edges, validation.order, dispatch, defaultProvider, append ?? (async () => { throw new Error("This workflow runtime cannot append to an active block session"); }), false, startBlockId);
    return run;
  }

  async continueChat(runId: string, blockId: string, input: string, dispatch: Dispatch, defaultProvider: string, append: Append, binding?: HarnessRun["binding"], settings?: import("@hatopad/protocol").HarnessChatSettings): Promise<HarnessRun> {
    const key = `${runId}:${blockId}`;
    if (this.resumingChats.has(key)) throw new CoreError("INVALID_REQUEST", "Wait for the current workflow turn on this Chatbox to finish before sending another message");
    this.resumingChats.add(key);
    // Serialize admission, not provider turns: concurrent resumes must share one
    // execution and one mutable run rather than load competing store snapshots.
    const previous = this.chatAdmissionQueue;
    let release!: () => void;
    this.chatAdmissionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (typeof input !== "string" || !input.trim() || input.length > 100_000) throw new CoreError("INVALID_REQUEST", "Chat input must contain 1–100,000 characters");
      let execution = this.executions.get(runId);
      // A finished provider turn may still be publishing its final snapshot.
      // Wait for that publication before admitting the next chat turn.
      const finishing = execution?.run.blocks.find((item) => item.blockId === blockId)?.status === "succeeded" ? execution.flowFinishing?.get(blockId) : undefined;
      if (finishing) { await finishing; execution = this.executions.get(runId); }
      const run = execution?.run ?? (await this.store.runs()).find((item) => item.id === runId);
      const definition = run?.definition;
      const block = definition?.blocks.find((item) => item.id === blockId);
      if (!run || !definition || block?.type !== "chatbox") throw new CoreError("INVALID_REQUEST", "Select a Chatbox in an existing workflow run");
      run.binding ??= binding;
      if (run.binding) run.workspace = run.binding.workspace;
      const validation = validateHarness(definition);
      if (!validation.valid) throw new CoreError("INVALID_REQUEST", "This saved workflow definition is invalid");
      const state = run.blocks.find((item) => item.blockId === blockId)!;
      const applySettings = () => {
        if (!settings) return;
        const provider = settings.provider ?? block.provider ?? state.provider ?? defaultProvider;
        const model = settings.model === undefined ? block.model : settings.model || undefined;
        const previousModel = state.chatSettings ? state.chatSettings.model : block.model;
        const changed = provider !== (state.provider ?? block.provider ?? defaultProvider) || model !== previousModel;
        if (changed) {
          state.sessionId = undefined;
          state.workspace = undefined;
          state.context = undefined; state.contextUsed = undefined; state.contextLimit = undefined;
        }
        state.chatSettings = { ...settings, provider, model };
        state.provider = provider;
        if (settings.autopilot !== undefined) state.autopilot = settings.autopilot;
      };
      if (execution) {
        const invoke = this.flowInvocations.get(runId);
        if (!this.isActive(runId) || !isActiveStatus(run.status) || !invoke || execution.flowBusy?.has(blockId) || isActiveStatus(state.status)) throw new CoreError("INVALID_REQUEST", "Wait for the current workflow turn on this Chatbox to finish before sending another message");
        applySettings();
        // invoke claims the block synchronously, before its first persistence await.
        // The flow drains background turns before recording the aggregate outcome.
        let pending!: Promise<void>;
        pending = invoke(blockId, input.trim()).then(() => {}, async (error) => {
          if (!this.isActive(runId)) return;
          state.status = "failed"; state.error = error instanceof Error ? error.message : String(error); state.completedAt = new Date().toISOString(); run.status = this.runActivityStatus(run);
          await this.update(run);
        }).finally(() => execution.background.delete(pending));
        execution.background.add(pending);
        await this.update(run);
        return structuredClone(run);
      }
      if (this.activeRuns.has(runId) || isActiveStatus(run.status)) throw new CoreError("INVALID_REQUEST", "The previous workflow turn is still active");
      applySettings();
      run.input = input.trim(); run.status = "queued"; run.error = undefined; run.completedAt = undefined; run.startedAt = undefined;
      state.status = "queued"; state.error = undefined; state.pendingPermission = undefined; state.question = undefined; state.pauseId = undefined; state.waitingUntil = undefined;
      await this.store.createRun(run, definition.settings?.maxActiveRuns ?? 4);
      this.changed(run.id); this.activeRuns.add(run.id);
      this.launchExecution(run, definition.blocks, definition.edges, validation.order, dispatch, state.provider ?? defaultProvider, append, false, blockId);
      return structuredClone(run);
    } finally { this.resumingChats.delete(key); release(); }
  }

  async recover(dispatch: Dispatch, defaultProvider = "codex", append?: Append, inspector?: HarnessRecoveryInspector): Promise<HarnessRun[]> {
    const recovered: HarnessRun[] = [];
    for (const run of await this.store.runs()) {
      if (!isActiveStatus(run.status)) continue;
      const definition = run.definition;
      const validation = definition ? validateHarness(definition) : undefined;
      if (!definition || !run.executionPlan || !validation?.valid || run.executionPlan.definitionVersion !== run.harnessVersion) {
        await this.failRecovery(run, "The persisted workflow has no valid frozen execution plan. Start a new run; completed sessions and task workspaces were preserved.");
        recovered.push(structuredClone(run)); continue;
      }
      const order = run.executionPlan.order;
      if (order.length !== definition.blocks.length || order.some((id) => !definition.blocks.some((block) => block.id === id))) {
        await this.failRecovery(run, "The persisted workflow execution plan does not match its frozen definition. Start a new run; completed sessions and task workspaces were preserved.");
        recovered.push(structuredClone(run)); continue;
      }
      try { await inspector?.binding?.(run); }
      catch (error) {
        await this.failRecovery(run, `Workflow recovery could not validate its bound worktree: ${error instanceof Error ? error.message : String(error)}`);
        recovered.push(structuredClone(run)); continue;
      }
      if (isHarnessFlow(definition)) {
        await this.failRecovery(run, "Core restarted during this flow. Start a new run; existing AI sessions and block outputs are preserved, and scripts will not be replayed automatically.");
        recovered.push(structuredClone(run)); continue;
      }
      this.activeRuns.add(run.id);
      try {
        await this.reconcilePersistedRun(run, inspector);
        recovered.push(structuredClone(run));
        this.launchExecution(run, definition.blocks, definition.edges, order, dispatch, defaultProvider, append ?? (async () => { throw new Error("This workflow runtime cannot append to an active block session"); }), true);
      } catch (error) {
        this.activeRuns.delete(run.id);
        await this.failRecovery(run, `Workflow recovery could not inspect its persisted resources: ${error instanceof Error ? error.message : String(error)}`);
        recovered.push(structuredClone(run));
      }
    }
    return recovered;
  }

  /** Pause future scheduling; already-running provider/tool calls may finish. */
  async setPaused(runId: string, paused: boolean): Promise<HarnessRun> {
    if (typeof paused !== "boolean") throw new CoreError("INVALID_REQUEST", "paused must be boolean");
    const execution = this.executions.get(runId);
    if (!execution || !this.isActive(runId) || !isActiveStatus(execution.run.status)) throw new CoreError("INVALID_REQUEST", "Only an active workflow can be paused or resumed");
    execution.run.paused = paused;
    await this.update(execution.run);
    return structuredClone(execution.run);
  }

  private async schedulingReady(runId: string): Promise<void> {
    this.assertActive(runId);
    while (this.executions.get(runId)?.run.paused) {
      await new Promise(resolve => setTimeout(resolve, 50)); this.assertActive(runId);
    }
  }

  /** Explicitly continue safe failed stages in the same frozen run, never completed stages. */
  async retryFailedRun(runId: string, dispatch: Dispatch, defaultProvider: string, append: Append): Promise<HarnessRun> {
    if (this.retryAdmissions.has(runId)) throw new CoreError("INVALID_REQUEST", "A workflow retry is already pending");
    this.retryAdmissions.add(runId);
    try {
      if (this.suspended) throw new CoreError("INVALID_REQUEST", "Core is shutting down");
      const execution = this.executions.get(runId);
      const run = execution?.run ?? (await this.store.runs()).find(item => item.id === runId);
      if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
      if (execution && !isActiveStatus(run.status)) throw new CoreError("INVALID_REQUEST", "Workflow is finishing; refresh before retrying");
      if (!execution && !["failed", "blocked"].includes(run.status)) throw new CoreError("INVALID_REQUEST", "Only a failed workflow can be retried");
      const definition = run.definition, validation = definition ? validateHarness(definition) : undefined;
      if (!definition || !run.executionPlan || !validation?.valid || run.executionPlan.definitionVersion !== run.harnessVersion) throw new CoreError("INVALID_REQUEST", "Workflow has no valid frozen execution plan");
      if (run.executionPlan.order.length !== definition.blocks.length || new Set(run.executionPlan.order).size !== definition.blocks.length || run.executionPlan.order.some(id => !definition.blocks.some(block => block.id === id))) throw new CoreError("INVALID_REQUEST", "Workflow has an invalid frozen execution plan");
      const failed = run.blocks.filter(state => ["failed", "retry_scheduled", "blocked"].includes(state.status));
      if (!failed.length) throw new CoreError("INVALID_REQUEST", "There are no failed workflow stages to retry");
      if (execution?.flowBusy && failed.some(state => execution.flowBusy!.has(state.blockId))) throw new CoreError("INVALID_REQUEST", "Workflow block is finishing; refresh before retrying");
      const attempted = run.blocks.filter(state => failed.includes(state) || (state.status === "cancelled" && (state.startedAt !== undefined || (state.attempts?.length ?? 0) > 0)));
      if (attempted.some(state => !["ai", "chatbox", "prompt", "task", "review"].includes(definition.blocks.find(block => block.id === state.blockId)?.type ?? ""))) throw new CoreError("INVALID_REQUEST", "An interrupted script, process or mutation stage has an uncertain outcome; inspect it before starting new work");
      const attemptedIds = new Set(attempted.map(state => state.blockId));
      const bookkeeping = new Set(["block_attempt", "dependency_decision", "route_selection", "prompt_delivery", "session_binding", "terminal_outcome"]);
      if (run.operations?.some(operation => operation.blockId && attemptedIds.has(operation.blockId) && operation.status !== "succeeded" && !bookkeeping.has(operation.kind))) throw new CoreError("INVALID_REQUEST", "A recorded workflow mutation has an uncertain outcome; inspect it before retrying");
      const continued = structuredClone(run);
      continued.status = "queued"; continued.completedAt = undefined; continued.error = undefined;
      for (const state of continued.blocks) if (["failed", "retry_scheduled", "blocked", "cancelled"].includes(state.status)) {
        state.status = "queued"; state.error = undefined; state.completedAt = undefined; state.retryAt = undefined; state.pauseId = undefined; state.pendingPermission = undefined; state.question = undefined;
      }
      if (execution) {
        // Running peers retain their state object references; only failed stages change.
        const flow = isHarnessFlow(definition), invoke = this.flowInvocations.get(runId);
        if (flow && !invoke) throw new CoreError("INVALID_REQUEST", "Workflow is finishing; refresh before retrying");
        for (const state of run.blocks) if (["failed", "retry_scheduled", "blocked", "cancelled"].includes(state.status)) Object.assign(state, continued.blocks.find(item => item.blockId === state.blockId)!);
        run.status = this.runActivityStatus(run); run.error = undefined; run.completedAt = undefined;
        await this.update(run);
        if (flow && invoke) {
          this.retryEntries.set(runId, failed.map(state => state.blockId));
          let task!: Promise<void>;
          task = Promise.allSettled(failed.map(state => invoke(state.blockId, connectedInput(state.blockId, run.input, execution.blocks, execution.edges, execution.outputs)))).then(() => undefined).finally(() => execution.background.delete(task));
          execution.background.add(task);
        }
        return structuredClone(run);
      }
      await this.store.createRun(continued, definition.settings?.maxActiveRuns ?? 4, true);
      this.retryEntries.set(runId, validation.order.filter(id => failed.some(state => state.blockId === id)));
      this.cancelled.delete(runId); this.activeRuns.add(runId); this.changed(runId);
      this.launchExecution(continued, definition.blocks, definition.edges, run.executionPlan.order, dispatch, defaultProvider, append, false);
      return structuredClone(continued);
    } finally { this.retryAdmissions.delete(runId); }
  }

  async cancel(runId: string, interrupt: Interrupt): Promise<HarnessRun> {
    const persisted = (await this.store.runs()).find((item) => item.id === runId);
    const execution = this.executions.get(runId); const run = execution?.run ?? persisted;
    if (!run) throw new CoreError("FILE_NOT_FOUND", "Harness run does not exist");
    if (!isActiveStatus(run.status)) return run;
    if (this.activeRuns.has(runId)) this.cancelled.add(runId);
    this.meetingUpdates.cancel(runId);
    const active = run.blocks.filter((block) => providerActiveStatuses.has(block.status) && block.provider);
    const completedAt = new Date().toISOString(); run.status = "cancelled"; run.completedAt = completedAt; run.error = undefined;
    for (const block of run.blocks) if (isActiveStatus(block.status)) { block.status = "cancelled"; block.completedAt = completedAt; block.error = undefined; }
    run.cleanupErrors = undefined; await this.recordCompletedOperation(run, "terminal_outcome", "terminal:cancelled", undefined, { status: "cancelled", completedAt }); await this.update(run);
    const targets = [
      ...active.map((block) => ({ label: `block ${block.blockId}`, provider: block.provider!, context: { runId, blockId: block.blockId, workspace: block.workspace } })),
      ...(run.children ?? []).map((child) => ({ label: `child task ${child.taskId}`, provider: child.provider, context: { runId, blockId: child.blockId, workspace: child.workspace } }))
    ];
    const cleanup = await Promise.allSettled(targets.map((target) => interrupt(target.provider, target.context)));
    run.cleanupErrors = cleanup.flatMap((result, index) => result.status === "rejected" ? [`Could not stop ${targets[index]!.label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
    if (!run.cleanupErrors.length) run.cleanupErrors = undefined;
    else await this.update(run);
    return run;
  }

  async setAutopilot(runId: string, blockId: string, sessionId: string, enabled: boolean, configure: (provider: string, workspace: string, sessionId: string, enabled: boolean) => Promise<AiSession>): Promise<HarnessRun> {
    if (typeof enabled !== "boolean") throw new CoreError("INVALID_REQUEST", "Autopilot must be a boolean");
    const execution = this.executions.get(runId);
    const run = execution?.run ?? await this.readRun(runId);
    const state = run?.blocks.find((item) => item.blockId === blockId);
    const block = run?.definition?.blocks.find((item) => item.id === blockId);
    if (!run || block?.type !== "chatbox" || !state?.workspace || !state.provider || !sessionId || state.sessionId !== sessionId || ["cancelled", "failed", "blocked"].includes(state.status)) {
      throw new CoreError("INVALID_REQUEST", "Chatbox session is no longer available");
    }
    const change = async () => {
      if (state.sessionId !== sessionId || ["cancelled", "failed", "blocked"].includes(state.status)) throw new CoreError("INVALID_REQUEST", "Chatbox session changed");
      const session = await configure(state.provider!, state.workspace!, sessionId, enabled);
      if (state.sessionId !== sessionId || session.id !== sessionId) throw new CoreError("INVALID_REQUEST", "Chatbox session changed");
      state.autopilot = enabled;
      if (execution && this.isActive(runId) && state.status === "awaiting_permission") await this.recordActivity(run, state, session);
      else await this.update(run);
    };
    if (execution && this.isActive(runId)) await execution.scheduler.control(blockId, change);
    else await change();
    return structuredClone(run);
  }

  async steerChat(runId: string, blockId: string, sessionId: string, input: string, steer: AnswerQuestion): Promise<HarnessRun> {
    const value = input.trim();
    if (!value || value.length > 100_000) throw new CoreError("INVALID_REQUEST", "Steering input must contain 1–100,000 characters");
    const execution = this.executions.get(runId);
    const state = execution?.run.blocks.find((item) => item.blockId === blockId);
    if (!execution || !this.isActive(runId) || execution.blocks.find((item) => item.id === blockId)?.type !== "chatbox"
      || !state || !["running", "waiting_timer"].includes(state.status) || !state.workspace || !state.provider || !sessionId || state.sessionId !== sessionId) {
      throw new CoreError("INVALID_REQUEST", "Chatbox session is no longer running");
    }
    await execution.scheduler.control(blockId, async () => {
      this.assertActive(runId);
      if (!["running", "waiting_timer"].includes(state.status) || state.sessionId !== sessionId) throw new CoreError("INVALID_REQUEST", "Chatbox session changed");
      // Publish the input while provider acknowledgement is still pending.
      this.appendChatSteering(state, value);
      this.log(state, "prompt", `User steering: ${value}`);
      await this.update(execution.run);
      const startedAt = state.startedAt; const provider = state.provider!; const workspace = state.workspace!;
      const delivery = (this.chatSteeringDeliveries.get(state) ?? Promise.resolve()).then(async () => {
        if (!this.isActive(runId) || state.sessionId !== sessionId || state.startedAt !== startedAt || !["running", "waiting_timer"].includes(state.status)) throw new CoreError("INVALID_REQUEST", "Chatbox turn ended before queued steering could be delivered");
        await steer(provider, workspace, value);
      }).catch(async (error) => {
        this.log(state, "error", `Steering delivery failed: ${error instanceof Error ? error.message : String(error)}`);
        if (state.sessionId === sessionId && state.startedAt === startedAt) state.error = `Steering delivery failed: ${error instanceof Error ? error.message : String(error)}`;
        await this.update(execution.run);
      });
      this.chatSteeringDeliveries.set(state, delivery);
      this.executionTasks.add(delivery);
      void delivery.finally(() => { this.executionTasks.delete(delivery); if (this.chatSteeringDeliveries.get(state) === delivery) this.chatSteeringDeliveries.delete(state); }).catch((error) => console.error("[core] Could not persist steering failure", error));
    });
    return structuredClone(execution.run);
  }

  private appendChatSteering(state: HarnessBlockRun, input: string): void {
    this.chatResponsePrefix.set(state, this.latestChatResponse.get(state) ?? "");
    const timestamp = new Date().toISOString();
    const messages = [...state.chatMessages ?? []];
    if (messages.at(-1)?.role === "assistant" && !messages.at(-1)?.text) messages.pop();
    state.chatMessages = [...messages, { id: crypto.randomUUID(), role: "user", text: input, timestamp }, { id: crypto.randomUUID(), role: "assistant", text: "", timestamp }].slice(-200) as NonNullable<HarnessBlockRun["chatMessages"]>;
  }
  private chatReplyText(state: HarnessBlockRun, session: AiSession): string {
    const full = chatResponse(session, this.chatTurnUsers.get(state)); this.latestChatResponse.set(state, full);
    const prefix = this.chatResponsePrefix.get(state);
    return prefix && full.startsWith(prefix) ? full.slice(prefix.length).replace(/^\n\n/, "") : full;
  }

  async appendInput(runId: string, input: string): Promise<HarnessRun> {
    const value = input.trim(); if (!value || value.length > 100_000) throw new CoreError("INVALID_REQUEST", "Workflow input must contain 1–100,000 characters");
    const execution = this.executions.get(runId); if (!execution || !this.isActive(runId)) throw new CoreError("INVALID_REQUEST", "Workflow run is no longer active");
    const targets = execution.blocks.filter((block) => !execution.edges.some((edge) => edge.to === block.id && !edge.loop));
    const available = targets.filter((block) => { const state = execution.run.blocks.find((item) => item.blockId === block.id); return state?.workspace && state.status === "running"; });
    if (!available.length) throw new CoreError("INVALID_REQUEST", "The workflow dispatcher session is not ready for another prompt");
    for (const block of available) { const state = execution.run.blocks.find((item) => item.blockId === block.id)!; state.status = "running"; state.completedAt = undefined; state.prompt = value; }
    await this.update(execution.run);
    let task!: Promise<void>;
    task = Promise.all(available.map((block) => execution.scheduler.turn(block.id, async () => {
      const state = execution.run.blocks.find((item) => item.blockId === block.id)!;
      const claim = crypto.randomUUID(); execution.turnClaims.set(block.id, claim);
      this.assertActive(runId);
      const session = await execution.append(block, value, { runId, blockId: block.id, workspace: state.workspace! });
      this.assertActive(runId);
      if (execution.turnClaims.get(block.id) !== claim) return;
      const output = session.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "";
      state.sessionId = session.id; state.tokens = session.tokens; this.assertTokenBudget(execution.run); state.output = output.slice(-200_000); state.status = "succeeded"; state.completedAt = new Date().toISOString(); execution.outputs.set(block.id, output);
      await this.update(execution.run);
    }))).then(() => undefined).catch(async (error) => { if (error instanceof Cancelled || this.cancelled.has(runId)) return; execution.run.status = "failed"; execution.run.error = error instanceof Error ? error.message : String(error); execution.run.completedAt = new Date().toISOString(); await this.update(execution.run); }).finally(() => execution.background.delete(task));
    execution.background.add(task);
    return structuredClone(execution.run);
  }

  async resolvePermission(runId: string, blockId: string, sessionId: string, pauseId: string, requestId: string, optionId: string | undefined, resolve: ResolvePermission): Promise<HarnessRun> {
    const { execution, state, provider, workspace } = this.pausedAttempt(runId, blockId, pauseId, "awaiting_permission", sessionId);
    if (state.pendingPermission?.id !== requestId) throw new CoreError("INVALID_REQUEST", "Permission request is no longer pending");
    if (optionId && !state.pendingPermission.options.some((option) => option.optionId === optionId)) throw new CoreError("INVALID_REQUEST", "Unknown permission option");
    const key = `${runId}:${blockId}:${sessionId}:${requestId}`;
    if (this.resolvingPauses.has(key)) throw new CoreError("INVALID_REQUEST", "Permission request is already being resolved");
    this.resolvingPauses.add(key);
    try {
      this.assertActive(runId);
      const session = await execution.scheduler.control(blockId, () => resolve(provider, workspace, requestId, optionId));
      this.assertActive(runId);
      await this.recordActivity(execution.run, state, session);
      return structuredClone(execution.run);
    } finally { this.resolvingPauses.delete(key); }
  }

  async answerQuestion(runId: string, blockId: string, sessionId: string, pauseId: string, input: string, answer: AnswerQuestion): Promise<HarnessRun> {
    if (!this.isActive(runId)) throw new CoreError("INVALID_REQUEST", "Workflow is no longer active");
    const flowAnswer = this.flowAnswers.get(`${runId}:${blockId}:${pauseId}`);
    if (flowAnswer) {
      const execution = this.executions.get(runId)!;
      const state = execution.run.blocks.find((block) => block.blockId === blockId);
      if (state?.sessionId !== sessionId) throw new CoreError("INVALID_REQUEST", "Question session does not match");
      if (execution.blocks.find((block) => block.id === blockId)?.type === "yes_no_prompt" && input !== "yes" && input !== "no") throw new CoreError("INVALID_REQUEST", "Choose Yes or No");
      if (!input.trim() || input.length > 100_000) throw new CoreError("INVALID_REQUEST", "Enter an answer of up to 100,000 characters"); this.flowAnswers.delete(`${runId}:${blockId}:${pauseId}`); flowAnswer(input); return structuredClone(this.executions.get(runId)!.run); }
    const value = input.trim();
    if (!value || value.length > 100_000) throw new CoreError("INVALID_REQUEST", "Workflow answer must contain 1–100,000 characters");
    const { execution, state, provider, workspace } = this.pausedAttempt(runId, blockId, pauseId, "awaiting_user_input", sessionId);
    const key = `${runId}:${blockId}:${sessionId}:answer`;
    if (this.resolvingPauses.has(key)) throw new CoreError("INVALID_REQUEST", "An answer is already being delivered");
    this.resolvingPauses.add(key);
    try {
      this.assertActive(runId);
      const session = await execution.scheduler.control(blockId, () => answer(provider, workspace, value));
      this.assertActive(runId);
      this.log(state, "prompt", `User answer: ${value}`);
      await this.recordActivity(execution.run, state, session);
      return structuredClone(execution.run);
    } finally { this.resolvingPauses.delete(key); }
  }

  async resumeTimer(runId: string, blockId: string, pauseId: string, fire: FireTimer): Promise<HarnessRun> {
    const flow = this.executions.get(runId);
    const timer = flow?.run.blocks.find((item) => item.blockId === blockId && item.pauseId === pauseId && item.status === "waiting_timer");
    if (timer && flow!.blocks.find((item) => item.id === blockId)?.type === "timer") { this.assertActive(runId); timer.waitingUntil = new Date().toISOString(); await this.update(flow!.run); return structuredClone(flow!.run); }
    const { execution, state, provider, workspace } = this.pausedAttempt(runId, blockId, pauseId, "waiting_timer");
    const key = `${runId}:${blockId}:${pauseId}:resume`;
    if (this.resolvingPauses.has(key)) throw new CoreError("INVALID_REQUEST", "Timer is already being resumed");
    this.resolvingPauses.add(key);
    try {
      this.assertActive(runId);
      const fired = await this.runOperation(runId, blockId, "timer_fire", `timer-fire:${pauseId}`, { workspace, provider, pauseId }, () => fire(provider, workspace));
      if (!fired) throw new CoreError("INVALID_REQUEST", "Workflow timer is no longer pending");
      this.assertActive(runId);
      if (state.status === "waiting_timer" && state.pauseId === pauseId) {
        state.status = "running"; state.waitingUntil = undefined; state.pauseId = undefined; execution.run.status = this.runActivityStatus(execution.run);
        this.log(state, "lifecycle", "Timer fired early by user"); await this.update(execution.run);
      }
      return structuredClone(execution.run);
    } finally { this.resolvingPauses.delete(key); }
  }

  async retryPause(runId: string, blockId: string, pauseId: string): Promise<HarnessRun> {
    const { execution, state } = this.pausedAttempt(runId, blockId, pauseId, "retry_scheduled", undefined, false);
    const policy = this.policy(execution.run);
    if ((state.recoveryAttempts ?? 0) >= policy.maxAttempts || retryBudgetExhausted(state.retryStartedAt, policy)) throw new CoreError("INVALID_REQUEST", "The automatic retry budget is exhausted");
    state.recoveryAttempts = (state.recoveryAttempts ?? 0) + 1;
    state.status = "queued"; state.error = undefined; state.completedAt = undefined; state.retryAt = undefined; state.pauseId = undefined; execution.run.status = "running";
    this.log(state, "lifecycle", "Retry requested by user"); await this.update(execution.run);
    return structuredClone(execution.run);
  }

  async cancelPause(runId: string, blockId: string, pauseId: string, interrupt: Interrupt): Promise<HarnessRun> {
    const flow = this.executions.get(runId);
    if (flow?.blocks.some((block) => block.id === blockId && ["user_prompt", "yes_no_prompt", "timer"].includes(block.type)) && flow.run.blocks.some((state) => state.blockId === blockId && state.pauseId === pauseId)) return this.cancel(runId, interrupt);
    this.pausedAttempt(runId, blockId, pauseId, ["awaiting_permission", "awaiting_user_input", "waiting_timer", "retry_scheduled"], undefined, false);
    return this.cancel(runId, interrupt);
  }

  async resumeFailed(runId: string, callerId: string): Promise<{ resumed: string[] }> {
    const execution = this.executions.get(runId);
    if (!execution || this.cancelled.has(runId)) throw new Error("Workflow is no longer active");
    if (!execution.blocks.find((block) => block.id === callerId)?.watchdog) throw new Error("Only a watchdog can request recovery");
    const resumed: string[] = [];
    for (const state of execution.run.blocks) {
      if (!["failed", "retry_scheduled"].includes(state.status) || state.blockId === callerId) continue;
      state.failureReason ??= classifyWorkflowFailure(state.error ?? "");
      const policy = this.policy(execution.run);
      if (!isRetryableFailure(state.failureReason) || !retryDue(state.retryAt) || (state.recoveryAttempts ?? 0) >= policy.maxAttempts) continue;
      if (retryBudgetExhausted(state.retryStartedAt, policy)) {
        state.status = "failed"; state.retryAt = undefined; state.pauseId = undefined;
        state.error = `${state.error ?? "Provider attempt failed"} Automatic retry budget exhausted; retry this block manually after resolving the provider issue.`;
        this.log(state, "error", "Automatic retry budget exhausted");
        continue;
      }
      state.recoveryAttempts = (state.recoveryAttempts ?? 0) + 1;
      state.status = "queued"; state.error = undefined; state.completedAt = undefined; state.retryAt = undefined; state.pauseId = undefined; execution.run.status = "running";
      this.log(state, "lifecycle", `Watchdog requested continuation after ${state.failureReason} (${state.recoveryAttempts}/${policy.maxAttempts})`); resumed.push(state.blockId);
    }
    await this.update(execution.run);
    return { resumed };
  }

  async runStack(runId: string, blockId: string, inputs: string[], path?: string): Promise<{ blocks: Array<{ blockId: string; output: string }> }> {
    const execution = this.executions.get(runId); if (!execution || !this.isActive(runId)) throw new Error("Workflow execution is no longer active");
    if (["ai", "chatbox"].includes(execution.blocks.find((block) => block.id === blockId)?.type ?? "")) throw new Error("Use workflow_use_block and workflow_choose_path for typed flow connections");
    if (!inputs.length || !inputs.every((input) => typeof input === "string" && input.trim())) throw new Error("inputs must be a non-empty array of strings");
    const maxStackSize = execution.run.definition?.settings?.maxStackSize ?? 100;
    if (inputs.length > maxStackSize) throw new CoreError("INVALID_REQUEST", `Workflow stack accepts at most ${maxStackSize} input${maxStackSize === 1 ? "" : "s"} per invocation`);
    const caller = execution.blocks.find((block) => block.id === blockId); const callerState = execution.run.blocks.find((block) => block.blockId === blockId);
    if (!caller || callerState?.status !== "running") throw new Error("Only a currently running workflow block can launch a stack");
    execution.stackInvocations.set(blockId, (execution.stackInvocations.get(blockId) ?? 0) + 1);
    let outgoing = execution.edges.filter((edge) => edge.from === blockId);
    if (path !== undefined) outgoing = outgoing.filter((edge) => edge.label === path);
    if (!outgoing.length) throw new Error(path === undefined ? "This block has no downstream path" : `No downstream path named '${path}'`);
    for (const edge of outgoing.filter((item) => item.loop)) {
      const count = (execution.loopInvocations.get(edge.id) ?? 0) + 1;
      const limit = execution.run.definition?.settings?.maxLoopCount ?? 100;
      if (count > limit) throw new CoreError("INVALID_REQUEST", `Workflow loop '${edge.label ?? edge.id}' reached its limit of ${limit} iterations`);
      execution.loopInvocations.set(edge.id, count);
    }
    if (caller.routing === "ai" && path === undefined) throw new Error("path is required because this block uses AI-selected routing");
    if (path !== undefined) { callerState.selectedRoute = path; await this.recordCompletedOperation(execution.run, "route_selection", `route:${blockId}:${callerState.attempts?.at(-1)?.id ?? "initial"}`, blockId, { path }); }
    const targets = outgoing.map((edge) => ({ edge, block: execution.blocks.find((block) => block.id === edge.to)! })).filter((target) => Boolean(target.block));
    const launch = async (target: HarnessBlock, waitForCurrentTurn = false): Promise<void> => {
      this.assertActive(runId);
      const state = execution.run.blocks.find((item) => item.blockId === target.id)!;
      // An async loop may reach a block while its previous invocation is still
      // returning from the tool call that launched the loop. Let that invocation
      // settle first so it cannot overwrite this turn's `running` state.
      while (waitForCurrentTurn && state.status === "running") {
        this.assertActive(runId);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (["queued", "waiting", "skipped"].includes(state.status) && !state.workspace) {
        state.status = "running"; await this.update(execution.run);
        await this.executeBlock(execution.run, target, execution.blocks, execution.edges, execution.outputs, execution.dispatch, execution.defaultProvider, inputs);
        await this.executeRevivedDescendants(execution, target.id); return;
      }
      if (!state.workspace || !["running", "succeeded"].includes(state.status)) throw new Error(`Downstream block '${target.label}' cannot accept another prompt`);
      const invocationCount = execution.stackInvocations.get(target.id) ?? 0;
      const output = await execution.scheduler.nestedTurn(target.id, async () => {
        const claim = crypto.randomUUID(); execution.turnClaims.set(target.id, claim);
        this.assertActive(runId); state.status = "running"; state.completedAt = undefined; await this.update(execution.run);
        const replies: string[] = [];
        for (const input of inputs) { this.assertActive(runId); const session = await execution.append(target, input, { runId, blockId: target.id, workspace: state.workspace! }); this.assertActive(runId); replies.push(session.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? ""); state.sessionId = session.id; state.tokens = session.tokens; this.assertTokenBudget(execution.run); }
        const value = replies.length === 1 ? replies[0]! : replies.map((reply, index) => `## Appended prompt ${index + 1}\n${reply}`).join("\n\n");
        if (execution.turnClaims.get(target.id) === claim) { state.output = value.slice(-200_000); state.status = "succeeded"; state.completedAt = new Date().toISOString(); execution.outputs.set(target.id, value); await this.update(execution.run); }
        return value;
      });
      const forward = execution.edges.filter((edge) => edge.from === target.id && !edge.loop);
      if (target.routing !== "ai" && forward.length && (execution.stackInvocations.get(target.id) ?? 0) === invocationCount) {
        // Forward graph edges run automatically on the initial pass. Preserve the
        // same contract when a loop appends to an existing session; otherwise a
        // successful repeated block silently terminates unless the model happens
        // to call workflow_run_stack itself.
        state.status = "running"; state.completedAt = undefined; await this.update(execution.run);
        await this.runStack(runId, target.id, [output]);
        state.status = "succeeded"; state.completedAt = new Date().toISOString(); await this.update(execution.run);
      }
    };
    await execution.scheduler.suspend(blockId, async () => {
      for (const target of targets) {
        if ((target.edge.execution ?? "sync") === "sync") { await launch(target.block); continue; }
        let task!: Promise<void>;
        task = launch(target.block, true).catch(async (error) => {
          if (error instanceof Cancelled || this.cancelled.has(runId)) return;
          const state = execution.run.blocks.find((item) => item.blockId === target.block.id)!;
          state.status = "failed"; state.error = error instanceof Error ? error.message : String(error); state.completedAt = new Date().toISOString(); this.log(state, "error", state.error); await this.update(execution.run);
        }).finally(() => execution.background.delete(task));
        execution.background.add(task);
      }
    });
    return { blocks: targets.map((target) => ({ blockId: target.block.id, output: execution.outputs.get(target.block.id) ?? "" })) };
  }

  private async executeRevivedDescendants(execution: ActiveExecution, sourceId: string): Promise<void> {
    const targets = execution.edges.filter((edge) => edge.from === sourceId).map((edge) => execution.blocks.find((block) => block.id === edge.to)).filter((block): block is HarnessBlock => Boolean(block));
    await Promise.all(targets.map(async (target) => {
      this.assertActive(execution.run.id);
      const state = execution.run.blocks.find((item) => item.blockId === target.id)!;
      if (state.status !== "queued" && state.status !== "waiting") return;
      if (blockReadiness(target.id, execution.blocks, execution.edges, execution.run.blocks) !== "ready") return;
      state.status = "running"; await this.update(execution.run);
      await this.executeBlock(execution.run, target, execution.blocks, execution.edges, execution.outputs, execution.dispatch, execution.defaultProvider);
      await this.executeRevivedDescendants(execution, target.id);
    }));
  }
  private async execute(run: HarnessRun, blocks: HarnessBlock[], edges: HarnessEdge[], order: string[], dispatch: Dispatch, defaultProvider: string, append: Append, recovering = false, startBlockId?: string): Promise<void> {
    const runner = this;
    return harnessExecute({
      get concurrency() { return runner.concurrency; },
      runActivityStatus: this.runActivityStatus.bind(this),
      get executions() { return runner.executions; },
      assertActive: this.assertActive.bind(this),
      schedulingReady: this.schedulingReady.bind(this),
      log: this.log.bind(this),
      executeFlow: this.executeFlow.bind(this),
      recordCompletedOperation: this.recordCompletedOperation.bind(this),
      update: this.update.bind(this),
      get suspended() { return runner.suspended; },
      get cancelled() { return runner.cancelled; },
      executeBlock: this.executeBlock.bind(this),
      policy: this.policy.bind(this),
      get meetingUpdates() { return runner.meetingUpdates; },
      get retryEntries() { return runner.retryEntries; },
      get flowInvocations() { return runner.flowInvocations; },
      get activeRuns() { return runner.activeRuns; },
      get activeProviders() { return runner.activeProviders; },
    }, run, blocks, edges, order, dispatch, defaultProvider, append, recovering, startBlockId);
  }

  async flowTool(runId: string, blockId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const execution = this.activeExecution(runId);
    const caller = execution.run.blocks.find((item) => item.blockId === blockId);
    const target = execution.blocks.find((item) => item.id === args.block_id);
    if (name !== "workflow_use_block" || !caller || !target) return this.executeFlowTool(runId, blockId, name, args);
    const call = { id: crypto.randomUUID(), blockId: target.id, ...(typeof args.action === "string" ? { action: args.action } : target.type === "meeting" ? { action: "diff" } : {}), ...(typeof args.lines === "number" && Number.isInteger(args.lines) ? { lines: args.lines } : {}) };
    caller.activeToolCalls = [...caller.activeToolCalls ?? [], call];
    try {
      await this.update(execution.run);
      return await this.executeFlowTool(runId, blockId, name, args);
    } finally {
      caller.activeToolCalls = caller.activeToolCalls?.filter((item) => item.id !== call.id);
      if (!caller.activeToolCalls?.length) caller.activeToolCalls = undefined;
      await this.update(execution.run);
    }
  }

  private async executeFlowTool(runId: string, blockId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    // Polling and Meeting cursor updates are saved without growing the operation journal.
    const execution = this.activeExecution(runId);
    const caller = execution.run.blocks.find((item) => item.blockId === blockId);
    if (!caller) throw new Error("Unknown workflow caller block");
    this.chargeContext(execution.run, caller, 0);
    const project = async (value: unknown) => {
      const result = this.projectFlowResult(runId, blockId, name, args, value);
      this.chargeContext(execution.run, caller, JSON.stringify(result)?.length ?? 0);
      await this.update(execution.run);
      return result;
    };
    const meetingRead = name === "workflow_use_block" && execution.blocks.some((block) => block.id === args.block_id && block.type === "meeting") && ["tail", "diff", "fetch", "wait", "status"].includes(String(args.action ?? "diff"));
    if (meetingRead || (name === "workflow_use_block" && args.action === "fetch") || name === "workflow_connections" || name === "workflow_block_output" || name === "workflow_block_messages" || (name === "workflow_use_block" && ["status", "tail"].includes(String(args.action)) && ["ai", "chatbox"].includes(execution.blocks.find((item) => item.id === args.block_id)?.type ?? ""))) return project(await this.callFlowTool(runId, blockId, name, args));
    const { run } = this.activeExecution(runId);
    const operation = await this.beginOperation(run, "tool_command", `flow-tool:${crypto.randomUUID()}`, blockId, { name, args });
    try {
      const result = await this.callFlowTool(runId, blockId, name, args);
      await this.finishOperation(run, operation, "succeeded", result);
      return await project(result);
    } catch (error) { await this.finishOperation(run, operation, "failed", undefined, error); throw error; }
  }

  private callerContext(runId: string, blockId: string) {
    const state = this.activeExecution(runId).run.blocks.find((item) => item.blockId === blockId)!;
    const key = `${runId}:${blockId}`;
    let context = this.contextReads.get(key);
    if (!context || context.sessionId !== state.sessionId) {
      context = { sessionId: state.sessionId, outputs: new Map(), reads: new Map(), fetched: new Map() };
      if (this.contextReads.size >= 512) this.contextReads.delete(this.contextReads.keys().next().value!);
      this.contextReads.set(key, context);
    }
    return context;
  }

  private projectFlowResult(runId: string, blockId: string, name: string, args: Record<string, unknown>, value: unknown): unknown {
    const target = this.activeExecution(runId).blocks.find((item) => item.id === args.block_id);
    if (target?.type === "meeting") return contextResult(value);
    // Fetch results are already limited to data this caller has not received.
    if (args.action === "fetch") return contextResult(value);
    const context = this.callerContext(runId, blockId);
    const key = JSON.stringify([name, args.block_id, args.action, args.count, args.lines, args.offset, args.limit]);
    const hash = contextHash(value);
    const previous = context.reads.get(key);
    context.reads.set(key, hash);
    if (previous === hash && !args.include_unchanged) return { blockId: args.block_id, ...(value && typeof value === "object" && "block_status" in value ? { block_status: value.block_status } : {}), unchanged: true };
    // Changed snapshots should not replay unchanged messages and activity.
    if (value && typeof value === "object" && "messages" in value) {
      const snapshot = value as Record<string, unknown>;
      const delta = (items: unknown, kind: string) => Array.isArray(items) ? items.filter((item) => {
        const hash = contextHash(item);
        const id = item && typeof item === "object" && "id" in item ? String(item.id) : hash;
        const itemKey = JSON.stringify([args.block_id, kind, id]);
        const seen = context.reads.get(itemKey) === hash;
        context.reads.set(itemKey, hash);
        return args.include_unchanged || !seen;
      }) : items;
      value = { ...snapshot, messages: delta(snapshot.messages, "message"), activity: delta(snapshot.activity, "activity") };
    }
    while (context.reads.size > 1024) context.reads.delete(context.reads.keys().next().value!);
    // Skill instructions must be delivered intact on their first load.
    return target?.type === "skill" ? value : contextResult(value);
  }
  private async callFlowTool(runId: string, blockId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const runner = this;
    return harnessCallFlowTool({
      activeExecution: this.activeExecution.bind(this),
      update: this.update.bind(this),
      fetchUnread: this.fetchUnread.bind(this),
      traceConnection: this.traceConnection.bind(this),
      flowBlockMessages: this.flowBlockMessages.bind(this),
      get agentStarts() { return runner.agentStarts; },
      get steerAgent() { return runner.steerAgent; },
      assertActive: this.assertActive.bind(this),
      chargeContext: this.chargeContext.bind(this),
      appendChatSteering: this.appendChatSteering.bind(this),
      log: this.log.bind(this),
      get flowInvocations() { return runner.flowInvocations; },
      get meetingUpdates() { return runner.meetingUpdates; },
      get appToolCalls() { return runner.appToolCalls; },
    }, runId, blockId, name, args);
  }
  private async fetchUnread(runId: string, blockId: string, target: HarnessBlock, args: Record<string, unknown>): Promise<unknown> {
    const runner = this;
    return harnessFetchUnread({
      activeExecution: this.activeExecution.bind(this),
      callerContext: this.callerContext.bind(this),
      callFlowTool: this.callFlowTool.bind(this),
      assertActive: this.assertActive.bind(this),
      traceConnection: this.traceConnection.bind(this),
    }, runId, blockId, target, args);
  }

  private flowBlockMessages(run: HarnessRun, blockId: string, count: number): Record<string, unknown> {
    const state = run.blocks.find((block) => block.blockId === blockId)!;
    const messages = state.chatMessages ?? (state.output ? [{ role: "assistant", text: state.output }] : []);
    return {
      blockId, block_status: state.status,
      // The latest output is already represented by these messages. Polling
      // must not also repeat the entire (potentially much larger) output.
      messages: (count ? messages.slice(-count) : []).map((message) => ({ ...message, text: message.text.slice(-8000), ...(message.text.length > 8000 ? { truncated: true } : {}) })),
      activity: count ? (state.agentActivity ?? []).slice(-count) : [],
      ...(state.error ? { error: state.error } : {})
    };
  }

  private async traceConnection(run: HarnessRun, edge: HarnessEdge, direction: HarnessConnectionTrace["direction"], status: HarnessConnectionTrace["status"], chars?: number): Promise<HarnessConnectionTrace> {
    this.assertActive(run.id);
    const now = new Date().toISOString();
    const trace: HarnessConnectionTrace = { id: crypto.randomUUID(), edgeId: edge.id, direction, status, startedAt: now, ...(chars !== undefined ? { chars } : {}), ...(status !== "active" ? { completedAt: now } : {}) };
    run.connectionTraces = [...(run.connectionTraces ?? []), trace].filter((trace, index, traces) => trace.status === "active" || index >= traces.length - 128);
    await this.update(run); return trace;
  }
  private async executeFlow(execution: ActiveExecution, startBlockId?: string): Promise<void> {
    const runner = this;
    return harnessExecuteFlow({
      schedulingReady: this.schedulingReady.bind(this),
      get retryEntries() { return runner.retryEntries; },
      assertActive: this.assertActive.bind(this),
      get chatTurnUsers() { return runner.chatTurnUsers; },
      get latestChatResponse() { return runner.latestChatResponse; },
      get chatResponsePrefix() { return runner.chatResponsePrefix; },
      runActivityStatus: this.runActivityStatus.bind(this),
      update: this.update.bind(this),
      log: this.log.bind(this),
      executeBlock: this.executeBlock.bind(this),
      get flowAnswers() { return runner.flowAnswers; },
      isActive: this.isActive.bind(this),
      assertTokenBudget: this.assertTokenBudget.bind(this),
      get openDocument() { return runner.openDocument?.bind(runner); },
      traceConnection: this.traceConnection.bind(this),
      get flowInvocations() { return runner.flowInvocations; },
    }, execution, startBlockId);
  }
  private async executeBlock(run: HarnessRun, block: HarnessBlock, blocks: HarnessBlock[], edges: HarnessEdge[], outputs: Map<string, string>, dispatch: Dispatch, defaultProvider: string, stack?: string[], runtimeContext?: string, sessionInstructions?: string): Promise<void> {
    const runner = this;
    return harnessExecuteBlock({
      log: this.log.bind(this),
      get activeProviders() { return runner.activeProviders; },
      update: this.update.bind(this),
      assertActive: this.assertActive.bind(this),
      callerContext: this.callerContext.bind(this),
      chargeContext: this.chargeContext.bind(this),
      beginOperation: this.beginOperation.bind(this),
      recordCompletedOperation: this.recordCompletedOperation.bind(this),
      recordActivity: this.recordActivity.bind(this),
      get executions() { return runner.executions; },
      effectiveBlock: this.effectiveBlock.bind(this),
      chatReplyText: this.chatReplyText.bind(this),
      assertTokenBudget: this.assertTokenBudget.bind(this),
      finishOperation: this.finishOperation.bind(this),
      output: this.output.bind(this),
      requestReviewCorrection: this.requestReviewCorrection.bind(this),
      executeBlock: this.executeBlock.bind(this),
    }, run, block, blocks, edges, outputs, dispatch, defaultProvider, stack, runtimeContext, sessionInstructions);
  }

  /** Persist review findings before asking the owning session to correct them. A restart can therefore never lose ownership or repeat a completed correction. */
  private async requestReviewCorrection(run: HarnessRun, block: HarnessBlock, output: string): Promise<"none" | "corrected" | "blocked"> {
    const correction = block.review?.correction;
    if (!correction) return "none";
    const previous = [...(run.corrections ?? [])].reverse().find((cycle) => cycle.reviewBlockId === block.id && cycle.status === "corrected");
    const report = parseReviewReport(output, block.id, previous?.correctedRevision ?? block.review!.revision, correction.ownerBlockId);
    await this.recordCompletedOperation(run, "review", `review-findings:${block.id}:${report.revision}:${report.findings.map((finding) => finding.id).join(",")}`, block.id, report);
    if (!report.findings.length) return "none";
    const cycles = (run.corrections ?? []).filter((cycle) => cycle.reviewBlockId === block.id);
    const maximum = correction.maxCycles ?? 3;
    const state = run.blocks.find((item) => item.blockId === block.id)!;
    if (cycles.length >= maximum) {
      const message = `Review found ${report.findings.length} remaining finding(s) after ${maximum} correction cycle(s): ${report.findings.map((finding) => finding.message).join("; ")}`;
      run.corrections = [...(run.corrections ?? []), { reviewBlockId: block.id, ownerBlockId: correction.ownerBlockId, verificationBlockId: correction.verificationBlockId, cycle: cycles.length + 1, revision: report.revision, findings: report.findings, status: "blocked", requestedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: message }];
      state.status = "blocked"; state.error = message; this.log(state, "error", message); await this.update(run); return "blocked";
    }
    const owner = run.blocks.find((item) => item.blockId === correction.ownerBlockId);
    const execution = this.executions.get(run.id);
    if (!owner?.workspace || !execution) throw new CoreError("INVALID_REQUEST", `Review '${block.label}' cannot request a correction because owner block '${correction.ownerBlockId}' has no persistent session`);
    const cycle: HarnessCorrectionCycle = { reviewBlockId: block.id, ownerBlockId: correction.ownerBlockId, verificationBlockId: correction.verificationBlockId, cycle: cycles.length + 1, revision: report.revision, findings: report.findings, status: "requested", requestedAt: new Date().toISOString() };
    run.corrections = [...(run.corrections ?? []), cycle]; await this.recordCompletedOperation(run, "review", `correction-request:${block.id}:${cycle.cycle}`, block.id, cycle); await this.update(run);
    const prompt = `Correct the following review findings for revision ${report.revision}. Keep working in this owned session. When finished, reply with JSON only: {"revision":"<new exact commit SHA>"}.\n\n${report.findings.map((finding) => `- [${finding.id}] ${finding.message}`).join("\n")}`;
    const session = await execution.scheduler.turn(correction.ownerBlockId, () => execution.append(blocksById(execution.blocks, correction.ownerBlockId), prompt, { runId: run.id, blockId: correction.ownerBlockId, workspace: owner.workspace! }));
    this.assertActive(run.id);
    if (session.status !== "done") throw new CoreError("INVALID_REQUEST", `Correction owner '${correction.ownerBlockId}' did not complete its correction turn`);
    const revision = parseCorrectionRevision(session.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "");
    cycle.status = "corrected"; cycle.correctedRevision = revision; cycle.completedAt = new Date().toISOString();
    owner.sessionId = session.id; owner.output = session.messages.filter((message) => message.role === "assistant").at(-1)?.text?.slice(-200_000) ?? owner.output;
    await this.recordCompletedOperation(run, "review", `correction-result:${block.id}:${cycle.cycle}`, block.id, { revision, ownerBlockId: correction.ownerBlockId }); await this.update(run);
    return "corrected";
  }

  private effectiveBlock(run: HarnessRun, block: HarnessBlock): HarnessBlock {
    const corrected = [...(run.corrections ?? [])].reverse().find((cycle) => cycle.reviewBlockId === block.id && cycle.status === "corrected" && cycle.correctedRevision);
    if (block.type === "review" && corrected?.correctedRevision && block.review) return { ...block, review: { ...block.review, revision: corrected.correctedRevision } };
    const verificationCorrection = [...(run.corrections ?? [])].reverse().find((cycle) => cycle.verificationBlockId === block.id && cycle.status === "corrected" && cycle.correctedRevision);
    if (block.type === "verification" && verificationCorrection?.correctedRevision && block.verification) return { ...block, verification: { ...block.verification, revision: verificationCorrection.correctedRevision } };
    return block;
  }

  private log(state: HarnessRun["blocks"][number], kind: HarnessLogEntry["kind"], message: string): void {
    const entry: HarnessLogEntry = { timestamp: new Date().toISOString(), kind, message: message.slice(-200_000) };
    state.log = [...(state.log ?? []), entry].slice(-500);
  }
  private async update(run: HarnessRun): Promise<void> {
    const runner = this;
    return harnessUpdate({
      get suspended() { return runner.suspended; },
      get meetingParticipantStatuses() { return runner.meetingParticipantStatuses; },
      get executions() { return runner.executions; },
      get updateQueue() { return runner.updateQueue; },
      set updateQueue(value: Promise<void>) { runner.updateQueue = value; },
      get store() { return runner.store; },
      get changed() { return runner.changed.bind(runner); },
      get meetingUpdates() { return runner.meetingUpdates; },
    }, run);
  }

  private activeExecution(runId: string): ActiveExecution {
    const execution = this.executions.get(runId); if (!execution || !this.isActive(runId)) throw new CoreError("INVALID_REQUEST", "Workflow execution is no longer active"); return execution;
  }

  async assertFeatureReady(runId: string, featureId: string): Promise<void> { this.readyFeature(this.activeExecution(runId), featureId); }

  private readyFeature(execution: ActiveExecution, featureId: string): HarnessFeature {
    const feature = execution.run.features?.find((item) => item.id === featureId);
    if (!feature) throw new CoreError("INVALID_REQUEST", `Feature '${featureId}' is not in the durable feature plan`);
    if (feature.status !== "planned") throw new CoreError("INVALID_REQUEST", `Feature '${featureId}' is already ${feature.status}`);
    const waiting = feature.prerequisites.filter((dependency) => execution.run.features!.find((item) => item.id === dependency)?.status !== "completed");
    if (waiting.length) throw new CoreError("INVALID_REQUEST", `Feature '${featureId}' cannot start until ${waiting.join(", ")} is merged into the root workspace`);
    return feature;
  }
  private async beginOperation(run: HarnessRun, kind: HarnessOperationKind, idempotencyKey: string, blockId?: string, input?: unknown, attemptId?: string): Promise<HarnessOperation> {
    const runner = this;
    return harnessBeginOperation({
      update: this.update.bind(this),
    }, run, kind, idempotencyKey, blockId, input, attemptId);
  }
  private async finishOperation(run: HarnessRun, operation: HarnessOperation, status: "succeeded" | "failed", result?: unknown, error?: unknown): Promise<void> {
    const runner = this;
    return harnessFinishOperation({
      update: this.update.bind(this),
    }, run, operation, status, result, error);
  }
  private async recordCompletedOperation(run: HarnessRun, kind: HarnessOperationKind, idempotencyKey: string, blockId: string | undefined, result: unknown, attemptId?: string): Promise<void> {
    const runner = this;
    return harnessRecordCompletedOperation({
      finishOperation: this.finishOperation.bind(this),
      update: this.update.bind(this),
    }, run, kind, idempotencyKey, blockId, result, attemptId);
  }

  private async recordActivity(run: HarnessRun, state: HarnessRun["blocks"][number], session: AiSession, waitingUntil?: string): Promise<void> {
    this.assertActive(run.id);
    const option = findAutopilotOption(session.availableOptions ?? []);
    const autopilot = option ? String(session.configuration?.[option.option.id] ?? option.option.defaultValue) === String(option.on) : state.autopilot;
    const status: "running" | HarnessPauseStatus = session.pendingPermission ? "awaiting_permission" : waitingUntil ? "waiting_timer" : session.status === "user_prompt" ? "awaiting_user_input" : "running";
    const question = status === "awaiting_user_input" ? session.messages.filter((message) => message.role === "assistant").at(-1)?.text : undefined;
    const permission = status === "awaiting_permission" ? session.pendingPermission : undefined;
    const response = waitingUntil || !state.chatMessages ? session.messages.filter((message) => message.role === "assistant").at(-1)?.text.slice(-200_000) : undefined;
    if (state.chatMessages && !this.chatTurnUsers.has(state)) this.chatTurnUsers.set(state, session.messages.filter((message) => message.role === "user").at(-1)?.id ?? null);
    const chatReply = state.chatMessages?.at(-1);
    const chatText = chatReply?.role === "assistant" ? this.chatReplyText(state, session) : undefined;
    const chatChanged = chatText !== undefined && chatText !== chatReply?.text;
    const lastUser = state.chatMessages ? session.messages.findIndex((message) => message.id === this.chatTurnUsers.get(state)) : session.messages.map((message) => message.role).lastIndexOf("user");
    const agentActivity = session.messages.slice(lastUser + 1).filter((message) => message.role === "activity").slice(-50).map((message) => ({ id: message.id, timestamp: message.timestamp, text: (message.text || message.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "Agent activity").slice(-8000) }));
    const contextChanged = state.contextUsed !== session.contextUsed || state.contextLimit !== session.contextLimit || JSON.stringify(state.context) !== JSON.stringify(session.context);
    if (contextChanged) { state.context = session.context; state.contextUsed = session.contextUsed; state.contextLimit = session.contextLimit; }
    const activityChanged = JSON.stringify(state.agentActivity ?? []) !== JSON.stringify(agentActivity);
    if (activityChanged) state.agentActivity = agentActivity;
    if (chatChanged) chatReply!.text = chatText!;
    const responseChanged = response !== undefined && response !== state.output;
    const pauseId = status === "running" ? undefined : state.status === status ? state.pauseId ?? crypto.randomUUID() : crypto.randomUUID();
    if (state.autopilot === autopilot && state.status === status && state.waitingUntil === waitingUntil && state.question === question && JSON.stringify(state.pendingPermission) === JSON.stringify(permission) && state.sessionId === session.id && state.pauseId === pauseId && !responseChanged && !chatChanged && !activityChanged && !contextChanged) return;
    state.autopilot = autopilot;
    if (responseChanged) { state.output = response; this.log(state, "response", response!); }
    const previous = state.status; state.status = status; state.sessionId = session.id; state.waitingUntil = waitingUntil; state.question = question; state.pendingPermission = permission;
    const attempt = state.attempts?.at(-1); if (attempt && session.id) { attempt.sessionId = session.id; await this.recordCompletedOperation(run, "session_binding", `session:${attempt.id}`, state.blockId, { sessionId: session.id, workspace: state.workspace }, attempt.id); }
    state.pauseId = pauseId;
    run.status = this.runActivityStatus(run);
    if (previous !== status) this.log(state, "lifecycle", status === "running" ? "Provider resumed work" : `Paused: ${status.replaceAll("_", " ")}`);
    await this.update(run);
  }

  private pausedAttempt(runId: string, blockId: string, pauseId: string, expected: HarnessPauseStatus | HarnessPauseStatus[], sessionId?: string, requireOwnership = true): { execution: ActiveExecution; state: HarnessRun["blocks"][number]; provider: string; workspace: string } {
    const execution = this.executions.get(runId);
    if (!execution || !this.isActive(runId)) throw new CoreError("INVALID_REQUEST", "Workflow run is no longer active");
    const state = execution.run.blocks.find((item) => item.blockId === blockId);
    const statuses = Array.isArray(expected) ? expected : [expected];
    if (!state || !statuses.includes(state.status as HarnessPauseStatus)) throw new CoreError("INVALID_REQUEST", "Workflow block is no longer waiting for this response");
    if (state.pauseId !== pauseId) throw new CoreError("INVALID_REQUEST", "Response belongs to a different paused attempt");
    if (sessionId !== undefined && state.sessionId !== sessionId) throw new CoreError("INVALID_REQUEST", "Response belongs to a different workflow session");
    if (requireOwnership && (!state.provider || !state.workspace)) throw new CoreError("INVALID_REQUEST", "Workflow session ownership is incomplete");
    return { execution, state, provider: state.provider ?? "", workspace: state.workspace ?? "" };
  }

  private runActivityStatus(run: HarnessRun): HarnessRun["status"] {
    for (const status of ["awaiting_permission", "awaiting_user_input", "waiting_timer", "retry_scheduled"] as const) if (run.blocks.some((block) => block.status === status)) return status;
    return "running";
  }

  private async reconcilePersistedRun(run: HarnessRun, inspector?: HarnessRecoveryInspector): Promise<void> {
    const now = new Date().toISOString();
    for (const child of run.children ?? []) {
      if (!inspector?.child) continue;
      const exists = await inspector.child(child);
      if (!exists) child.recoveryError = `Owned task '${child.taskId}' is missing after Core restart`;
    }
    for (const state of run.blocks) {
      if (!isActiveStatus(state.status) || state.status === "queued" || state.status === "waiting" || state.status === "retry_scheduled") continue;
      const unresolved = run.operations?.filter((operation) => operation.blockId === state.blockId && operation.status === "intent") ?? [];
      if (!state.provider || !state.workspace || !inspector) {
        this.pauseOrphan(state, unresolved.length ? `Core restarted with unresolved ${unresolved.map((operation) => operation.kind).join(", ")} intent; inspect the existing session and choose Resume or Cancel.` : "Core restarted before session ownership was durably recorded; inspect preserved work and choose Resume or Cancel.");
        continue;
      }
      if (state.status === "waiting_timer" && await inspector.timer(run.id, state.blockId, state.provider, state.workspace)) continue;
      const session = await inspector.session(state.provider, state.workspace);
      const ambiguousOperations = unresolved.filter((item) => !["block_attempt", "prompt_delivery", "session_binding"].includes(item.kind));
      if (ambiguousOperations.length) {
        this.pauseOrphan(state, `Core restarted with unresolved ${ambiguousOperations.map((operation) => operation.kind).join(", ")} intent. Inspect the recorded operation and choose Resume or Cancel; recovery will not repeat it automatically.`); continue;
      }
      if (session && (!state.sessionId || state.sessionId === session.id) && session.status === "done") {
        const output = session.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? state.output ?? "";
        const block = run.definition?.blocks.find((item) => item.id === state.blockId);
        try {
          const structuredOutput = parseHarnessData(output, block?.outputSchema, `${block?.label ?? state.blockId} output`);
          if (structuredOutput !== undefined) state.structuredOutput = structuredOutput;
        } catch (error) {
          if (!(error instanceof HarnessSchemaError)) throw error;
          state.status = "retry_scheduled"; state.error = error.message; state.failureReason = "schema_validation"; state.pauseId = crypto.randomUUID(); state.waitingUntil = undefined;
          this.log(state, "error", error.message); continue;
        }
        state.sessionId = session.id; state.output = output.slice(-200_000); state.status = "succeeded"; state.completedAt = now; state.error = undefined; state.failureReason = undefined; state.pauseId = undefined; state.pendingPermission = undefined; state.question = undefined; state.waitingUntil = undefined;
        const attempt = [...(state.attempts ?? [])].reverse().find((item) => item.status === "running");
        if (attempt) { attempt.status = "succeeded"; attempt.completedAt = now; attempt.sessionId = session.id; attempt.workspace ??= state.workspace; const operation = run.operations?.find((item) => item.id === attempt.operationId); if (operation) { operation.status = "succeeded"; operation.updatedAt = now; operation.error = undefined; operation.result = journalValue({ sessionId: session.id, workspace: state.workspace, output: output.slice(-20_000) }); } }
        for (const operation of unresolved.filter((item) => item.kind === "prompt_delivery" || item.kind === "session_binding")) { operation.status = "succeeded"; operation.updatedAt = now; operation.error = undefined; operation.result = journalValue({ sessionId: session.id, workspace: state.workspace, status: session.status }); }
        this.log(state, "lifecycle", "Recovered a provider turn that completed before Core restarted");
        continue;
      }
      if (session && (!state.sessionId || state.sessionId === session.id) && session.pendingPermission) {
        state.status = "awaiting_permission"; state.sessionId = session.id; state.pendingPermission = session.pendingPermission; state.pauseId ??= crypto.randomUUID(); state.failureReason = "permission_required"; continue;
      }
      if (session && (!state.sessionId || state.sessionId === session.id) && session.status === "user_prompt") {
        state.status = "awaiting_user_input"; state.sessionId = session.id; state.question = session.messages.filter((message) => message.role === "assistant").at(-1)?.text; state.pauseId ??= crypto.randomUUID(); state.failureReason = "user_input_required"; continue;
      }
      const detail = !session ? "the recorded provider session no longer exists" : state.sessionId && state.sessionId !== session.id ? "the workspace now belongs to a different provider session" : session.status === "error" ? "the provider session stopped while Core was offline" : "the provider session outcome is still ambiguous";
      this.pauseOrphan(state, `Core restart recovery found that ${detail}. Existing work was preserved; choose Resume to continue in the recorded workspace or Cancel.`);
    }
    run.status = this.runActivityStatus(run); run.completedAt = undefined; run.error = undefined; await this.update(run);
  }

  private pauseOrphan(state: HarnessRun["blocks"][number], message: string): void {
    state.status = "retry_scheduled"; state.error = message; state.failureReason = "recovery_orphaned"; state.retryAt = undefined; state.pauseId = crypto.randomUUID(); state.pendingPermission = undefined; state.question = undefined; state.waitingUntil = undefined; this.log(state, "error", message);
  }

  private async failRecovery(run: HarnessRun, message: string): Promise<void> {
    const now = new Date().toISOString(); run.status = "failed"; run.error = message; run.completedAt = now;
    for (const state of run.blocks) if (isActiveStatus(state.status)) { state.status = state.status === "running" ? "failed" : "cancelled"; state.completedAt = now; if (state.status === "failed") { state.error = message; state.failureReason = "recovery_orphaned"; } }
    await this.recordCompletedOperation(run, "terminal_outcome", "terminal:recovery-orphaned", undefined, { status: run.status, error: message, completedAt: now }); await this.update(run);
  }

  private deliveryIsTerminal(execution: ActiveExecution): boolean {
    return execution.blocks.filter((block) => !block.watchdog).every((block) => {
      const state = execution.run.blocks.find((item) => item.blockId === block.id);
      if (!state) return false;
      if (["succeeded", "skipped", "cancelled"].includes(state.status)) return true;
      if (state.status !== "failed") return false;
      const reason = state.failureReason ?? classifyWorkflowFailure(state.error ?? "");
      return !isRetryableFailure(reason)
        || (state.recoveryAttempts ?? 0) >= this.policy(execution.run).maxAttempts
        || retryBudgetExhausted(state.retryStartedAt, this.policy(execution.run))
        || (reason === "transient_transport" && state.retryAt === undefined);
    });
  }

  private assertActive(runId: string): void {
    if (!this.isActive(runId)) throw new Cancelled();
    const run = this.executions.get(runId)?.run;
    const duration = run?.definition?.settings?.maxRunDurationMs;
    if (run?.startedAt && duration !== undefined && Date.now() - Date.parse(run.startedAt) >= duration) throw new RunDurationExceeded(duration);
  }

  private policy(run: HarnessRun): ResolvedRecoveryPolicy { return { ...this.recovery, maxAttempts: run.definition?.settings?.retry?.maxAttempts ?? this.recovery.maxAttempts }; }

  private output(run: HarnessRun, value: string): string { return value.slice(-(run.definition?.settings?.outputLimitChars ?? 200_000)); }

  private chargeContext(run: HarnessRun, state: HarnessRun["blocks"][number], chars: number): void {
    const limit = run.definition?.settings?.contextBudgetChars ?? 400_000;
    const used = (state.deliveredContextChars ?? 0) + chars;
    state.deliveredContextChars = used;
    if (used >= limit) throw new CoreError("INVALID_REQUEST", `Block '${state.blockId}' reached its workflow context budget of ${limit.toLocaleString()} characters. Start a new workflow run with a concise handoff, or increase settings.contextBudgetChars. Provider history has been preserved.`);
  }

  private assertTokenBudget(run: HarnessRun): void {
    const budget = run.definition?.settings?.tokenBudget;
    const used = run.blocks.reduce((total, block) => total + (block.tokens?.total ?? 0), 0);
    if (budget !== undefined && used > budget) throw new CoreError("INVALID_REQUEST", `Workflow token budget of ${budget.toLocaleString()} was exceeded (${used.toLocaleString()} used)`);
  }
}

export type { HarnessRecoveryInspector } from "./harness/types.js";

export { connectedInput, isolatedBlockDefinition } from "./harness/context.js";

export { isRecoverableWorkflowError, classifyWorkflowFailure, nextWatchdogReset } from "./harness/recovery.js";
