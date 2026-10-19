import { useMeeting } from "../workflow-meeting.js";
import type { HarnessBlock } from "@hatopad/protocol";
import { takeUnfetchedText, rememberFetch } from "../workflow-fetch.js";
import { contextHash, contextPreview, WORKFLOW_CONTEXT_CHARS } from "../workflow-context.js";
import { workflowBlockDescription, taskControlsMetadata } from "./context.js";
import type { HarnessRunner } from "../harness-runner.js";

type CallFlowToolHost = {
  activeExecution: HarnessRunner["activeExecution"];
  update: HarnessRunner["update"];
  fetchUnread: HarnessRunner["fetchUnread"];
  traceConnection: HarnessRunner["traceConnection"];
  flowBlockMessages: HarnessRunner["flowBlockMessages"];
  agentStarts: HarnessRunner["agentStarts"];
  steerAgent: HarnessRunner["steerAgent"];
  assertActive: HarnessRunner["assertActive"];
  chargeContext: HarnessRunner["chargeContext"];
  appendChatSteering: HarnessRunner["appendChatSteering"];
  log: HarnessRunner["log"];
  flowInvocations: HarnessRunner["flowInvocations"];
  meetingUpdates: HarnessRunner["meetingUpdates"];
  appToolCalls: HarnessRunner["appToolCalls"];
};

export async function harnessCallFlowTool(host: CallFlowToolHost, runId: string, blockId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const execution = host.activeExecution(runId);
    const state = execution.run.blocks.find((item) => item.blockId === blockId);
    if (state?.status !== "running" || !["ai", "chatbox"].includes(execution.blocks.find((block) => block.id === blockId)?.type ?? "")) throw new Error("Only an active AI Agent or Chatbox can use flow tools");
    const edges = execution.edges.filter((edge) => edge.from === blockId);
    if (name === "workflow_connections") return edges.map((edge) => ({ blockId: edge.to, block_id: edge.to, name: execution.blocks.find((block) => block.id === edge.to)?.label, blockType: execution.blocks.find((block) => block.id === edge.to)?.type, description: workflowBlockDescription(execution.blocks.find((block) => block.id === edge.to)), seconds: execution.blocks.find((block) => block.id === edge.to)?.seconds, app: execution.blocks.find((block) => block.id === edge.to)?.app, task_controls: taskControlsMetadata(execution.blocks.find((block) => block.id === edge.to), execution.defaultProvider), timeout_seconds: (edge.timeoutMs ?? 300_000) / 1000, type: edge.type ?? "follow", path: edge.label }));
    if (name === "workflow_choose_path") {
      const edge = edges.find((edge) => edge.type === "path" && edge.label === args.path);
      if (!edge) throw new Error("Choose a connected path by its label");
      state.selectedRoute = edge.label; await host.update(execution.run); return { path: edge.label };
    }
    if (name !== "workflow_use_block" && name !== "workflow_block_output" && name !== "workflow_block_messages") throw new Error("Unknown flow tool");
    const edge = edges.find((edge) => (edge.type === "use" || execution.blocks.find((block) => block.id === blockId)?.type === "chatbox") && edge.to === args.block_id);
    if (name === "workflow_use_block" && args.action === "fetch" && edge) {
      const fetchTarget = execution.blocks.find((block) => block.id === edge.to);
      if (fetchTarget?.type === "meeting") args = { ...args, action: "diff" };
      else if (fetchTarget) return host.fetchUnread(runId, blockId, fetchTarget, args);
    }
    const textInput = args.input ?? "";
    if (!edge || typeof textInput !== "string" || textInput.length > 100_000) throw new Error("Use a connected block ID and a text input of at most 100000 characters");
    const target = execution.blocks.find((block) => block.id === edge.to)!;
    // Calls that answer immediately never reach the traced invocation below;
    // pulse the connection both ways so every use of it is visible.
    if (name !== "workflow_use_block" || target.type === "meeting" || (["ai", "chatbox"].includes(target.type) && ["status", "tail", "steer"].includes(String(args.action)))) {
      await host.traceConnection(execution.run, edge, "forward", "succeeded", textInput.length);
      await host.traceConnection(execution.run, edge, "return", "succeeded", (execution.run.blocks.find((item) => item.blockId === target.id)?.output ?? "").length);
    }
    if (name === "workflow_block_output") {
      if (target.type === "skill") throw new Error("Load skills through workflow_use_block so current policy is checked");
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 8000;
      if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 8000) throw new Error("Use a nonnegative offset and limit from 1 to 8000");
      const output = execution.run.blocks.find((item) => item.blockId === target.id)?.output ?? "";
      return { blockId: target.id, offset, totalChars: output.length, output: output.slice(offset, offset + limit), ...(offset + limit < output.length ? { nextOffset: offset + limit } : {}) };
    }
    if (name === "workflow_block_messages") {
      if (!["ai", "chatbox"].includes(target.type)) throw new Error("Messages are only available for connected AI Agents and Chatboxes");
      const count = args.count ?? 6;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 50) throw new Error("Use a message count from 1 to 50");
      if (args.include_unchanged !== undefined && typeof args.include_unchanged !== "boolean") throw new Error("include_unchanged must be a boolean");
      const result = host.flowBlockMessages(execution.run, target.id, count);
      return result;
    }
    if (target.type === "meeting") {
      if (["terminal_id", "name", "data", "command", "task_id", "branch", "status", "idempotency_key"].some((key) => args[key] !== undefined)) throw new Error("Meeting accepts action, message, input, lines and after");
      if (args.action === "status" || args.action === "shake") {
        if (["lines", "after"].some((key) => args[key] !== undefined)) throw new Error("Meeting status/shake does not accept lines or after");
        const peers = execution.blocks.filter((peer) => execution.edges.some((connection) => connection.to === target.id && connection.from === peer.id && (connection.type === "use" || peer.type === "chatbox")));
        if (args.action === "status") {
          if (["peer_block_id", "message", "input"].some((key) => args[key] !== undefined)) throw new Error("Meeting status accepts only the room block_id and action");
          return { blockId: target.id, meeting: { peers: peers.map((peer) => {
            const live = execution.run.blocks.find((item) => item.blockId === peer.id)!;
            const starting = host.agentStarts.has(`${runId}:${peer.id}`);
            return { blockId: peer.id, name: peer.label, type: peer.type, self: peer.id === blockId, online: live.status === "running" || starting, block_status: live.status, hasSession: !!live.sessionId, provider: live.provider ?? peer.provider ?? execution.defaultProvider, ...(live.error ? { error: live.error } : {}) };
          }) } };
        }
        const peer = peers.find((item) => item.id === args.peer_block_id);
        if (!peer || peer.id === blockId || !["ai", "chatbox"].includes(peer.type)) throw new Error("Shake requires peer_block_id of another AI Agent or Chatbox connected to this Meeting");
        const message = args.message ?? args.input ?? "Please check the Meeting room and respond.";
        if (typeof message !== "string" || !message.trim() || message.length > 10000) throw new Error("Meeting shake message must contain 1 to 10000 characters");
        const caller = execution.blocks.find((item) => item.id === blockId)!;
        const input = `Shake from ${caller.label} in Meeting "${target.label}" (${target.id}):\n${message}`;
        const child = execution.run.blocks.find((item) => item.blockId === peer.id)!;
        const key = `${runId}:${peer.id}`;
        if (["running", "waiting_timer"].includes(child.status) || execution.flowBusy?.has(peer.id) || host.agentStarts.has(key)) {
          if (!child.workspace || !child.provider || !host.steerAgent) throw new Error("Peer is starting or cannot receive live messages; check status and retry once ready");
          await execution.scheduler.control(peer.id, async () => {
            host.assertActive(runId);
            if (!["running", "waiting_timer"].includes(child.status)) throw new Error("Peer turn ended; check status and shake again");
            host.chargeContext(execution.run, child, input.length);
            if (peer.type === "chatbox") host.appendChatSteering(child, input);
            host.log(child, "prompt", input);
            await host.update(execution.run);
            await host.steerAgent!(child.provider!, child.workspace!, input);
            host.assertActive(runId);
          });
          return { blockId: target.id, meeting: { shake: { blockId: peer.id, delivery: "steered" } } };
        }
        const invoke = host.flowInvocations.get(runId);
        if (!invoke) throw new Error("Flow is unavailable");
        host.agentStarts.add(key);
        const result = invoke(peer.id, input, [blockId]);
        const pending = result.then(() => {}, () => {}).finally(() => { execution.background.delete(pending); host.agentStarts.delete(key); });
        execution.background.add(pending);
        return { blockId: target.id, meeting: { shake: { blockId: peer.id, delivery: "started" } } };
      }
      if (args.peer_block_id !== undefined) throw new Error("peer_block_id is only available for Meeting shake");
      // The transcript mutation is synchronous; save through the run update queue.
      // It needs no execution permit, even when several callers publish at once.
      host.assertActive(runId);
      const meetingState = execution.run.blocks.find((item) => item.blockId === target.id)!;
      const callerBlock = execution.blocks.find((item) => item.id === blockId)!;
      const participant = { ...callerBlock, ...state.chatSettings, provider: state.provider ?? callerBlock.provider ?? execution.defaultProvider };
      if (args.action === "wait") {
        const timeoutMs = args.timeout_seconds === undefined ? edge.timeoutMs ?? 300000 : typeof args.timeout_seconds === "number" ? Math.round(args.timeout_seconds * 1000) : NaN;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000) throw new Error("Use timeout_seconds greater than zero and at most 86400");
        const initial = useMeeting(meetingState, participant, { ...args, action: "diff" });
        if (initial.messages?.length) {
          await host.update(execution.run);
          return { blockId: target.id, meeting: { ...initial, status: "updated" } };
        }
        const duration = execution.run.definition?.settings?.maxRunDurationMs;
        const remaining = duration === undefined ? timeoutMs : Math.max(1, duration - (Date.now() - Date.parse(execution.run.startedAt!)));
        // Subscribe before yielding, and release this agent's execution permit so
        // another participant can publish even at workflow concurrency one.
        const waiting = host.meetingUpdates.wait(runId, target.id, Math.min(timeoutMs, remaining));
        return execution.scheduler.suspend(blockId, async () => {
          const status = await waiting;
          host.assertActive(runId);
          const result = useMeeting(meetingState, participant, { ...args, action: "diff", after: initial.cursor });
          await host.update(execution.run);
          return { blockId: target.id, meeting: { ...result, status: result.messages?.length ? "updated" : status } };
        });
      }
      const result = useMeeting(meetingState, participant, args);
      meetingState.status = "succeeded";
      meetingState.output = meetingState.meeting!.messages.map((message) => `[${message.sequence}] ${message.author}: ${message.text}`).join("\n\n").slice(-200000);
      execution.outputs.set(target.id, meetingState.output);
      await host.update(execution.run);
      if (args.action === "publish") host.meetingUpdates.publish(runId, target.id);
      return { blockId: target.id, meeting: result };
    }
    if (args.peer_block_id !== undefined) throw new Error("peer_block_id is only available for Meeting shake");
    if (args.after !== undefined) throw new Error("after is only available for Meeting blocks");
    if (target.type !== "task_controls" && ["task_id", "branch", "status", "message", "idempotency_key"].some((key) => args[key] !== undefined)) throw new Error("Task arguments are only available for Task controls blocks");
    if (target.type !== "terminal_control" && ["terminal_id", "name", "data", "command"].some((key) => args[key] !== undefined)) throw new Error("Terminal arguments are only available for Terminal Control blocks");
    const agentTarget = ["ai", "chatbox"].includes(target.type);
    if (agentTarget && args.lines !== undefined && args.action !== "tail") throw new Error("AI lines are only available with action 'tail'");
    if (agentTarget && args.action !== undefined) {
      if (!["start", "status", "tail", "steer"].includes(String(args.action))) throw new Error("AI action must be start, status, tail, or steer");
      if (args.lines !== undefined && (args.action !== "tail" || typeof args.lines !== "number" || !Number.isInteger(args.lines) || args.lines < 1 || args.lines > 50)) throw new Error("Use lines from 1 to 50 with AI action 'tail'");
      if (args.action === "status" || args.action === "tail") return host.flowBlockMessages(execution.run, target.id, args.action === "status" ? 0 : (args.lines as number | undefined) ?? 6);
      if (args.action === "steer") {
        const child = execution.run.blocks.find((item) => item.blockId === target.id)!;
        if (!textInput.trim() || !["running", "waiting_timer"].includes(child.status) || !child.workspace || !child.provider || !host.steerAgent) throw new Error("Steering requires a running connected AI session and nonempty input");
        const steeringInput = contextPreview(textInput, WORKFLOW_CONTEXT_CHARS);
        await execution.scheduler.control(target.id, async () => {
          host.assertActive(runId);
          if (!["running", "waiting_timer"].includes(child.status)) throw new Error("Connected AI session is no longer running");
          host.chargeContext(execution.run, child, steeringInput.length);
          if (target.type === "chatbox") {
            host.appendChatSteering(child, steeringInput);
          }
          host.log(child, "prompt", `Agent steering: ${steeringInput}`);
          await host.update(execution.run);
          await host.steerAgent!(child.provider!, child.workspace!, steeringInput);
          host.assertActive(runId);
        });
        return host.flowBlockMessages(execution.run, target.id, 6);
      }
      if (execution.flowBusy?.has(target.id) || host.agentStarts.has(`${runId}:${target.id}`)) throw new Error("Connected AI block is already running; use status, tail, or steer");
    }
    const timeoutMs = args.timeout_seconds === undefined ? edge.timeoutMs ?? 300_000 : typeof args.timeout_seconds === "number" ? Math.round(args.timeout_seconds * 1000) : NaN;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000) throw new Error("Use timeout_seconds greater than zero and at most 86400");
    if (target.type === "run_app") {
      const allowed = target.app?.actions ?? (target.app?.action ? [target.app.action] : []);
      if (args.action !== undefined && !allowed.includes(args.action as typeof allowed[number])) throw new Error(`App '${target.label}' does not allow '${String(args.action)}'. Allowed actions for workflow v${execution.run.harnessVersion}: ${allowed.join(", ") || "none"}. If you changed the design, save it and start a new conversation to apply the new allowed actions.`);
      if (args.lines !== undefined && (args.action !== "tail" || !Number.isInteger(args.lines) || typeof args.lines !== "number" || args.lines < 1 || args.lines > 10000)) throw new Error("Use lines from 1 to 10000 with action 'tail'");
    } else if (target.type === "terminal_control") {
      if (args.action !== undefined && !["list", "open", "open_and_run", "run_and_wait", "read", "write"].includes(String(args.action))) throw new Error("Terminal Control action must be list, open, open_and_run, run_and_wait, read, or write");
    } else if (target.type === "task_controls") {
      if (args.lines !== undefined) throw new Error("Lines are only available for Run App blocks");
    } else if (!agentTarget && (args.action !== undefined || args.lines !== undefined)) throw new Error("Action is only available for Run App, Terminal Control and Task controls blocks; lines are only available for Run App and Terminal Control blocks");
    const invoke = host.flowInvocations.get(runId);
    if (!invoke) throw new Error("Flow is unavailable");
    const call = () => execution.scheduler.suspend(blockId, async () => {
      const transfer = await host.traceConnection(execution.run, edge, "forward", "active", textInput.length);
      try {
        const appTarget = execution.blocks.find((block) => block.id === edge.to);
        const input = appTarget?.type === "terminal_control" && args.action !== undefined ? JSON.stringify({ action: args.action, terminal_id: args.terminal_id, name: args.name, command: args.command ?? (args.action === "open_and_run" || args.action === "run_and_wait" ? textInput : undefined), data: args.data ?? textInput, lines: args.lines, ...(args.action === "run_and_wait" ? { timeout_ms: Math.max(1, timeoutMs - 500) } : {}) }) : appTarget?.type === "task_controls" && (args.action !== undefined || ["task_id", "branch", "status", "message", "idempotency_key"].some((key) => args[key] !== undefined)) ? JSON.stringify({ action: args.action, prompt: textInput, task_id: args.task_id, branch: args.branch, status: args.status, message: args.message === undefined ? textInput : args.message, idempotency_key: args.idempotency_key }) : appTarget?.type === "run_app" && args.action !== undefined ? JSON.stringify({ action: args.action, input: textInput, ...(args.lines !== undefined ? { lines: args.lines } : {}) }) : textInput;
        const output = await invoke(edge.to, input, [blockId]);
        transfer.status = "succeeded"; transfer.completedAt = new Date().toISOString();
        await host.traceConnection(execution.run, edge, "return", "succeeded", output.length);
        const target = execution.blocks.find((block) => block.id === edge.to);
        const timer = execution.run.blocks.find((block) => block.blockId === edge.to);
        const app = target?.type === "run_app" ? JSON.parse(output) : undefined;
        // Structured results already contain the output; do not send a second,
        // escaped copy into the calling agent's conversation.
        return { blockId: edge.to, ...(app ? { app } : target?.type === "terminal_control" ? { terminal: JSON.parse(output) } : target?.type === "task_controls" ? { task_controls: JSON.parse(output) } : target?.type === "skill" && target.skillId ? { skill: JSON.parse(output) } : { output }), ...(target?.type === "timer" ? { status: "waiting", due_at: timer?.waitingUntil } : {}) };
      } catch (error) { transfer.status = "failed"; transfer.completedAt = new Date().toISOString(); await host.update(execution.run); throw error; }
    });
    const waitForResult = async (result: Promise<unknown>) => {
      // Keep the real invocation alive after the caller's wait expires. The parent
      // can inspect progress without sending a duplicate prompt to the child.
      const pending = result.then(() => {}, () => {}).finally(() => execution.background.delete(pending));
      execution.background.add(pending);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A human reply is not bounded by an execution timeout. Returning a
        // timeout here strands the answer after the calling Chatbox moves on.
        if (["user_prompt", "yes_no_prompt"].includes(target.type)) return await result;
        return await Promise.race([result, new Promise<unknown>((resolve) => {
          timer = setTimeout(() => resolve({ ...host.flowBlockMessages(execution.run, target.id, 6), status: "timed_out", timeout_seconds: timeoutMs / 1000, message: "The block is still running. Call workflow_block_messages to check progress without sending another prompt." }), timeoutMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    };
    if (agentTarget && args.action === "start") {
      const key = `${runId}:${target.id}`;
      const result = call();
      host.agentStarts.add(key);
      const pending = result.then(() => {}, () => {}).finally(() => {
        execution.background.delete(pending);
        host.agentStarts.delete(key);
      });
      execution.background.add(pending);
      return { blockId: target.id, status: "started" };
    }
    if (target.type !== "run_app") return waitForResult(call());
    const key = `${runId}:${target.id}`;
    const pending = host.appToolCalls.get(key) ?? Promise.resolve();
    const result = pending.then(call, call);
    host.appToolCalls.set(key, result);
    const cleanup = () => { if (host.appToolCalls.get(key) === result) host.appToolCalls.delete(key); };
    void result.then(cleanup, cleanup);
    return waitForResult(result);
  }

type FetchUnreadHost = {
  activeExecution: HarnessRunner["activeExecution"];
  callerContext: HarnessRunner["callerContext"];
  callFlowTool: HarnessRunner["callFlowTool"];
  assertActive: HarnessRunner["assertActive"];
  traceConnection: HarnessRunner["traceConnection"];
};

export async function harnessFetchUnread(host: FetchUnreadHost, runId: string, blockId: string, target: HarnessBlock, args: Record<string, unknown>): Promise<unknown> {
    const execution = host.activeExecution(runId);
    if (args.lines !== undefined || args.after !== undefined || args.input !== undefined && args.input !== "") throw new Error("fetch accepts only block_id and, for Terminal Control, terminal_id; it returns data not yet fetched");
    const context = host.callerContext(runId, blockId);
    const cursors = context.fetched;
    const unfetchedText = (key: string, text: string) => {
      const part = takeUnfetchedText(cursors, `${target.id}:${key}`, text);
      return { output: part.text, ...(part.hasMore ? { hasMore: true } : {}), ...(part.gap ? { gap: true } : {}), ...(!part.text ? { unchanged: true } : {}) };
    };
    const forward = (action: string, extra: Record<string, unknown> = {}) => host.callFlowTool(runId, blockId, "workflow_use_block", { ...args, action, ...extra });
    if (["ai", "chatbox"].includes(target.type)) {
      host.assertActive(runId);
      const edge = execution.edges.find((item) => item.from === blockId && item.to === target.id && (item.type === "use" || execution.blocks.find((block) => block.id === blockId)?.type === "chatbox"));
      if (!edge) throw new Error("Use a connected block ID");
      await host.traceConnection(execution.run, edge, "forward", "succeeded", 0);
      const state = execution.run.blocks.find((block) => block.blockId === target.id)!;
      const messages = state.chatMessages ?? (state.output ? [{ id: "output", role: "assistant", text: state.output, timestamp: state.completedAt ?? state.startedAt ?? "" }] : []);
      let size = 0;
      let hasMore = false;
      const fresh: { id: string; hash: string; item: Record<string, unknown> }[] = [];
      const take = (kind: string, items: readonly { id: string; text: string }[]) => {
        for (const item of items) {
          const hash = contextHash(item);
          if (cursors.get(`${target.id}:${kind}:${item.id}`) === hash) continue;
          const shown = kind === "message" ? { ...item, text: item.text.slice(-8000), ...(item.text.length > 8000 ? { truncated: true } : {}) } : item;
          const length = JSON.stringify(shown).length;
          if (size + length > 16000 && size > 0) { hasMore = true; return false; }
          size += length;
          fresh.push({ id: `${kind}:${item.id}`, hash, item: shown });
        }
        return true;
      };
      take("message", messages) && take("activity", state.agentActivity ?? []);
      for (const entry of fresh) rememberFetch(cursors, `${target.id}:${entry.id}`, entry.hash);
      const result = { blockId: target.id, block_status: state.status, messages: fresh.filter((entry) => entry.id.startsWith("message:")).map((entry) => entry.item), activity: fresh.filter((entry) => entry.id.startsWith("activity:")).map((entry) => entry.item), ...(hasMore ? { hasMore: true } : {}), ...(state.error ? { error: state.error } : {}) };
      await host.traceConnection(execution.run, edge, "return", "succeeded", JSON.stringify(result).length);
      return result;
    }
    if (target.type === "run_app") {
      const result = await forward("tail", { lines: 10_000 }) as { blockId: string; app: { output?: string } & Record<string, unknown> };
      return { ...result, app: { ...result.app, ...unfetchedText("app", result.app.output ?? "") } };
    }
    if (target.type === "terminal_control") {
      if (typeof args.terminal_id !== "string") throw new Error("terminal_id is required to fetch Terminal Control output; use action list to find it");
      const result = await forward("read", { lines: 10_000 }) as { blockId: string; terminal: { output?: string } & Record<string, unknown> };
      return { ...result, terminal: { ...result.terminal, ...unfetchedText(`terminal:${args.terminal_id}`, result.terminal.output ?? ""), truncated: undefined } };
    }
    if (target.type === "task_controls") {
      const result = await forward("status") as { blockId: string; task_controls: unknown };
      const hash = contextHash(result.task_controls);
      const key = `${target.id}:task_controls:${typeof args.task_id === "string" ? args.task_id : ""}`;
      if (cursors.get(key) === hash) return { blockId: target.id, unchanged: true };
      rememberFetch(cursors, key, hash);
      return result;
    }
    if (target.type === "skill") throw new Error("Load skills through workflow_use_block so current policy is checked");
    host.assertActive(runId);
    const edge = execution.edges.find((item) => item.from === blockId && item.to === target.id && (item.type === "use" || execution.blocks.find((block) => block.id === blockId)?.type === "chatbox"));
    if (!edge) throw new Error("Use a connected block ID");
    const output = execution.run.blocks.find((item) => item.blockId === target.id)?.output ?? "";
    await host.traceConnection(execution.run, edge, "forward", "succeeded", 0);
    await host.traceConnection(execution.run, edge, "return", "succeeded", output.length);
    return { blockId: target.id, ...unfetchedText("output", output) };
  }
