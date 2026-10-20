import { workflowTemplateCatalog } from "../workflow-templates.js";
import { type Request } from "@hatopad/protocol";
import { workflowOutputPage } from "../workflow-inspection.js";
import { CoreError } from "../errors.js";
import { summarizeHarnessRun } from "../harnesses.js";
import { validateHarness } from "../harness-graph.js";
import { pageMessages } from "../ai/message-page.js";
import { projectBlockDetail, projectProgress } from "../harness-progress.js";
import { findAutopilotOption } from "@hatopad/acp";
import {
  startWorkflow,
  workflowRunWorkspace,
  availableWorkflowWorkspace,
  resolveWorkflowBinding,
  workflowSessionWorkspace,
  steerWorkflowSession,
} from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleHarnessesRequest(context: RequestContext, request: Request): Promise<unknown> {
  const {
    tasks,
    acp,
    agents,
    harnesses,
    harnessRunner,
    workflowApps,
    terminalHost,
    aiTimers,
    rootWorkspace,
    bridgeWorkspace,
    workspacePath,
  } = context;
  switch (request.type) {
    case "harnesses.templates":
      return { templates: workflowTemplateCatalog() };
    case "harnesses.list":
      return { harnesses: await harnesses.list(), diagnostics: await harnesses.diagnostics() };
    case "harnesses.read":
      return { harness: await harnesses.read(request.payload.id) };
    case "harnesses.create":
      return { harness: await harnesses.create(request.payload.name, request.payload.template) };
    case "harnesses.update": {
      const validation = validateHarness(request.payload.harness);
      if (!validation.valid && request.payload.harness.blocks.length)
        throw new CoreError("INVALID_REQUEST", validation.issues.map((issue) => issue.message).join("; "));
      return { harness: await harnesses.update(request.payload.harness) };
    }
    case "harnesses.delete":
      await harnesses.delete(request.payload.id);
      return {};
    case "harnesses.validate":
      return validateHarness(request.payload.harness);
    case "harnesses.messages": {
      const empty = pageMessages(
        { messages: [] },
        { limit: request.payload.limit, maxTextLength: request.payload.maxTextLength },
      );
      if (
        request.payload.before !== undefined &&
        (typeof request.payload.before !== "string" || !request.payload.before || request.payload.before.length > 128)
      )
        throw new CoreError("INVALID_REQUEST", "before must be a message id");
      if (
        typeof request.payload.runId !== "string" ||
        !request.payload.runId ||
        typeof request.payload.blockId !== "string" ||
        !request.payload.blockId
      )
        throw new CoreError("INVALID_REQUEST", "Choose a workflow run and block");
      const run = await harnessRunner.readRun(request.payload.runId);
      const block = run?.blocks.find((block) => block.blockId === request.payload.blockId);
      if (!run || !block) throw new CoreError("FILE_NOT_FOUND", "Workflow block is unavailable in this root");
      if (!block.workspace || !block.provider) return { available: false, status: "idle", ...empty };
      const binding = await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath });
      if ((await availableWorkflowWorkspace(block.workspace)) !== (await availableWorkflowWorkspace(binding.workspace)))
        throw new CoreError("INVALID_REQUEST", "Workflow session no longer belongs to its bound worktree");
      const session = await acp.get(block.provider).get(block.workspace);
      if (block.sessionId && block.sessionId !== session.id) return { available: false, status: "idle", ...empty };
      const page = {
        available: true,
        ...(session.id ? { sessionId: session.id } : {}),
        status: session.status,
        ...pageMessages(session, request.payload),
      };
      if (Buffer.byteLength(JSON.stringify(page)) > 900_000)
        throw new CoreError("INVALID_REQUEST", "Transcript page exceeds its byte budget; use a smaller page");
      return page;
    }
    case "harnesses.output": {
      if (typeof request.payload.runId !== "string" || !request.payload.runId)
        throw new CoreError("INVALID_REQUEST", "Choose a workflow run");
      const run = await harnessRunner.readRun(request.payload.runId);
      if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run is unavailable in this root");
      return workflowOutputPage(run, request.payload.blockId, request.payload);
    }
    case "harnesses.invoke": {
      const { runId, callerBlockId, targetBlockId, input } = request.payload;
      if (
        [runId, callerBlockId, targetBlockId].some((id) => typeof id !== "string" || !id || id.length > 128) ||
        typeof input !== "string" ||
        !input.trim() ||
        input.length > 64_000
      )
        throw new CoreError("INVALID_REQUEST", "Choose a connected AI block and input");
      const run = await harnessRunner.readRun(runId),
        caller = run?.definition?.blocks.find((block) => block.id === callerBlockId),
        target = run?.definition?.blocks.find((block) => block.id === targetBlockId);
      if (!run || !caller || !target)
        throw new CoreError("FILE_NOT_FOUND", "Workflow block is unavailable in this root");
      await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath });
      if (
        !["ai", "chatbox"].includes(caller.type) ||
        !["ai", "chatbox"].includes(target.type) ||
        !run.definition?.edges.some(
          (edge) =>
            edge.from === callerBlockId &&
            edge.to === targetBlockId &&
            (edge.type === "use" || caller.type === "chatbox"),
        )
      )
        throw new CoreError("INVALID_REQUEST", "Choose a directly connected AI Agent or Chatbox");
      if (
        !harnessRunner.isActive(runId) ||
        run.blocks.find((block) => block.blockId === callerBlockId)?.status !== "running"
      )
        throw new CoreError(
          "INVALID_REQUEST",
          "Send a follow-up to activate this Chatbox before invoking a connected block",
        );
      const result = await harnessRunner.flowTool(runId, callerBlockId, "workflow_use_block", {
        block_id: targetBlockId,
        action: "start",
        input,
      });
      return { output: JSON.stringify(result).slice(0, 8000) };
    }
    case "harnesses.blockDetail": {
      if (typeof request.payload.runId !== "string" || !request.payload.runId)
        throw new CoreError("INVALID_REQUEST", "runId must be a non-empty string");
      const run = await harnessRunner.readRun(request.payload.runId);
      if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
      return { block: projectBlockDetail(run, request.payload.blockId, request.payload) };
    }
    case "harnesses.progress": {
      if (typeof request.payload.runId !== "string" || !request.payload.runId)
        throw new CoreError("INVALID_REQUEST", "runId must be a non-empty string");
      const run = await harnessRunner.readRun(request.payload.runId);
      if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
      return { run: projectProgress(run, request.payload.logLimit) };
    }
    case "harnesses.runs": {
      const selectedRun = request.payload.runId ? await harnessRunner.readRun(request.payload.runId) : undefined;
      const runs = request.payload.runId
        ? selectedRun && (!request.payload.harnessId || selectedRun.harnessId === request.payload.harnessId)
          ? [selectedRun]
          : []
        : request.payload.summary
          ? await harnesses.summaries(request.payload.harnessId)
          : await harnesses.runs(request.payload.harnessId);
      return {
        runs: await Promise.all(
          runs.map(async (record) => {
            const run = request.payload.summary ? summarizeHarnessRun(record) : record;
            if (run.binding) return run;
            try {
              const binding = await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath });
              return { ...run, workspace: binding.workspace, binding };
            } catch {
              return run;
            } // Preserve unreadable legacy evidence; execution rejects it explicitly.
          }),
        ),
      };
    }
    case "harnesses.runs.delete":
      await harnesses.deleteRun(request.payload.runId);
      return {};
    case "harnesses.test": {
      const { definition, blockId, input, provider } = request.payload;
      return {
        run: await startWorkflow(
          {
            harnessId: definition.id,
            input,
            provider,
            target: request.payload.target,
            startBlockId: blockId,
            testDefinition: definition,
          },
          { acp, tasks, agents, harnessRunner, workflowApps, aiTimers, rootWorkspace, bridgeWorkspace, workspacePath },
        ),
      };
    }
    case "harnesses.app.terminal":
    case "harnesses.app.read":
    case "harnesses.app.kill": {
      const { harnessId, blockId, runId } = request.payload;
      const run = runId ? (await harnesses.runs(harnessId)).find((run) => run.id === runId) : undefined;
      if (runId && !run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
      const definition = run?.definition ?? (await harnesses.read(harnessId));
      const block = definition.blocks.find((block) => block.id === blockId);
      if (block?.type !== "run_app" || !block.app)
        throw new CoreError("INVALID_REQUEST", "Selected block is not a Run App");
      const appWorkspace = run
        ? (await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath })).workspace
        : await availableWorkflowWorkspace(workspacePath);
      if (request.type === "harnesses.app.terminal")
        return workflowApps.openTerminal(block.app.name, appWorkspace, appWorkspace, terminalHost);
      if (request.type === "harnesses.app.read") return { app: workflowApps.read(block.app.name, appWorkspace) };
      await workflowApps.execute(
        { ...block, app: { ...block.app, actions: ["kill"] } },
        '{"action":"kill"}',
        appWorkspace,
        () => {},
      );
      return {};
    }
    case "harnesses.run":
      return {
        run: await startWorkflow(request.payload, {
          acp,
          tasks,
          agents,
          harnessRunner,
          workflowApps,
          aiTimers,
          rootWorkspace,
          bridgeWorkspace,
          workspacePath,
        }),
      };
    case "harnesses.chat": {
      const payload = request.payload;
      if (typeof payload.input !== "string" || !payload.input.trim() || payload.input.length > 100_000)
        throw new CoreError("INVALID_REQUEST", "Chat input must contain 1–100,000 characters");
      const existing = payload.runId ? (await harnesses.runs()).find((run) => run.id === payload.runId) : undefined;
      if (payload.runId && (!existing || existing.harnessId !== payload.harnessId))
        throw new CoreError("INVALID_REQUEST", "Chat run does not belong to this workflow");
      const definition = existing?.definition ?? (await harnesses.read(payload.harnessId));
      if (definition.blocks.find((block) => block.id === payload.blockId)?.type !== "chatbox")
        throw new CoreError("INVALID_REQUEST", "Select a Chatbox block");
      return {
        run: await startWorkflow(
          {
            harnessId: payload.harnessId,
            input: payload.input,
            startBlockId: payload.blockId,
            chatRunId: payload.runId,
            chatSettings: payload.settings,
            target: payload.target,
            provider: existing?.blocks.find((block) => block.blockId === payload.blockId)?.provider ?? payload.provider,
          },
          { acp, tasks, agents, harnessRunner, workflowApps, aiTimers, rootWorkspace, bridgeWorkspace, workspacePath },
        ),
      };
    }
    case "harnesses.autopilot":
      return {
        run: await harnessRunner.setAutopilot(
          request.payload.runId,
          request.payload.blockId,
          request.payload.sessionId,
          request.payload.enabled,
          async (providerId, target, sessionId, enabled) => {
            const provider = acp.get(providerId);
            const session = await provider.get(target);
            if (session.id !== sessionId) throw new CoreError("INVALID_REQUEST", "Chatbox session changed");
            const option = findAutopilotOption([...provider.descriptor.options, ...(session.availableOptions ?? [])]);
            if (!option) throw new CoreError("INVALID_REQUEST", "This provider does not support Autopilot");
            return provider.configure(target, { [option.option.id]: enabled ? option.on : option.off });
          },
        ),
      };
    case "harnesses.steer":
      return {
        run: await harnessRunner.steerChat(
          request.payload.runId,
          request.payload.blockId,
          request.payload.sessionId,
          request.payload.input,
          (provider, target, input) =>
            steerWorkflowSession(acp.get(provider), target, input, aiTimers, rootWorkspace, bridgeWorkspace),
        ),
      };
    case "harnesses.append":
      return { run: await harnessRunner.appendInput(request.payload.runId, request.payload.input) };
    case "harnesses.permission.resolve":
      return {
        run: await harnessRunner.resolvePermission(
          request.payload.runId,
          request.payload.blockId,
          request.payload.sessionId,
          request.payload.pauseId,
          request.payload.requestId,
          request.payload.optionId,
          async (provider, target, requestId, optionId) =>
            acp.get(provider).resolvePermission(target, requestId, optionId),
        ),
      };
    case "harnesses.answer":
      return {
        run: await harnessRunner.answerQuestion(
          request.payload.runId,
          request.payload.blockId,
          request.payload.sessionId,
          request.payload.pauseId,
          request.payload.input,
          async (provider, target, input) => acp.get(provider).steer(target, input),
        ),
      };
    case "harnesses.pause.resume":
      return {
        run: await harnessRunner.resumeTimer(
          request.payload.runId,
          request.payload.blockId,
          request.payload.pauseId,
          (provider, target) => aiTimers.fireNext(target, provider),
        ),
      };
    case "harnesses.pause.retry":
      return {
        run: await harnessRunner.retryPause(request.payload.runId, request.payload.blockId, request.payload.pauseId),
      };
    case "harnesses.pause.cancel":
      return {
        run: await harnessRunner.cancelPause(
          request.payload.runId,
          request.payload.blockId,
          request.payload.pauseId,
          async (provider, runtime) => {
            const target =
              runtime.workspace ??
              (await workflowSessionWorkspace(
                await workflowRunWorkspace(await harnessRunner.readRun(runtime.runId), rootWorkspace),
                runtime.runId,
                runtime.blockId,
              ));
            await aiTimers.cancelWorkspace(target);
            await acp.get(provider).interrupt(target);
          },
        ),
      };
    case "harnesses.control.pause": {
      const run = await harnessRunner.readRun(request.payload.runId);
      if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
      await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath });
      return { run: summarizeHarnessRun(await harnessRunner.setPaused(request.payload.runId, request.payload.paused)) };
    }
    case "harnesses.control.retryFailed": {
      const run = await harnessRunner.readRun(request.payload.runId);
      if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
      for (const block of run.blocks.filter(
        (block) => block.workspace && ["failed", "retry_scheduled", "blocked", "cancelled"].includes(block.status),
      )) {
        const session = await acp.get(block.provider).get(block.workspace!);
        if (session.status === "in_progress" || session.status === "user_prompt")
          throw new CoreError("INVALID_REQUEST", "A workflow session is still active; inspect it before retrying");
      }
      return {
        run: summarizeHarnessRun(
          await startWorkflow(
            { harnessId: run.harnessId, input: run.input, retryRunId: run.id },
            {
              acp,
              tasks,
              agents,
              harnessRunner,
              workflowApps,
              aiTimers,
              rootWorkspace,
              bridgeWorkspace,
              workspacePath,
            },
          ),
        ),
      };
    }
    case "harnesses.cancel":
      return {
        run: await harnessRunner.cancel(request.payload.runId, async (provider, runtime) => {
          const target =
            runtime.workspace ??
            (await workflowSessionWorkspace(
              await workflowRunWorkspace(await harnessRunner.readRun(runtime.runId), rootWorkspace),
              runtime.runId,
              runtime.blockId,
            ));
          await aiTimers.cancelWorkspace(target);
          await acp.get(provider).interrupt(target);
        }),
      };
  }
}
