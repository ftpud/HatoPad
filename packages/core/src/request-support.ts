import { stateHome } from "./state-home.js";
import { executeTerminalControlAsync } from "./workflow-terminal.js";
import { managedProcesses } from "./managed-processes.js";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, realpath, stat, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ProtocolOperations, type WorkspaceOptions } from "@hatopad/protocol";
import { CoreError } from "./errors.js";
import { WorkspaceTaskStore } from "./tasks.js";
import { SkillsStore } from "./skills.js";
import { AgentsStore } from "./agents.js";
import { prepareWorkflowSkills, executeWorkflowSkill, workflowSessionSkillIds } from "./workflow-skills.js";
import { executeTaskControls } from "./workflow-task-controls.js";
import { executeFlowScript } from "./workflow-script.js";
import { WorkflowAppService } from "./workflow-app.js";
import { HarnessRunner } from "./harness-runner.js";
import { type AcpRegistry } from "./ai/index.js";
import { AiTimerService } from "./ai-timers.js";
import { appToolServer, withAppTools } from "./app-tools.js";
import { MAX_FILE_SIZE } from "./filesystem.js";
import type { AiProvider, AiSession, HarnessBlock, HarnessDefinition } from "@hatopad/protocol";
import {
  AiProviderError,
  findAutopilotOption,
  normalizeAiFailure,
  type AiConfiguration,
  type AiOption,
  type AiProtocolVersion,
} from "@hatopad/acp";

export const execFileAsync = promisify(execFile);

export const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export /** Optional per-request cap for phone-sized reads; never exceeds the Core-wide file limit. */
function optionalByteLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_FILE_SIZE)
    throw new CoreError("INVALID_REQUEST", `maxBytes must be an integer from 1 to ${MAX_FILE_SIZE}`);
  return value;
}

export /** The target is already working; schedules pause on it, triggers skip the event. */
class DeliveryBusy extends CoreError {
  constructor(message: string) {
    super("INVALID_REQUEST", message);
  }
}

export type WorkflowGateRuntime = { runId: string; blockId: string; attemptId: string; assertActive(): void };

export type WorkflowReviewEvidence = { revision: string; baseRevision: string; files: string[]; diff: string };

export async function collectWorkflowReviewEvidence(
  block: HarnessBlock,
  workspace: string,
  runner: HarnessRunner,
  runtime: WorkflowGateRuntime,
): Promise<WorkflowReviewEvidence> {
  const review = block.review;
  if (!review) throw new CoreError("INVALID_REQUEST", "Review blocks require a review configuration");
  return runner.runOperation(
    runtime.runId,
    runtime.blockId,
    "review",
    `review:${runtime.attemptId}`,
    { revision: review.revision, baseRevision: review.baseRevision },
    async () => {
      runtime.assertActive();
      const revision = await resolveWorkflowCommit(workspace, review.revision);
      const baseRevision = review.baseRevision
        ? await resolveWorkflowCommit(workspace, review.baseRevision)
        : (
            await execFileAsync("git", ["-C", workspace, "rev-parse", `${revision}^`], { encoding: "utf8" })
          ).stdout.trim();
      const [diffResult, filesResult] = await Promise.all([
        execFileAsync("git", ["-C", workspace, "diff", "--no-ext-diff", "--unified=3", baseRevision, revision], {
          encoding: "utf8",
          maxBuffer: 2_000_000,
        }),
        execFileAsync("git", ["-C", workspace, "diff", "--name-only", baseRevision, revision], { encoding: "utf8" }),
      ]);
      runtime.assertActive();
      return {
        revision,
        baseRevision,
        files: filesResult.stdout.split("\n").filter(Boolean).slice(0, 500),
        diff: boundedWorkflowOutput(diffResult.stdout, 500_000),
      };
    },
  );
}

export async function runWorkflowVerification(
  block: HarnessBlock,
  workspace: string,
  runner: HarnessRunner,
  runtime: WorkflowGateRuntime,
): Promise<AiSession> {
  const verification = block.verification;
  if (!verification) throw new CoreError("INVALID_REQUEST", "Verification blocks require a verification configuration");
  const workingDirectory = path.resolve(workspace, verification.workingDirectory ?? ".");
  if (workingDirectory !== workspace && !workingDirectory.startsWith(`${workspace}${path.sep}`))
    throw new CoreError("INVALID_REQUEST", "Verification working directory must be inside the workspace");
  const result = await runner.runOperation(
    runtime.runId,
    runtime.blockId,
    "verification",
    `verification:${runtime.attemptId}`,
    {
      command: verification.command,
      workingDirectory: verification.workingDirectory ?? ".",
      revision: verification.revision,
    },
    async () => {
      runtime.assertActive();
      const revision = await resolveWorkflowCommit(workingDirectory, verification.revision ?? "HEAD");
      if (verification.revision && revision.toLowerCase() !== verification.revision.toLowerCase())
        throw new CoreError(
          "INVALID_REQUEST",
          `Verification revision '${verification.revision}' resolved to '${revision}', so Core refused to test a different revision`,
        );
      const startedAt = Date.now();
      try {
        const completed = await execFileAsync("sh", ["-lc", verification.command], {
          cwd: workingDirectory,
          encoding: "utf8",
          timeout: verification.timeoutMs ?? 10 * 60_000,
          maxBuffer: 2_000_000,
        });
        runtime.assertActive();
        return {
          revision,
          workingDirectory,
          command: verification.command,
          exitCode: 0,
          durationMs: Date.now() - startedAt,
          output: boundedWorkflowOutput(`${completed.stdout}${completed.stderr}`),
        };
      } catch (error) {
        const failed = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
        const result = {
          revision,
          workingDirectory,
          command: verification.command,
          exitCode: typeof failed.code === "number" ? failed.code : null,
          durationMs: Date.now() - startedAt,
          output: boundedWorkflowOutput(`${failed.stdout ?? ""}${failed.stderr ?? ""}`),
          timedOut: Boolean(failed.killed),
        };
        throw new CoreError(
          "INVALID_REQUEST",
          `Verification failed for ${revision} (exit ${result.exitCode ?? "unknown"}) after ${result.durationMs}ms: ${result.output || "no output"}`,
        );
      }
    },
  );
  return {
    id: `core-verification-${runtime.attemptId}`,
    model: "core",
    reasoning: "none",
    status: "done",
    messages: [
      {
        id: `verification-${runtime.attemptId}`,
        role: "assistant",
        text: JSON.stringify(result),
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export async function resolveWorkflowCommit(workspace: string, reference: string): Promise<string> {
  if (reference !== "HEAD" && !/^[0-9a-f]{7,64}$/i.test(reference))
    throw new CoreError("INVALID_REQUEST", "Workflow gates require a commit SHA");
  try {
    return (
      await execFileAsync("git", ["-C", workspace, "rev-parse", "--verify", `${reference}^{commit}`], {
        encoding: "utf8",
      })
    ).stdout.trim();
  } catch {
    throw new CoreError("INVALID_REQUEST", `Workflow gate commit '${reference}' does not exist in this workspace`);
  }
}

export function boundedWorkflowOutput(value: string, limit = 200_000): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… output truncated by Core`;
}

export async function startWorkflow(
  input: ProtocolOperations["harnesses.run"]["payload"] & {
    retryRunId?: string;
    chatRunId?: string;
    chatSettings?: import("@hatopad/protocol").HarnessChatSettings;
    testDefinition?: HarnessDefinition;
  },
  context: {
    acp: AcpRegistry;
    tasks: WorkspaceTaskStore;
    agents: AgentsStore;
    harnessRunner: HarnessRunner;
    workflowApps: WorkflowAppService;
    aiTimers: AiTimerService;
    rootWorkspace: string;
    bridgeWorkspace: string;
    workspacePath: string;
  },
): Promise<import("@hatopad/protocol").HarnessRun> {
  const { acp, tasks, agents, harnessRunner, workflowApps, aiTimers, rootWorkspace, bridgeWorkspace } = context;
  const previousRunId = input.retryRunId ?? input.chatRunId ?? input.rerunRunId;
  const previousRun = previousRunId ? await harnessRunner.readRun(previousRunId) : undefined;
  if (previousRunId && !previousRun) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
  const binding = await resolveWorkflowBinding(previousRun, input.target, context);
  const workspacePath = binding.workspace;
  const dispatch: Parameters<HarnessRunner["start"]>[2] = async (block, prompt, runtime) =>
    providerOperation(async () => {
      await validateWorkflowBinding(binding, tasks, rootWorkspace);
      if (block.type === "skill" && block.skillId)
        return executeWorkflowSkill(block, new SkillsStore(undefined, rootWorkspace), workspacePath, runtime);
      if (block.type === "script")
        return executeFlowScript(block, prompt, workspacePath, runtime.assertActive, {
          rootWorkspace,
          workflowRunId: runtime.runId,
          workflowBlockId: runtime.blockId,
        });
      if (block.type === "terminal_control")
        return executeTerminalControlAsync(prompt, workspacePath, workflowApps.terminals, runtime.assertActive);
      if (block.type === "run_app")
        return workflowApps.execute(block, prompt, workspacePath, runtime.assertActive, {
          rootWorkspace,
          workflowRunId: runtime.runId,
          workflowBlockId: runtime.blockId,
        });
      if (block.type === "task_controls")
        return executeTaskControls(
          block,
          prompt,
          { ...context, workspacePath, defaultProvider: input.provider ?? acp.defaultId },
          runtime,
        );
      if (block.type === "verification") return runWorkflowVerification(block, workspacePath, harnessRunner, runtime);
      if (block.type === "review") {
        const evidence = await collectWorkflowReviewEvidence(block, workspacePath, harnessRunner, runtime);
        prompt = `${prompt}\n\nCore-recorded review evidence (review this exact revision; do not infer it from another session):\nCommit: ${evidence.revision}\nBase: ${evidence.baseRevision}\nChanged files: ${evidence.files.join(", ") || "none"}\n\nDiff:\n${evidence.diff}`;
        if (block.review?.correction)
          prompt += `\n\nThis review drives a Core correction loop. Reply with JSON only: {"revision":"${evidence.revision}","findings":[{"id":"stable-finding-id","message":"actionable finding","ownerBlockId":"${block.review.correction.ownerBlockId}"}]}. Use an empty findings array when the revision is approved.`;
      }
      const provider = acp.get(block.provider ?? input.provider);
      await assertWorkflowModelAvailable(provider, block.model, block.reasoning);
      if (block.watchdog)
        return harnessRunner.watch(
          runtime.runId,
          runtime.blockId,
          () => provider.usage(),
          () =>
            harnessRunner.recoverChildren(
              runtime.runId,
              async (child) => {
                const task = (await tasks.list()).tasks.find((item) => item.id === child.taskId);
                if (
                  !task ||
                  task.status === "finished" ||
                  task.archived ||
                  (await aiTimers.next(child.workspace, child.provider))
                )
                  return undefined;
                if (
                  (await availableWorkflowWorkspace(tasks.taskPath(child.taskId))) !==
                  (await availableWorkflowWorkspace(child.workspace))
                )
                  throw new CoreError("INVALID_REQUEST", "Workflow child worktree changed");
                return acp.get(child.provider).get(child.workspace);
              },
              async (child, session) => {
                const manager = acp.get(child.provider);
                const current = await manager.get(child.workspace);
                if (current.status !== "error" || current.id !== session.id || !harnessRunner.isActive(runtime.runId))
                  return;
                const tools = withAppTools(
                  rootWorkspace,
                  child.workspace,
                  undefined,
                  undefined,
                  child.provider,
                  bridgeWorkspace,
                );
                const resumed = await manager.send(child.workspace, {
                  prompt:
                    "Continue your interrupted implementation from the existing session. Preserve completed work and recorded task IDs. Do not create replacement tasks.",
                  configuration: current.configuration ?? { model: current.model, reasoning: current.reasoning },
                  mcpServers: tools.servers,
                });
                if (!harnessRunner.isActive(runtime.runId)) await manager.interrupt(child.workspace);
                return resumed;
              },
            ),
        );
      const sessionWorkspace = await workflowSessionWorkspace(workspacePath, runtime.runId, runtime.blockId);
      await runtime.started(sessionWorkspace);
      const agentFile = block.agent
        ? (await agents.list(workspacePath)).find(
            (item) => item.scope === block.agent!.scope && item.name === block.agent!.name,
          )
        : undefined;
      if (block.agent && !agentFile)
        throw new CoreError("FILE_NOT_FOUND", `Agent preset '${block.agent.name}' does not exist`);
      const appTools = withAppTools(
        rootWorkspace,
        sessionWorkspace,
        undefined,
        agentFile?.agent,
        provider.descriptor.id,
        bridgeWorkspace,
      );
      const workflowTools = appToolServer(rootWorkspace, sessionWorkspace, provider.descriptor.id, bridgeWorkspace, {
        ...runtime,
        flow: ["ai", "chatbox"].includes(block.type),
      });
      const mcpServers = [...appTools.servers.filter((server) => server.name !== workflowTools.name), workflowTools];
      const workflowAgent = appTools.agent
        ? { ...appTools.agent, mcpServers: [...new Set([...(appTools.agent.mcpServers ?? []), workflowTools.name])] }
        : undefined;
      // The protocol only adds guidance; failing to read it must not block the step.
      const turnInstructions = workflowTurnInstructions(
        await Promise.resolve()
          .then(() => provider.installation())
          .then(
            (item) => item.protocol,
            () => undefined,
          ),
      );
      const sessionAgent =
        runtime.instructions || turnInstructions
          ? {
              ...workflowAgent,
              name: workflowAgent?.name ?? block.label,
              instructions: [workflowAgent?.instructions, runtime.instructions, turnInstructions]
                .filter(Boolean)
                .join("\n\n"),
            }
          : workflowAgent;
      const configuration = workflowConfiguration(provider.descriptor.options, block);
      const run = await harnessRunner.readRun(runtime.runId);
      const skillIds = await workflowSessionSkillIds(
        run?.definition,
        block,
        new SkillsStore(undefined, rootWorkspace),
        workspacePath,
      );
      runtime.assertActive();
      try {
        await provider.startFreshSession(sessionWorkspace, {
          prompt,
          configuration,
          mcpServers,
          captureSnapshots: workflowCapturesSnapshots(run, block.id),
          ...(skillIds ? { skillIds } : {}),
          agent: sessionAgent,
          ...(block.agent ? { agentPreset: block.agent } : {}),
        });
        runtime.assertActive();
      } catch (error) {
        runtime.assertActive();
        if (!block.watchdog) throw error;
        console.error("[core] Watchdog startup failed; scheduling recovery", error);
      }
      managedProcesses.setWorkspaceContext(sessionWorkspace, {
        workflowRunId: runtime.runId,
        workflowBlockId: runtime.blockId,
      });
      return settleWorkflowSession(
        provider,
        sessionWorkspace,
        aiTimers,
        block.watchdog ? runtime : undefined,
        () => harnessRunner.isActive(runtime.runId),
        runtime.activity,
      );
    });
  const append: NonNullable<Parameters<HarnessRunner["start"]>[4]> = async (block, prompt, runtime) =>
    providerOperation(async () => {
      await validateWorkflowBinding(binding, tasks, rootWorkspace);
      if ((await availableWorkflowWorkspace(runtime.workspace)) !== workspacePath)
        throw new CoreError("INVALID_REQUEST", "Workflow session no longer points to its bound worktree");
      const provider = acp.get(block.provider ?? input.provider);
      if (!harnessRunner.isActive(runtime.runId)) throw new Error("Workflow is no longer active");
      const current = await provider.get(runtime.workspace);
      if (!harnessRunner.isActive(runtime.runId)) throw new Error("Workflow is no longer active");
      const workflowTools = appToolServer(rootWorkspace, runtime.workspace, provider.descriptor.id, bridgeWorkspace, {
        runId: runtime.runId,
        blockId: runtime.blockId,
        flow: ["ai", "chatbox"].includes(block.type),
      });
      if (current.status === "in_progress" || current.status === "user_prompt")
        await provider.steer(runtime.workspace, prompt);
      else
        await provider.send(runtime.workspace, {
          prompt,
          configuration: {
            ...(current.configuration ?? { model: current.model, reasoning: current.reasoning }),
            ...workflowFeatureOptions(provider.descriptor.options, block),
          },
          mcpServers: [workflowTools],
          captureSnapshots: workflowCapturesSnapshots(await harnessRunner.readRun(runtime.runId), block.id),
        });
      if (!harnessRunner.isActive(runtime.runId)) throw new Error("Workflow is no longer active");
      return settleWorkflowSession(
        provider,
        runtime.workspace,
        aiTimers,
        block.watchdog ? runtime : undefined,
        () => harnessRunner.isActive(runtime.runId),
        runtime.activity,
      );
    });
  if (input.retryRunId)
    return harnessRunner.retryFailedRun(input.retryRunId, dispatch, input.provider ?? acp.defaultId, append);
  return input.chatRunId
    ? harnessRunner.continueChat(
        input.chatRunId,
        input.startBlockId!,
        input.input,
        dispatch,
        input.provider ?? acp.defaultId,
        append,
        binding,
        input.chatSettings,
      )
    : harnessRunner.start(
        input.harnessId,
        input.input,
        dispatch,
        input.provider ?? acp.defaultId,
        append,
        input.startBlockId,
        input.rerunRunId,
        input.testDefinition,
        workspacePath,
        (definition) => prepareWorkflowSkills(definition, new SkillsStore(undefined, rootWorkspace), workspacePath),
        binding,
        input.chatSettings && input.startBlockId
          ? { blockId: input.startBlockId, settings: input.chatSettings }
          : undefined,
      );
}

/**
 * ACP v2 agents may end a turn while background work they started still runs and
 * resume on their own later. A workflow step ends with the turn, so the step would
 * pass on an unfinished answer; v2 agents are told to wait inside the turn instead.
 */
export function workflowTurnInstructions(protocol: AiProtocolVersion | undefined): string | undefined {
  if (protocol !== "v2") return undefined;
  return "Workflow turns: this workflow step ends as soon as your turn ends, and its output is passed on immediately. Do not end your turn or go idle while you are waiting for something, such as a background command, build, test, subagent, or connected block. Work you resume after the turn ends is not seen by the workflow. Wait inside the turn instead: run commands in the foreground until they finish, or poll their status and output with short sleeps between checks; for connected blocks, call workflow_use_block without an action to wait for completion, use the Meeting wait action, or poll workflow_block_messages. End your turn only when your final answer for this step is ready.";
}

/** Helpers connected through use edges share the lead's workspace snapshot coverage. */
export function workflowCapturesSnapshots(
  run: import("@hatopad/protocol").HarnessRun | undefined,
  blockId: string,
): boolean {
  return !run?.definition?.edges.some((edge) => edge.type === "use" && edge.to === blockId);
}

export async function workflowRunWorkspace(
  run: import("@hatopad/protocol").HarnessRun | undefined,
  fallback: string,
): Promise<string> {
  if (!run) return availableWorkflowWorkspace(fallback);
  const recorded = run.binding?.workspace ?? run.workspace;
  if (recorded) return availableWorkflowWorkspace(recorded);
  // A child session is intentional targeting, not evidence of the parent's cwd.
  for (const block of run.blocks) {
    if (!block.workspace) continue;
    const workspace = await availableWorkflowWorkspace(block.workspace);
    if (!run.children?.some((child) => path.resolve(child.workspace) === workspace)) return workspace;
  }
  throw new CoreError(
    "INVALID_REQUEST",
    "Legacy workflow run has no recorded workspace; start a new run in the selected task",
  );
}

export async function availableWorkflowWorkspace(workspace: string): Promise<string> {
  try {
    const resolved = await realpath(workspace);
    if (!(await stat(resolved)).isDirectory()) throw new Error("Not a directory");
    return resolved;
  } catch {
    throw new CoreError("FILE_NOT_FOUND", `Workflow worktree is unavailable: ${workspace}`);
  }
}

export async function validateWorkflowBinding(
  binding: import("@hatopad/protocol").HarnessWorkspaceBinding,
  tasks: Pick<WorkspaceTaskStore, "list" | "taskPath">,
  rootWorkspace: string,
): Promise<void> {
  if (
    !binding ||
    typeof binding.rootWorkspace !== "string" ||
    typeof binding.workspace !== "string" ||
    (binding.taskId !== undefined && (typeof binding.taskId !== "string" || !binding.taskId))
  )
    throw new CoreError("INVALID_REQUEST", "Workflow has an invalid recorded worktree binding");
  if (path.resolve(binding.rootWorkspace) !== path.resolve(rootWorkspace))
    throw new CoreError("INVALID_REQUEST", "Workflow run belongs to a different root");
  if (binding.taskId) {
    if (!(await tasks.list()).tasks.some((task) => task.id === binding.taskId))
      throw new CoreError("FILE_NOT_FOUND", "Workflow bound task no longer exists");
    if ((await availableWorkflowWorkspace(tasks.taskPath(binding.taskId))) !== binding.workspace)
      throw new CoreError("INVALID_REQUEST", "Workflow task worktree changed since this run started");
  }
  if (!binding.taskId && binding.workspace !== (await availableWorkflowWorkspace(rootWorkspace)))
    throw new CoreError(
      "INVALID_REQUEST",
      "Workflow root binding points to a task worktree without a recorded task identity",
    );
  if ((await availableWorkflowWorkspace(binding.workspace)) !== binding.workspace)
    throw new CoreError("INVALID_REQUEST", "Workflow bound worktree was redirected");
}

export async function resolveWorkflowBinding(
  run: import("@hatopad/protocol").HarnessRun | undefined,
  target: import("@hatopad/protocol").HarnessTaskTarget | undefined,
  context: { tasks: Pick<WorkspaceTaskStore, "list" | "taskPath">; rootWorkspace: string; workspacePath: string },
): Promise<import("@hatopad/protocol").HarnessWorkspaceBinding> {
  if (
    target !== undefined &&
    (!target ||
      typeof target !== "object" ||
      (target.taskId !== undefined && (typeof target.taskId !== "string" || !target.taskId)))
  )
    throw new CoreError(
      "INVALID_REQUEST",
      "Workflow target must identify a task or explicitly select the root workspace",
    );
  if (run?.binding) {
    await validateWorkflowBinding(run.binding, context.tasks, context.rootWorkspace);
    return run.binding;
  }
  const workspace = run
    ? await workflowRunWorkspace(run, context.rootWorkspace)
    : target
      ? await availableWorkflowWorkspace(
          await permissionTargetWorkspace(context.tasks, context.rootWorkspace, target.taskId),
        )
      : await availableWorkflowWorkspace(context.workspacePath);
  // Legacy callers and records may have a workspace but no task identity. Infer
  // identity only from the recorded path, never the mutable selected task.
  const task = (await context.tasks.list()).tasks.find(
    (task) => path.resolve(context.tasks.taskPath(task.id)) === workspace,
  );
  if (!run && target?.taskId && task?.id !== target.taskId)
    throw new CoreError("INVALID_REQUEST", "Selected task does not resolve to the workflow worktree");
  if (!task && workspace !== (await availableWorkflowWorkspace(context.rootWorkspace)))
    throw new CoreError("FILE_NOT_FOUND", "Workflow recorded task worktree is no longer registered");
  return { rootWorkspace: context.rootWorkspace, workspace, ...(task ? { taskId: task.id, taskName: task.name } : {}) };
}

export async function validateWorkflowTarget(
  run: import("@hatopad/protocol").HarnessRun,
  workspace: string,
  context: Parameters<typeof resolveWorkflowBinding>[2],
): Promise<void> {
  const binding = await resolveWorkflowBinding(run, undefined, context);
  const resolved = await availableWorkflowWorkspace(workspace);
  if (resolved === binding.workspace) return;
  const child = run.children?.find((child) => path.resolve(child.workspace) === path.resolve(workspace));
  if (!child) throw new CoreError("INVALID_REQUEST", "Workflow session points to a different worktree");
  const registered = await permissionTargetWorkspace(context.tasks, context.rootWorkspace, child.taskId);
  if ((await availableWorkflowWorkspace(registered)) !== resolved)
    throw new CoreError("INVALID_REQUEST", "Workflow child worktree changed");
}

export async function workflowSessionWorkspace(workspace: string, runId: string, blockId: string): Promise<string> {
  const stateDirectory = process.env.HATOPAD_STATE_DIR ?? path.join(stateHome(), "workspaces");
  const workspaceKey = crypto.createHash("sha256").update(path.resolve(workspace)).digest("hex");
  const sessionKey = crypto.createHash("sha256").update(`${runId}:${blockId}`).digest("hex");
  const directory = path.join(stateDirectory, "workflow-sessions", workspaceKey);
  const alias = path.join(directory, sessionKey);
  await mkdir(directory, { recursive: true });
  try {
    await symlink(path.resolve(workspace), alias, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if ((await realpath(alias)) !== (await availableWorkflowWorkspace(workspace)))
    throw new CoreError("INVALID_REQUEST", "Workflow session alias points to a different worktree");
  return alias;
}

/** Workflow sessions never wait for a person: interactive switches are forced off, other feature switches follow the block. */
export function workflowFeatureOptions(options: AiOption[], block: Pick<HarnessBlock, "options">): AiConfiguration {
  const chosen = Object.entries(block.options ?? {}).filter(([id]) =>
    options.some((option) => option.id === id && !option.interactive && !option.permissionApproval),
  );
  return {
    ...Object.fromEntries(chosen),
    ...Object.fromEntries(options.filter((option) => option.interactive).map((option) => [option.id, false])),
  };
}

export function workflowConfiguration(
  options: AiOption[],
  block: Pick<HarnessBlock, "model" | "reasoning" | "autopilot" | "options">,
): AiConfiguration {
  const autopilot = findAutopilotOption(options);
  return {
    ...(block.model ? { model: block.model } : {}),
    ...(block.reasoning ? { reasoning: block.reasoning } : {}),
    ...workflowFeatureOptions(options, block),
    ...(autopilot ? { [autopilot.option.id]: block.autopilot === false ? autopilot.off : autopilot.on } : {}),
  };
}

/** Timer-paused workflows can own an idle provider turn; resume that same conversation. */
export async function steerWorkflowSession(
  provider: ReturnType<AcpRegistry["get"]>,
  workspace: string,
  input: string,
  timers: Pick<AiTimerService, "next">,
  rootWorkspace: string,
  bridgeWorkspace: string,
) {
  const session = await provider.get(workspace);
  if (session.status === "in_progress" || session.status === "user_prompt") return provider.steer(workspace, input);
  const timer = await timers.next(workspace, provider.descriptor.id);
  if (!timer?.workflowRunId || !timer.workflowBlockId)
    throw new CoreError("INVALID_REQUEST", "Workflow session is no longer working or waiting for a timer");
  return provider.send(workspace, {
    prompt: input,
    configuration: session.configuration ?? { model: session.model, reasoning: session.reasoning },
    mcpServers: [
      appToolServer(rootWorkspace, workspace, provider.descriptor.id, bridgeWorkspace, {
        runId: timer.workflowRunId,
        blockId: timer.workflowBlockId,
        flow: timer.workflowFlow,
      }),
    ],
  });
}

export async function settleWorkflowSession(
  provider: ReturnType<AcpRegistry["get"]>,
  workspace: string,
  timers: Pick<AiTimerService, "next" | "scheduleAt">,
  watchdog?: { runId: string; blockId: string },
  active: () => boolean = () => true,
  activity?: (session: AiSession, waitingUntil?: string) => Promise<void>,
) {
  let session = await provider.get(workspace);
  for (;;) {
    while ((session.status === "in_progress" || session.pendingPermission) && active()) {
      await activity?.(session);
      await delay(250);
      session = await provider.get(workspace);
    }
    if (!active()) return session;
    let timer = await timers.next(workspace, provider.descriptor.id);
    if (!timer && watchdog) {
      const usage = await provider.usage(workspace).catch(() => undefined);
      if (!active()) return session;
      const resets = [usage?.resetsAt, usage?.accountQuota?.primary?.resetsAt, usage?.accountQuota?.secondary?.resetsAt]
        .filter((value): value is string => Boolean(value) && Date.parse(value!) > Date.now())
        .sort();
      timer = await timers.scheduleAt(
        workspace,
        provider.descriptor.id,
        "RESET_ELAPSED: Call workflow_resume_failed, then recheck ai_usage and arm the next reset timer. Preserve the existing request and sessions.",
        resets[0] ?? new Date(Date.now() + 300_000).toISOString(),
        watchdog,
      );
    }
    await activity?.(session, timer?.dueAt);
    if (session.status === "user_prompt" && !timer && activity) {
      await delay(250);
      session = await provider.get(workspace);
      continue;
    }
    if (!timer) return session;
    while (active() && (timer = await timers.next(workspace, provider.descriptor.id))) {
      await delay(Math.min(250, Math.max(10, new Date(timer.dueAt).getTime() - Date.now())));
      session = await provider.get(workspace);
      if (session.status === "in_progress" || session.pendingPermission) break;
      await activity?.(session, timer.dueAt);
    }
    await delay(250);
    session = await provider.get(workspace);
  }
}

export async function providerOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(normalizeAiFailure(error));
  }
}

export function renameWorkspacePaths(options: WorkspaceOptions, oldPath: string, newPath: string): WorkspaceOptions {
  const oldPrefix = `${oldPath}/`;
  const newPrefix = `${newPath}/`;
  const moved = (value: string) =>
    value === oldPath ? newPath : value.startsWith(oldPrefix) ? newPrefix + value.slice(oldPrefix.length) : value;
  const javaProject = options.javaProject
    ? {
        ...options.javaProject,
        pomPath: moved(options.javaProject.pomPath),
        sourceRoots: options.javaProject.sourceRoots.map(moved),
        outputPath: moved(options.javaProject.outputPath),
        testOutputPath: moved(options.javaProject.testOutputPath),
      }
    : undefined;
  const fileColors = options.fileColors
    ? Object.fromEntries(Object.entries(options.fileColors).map(([filePath, color]) => [moved(filePath), color]))
    : undefined;
  return {
    ...options,
    openFiles: options.openFiles.map(moved),
    ...(options.pinnedFiles ? { pinnedFiles: options.pinnedFiles.map(moved) } : {}),
    ...(options.activeFile ? { activeFile: moved(options.activeFile) } : {}),
    ...(javaProject ? { javaProject } : {}),
    ...(fileColors ? { fileColors } : {}),
  };
}

export async function permissionTargetWorkspace(
  tasks: Pick<WorkspaceTaskStore, "list" | "taskPath">,
  rootWorkspace: string,
  taskId?: string,
): Promise<string> {
  if (!taskId) return rootWorkspace;
  if (!(await tasks.list()).tasks.some((task) => task.id === taskId))
    throw new CoreError("INVALID_REQUEST", "Task does not exist");
  return tasks.taskPath(taskId);
}

export async function assertWorkflowModelAvailable(
  provider: { models(): Promise<Array<{ id: string; available?: boolean; reasoningLevels: string[] }>> },
  model?: string,
  reasoning?: string,
): Promise<void> {
  if (!model) return;
  const selected = (await provider.models()).find((item) => item.id === model);
  if (!selected || selected.available === false)
    throw new CoreError(
      "INVALID_REQUEST",
      `Workflow model '${model}' is unavailable. Select an available model before running this workflow.`,
    );
  if (reasoning && !selected.reasoningLevels.includes(reasoning))
    throw new CoreError(
      "INVALID_REQUEST",
      `Workflow reasoning effort '${reasoning}' is unavailable for model '${model}'. Select an available reasoning effort before running this workflow.`,
    );
}

export async function assertSessionChangeAllowed(
  timers: Pick<AiTimerService, "next">,
  workspace: string,
  provider: AiProvider,
): Promise<void> {
  if (await timers.next(workspace, provider))
    throw new CoreError("INVALID_REQUEST", "Cancel or run the active task timer before changing its AI session");
}
