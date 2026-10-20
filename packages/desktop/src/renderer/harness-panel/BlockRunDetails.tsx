import { useState } from "react";
import { Square, Terminal, X } from "lucide-react";
import type {
  HarnessBlock,
  HarnessChatSettings,
  HarnessAppState,
  HarnessDefinition,
  HarnessRun,
} from "@hatopad/protocol";
import type { ChatboxOptions } from "./types";
import {
  WorkflowMeetingTranscript,
  WorkflowMessage,
  WorkflowAppOutput,
  LogSection,
  LogEntry,
} from "./WorkflowRunOutput";
import { WorkflowChatbox, waitingStatus } from "./WorkflowChatbox";
import { WorkflowBlockIcon } from "./WorkflowBlockIcon";
import { blockTypeLabels } from "./block-catalog";

export function BlockRunDetails({
  providers,
  defaultProvider,
  onLoadModels,
  block,
  run,
  state,
  tasks,
  onClose,
  onChat,
  onCancelChat,
  onKillApp,
  onReadApp,
  onSteer,
  onOpenAppTerminal,
  onAutopilot,
  definition,
}: {
  block: HarnessBlock;
  run?: HarnessRun;
  state?: HarnessRun["blocks"][number];
  tasks?: HarnessRun["children"];
  onClose(): void;
  onChat?(input: string, settings?: HarnessChatSettings): Promise<void>;
  onCancelChat?(): Promise<void>;
  onKillApp?(): Promise<void>;
  onReadApp?(): Promise<HarnessAppState>;
  onSteer?(input: string): Promise<void>;
  onOpenAppTerminal?(): Promise<void>;
  onAutopilot?(enabled: boolean): Promise<void>;
  definition?: HarnessDefinition;
} & ChatboxOptions) {
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState("");
  const [appRefresh, setAppRefresh] = useState(0);
  if (block.type === "meeting")
    return <WorkflowMeetingTranscript block={block} run={run} state={state} onClose={onClose} />;
  if (block.type === "chatbox")
    return (
      <WorkflowChatbox
        providers={providers}
        defaultProvider={defaultProvider}
        onLoadModels={onLoadModels}
        block={block}
        run={run}
        state={state}
        onClose={onClose}
        onSend={onChat}
        onSteer={onSteer}
        onStop={onCancelChat}
        onAutopilot={onAutopilot}
        definition={definition}
      />
    );
  const totalTokens = run?.blocks.reduce((total, item) => total + (item.tokens?.total ?? 0), 0) ?? 0;
  const tokenBudget = run?.definition?.settings?.tokenBudget;
  const limits = run?.definition?.settings;
  const waitingMessage = state && waitingStatus(block, state);
  return (
    <section className="harness-run-details" aria-label={`${block.label} run details`}>
      <header>
        <div>
          <span className="harness-detail-icon">
            <WorkflowBlockIcon type={block.type} />
          </span>
          <div className="harness-detail-title">
            <strong>{block.label}</strong>
            <small>{blockTypeLabels[block.type] ?? block.type}</small>
          </div>
          <span className={`harness-run-state ${state?.status ?? "idle"}`}>
            {state?.status.replaceAll("_", " ") ?? "not run"}
          </span>
        </div>
        <div className="harness-detail-actions">
          {block.type === "run_app" && onOpenAppTerminal && (
            <button
              aria-label="Open app output in terminal"
              title="Open live app output in terminal"
              onClick={() => {
                setKillError("");
                void onOpenAppTerminal().catch((error) =>
                  setKillError(error instanceof Error ? error.message : "Could not open app output"),
                );
              }}
            >
              <Terminal size={14} aria-hidden="true" />
            </button>
          )}
          {block.type === "run_app" && onKillApp && (
            <button
              className="harness-kill-process"
              aria-label="Kill process"
              title={killing ? "Killing process…" : "Kill process"}
              disabled={killing}
              onClick={() => {
                setKilling(true);
                setKillError("");
                void onKillApp()
                  .then(() => setAppRefresh((value) => value + 1))
                  .catch((error) => setKillError(error instanceof Error ? error.message : "Could not kill process"))
                  .finally(() => setKilling(false));
              }}
            >
              <Square size={14} aria-hidden="true" />
            </button>
          )}
          <button title="Close run details" aria-label="Close run details" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="harness-run-details-body">
        {block.type === "skill" && block.description && (
          <WorkflowMessage title="Description" value={block.description} />
        )}
        {killError && <p role="alert">{killError}</p>}
        {block.type === "run_app" && onReadApp && (
          <WorkflowAppOutput key={`${run?.id ?? "draft"}:${block.id}`} onRead={onReadApp} refresh={appRefresh} />
        )}
        {!state ? (
          <>
            <p className="harness-detail-empty">This block has not run yet.</p>
            {block.prompt && <WorkflowMessage title="Instructions" value={block.prompt} />}
          </>
        ) : (
          <>
            {waitingMessage && (
              <p className="harness-detail-empty" aria-label="Block waiting status">
                {waitingMessage}
              </p>
            )}
            {!state.prompt && !state.iterations?.length && block.prompt && (
              <WorkflowMessage title="Instructions" value={block.prompt} />
            )}
            {state.iterations?.length ? (
              <div className="harness-iteration-list">
                <strong>
                  Stack items ({state.iterations.length}/{state.plannedRuns ?? state.iterations.length})
                </strong>
                {state.iterations.map((iteration) => (
                  <details key={iteration.index} open={iteration.index === state.iterations!.length}>
                    <summary>
                      <span>Item {iteration.index}</span>
                      <span className={`harness-run-state ${iteration.status}`}>{iteration.status}</span>
                    </summary>
                    {iteration.prompt && <WorkflowMessage title="Prompt" value={iteration.prompt} />}
                    {iteration.output && <WorkflowMessage title="Answer" value={iteration.output} />}
                    {iteration.error && <LogSection title="Error" value={iteration.error} error />}
                  </details>
                ))}
              </div>
            ) : (
              <>
                {state.prompt && <WorkflowMessage title="Prompt" value={state.prompt} />}
                {state.output && (block.type !== "run_app" || !onReadApp) && (
                  <WorkflowMessage title="Answer" value={state.output} />
                )}
                {state.error && <LogSection title="Error" value={state.error} error />}
              </>
            )}
            <details className="harness-detail-diagnostics">
              <summary>Execution details</summary>
              <div>
                {block.type === "run_app" && onReadApp && state.output && (
                  <LogSection title="Process response" value={state.output} />
                )}
                {run && (
                  <p
                    className={`harness-detail-empty${tokenBudget !== undefined && totalTokens > tokenBudget ? " error" : ""}`}
                  >
                    Run {run.id} · definition v{run.harnessVersion}
                    {run.startedAt ? ` · started ${new Date(run.startedAt).toLocaleString()}` : ""}
                    {run.completedAt && run.startedAt
                      ? ` · ${Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000}s`
                      : ""}
                    {totalTokens ? ` · ${totalTokens.toLocaleString()} tokens` : ""}
                    {tokenBudget !== undefined ? ` / ${tokenBudget.toLocaleString()} budget` : ""}
                  </p>
                )}
                {limits && (
                  <p className="harness-detail-empty" aria-label="Workflow run limits">
                    Limits: {limits.maxActiveRuns ?? 4} active runs · {limits.maxBlockAttempts ?? 100} block attempts ·{" "}
                    {limits.maxStackSize ?? 100} stack inputs · {limits.maxLoopCount ?? 100} loop iterations ·{" "}
                    {limits.maxChildTasks ?? 100} child tasks
                  </p>
                )}
                {tasks?.length ? (
                  <section className="harness-execution-log">
                    <strong>Owned implementation tasks</strong>
                    {tasks.map((child) => (
                      <LogSection
                        key={`${child.provider}:${child.taskId}`}
                        title={`${child.taskId} · ${child.provider}`}
                        value={`Recovery attempts: ${child.recoveryAttempts}/3${child.failureReason ? `\nFailure: ${child.failureReason.replaceAll("_", " ")}` : ""}${child.retryAt ? `\nRetry after: ${new Date(child.retryAt).toLocaleString()}` : ""}${child.recoveryError ? `\nLast recovery error: ${child.recoveryError}` : ""}`}
                        error={Boolean(child.recoveryError)}
                      />
                    ))}
                  </section>
                ) : null}
                {block.watchdog && (
                  <p className="harness-detail-empty">
                    Core-managed watchdog · no model calls
                    {state.waitingUntil ? ` · Next check: ${new Date(state.waitingUntil).toLocaleString()}` : ""}
                  </p>
                )}
                {(state.failureReason || state.recoveryAttempts) && (
                  <p className="harness-detail-empty">
                    {state.failureReason ? `Failure: ${state.failureReason.replaceAll("_", " ")} · ` : ""}Automatic
                    recovery attempts: {state.recoveryAttempts ?? 0}/3
                    {state.retryAt ? ` · Retry after: ${new Date(state.retryAt).toLocaleString()}` : ""}
                  </p>
                )}
                <div className="harness-detail-meta">
                  <span>Provider: {state.provider ?? block.provider ?? "default"}</span>
                  {state.tokens && <span>Tokens: {state.tokens.total.toLocaleString()}</span>}
                  {state.workspace && <span>Persistent session: active</span>}
                  {state.selectedRoute && <span>Route: {state.selectedRoute}</span>}
                  {state.startedAt && <span>Started: {new Date(state.startedAt).toLocaleString()}</span>}
                </div>
                {state.log?.length ? (
                  <details className="harness-execution-log">
                    <summary>Execution log ({state.log.length})</summary>
                    <div className="harness-execution-log-entries">
                      {state.log.map((entry, index) => (
                        <LogEntry key={`${entry.timestamp}-${index}`} entry={entry} />
                      ))}
                    </div>
                  </details>
                ) : null}
                {state.attempts?.length ? (
                  <section className="harness-execution-log">
                    <strong>Attempts ({state.attempts.length})</strong>
                    {state.attempts.map((attempt) => (
                      <LogSection
                        key={attempt.id}
                        title={`Attempt ${attempt.index} · ${attempt.status}`}
                        value={`Started: ${new Date(attempt.startedAt).toLocaleString()}${attempt.completedAt ? `\nCompleted: ${new Date(attempt.completedAt).toLocaleString()}` : ""}${attempt.error ? `\nFailure: ${attempt.error}` : ""}`}
                        error={attempt.status === "failed"}
                      />
                    ))}
                  </section>
                ) : null}
                {state.structuredInput !== undefined && (
                  <LogSection title="Validated input" value={JSON.stringify(state.structuredInput, null, 2)} />
                )}
                {state.structuredOutput !== undefined && (
                  <LogSection title="Validated output" value={JSON.stringify(state.structuredOutput, null, 2)} />
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
