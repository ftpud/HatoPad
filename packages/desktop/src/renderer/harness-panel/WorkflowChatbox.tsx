import { useWorkflowTranscript } from "../workflow-transcript";
import { AiAuthentication } from "../AiAuthentication";
import { WorkflowError } from "../WorkflowError";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, Settings2, Square, Terminal, X } from "lucide-react";
import { findAutopilotOption } from "@hatopad/acp";
import type {
  AiConfiguration,
  AiModel,
  HarnessBlock,
  HarnessChatSettings,
  HarnessOperation,
  HarnessDefinition,
  HarnessRun,
} from "@hatopad/protocol";
import { ContextInspector, ContextUsageIndicator } from "../ContextInspector";
import { ModelPicker } from "../ModelPicker";
import type { ChatboxOptions } from "./types";
import { WorkflowMarkdown } from "./WorkflowRunOutput";

export function WorkflowChatbox({
  providers = [],
  defaultProvider,
  onLoadModels,
  block,
  run,
  state,
  onClose,
  onSend,
  onSteer,
  onStop,
  onAutopilot,
  definition,
}: {
  block: HarnessBlock;
  run?: HarnessRun;
  state?: HarnessRun["blocks"][number];
  onClose(): void;
  onSend?(input: string, settings?: HarnessChatSettings): Promise<void>;
  onSteer?(input: string): Promise<void>;
  onStop?(): Promise<void>;
  onAutopilot?(enabled: boolean): Promise<void>;
  definition?: HarnessDefinition;
} & ChatboxOptions) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const contextId = useId();
  const [providerOverride, setProviderOverride] = useState(state?.chatSettings?.provider ?? "");
  const [modelOverride, setModelOverride] = useState(state?.chatSettings?.model ?? "");
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelError, setModelError] = useState("");
  const effectiveProvider = providerOverride || block.provider || defaultProvider || state?.provider;
  // Only non-blocking feature switches belong here: a Chatbox runs on Autopilot by design, and Core
  // forces interactive features such as agent questions off for every workflow session.
  const [optionOverrides, setOptionOverrides] = useState<AiConfiguration>(state?.chatSettings?.options ?? {});
  const featureOptions = useMemo(() => {
    const options = providers.find((item) => item.id === effectiveProvider)?.options ?? [];
    const autopilotOption = findAutopilotOption(options)?.option.id;
    return options.filter(
      (option) =>
        option.type === "boolean" && !option.interactive && !option.permissionApproval && option.id !== autopilotOption,
    );
  }, [providers, effectiveProvider]);
  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModelError("");
    if (settingsOpen && effectiveProvider && onLoadModels)
      void onLoadModels(effectiveProvider)
        .then((items) => {
          if (!cancelled) setModels(items);
        })
        .catch((reason) => {
          if (!cancelled) setModelError(String(reason));
        });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, effectiveProvider, onLoadModels]);
  const [changingAutopilot, setChangingAutopilot] = useState(false);
  const [autopilotOverride, setAutopilotOverride] = useState<boolean>();
  const autopilot =
    autopilotOverride ??
    state?.autopilot ??
    state?.chatSettings?.autopilot ??
    (state?.pendingPermission ? false : (block.autopilot ?? true));
  useEffect(() => setAutopilotOverride(undefined), [state?.autopilot, state?.sessionId]);
  const [message, setMessage] = useState("");
  const messageRevision = useRef(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const messages = state?.chatMessages ?? [];
  const busy =
    sending ||
    (!!state &&
      [
        "queued",
        "running",
        "waiting",
        "awaiting_permission",
        "awaiting_user_input",
        "waiting_timer",
        "retry_scheduled",
      ].includes(state.status));
  const graph = run?.definition ?? definition;
  const connected = (graph?.edges ?? [])
    .filter((edge) => edge.from === block.id)
    .map((edge) => graph?.blocks.find((item) => item.id === edge.to)?.label)
    .filter(Boolean);
  const { onScroll: onTranscriptScroll, followLatest } = useWorkflowTranscript(
    transcript,
    `${run?.id ?? "draft"}:${block.id}:${state?.sessionId ?? ""}`,
    `${messages.length}:${messages.at(-1)?.id ?? ""}:${messages.at(-1)?.text ?? ""}:${busy}`,
  );
  const send = async () => {
    const action = busy ? (["running", "waiting_timer"].includes(state?.status ?? "") ? onSteer : undefined) : onSend;
    if (!action || sending || !message.trim()) return;
    const input = message;
    const revision = messageRevision.current;
    setMessage("");
    setSending(true);
    setError("");
    followLatest();
    try {
      if (busy) await onSteer!(input);
      else
        await onSend!(input, {
          provider: effectiveProvider,
          model:
            modelOverride ||
            (effectiveProvider !== (block.provider || defaultProvider || state?.provider) ? "" : (block.model ?? "")),
          autopilot,
          ...(Object.keys(optionOverrides).length ? { options: optionOverrides } : {}),
        });
    } catch (reason) {
      if (messageRevision.current === revision) setMessage(input);
      setError(reason instanceof Error ? reason.message : "Could not send message");
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="harness-run-details workflow-chatbox" aria-label={`${block.label} run details`}>
      <header>
        <div>
          <span className="harness-detail-icon">
            <MessageSquare size={16} aria-hidden="true" />
          </span>
          <div className="harness-detail-title">
            <strong>{block.label}</strong>
            <small>Chatbox · {busy ? "Working" : "Ready"}</small>
          </div>
        </div>
        <div className="harness-detail-actions">
          <ContextUsageIndicator
            session={state ?? {}}
            onClick={() => setContextOpen((open) => !open)}
            expanded={contextOpen}
            controls={contextId}
          />
          <button
            type="button"
            aria-label="Chatbox settings"
            title="Chatbox settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 size={16} />
          </button>
          <button title="Close run details" aria-label="Close run details" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      {contextOpen && <ContextInspector key={state?.sessionId} id={contextId} session={state ?? {}} />}
      {settingsOpen && (
        <div className="workflow-chat-settings" role="group" aria-label="Chatbox settings">
          <label>
            Provider override
            <select
              aria-label="Chatbox provider override"
              disabled={busy}
              value={providerOverride}
              onChange={(event) => {
                setProviderOverride(event.target.value);
                setModelOverride("");
                setOptionOverrides({});
              }}
            >
              <option value="">Workflow default</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model override
            <ModelPicker
              label="Chatbox model override"
              models={[
                { id: "", name: "Provider / workflow default", defaultReasoning: "", reasoningLevels: [] },
                ...models,
              ]}
              value={modelOverride}
              disabled={busy || !effectiveProvider}
              onChange={setModelOverride}
            />
          </label>
          {modelError && <small role="alert">{modelError}</small>}
          <label className="harness-autopilot">
            <input
              type="checkbox"
              role="switch"
              aria-label="Autopilot"
              checked={autopilot}
              disabled={changingAutopilot}
              onChange={(event) => {
                const enabled = event.target.checked;
                if (!onAutopilot) {
                  setAutopilotOverride(enabled);
                  return;
                }
                setChangingAutopilot(true);
                setError("");
                void onAutopilot(enabled)
                  .then(() => setAutopilotOverride(enabled))
                  .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not change Autopilot"))
                  .finally(() => setChangingAutopilot(false));
              }}
            />
            Autopilot
          </label>
          {featureOptions.map((option) => (
            <label key={option.id} className="harness-autopilot" title={option.description}>
              <input
                type="checkbox"
                role="switch"
                aria-label={option.name}
                disabled={busy}
                checked={(optionOverrides[option.id] ?? block.options?.[option.id] ?? option.defaultValue) === true}
                onChange={(event) =>
                  setOptionOverrides((current) => ({ ...current, [option.id]: event.target.checked }))
                }
              />
              {option.name}
            </label>
          ))}
          {effectiveProvider && (
            <div className="workflow-chat-account" role="group" aria-label="Provider account">
              <span>Provider account</span>
              <AiAuthentication provider={effectiveProvider} disabled={busy} />
            </div>
          )}
          <small>
            Overrides apply to this Chatbox on the next message. Changing provider or model starts a fresh session.
            Autopilot approves tool permission requests automatically.
          </small>
        </div>
      )}
      {!!connected.length && (
        <div className="workflow-chat-tools" aria-label="Connected chat tools">
          <span>Connected</span>
          {connected.map((label, index) => (
            <span className="workflow-chat-tool" key={`${label}:${index}`}>
              {label}
            </span>
          ))}
        </div>
      )}
      <div
        className="workflow-chat-messages"
        ref={transcript}
        role="log"
        aria-label={`${block.label} conversation`}
        aria-live="off"
        onScroll={onTranscriptScroll}
      >
        {!messages.length && (
          <div className="workflow-chat-empty">
            <MessageSquare size={28} aria-hidden="true" />
            <strong>Start a conversation</strong>
            <p>Ask a question or put the connected blocks to work.</p>
          </div>
        )}
        {messages.map((item) => (
          <article key={item.id} className={`workflow-chat-message ${item.role}`}>
            <strong>{item.role === "user" ? "You" : block.label}</strong>
            {item.text ? (
              item.role === "assistant" ? (
                <WorkflowMarkdown>{item.text}</WorkflowMarkdown>
              ) : (
                <p>{item.text}</p>
              )
            ) : (
              <span className="workflow-chat-thinking">{busy ? "Thinking…" : "No response"}</span>
            )}
          </article>
        ))}
        {state?.error && <WorkflowError message={state.error} />}
      </div>
      <WorkflowChatActivity block={block} run={run} state={state} busy={busy} />
      <form
        className="workflow-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label={`Message ${block.label}`}
          placeholder={busy ? "Steer this Chatbox while it works…" : "Message this Chatbox…"}
          rows={3}
          value={message}
          disabled={!onSend && !onSteer}
          onChange={(event) => {
            messageRevision.current++;
            setMessage(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <span role="status">
            {busy ? "Working with your workflow…" : "Enter to send · Shift+Enter for a new line"}
          </span>
          {busy && onStop ? (
            <button
              type="button"
              aria-label="Stop chat response"
              onClick={() => {
                setError("");
                void onStop().catch((reason) =>
                  setError(reason instanceof Error ? reason.message : "Could not stop response"),
                );
              }}
            >
              <Square size={13} aria-hidden="true" /> Stop
            </button>
          ) : null}
          <button
            type="submit"
            aria-label={busy ? "Steer chat response" : "Send chat message"}
            disabled={
              sending ||
              !message.trim() ||
              (busy ? !onSteer || !["running", "waiting_timer"].includes(state?.status ?? "") : !onSend)
            }
          >
            <Send size={14} aria-hidden="true" /> {busy ? "Steer" : "Send"}
          </button>
        </div>
        {error && <WorkflowError message={error} />}
      </form>
    </section>
  );
}

export function WorkflowChatActivity({
  block,
  run,
  state,
  busy,
}: {
  block: HarnessBlock;
  run?: HarnessRun;
  state?: HarnessRun["blocks"][number];
  busy: boolean;
}) {
  const operations = (run?.operations ?? [])
    .filter(
      (item) =>
        item.blockId === block.id &&
        item.kind === "tool_command" &&
        (!state?.startedAt || Date.parse(item.createdAt) >= Date.parse(state.startedAt)),
    )
    .slice(-30);
  const activities = state?.agentActivity ?? [];
  const describe = (operation: HarnessOperation) => {
    const input = operation.input as
      { name?: string; args?: { block_id?: string; action?: string; lines?: number } } | undefined;
    const target = run?.definition?.blocks.find((item) => item.id === input?.args?.block_id);
    return input?.name === "workflow_use_block"
      ? `${target?.label ?? input.args?.block_id ?? "Connected block"}${input.args?.action ? ` · ${input.args.action}` : ""}${input.args?.lines ? ` · ${input.args.lines} lines` : ""}`
      : (input?.name ?? "Tool call");
  };
  const active = busy ? state?.activeToolCalls?.at(-1) : undefined;
  const activeTarget = run?.definition?.blocks.find((item) => item.id === active?.blockId);
  const activeDescription = active
    ? `${activeTarget?.label ?? active.blockId}${active.action ? ` · ${active.action}` : ""}${active.lines ? ` · ${active.lines} lines` : ""}`
    : undefined;
  const pending = [...operations].reverse().find((item) => item.status === "intent");
  const latest = activities.at(-1);
  const status = state && waitingStatus(block, state);
  const describeActivity = (text: string) => {
    if (!/workflow_use_block/.test(text.split("\n")[0] ?? "")) return text.split("\n")[0] || "Agent activity";
    const blockId = /^block_id: (.+)$/m.exec(text)?.[1];
    const action = /^action: (.+)$/m.exec(text)?.[1];
    return blockId
      ? `${run?.definition?.blocks.find((item) => item.id === blockId)?.label ?? blockId}${action ? ` · ${action}` : ""}`
      : "Connected block";
  };
  const summary =
    status ??
    (activeDescription
      ? `Running ${activeDescription}`
      : pending
        ? `Running ${describe(pending)}`
        : busy
          ? latest
            ? describeActivity(latest.text)
            : "Agent working…"
          : "Agent activity");
  if (!busy && !activities.length && !operations.length) return null;
  const entries = [
    ...activities.map((item) => ({
      id: `activity:${item.id}`,
      timestamp: item.timestamp,
      label: describeActivity(item.text),
      detail: item.text,
      status: "",
    })),
    ...operations.map((item) => ({
      id: item.id,
      timestamp: item.createdAt,
      label: describe(item),
      detail:
        item.error ??
        (item.result !== undefined ? JSON.stringify(item.result, null, 2) : JSON.stringify(item.input, null, 2)) ??
        "",
      status: item.status === "intent" ? "Running" : item.status === "succeeded" ? "Completed" : "Failed",
    })),
  ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return (
    <details className="workflow-chat-activity" aria-label="Chatbox agent activity">
      <summary>
        <Terminal size={13} aria-hidden="true" />
        <span role="status" aria-label="Agent current activity" title={summary}>
          {summary}
        </span>
        <small>{entries.length || "Live"}</small>
      </summary>
      <div className="workflow-chat-activity-list">
        {!entries.length && <p>Waiting for agent activity…</p>}
        {entries.map((item) => (
          <details key={item.id}>
            <summary>
              <time>{new Date(item.timestamp).toLocaleTimeString()}</time>
              <span title={item.label}>{item.label}</span>
              {item.status && <small className={item.status.toLowerCase()}>{item.status}</small>}
            </summary>
            <pre>{item.detail.slice(-12000)}</pre>
          </details>
        ))}
      </div>
    </details>
  );
}

export function waitingStatus(block: HarnessBlock, state: HarnessRun["blocks"][number]): string | undefined {
  if (state.status === "queued") return "Queued to start when scheduler capacity is available.";
  if (state.status === "waiting")
    return block.join === "any"
      ? "Waiting for any incoming synchronous connection to finish."
      : "Waiting for every incoming synchronous connection to finish.";
  if (state.status === "awaiting_permission")
    return "Waiting for a permission decision. Next action: approve or reject the request.";
  if (state.status === "awaiting_user_input")
    return state.question
      ? `Waiting for your answer: ${state.question}`
      : "Waiting for your answer before the block can resume.";
  if (state.status === "waiting_timer")
    return state.waitingUntil
      ? `Waiting for a timer until ${new Date(state.waitingUntil).toLocaleString()}. Next action: resume when it fires.`
      : "Waiting for a timer to fire.";
  if (state.status === "retry_scheduled")
    return state.retryAt
      ? `Waiting to retry at ${new Date(state.retryAt).toLocaleString()}. Next action: retry this attempt.`
      : "Waiting to retry this attempt.";
  return undefined;
}
