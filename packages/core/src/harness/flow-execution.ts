import crypto from "node:crypto";
import { useMeeting } from "../workflow-meeting.js";
import { CoreError } from "../errors.js";
import { parseHarnessData, renderHarnessPrompt } from "../harness-graph.js";
import { ActiveExecution } from "./types.js";
import { workflowBlockDescription, taskControlsMetadata, connectedInput } from "./context.js";
import type { HarnessRunner } from "../harness-runner.js";

type ExecuteFlowHost = {
  schedulingReady: HarnessRunner["schedulingReady"];
  retryEntries: HarnessRunner["retryEntries"];
  assertActive: HarnessRunner["assertActive"];
  chatTurnUsers: HarnessRunner["chatTurnUsers"];
  latestChatResponse: HarnessRunner["latestChatResponse"];
  chatResponsePrefix: HarnessRunner["chatResponsePrefix"];
  runActivityStatus: HarnessRunner["runActivityStatus"];
  update: HarnessRunner["update"];
  log: HarnessRunner["log"];
  executeBlock: HarnessRunner["executeBlock"];
  flowAnswers: HarnessRunner["flowAnswers"];
  isActive: HarnessRunner["isActive"];
  assertTokenBudget: HarnessRunner["assertTokenBudget"];
  openDocument: HarnessRunner["openDocument"];
  traceConnection: HarnessRunner["traceConnection"];
  flowInvocations: HarnessRunner["flowInvocations"];
};

export async function harnessExecuteFlow(
  host: ExecuteFlowHost,
  execution: ActiveExecution,
  startBlockId?: string,
): Promise<void> {
  const { run, blocks, edges } = execution;
  const busy = new Set<string>();
  execution.flowBusy = busy;
  const finishing = new Map<string, Promise<void>>();
  execution.flowFinishing = finishing;
  // Unselected Chatboxes are available for independent user turns. They are
  // not scheduled by this explicitly selected flow entry point.
  if (startBlockId)
    for (const state of run.blocks) {
      if (
        state.blockId !== startBlockId &&
        state.status === "queued" &&
        blocks.find((block) => block.id === state.blockId)?.type === "chatbox"
      )
        state.status = "skipped";
    }
  const timers = new Map<string, string>();
  let steps = 0;
  // Converging forward connections honour the target's join policy instead of
  // invoking the shared target once per branch.
  const flowEdge = (edge: (typeof edges)[number]) => edge.type === "follow" || !edge.type || edge.type === "path";
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of edges) if (edge.from === current) stack.push(edge.to);
    }
    return false;
  };
  // Connections that close a cycle are loop returns, not join inputs.
  const forwardEdge = (edge: (typeof edges)[number]) =>
    !edge.loop && flowEdge(edge) && !reaches(edge.to, edge.from);
  const joins = new Map<
    string,
    { resolved: Set<string>; active: Set<string>; outputs: Map<string, string>; fired: boolean }
  >();
  const resolveEdge = (
    edge: (typeof edges)[number],
    active: boolean,
    output: string,
    path: string[],
    visited = new Set<string>(),
  ): Promise<void>[] => {
    const target = edge.to;
    const incoming = edges.filter((item) => item.to === target && forwardEdge(item));
    const outgoing = () => edges.filter((item) => item.from === target && forwardEdge(item));
    if (incoming.length < 2) {
      if (active) return [invoke(target, output, path).then(() => undefined)];
      if (visited.has(target)) return [];
      visited.add(target);
      return outgoing().flatMap((next) => resolveEdge(next, false, "", [...path, target], visited));
    }
    let entry = joins.get(target);
    if (!entry) {
      entry = { resolved: new Set(), active: new Set(), outputs: new Map(), fired: false };
      joins.set(target, entry);
    }
    entry.resolved.add(edge.id);
    if (active) {
      entry.active.add(edge.id);
      entry.outputs.set(edge.from, output);
    }
    const complete = incoming.every((item) => entry.resolved.has(item.id));
    const results: Promise<void>[] = [];
    if (!entry.fired && entry.active.size > 0 && (complete || blocks.find((item) => item.id === target)?.join === "any")) {
      entry.fired = true;
      const activeEdges = incoming.filter((item) => entry.active.has(item.id));
      const input =
        activeEdges.length === 1
          ? entry.outputs.get(activeEdges[0]!.from)!
          : connectedInput(target, run.input, blocks, activeEdges, entry.outputs);
      results.push(invoke(target, input, path).then(() => undefined));
    }
    if (complete) {
      joins.delete(target);
      if (!entry.fired && !visited.has(target)) {
        visited.add(target);
        for (const next of outgoing()) results.push(...resolveEdge(next, false, "", [...path, target], visited));
      }
    }
    return results;
  };
  const invoke = async (id: string, input: string, ancestors: string[] = []): Promise<string> => {
    await host.schedulingReady(run.id);
    const prior = run.blocks.find((state) => state.blockId === id);
    if (host.retryEntries.has(run.id) && prior?.status === "succeeded") return prior.output ?? "";
    host.assertActive(run.id);
    if (busy.has(id)) throw new Error("This block is already active; recursive tool calls are not allowed");
    if (++steps > 1000) throw new Error("Flow exceeded 1000 block executions");
    const originalBlock = blocks.find((item) => item.id === id)!;
    const state = run.blocks.find((item) => item.blockId === id)!;
    const settings = state.chatSettings;
    const block = settings
      ? {
          ...originalBlock,
          ...settings,
          model: settings.model,
          ...(settings.options ? { options: { ...originalBlock.options, ...settings.options } } : {}),
        }
      : originalBlock;
    if (
      settings &&
      ((settings.provider ?? originalBlock.provider ?? execution.defaultProvider) !==
        (originalBlock.provider ?? execution.defaultProvider) ||
        settings.model !== originalBlock.model)
    )
      block.reasoning = undefined;
    let published!: () => void;
    finishing.set(
      id,
      new Promise<void>((resolve) => {
        published = resolve;
      }),
    );
    busy.add(id);
    state.error = undefined;
    state.status = "running";
    state.startedAt = new Date().toISOString();
    state.completedAt = undefined;
    state.selectedRoute = undefined;
    if (block.type === "chatbox") {
      const timestamp = new Date().toISOString();
      state.agentActivity = [];
      host.chatTurnUsers.delete(state);
      host.latestChatResponse.delete(state);
      host.chatResponsePrefix.delete(state);
      state.chatMessages = [
        ...(state.chatMessages ?? []),
        { id: crypto.randomUUID(), role: "user", text: input, timestamp },
        { id: crypto.randomUUID(), role: "assistant", text: "", timestamp },
      ].slice(-200) as NonNullable<typeof state.chatMessages>;
    }
    run.status = host.runActivityStatus(run);
    await host.update(run);
    let output = input;
    try {
      const prompt =
        block.type === "skill" && block.skillId ? "" : renderHarnessPrompt(block.prompt, input, execution.outputs);
      if (!["ai", "chatbox"].includes(block.type)) {
        state.prompt = prompt;
        state.structuredInput = parseHarnessData(input, block.inputSchema, `${block.label} input`);
        host.log(state, "prompt", input);
      }
      if (["ai", "chatbox"].includes(block.type) || ["prompt", "task", "review", "verification"].includes(block.type)) {
        const tools = edges
          .filter((edge) => edge.from === id && (edge.type === "use" || block.type === "chatbox"))
          .map((edge) => ({
            block_id: edge.to,
            name: blocks.find((item) => item.id === edge.to)?.label,
            type: blocks.find((item) => item.id === edge.to)?.type,
            description: workflowBlockDescription(blocks.find((item) => item.id === edge.to)),
            seconds: blocks.find((item) => item.id === edge.to)?.seconds,
            app: blocks.find((item) => item.id === edge.to)?.app,
            task_controls: taskControlsMetadata(
              blocks.find((item) => item.id === edge.to),
              execution.defaultProvider,
            ),
            timeout_seconds: (edge.timeoutMs ?? 300_000) / 1000,
          }));
        const paths =
          block.type === "chatbox"
            ? []
            : edges.filter((edge) => edge.from === id && edge.type === "path").map((edge) => edge.label);
        const inputTemplate = /\{\{\s*input\s*\}\}/.test(block.prompt)
          ? block.prompt
          : `${block.prompt}\n\nInput:\n{{input}}`;
        const instructions = `Workflow context transfers are bounded and unchanged results may be omitted. Keep delegation requests and reports concise; send new facts rather than forwarding earlier reports. Use workflow_block_output with block_id, offset, and limit (at most 8000) to inspect retained output in pages when a preview is truncated. Connected tools: ${JSON.stringify(tools)}. For connected AI Agents and Chatboxes, action start launches input in the background immediately, status checks state, tail reads recent messages (lines 1–50), and steer sends input to the running session without waiting for completion. To read only what you have not yet seen from any connected data block, call workflow_use_block with action "fetch" (Terminal Control also needs terminal_id); repeat while hasMore is true. Start different connected blocks independently; do not start an already running block. Call workflow_use_block with block_id and input to use one; timeout_seconds optionally overrides its connection timeout. On a timed_out result the child keeps working. Read the returned messages and activity, then call workflow_block_messages with block_id and optional count (default 6, maximum 50) to check progress without starting another turn. For Run App blocks, pass action (start, status, kill, or tail) from the configured allowed actions. Status and tail do not need input; tail optionally accepts lines (1–10000). Read the structured app result: app.status is process status and app.output is log text for tail. For example: workflow_use_block({"block_id":"APP_BLOCK_ID","action":"status"}) or workflow_use_block({"block_id":"APP_BLOCK_ID","action":"tail","lines":100}). Terminal Control blocks are only for long-running apps and services. Do not spawn agents in terminals. List terminals first and reuse an existing terminal whenever possible; avoid spawning new terminals unnecessarily. They list, open, open_and_run, run_and_wait, read, and write terminals in the bound task workspace. Pass action, terminal_id for read/write, name for open/open_and_run, command for open_and_run (or input; a newline is appended automatically), data for write (raw text; include a newline to execute a command), and optional lines for read. open_and_run starts a named terminal and runs the command in one call, returning immediately with its terminalId. run_and_wait (name and command, or input; or terminal_id to reuse a terminal) runs the command and waits for it to finish, returning status, exitCode and output in terminal; on timed_out the command keeps running. Read structured results in terminal. Task controls blocks manage task worktrees using their designed provider/model/reasoning. Call workflow_use_block with action create (branch required), create_and_start (input is the prompt; branch optional), status (task_id optional), prompt (task_id and input required), set_status (task_id and status active or finished required), set_commit_message (task_id and message or input; sets the commit-message draft), or update_commit_message (task_id and message or input; rewrites the latest unpushed commit message without changing contents). Pass idempotency_key for create and prompt operations and reuse it only when retrying the same operation. Read structured results in task_controls. Skill blocks provide reusable instructions. Choose skills by their descriptions; call workflow_use_block with the skill block_id to load its instructions before applying them in your own session. For linked skills, read the returned skill.content and resolve supporting files relative to skill.baseDirectory. Reuse loaded instructions for this workflow run. User Prompt and Yes/No Prompt blocks wait for a human answer in the workflow UI and return that answer to you. Their wait does not expire with the connection timeout. Timer blocks arm immediately and return without waiting, so you can continue your work. When a Timer fires, its follow connections receive the input you supplied to it. Reusing a waiting Timer replaces its countdown. Each AI block keeps its own context. Available paths: ${JSON.stringify(paths)}. ${paths.length ? "Call workflow_choose_path before finishing to choose one path." : ""}`;
        const reuseSession = Boolean(state.workspace && state.sessionId && block.type !== "review");
        // A Chatbox's configured prompt is durable session guidance, including
        // templates. User turns must never reinsert that guidance as a message.
        const chatbox = block.type === "chatbox";
        const outputReferences = [
          ...new Set(
            [...block.prompt.matchAll(/\{\{\s*blocks\.([A-Za-z0-9_-]+)\.output\s*\}\}/g)].map((match) => match[1]!),
          ),
        ];
        const chatTurn = outputReferences.length
          ? `{{input}}\n\nWorkflow context updates:\n${outputReferences.map((id) => `${id}: {{blocks.${id}.output}}`).join("\n")}`
          : "{{input}}";
        const continuedPrompt = chatbox ? chatTurn : !/\{\{/.test(block.prompt) ? "{{input}}" : inputTemplate;
        const sessionInstructions = chatbox && !reuseSession ? block.prompt : undefined;
        await host.executeBlock(
          run,
          { ...block, prompt: reuseSession ? continuedPrompt : chatbox ? "{{input}}" : inputTemplate },
          blocks,
          [],
          execution.outputs,
          execution.dispatch,
          execution.defaultProvider,
          [input],
          reuseSession ? undefined : instructions,
          sessionInstructions,
        );
        output = state.output ?? "";
        if (block.type !== "chatbox" && paths.length && !state.selectedRoute)
          throw new Error(`${block.label} finished without choosing a path`);
      } else if (block.type === "text" || block.type === "start_button") output = prompt;
      else if (block.type === "skill") {
        if (block.skillId) {
          const caller = blocks.find((item) => item.id === ancestors.at(-1));
          const loaded = await execution.dispatch(block, "", {
            runId: run.id,
            blockId: id,
            attemptId: crypto.randomUUID(),
            iteration: 1,
            skillAgent: caller?.agent ?? null,
            started: async () => {},
            activity: async () => {},
            assertActive: () => host.assertActive(run.id),
          });
          output = loaded.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "";
        } else output = prompt;
      } else if (block.type === "meeting") output = JSON.stringify(useMeeting(state, block, { action: "tail" }));
      else if (block.type === "markdown") output = block.prompt.trim() ? prompt : input;
      else if (block.type === "user_prompt" || block.type === "yes_no_prompt") {
        state.status = "awaiting_user_input";
        state.question = prompt || input;
        state.pauseId = crypto.randomUUID();
        state.sessionId = `flow:${id}`;
        const key = `${run.id}:${id}:${state.pauseId}`;
        try {
          const answer = new Promise<string>((resolve) => host.flowAnswers.set(key, resolve));
          run.status = host.runActivityStatus(run);
          await host.update(run);
          output = await Promise.race([
            answer,
            (async () => {
              while (host.isActive(run.id) && host.flowAnswers.has(key))
                await new Promise((resolve) => setTimeout(resolve, 100));
              host.assertActive(run.id);
              return "";
            })(),
          ]);
        } finally {
          host.flowAnswers.delete(key);
        }
        state.question = undefined;
        state.pauseId = undefined;
      } else if (block.type === "timer") {
        state.status = "waiting_timer";
        state.pauseId = crypto.randomUUID();
        state.waitingUntil = new Date(Date.now() + block.seconds! * 1000).toISOString();
        run.status = host.runActivityStatus(run);
        await host.update(run);
        timers.set(id, input);
        host.log(state, "lifecycle", `Timer armed for ${state.waitingUntil}`);
        return `Timer armed for ${state.waitingUntil}`;
      } else if (
        block.type === "mcp" ||
        block.type === "script" ||
        block.type === "run_app" ||
        block.type === "terminal_control" ||
        block.type === "task_controls"
      ) {
        const session = await execution.dispatch(block, input, {
          runId: run.id,
          blockId: id,
          attemptId: crypto.randomUUID(),
          iteration: 1,
          started: async () => {},
          activity: async () => {},
          assertActive: () => host.assertActive(run.id),
        });
        state.tokens = session.tokens;
        host.assertTokenBudget(run);
        output = session.messages.filter((message) => message.role === "assistant").at(-1)?.text ?? "";
      }
      if (!["ai", "chatbox"].includes(block.type))
        state.structuredOutput = parseHarnessData(output, block.outputSchema, `${block.label} output`);
      host.assertActive(run.id);
      host.log(state, "response", output);
      state.output = output.slice(-200_000);
      execution.outputs.set(id, output);
      state.status = "succeeded";
      state.completedAt = new Date().toISOString();
      run.status = host.runActivityStatus(run);
      await host.update(run);
    } catch (error) {
      state.status = host.isActive(run.id) ? "failed" : "cancelled";
      state.error = error instanceof Error ? error.message : String(error);
      state.completedAt = new Date().toISOString();
      host.log(state, "error", state.error);
      if (host.isActive(run.id)) run.status = host.runActivityStatus(run);
      await host.update(run);
      throw error;
    } finally {
      finishing.delete(id);
      busy.delete(id);
      published();
    }
    if (block.type === "markdown")
      host.openDocument?.({
        runId: run.id,
        blockId: id,
        title: block.label.endsWith(".md") ? block.label : `${block.label}.md`,
        content: output,
      });
    // Every outgoing connection starts at once; a block connected to several followers does not run them one after another.
    const followers: Promise<unknown>[] = [];
    if (block.type !== "chatbox")
      for (const edge of edges.filter(
        (edge) =>
          edge.from === id && edge.type === "path" && edge.label !== state.selectedRoute && forwardEdge(edge),
      ))
        followers.push(...resolveEdge(edge, false, "", [...ancestors, id]));
    for (const edge of edges.filter(
      (edge) =>
        block.type !== "chatbox" &&
        edge.from === id &&
        (edge.type === "follow" || !edge.type || (edge.type === "path" && edge.label === state.selectedRoute)),
    )) {
      // A question used as a tool returns its answer to the waiting caller.
      // A drawn return connection must not start a second turn in that active session.
      if (
        (block.type === "user_prompt" || block.type === "yes_no_prompt") &&
        edge.to === ancestors.at(-1) &&
        busy.has(edge.to)
      ) {
        await host.traceConnection(run, edge, "forward", "succeeded", output.length);
        continue;
      }
      if (ancestors.includes(edge.to) || edge.to === id) {
        const count = (execution.loopInvocations.get(edge.id) ?? 0) + 1;
        const limit = run.definition?.settings?.maxLoopCount ?? 100;
        if (count > limit)
          throw new CoreError(
            "INVALID_REQUEST",
            `Workflow loop '${edge.label ?? edge.id}' reached its limit of ${limit} iterations`,
          );
        execution.loopInvocations.set(edge.id, count);
      }
      const back = ancestors.includes(edge.to) || edge.to === id;
      followers.push(
        (async () => {
          await host.traceConnection(run, edge, "forward", "succeeded", output.length);
          if (back || !forwardEdge(edge)) await invoke(edge.to, output, [...ancestors, id]);
          else await Promise.all(resolveEdge(edge, true, output, [...ancestors, id]));
        })(),
      );
    }
    const settled = await Promise.allSettled(followers);
    const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failed) throw failed.reason;
    return output;
  };
  host.flowInvocations.set(run.id, invoke);
  const roots =
    host.retryEntries.get(run.id) ??
    (startBlockId
      ? [startBlockId]
      : blocks.filter((block) => !edges.some((edge) => edge.to === block.id)).map((block) => block.id));
  if (!roots.length && blocks.length) roots.push(blocks[0]!.id);
  let entryError: unknown;
  for (const id of roots) {
    try {
      await invoke(
        id,
        host.retryEntries.has(run.id) ? connectedInput(id, run.input, blocks, edges, execution.outputs) : run.input,
      );
    } catch (error) {
      // A failed entry turn must not cancel unrelated Chatboxes still working.
      if (!host.isActive(run.id)) throw error;
      entryError ??= error;
      break;
    }
  }
  while (timers.size || execution.background.size) {
    if (!timers.size) {
      await Promise.allSettled([...execution.background]);
      continue;
    }
    host.assertActive(run.id);
    const due = [...timers].find(
      ([id]) => Date.now() >= Date.parse(run.blocks.find((state) => state.blockId === id)!.waitingUntil!),
    );
    if (!due) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    const [id, input] = due;
    timers.delete(id);
    const block = blocks.find((block) => block.id === id)!;
    if (block.seconds! > 0) steps = 0;
    const state = run.blocks.find((state) => state.blockId === id)!;
    state.structuredOutput = parseHarnessData(input, block.outputSchema, `${block.label} output`);
    state.output = input.slice(-200_000);
    execution.outputs.set(id, input);
    state.status = "succeeded";
    state.completedAt = new Date().toISOString();
    state.waitingUntil = undefined;
    state.pauseId = undefined;
    host.log(state, "response", input);
    host.log(state, "lifecycle", "Timer fired; starting followers");
    run.status = host.runActivityStatus(run);
    await host.update(run);
    const settled = await Promise.allSettled(
      edges
        .filter((edge) => edge.from === id && (edge.type === "follow" || !edge.type))
        .map(async (edge) => {
          await host.traceConnection(run, edge, "forward", "succeeded", input.length);
          await invoke(edge.to, input);
        }),
    );
    const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failed) throw failed.reason;
  }
  // Close admission synchronously with the drain, before execute records the
  // terminal outcome on its next microtask. No late turn may revive this flow.
  host.flowInvocations.delete(run.id);
  host.assertActive(run.id);
  if (entryError && !host.retryEntries.has(run.id)) throw entryError;
  const failed = run.blocks.find((state) => state.status === "failed");
  if (failed) throw new Error(failed.error ?? "A connected workflow block failed");
  for (const state of run.blocks) if (state.status === "queued") state.status = "skipped";
}
