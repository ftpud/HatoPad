import crypto from "node:crypto";
import type { HarnessBlock, HarnessBlockAttempt, HarnessBlockIteration, HarnessEdge, HarnessRun, AiSession } from "@hatopad/protocol";
import { AiProviderError, normalizeAiFailure } from "@hatopad/acp";
import { CoreError } from "../errors.js";
import { parseHarnessData, renderHarnessPrompt } from "../harness-graph.js";
import { contextHash, contextPreview, contextOutputs, WORKFLOW_CONTEXT_CHARS } from "../workflow-context.js";
import { Dispatch } from "./types.js";
import { connectedInput, operationId } from "./context.js";
import { Cancelled } from "./errors.js";
import type { HarnessRunner } from "../harness-runner.js";

type ExecuteBlockHost = {
  log: HarnessRunner["log"];
  activeProviders: HarnessRunner["activeProviders"];
  update: HarnessRunner["update"];
  assertActive: HarnessRunner["assertActive"];
  callerContext: HarnessRunner["callerContext"];
  chargeContext: HarnessRunner["chargeContext"];
  beginOperation: HarnessRunner["beginOperation"];
  recordCompletedOperation: HarnessRunner["recordCompletedOperation"];
  recordActivity: HarnessRunner["recordActivity"];
  executions: HarnessRunner["executions"];
  effectiveBlock: HarnessRunner["effectiveBlock"];
  chatReplyText: HarnessRunner["chatReplyText"];
  assertTokenBudget: HarnessRunner["assertTokenBudget"];
  finishOperation: HarnessRunner["finishOperation"];
  output: HarnessRunner["output"];
  requestReviewCorrection: HarnessRunner["requestReviewCorrection"];
  executeBlock: HarnessRunner["executeBlock"];
};

export async function harnessExecuteBlock(host: ExecuteBlockHost, run: HarnessRun, block: HarnessBlock, blocks: HarnessBlock[], edges: HarnessEdge[], outputs: Map<string, string>, dispatch: Dispatch, defaultProvider: string, stack?: string[], runtimeContext?: string, sessionInstructions?: string): Promise<void> {
    const state = run.blocks.find((item) => item.blockId === block.id)!; const outgoing = edges.filter((edge) => edge.from === block.id);
    const loopOutgoing = outgoing.filter((edge) => edge.loop);
    const blockInput = connectedInput(block.id, run.input, blocks, edges, outputs); const count = stack?.length ?? 1; const collected: string[] = []; let latestAttemptId: string | undefined;
    state.startedAt = new Date().toISOString(); state.provider = block.type === "verification" ? undefined : block.provider ?? defaultProvider; state.plannedRuns = count; state.iterations = count > 1 ? [] : undefined; state.log = state.log ?? []; host.log(state, "lifecycle", `Started ${count > 1 ? `${count} planned iterations` : "block"}`);
    const providers = host.activeProviders.get(run.id) ?? new Set<string>(); if (state.provider) providers.add(state.provider); host.activeProviders.set(run.id, providers); await host.update(run);
    try {
      for (let index = 0; index < count; index += 1) {
        host.assertActive(run.id);
        const input = stack?.[index] ?? blockInput;
        const structuredInput = parseHarnessData(input, block.inputSchema, `${block.label} input`);
        if (structuredInput !== undefined) state.structuredInput = structuredInput;
        const context = host.callerContext(run.id, block.id);
        const promptOutputs = contextOutputs(`${block.prompt}\n${sessionInstructions ?? ""}`, outputs, state.workspace && block.type !== "review" ? context.outputs : new Map());
        const deliveredOutputs = new Map([...promptOutputs].filter(([, preview]) => preview.length > 0).map(([id]) => [id, contextHash(outputs.get(id) ?? "")]));
        let prompt = renderHarnessPrompt(block.prompt, ["ai", "chatbox"].includes(block.type) && !block.inputSchema ? contextPreview(input, WORKFLOW_CONTEXT_CHARS) : input, promptOutputs).replace(/\{\{\s*iteration\s*\}\}/g, String(index + 1));
        const instructions = sessionInstructions === undefined ? undefined : [
          sessionInstructions ? `Chatbox instructions ({{input}} refers to the current user message):\n${renderHarnessPrompt(sessionInstructions, "{{input}}", promptOutputs).replace(/\{\{\s*iteration\s*\}\}/g, String(index + 1))}` : "",
          runtimeContext,
        ].filter(Boolean).join("\n\n");
        if (runtimeContext && sessionInstructions === undefined) prompt += `\n\n${runtimeContext}`;
        if (index === 0 && state.workspace && !["ai", "chatbox"].includes(block.type)) prompt = `Continue your interrupted work from this session. Inspect prior tool results and preserve recorded task IDs and completed merges; do not duplicate previously completed operations. Original stage instructions:\n\n${prompt}`;
        if (outgoing.length) prompt += `\n\nWorkflow runtime capability: Use workflow_run_stack to send prompts to directly connected blocks and wait for their replies. If a connected block already has a session, the prompt is appended to that same session. Use timer_set to pause yourself and resume this same session later.`;
        if (loopOutgoing.length) prompt += `\nLoop paths return to earlier workflow blocks for another cycle. Use one only when another pass is needed: ${loopOutgoing.map((edge) => edge.label ?? blocks.find((item) => item.id === edge.to)?.label ?? edge.to).join(", ")}.`;
        if (block.routing === "ai" && outgoing.length) prompt += `\nChoose a named path when calling workflow_run_stack. Available paths: ${outgoing.map((edge) => edge.label).join(", ")}.`;
        if (block.type === "task") prompt += `\n\nThis is a visible task-orchestration block. Create implementation workspaces with task_create_and_start, inspect them with task_list and task_ai_response_tail, append instructions with task_append_prompt, and merge completed work with task_merge.`;
        const promptLimit = run.definition?.settings?.promptLimitChars ?? 100_000;
        const deliveredCharacters = prompt.length + (instructions?.length ?? 0);
        if (deliveredCharacters > promptLimit) throw new CoreError("INVALID_REQUEST", `Block '${block.label}' rendered a ${deliveredCharacters.toLocaleString()} character prompt, exceeding its ${promptLimit.toLocaleString()} character limit`);
        host.chargeContext(run, state, deliveredCharacters);
        state.prompt = prompt;
        host.log(state, "prompt", prompt);
        const attemptIndex = (state.attempts?.length ?? 0) + 1;
        const maxAttempts = run.definition?.settings?.maxBlockAttempts ?? 100;
        if (attemptIndex > maxAttempts) throw new CoreError("INVALID_REQUEST", `Block '${block.label}' reached its limit of ${maxAttempts} attempts`);
        const attemptId = crypto.randomUUID();
        latestAttemptId = attemptId;
        const attemptOperation = await host.beginOperation(run, "block_attempt", `block-attempt:${block.id}:${attemptIndex}`, block.id, { attemptIndex, iteration: index + 1, provider: state.provider }, attemptId);
        const attempt: HarnessBlockAttempt = { id: attemptId, index: attemptIndex, status: "running", startedAt: new Date().toISOString(), operationId: attemptOperation.id };
        state.attempts = [...(state.attempts ?? []), attempt];
        const promptOperation = await host.beginOperation(run, "prompt_delivery", `prompt:${block.id}:${attemptId}`, block.id, { provider: state.provider, prompt, ...(instructions ? { instructions } : {}) }, attemptId);
        const iteration: HarnessBlockIteration | undefined = state.iterations ? { index: index + 1, status: "running", startedAt: new Date().toISOString(), prompt } : undefined; if (iteration) state.iterations!.push(iteration); await host.update(run);
        try {
          const started = async (workspace: string) => { host.assertActive(run.id); state.workspace = workspace; attempt.workspace = workspace; if (iteration) iteration.workspace = workspace; await host.recordCompletedOperation(run, "session_binding", `session-workspace:${attemptId}`, block.id, { workspace }, attemptId); await host.update(run); host.assertActive(run.id); };
          const activity = async (session: AiSession, waitingUntil?: string) => host.recordActivity(run, state, session, waitingUntil);
          const execution = host.executions.get(run.id);
          host.assertActive(run.id);
          if (!execution) throw new Error("Workflow execution is no longer active");
          const settled = await execution.scheduler.turn(block.id, () => {
            execution.turnClaims.set(block.id, attemptId);
            return state.workspace && block.type !== "review"
              ? execution.append(block, prompt, { runId: run.id, blockId: block.id, workspace: state.workspace!, activity })
              : dispatch(host.effectiveBlock(run, block), prompt, { runId: run.id, blockId: block.id, attemptId, iteration: index + 1, ...(instructions ? { instructions } : {}), started, activity, assertActive: () => host.assertActive(run.id) });
          });
          host.assertActive(run.id);
          if (block.type === "chatbox") state.chatMessages!.at(-1)!.text = host.chatReplyText(state, settled);
          state.sessionId = settled.id; attempt.sessionId = settled.id; if (iteration) iteration.sessionId = settled.id;
          context.sessionId = state.sessionId;
          for (const [id, hash] of deliveredOutputs) context.outputs.set(id, hash);
          state.tokens = settled.tokens;
          state.context = settled.context; state.contextUsed = settled.contextUsed; state.contextLimit = settled.contextLimit;
          host.assertTokenBudget(run);
          await host.finishOperation(run, promptOperation, "succeeded", { sessionId: settled.id, workspace: state.workspace, status: settled.status });
          await host.recordCompletedOperation(run, "session_binding", `session:${attemptId}`, block.id, { sessionId: settled.id, workspace: state.workspace }, attemptId);
          host.log(state, "response", settled.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "Provider turn completed without an assistant response");
          if (settled.status === "user_prompt") throw new CoreError("INVALID_REQUEST", `${block.label} requires user input; resume support is not implemented yet`);
          if (settled.status === "error") {
            const message = [settled.messages.filter((message) => message.role === "error").at(-1)?.text ?? `${block.label} failed`, settled.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? ""].join("\n");
            throw new AiProviderError(settled.failure ?? normalizeAiFailure(message));
          }
          let output = settled.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "";
          host.chargeContext(run, state, output.length);
          const structuredOutput = parseHarnessData(output, block.outputSchema, `${block.label} output`);
          if (structuredOutput !== undefined) state.structuredOutput = structuredOutput;
          output = host.output(run, output);
          collected.push(output); attempt.status = "succeeded"; attempt.completedAt = new Date().toISOString(); await host.finishOperation(run, attemptOperation, "succeeded", { sessionId: settled.id, workspace: state.workspace, output: output.slice(-20_000) }); if (iteration) { iteration.output = output.slice(-200_000); iteration.status = "succeeded"; iteration.completedAt = new Date().toISOString(); } await host.update(run);
        } catch (error) {
          host.log(state, "error", error instanceof Error ? error.message : String(error));
          const message = error instanceof Error ? error.message : String(error); attempt.status = error instanceof Cancelled ? "cancelled" : "failed"; attempt.error = message; attempt.completedAt = new Date().toISOString();
          if (promptOperation.status === "intent") await host.finishOperation(run, promptOperation, "failed", undefined, error);
          if (attemptOperation.status === "intent") await host.finishOperation(run, attemptOperation, "failed", undefined, error);
          if (iteration) { iteration.status = error instanceof Cancelled ? "cancelled" : "failed"; iteration.error = message; iteration.completedAt = new Date().toISOString(); } throw error;
        }
      }
      const output = count === 1 ? collected[0] ?? "" : collected.map((value, index) => `## Stack item ${index + 1}\n${value}`).join("\n\n");
      if (block.type === "review" && block.review?.correction) {
        const corrected = await host.requestReviewCorrection(run, block, output);
        if (corrected === "blocked") return;
        if (corrected === "corrected") return host.executeBlock(run, block, blocks, edges, outputs, dispatch, defaultProvider, stack);
      }
      host.assertActive(run.id);
      const execution = host.executions.get(run.id); if (!execution || execution.turnClaims.get(block.id) !== latestAttemptId) return;
      const boundedOutput = host.output(run, output); outputs.set(block.id, boundedOutput); state.output = boundedOutput; state.status = "succeeded"; state.completedAt = new Date().toISOString(); state.failureReason = undefined; state.retryAt = undefined; state.retryStartedAt = undefined; state.waitingUntil = undefined; state.pendingPermission = undefined; state.question = undefined; state.pauseId = undefined; host.log(state, "lifecycle", "Completed successfully"); await host.update(run);
    } finally { const active = host.activeProviders.get(run.id); if (state.provider) active?.delete(state.provider); }
  }
