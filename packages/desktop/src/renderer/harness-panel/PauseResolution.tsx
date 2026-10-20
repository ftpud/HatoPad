import { WorkflowError } from "../WorkflowError";
import { useState } from "react";
import { MessageSquare, Play } from "lucide-react";
import type { HarnessRun } from "@hatopad/protocol";
import type { HarnessPanelProps } from "./types";
import { WorkflowMarkdown } from "./WorkflowRunOutput";

export function PauseResolution({
  run,
  block,
  yesNo,
  compactTimer = false,
  label,
  onResolvePermission,
  onAnswerQuestion,
  onResumePause,
  onRetryPause,
  onCancelPause,
  onError,
}: {
  run: HarnessRun;
  block: HarnessRun["blocks"][number];
  yesNo?: boolean;
  compactTimer?: boolean;
  label: string;
  onResolvePermission?: HarnessPanelProps["onResolvePermission"];
  onAnswerQuestion?: HarnessPanelProps["onAnswerQuestion"];
  onResumePause?: HarnessPanelProps["onResumePause"];
  onRetryPause?: HarnessPanelProps["onRetryPause"];
  onCancelPause?: HarnessPanelProps["onCancelPause"];
  onError(message: string): void;
}) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [timerError, setTimerError] = useState("");
  const owned = Boolean(block.sessionId && block.pauseId);
  const identified = Boolean(block.pauseId);
  const submit = async (action: () => Promise<unknown>) => {
    setSubmitting(true);
    setTimerError("");
    try {
      await action();
      setAnswer("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not resume workflow";
      if (compactTimer) setTimerError(message);
      onError(message);
    } finally {
      setSubmitting(false);
    }
  };
  const cancel = (
    <button
      className="reject"
      disabled={!identified || submitting || !onCancelPause}
      onClick={() => void submit(() => onCancelPause!(run.id, block.blockId, block.pauseId!))}
    >
      Cancel run
    </button>
  );
  if (block.status === "awaiting_permission" && block.pendingPermission)
    return (
      <section className="harness-pause" aria-label={`${label} permission request`}>
        <strong>{label} needs permission</strong>
        <span>{block.pendingPermission.title}</span>
        {block.pendingPermission.details && <pre>{block.pendingPermission.details}</pre>}
        <div>
          {block.pendingPermission.options.map((option) => (
            <button
              key={option.optionId}
              className={option.kind.startsWith("allow") ? "allow" : "reject"}
              disabled={!owned || submitting || !onResolvePermission}
              onClick={() =>
                void submit(() =>
                  onResolvePermission!(
                    run.id,
                    block.blockId,
                    block.sessionId!,
                    block.pauseId!,
                    block.pendingPermission!.id,
                    option.optionId,
                  ),
                )
              }
            >
              {option.name}
            </button>
          ))}
          <button
            className="reject"
            disabled={!owned || submitting || !onResolvePermission}
            onClick={() =>
              void submit(() =>
                onResolvePermission!(
                  run.id,
                  block.blockId,
                  block.sessionId!,
                  block.pauseId!,
                  block.pendingPermission!.id,
                ),
              )
            }
          >
            Reject
          </button>
          {cancel}
        </div>
      </section>
    );
  if (block.status === "awaiting_user_input")
    return (
      <section className="harness-pause workflow-user-request" aria-label={`${label} question`} aria-busy={submitting}>
        <header className="workflow-request-header">
          <span className="workflow-request-icon">
            <MessageSquare size={18} aria-hidden="true" />
          </span>
          <div>
            <span className="workflow-request-eyebrow">Your input is needed</span>
            <strong>{label}</strong>
          </div>
          <span className="workflow-request-badge">Paused</span>
        </header>
        {block.question && (
          <div className="workflow-request-question">
            <WorkflowMarkdown>{block.question}</WorkflowMarkdown>
          </div>
        )}
        {!yesNo && (
          <label className="workflow-request-response">
            Your response
            <textarea
              placeholder="Share your answer to continue…"
              aria-label={`Answer ${label}`}
              rows={4}
              disabled={submitting}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
        )}
        <footer className="workflow-request-footer">
          <span className="workflow-request-hint">
            {submitting ? "Resuming workflow…" : "The workflow will continue after your reply."}
          </span>
          <div className="workflow-request-actions">
            {cancel}
            {yesNo ? (
              (["yes", "no"] as const).map((value) => (
                <button
                  key={value}
                  className={value === "yes" ? "workflow-request-primary" : "workflow-request-secondary"}
                  disabled={!owned || submitting || !onAnswerQuestion}
                  onClick={() =>
                    void submit(() => onAnswerQuestion!(run.id, block.blockId, block.sessionId!, block.pauseId!, value))
                  }
                >
                  {value === "yes" ? "Yes" : "No"}
                </button>
              ))
            ) : (
              <button
                className="workflow-request-primary"
                disabled={!owned || submitting || !answer.trim() || !onAnswerQuestion}
                onClick={() =>
                  void submit(() => onAnswerQuestion!(run.id, block.blockId, block.sessionId!, block.pauseId!, answer))
                }
              >
                <Play size={13} aria-hidden="true" />
                {submitting ? "Resuming…" : "Answer and resume"}
              </button>
            )}
          </div>
        </footer>
      </section>
    );
  if (block.status === "waiting_timer" && compactTimer)
    return (
      <section
        className={`workflow-timer-strip${timerError ? " failed" : ""}`}
        aria-label={`${label} timer pause`}
        aria-busy={submitting}
      >
        <strong className="workflow-timer-label" title={`${label} is waiting for a timer`}>
          Timer · {label}
        </strong>
        {timerError && (
          <span className="workflow-timer-feedback" role="alert" title={timerError}>
            {timerError}
          </span>
        )}
        {block.waitingUntil ? (
          <time
            dateTime={block.waitingUntil}
            title={`Scheduled for ${new Date(block.waitingUntil).toLocaleString()}`}
            aria-label={`Scheduled for ${new Date(block.waitingUntil).toLocaleString()}`}
          >
            Due {new Date(block.waitingUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        ) : (
          <span className="workflow-timer-feedback">Waiting</span>
        )}
        <div className="workflow-timer-actions">
          <button
            type="button"
            aria-label={`Stop timer for ${label}`}
            title="Stop this timer and cancel its workflow run"
            disabled={!identified || submitting || !onCancelPause}
            onClick={() => void submit(() => onCancelPause!(run.id, block.blockId, block.pauseId!))}
          >
            Stop
          </button>
          <button
            type="button"
            aria-label={`Run timer now for ${label}`}
            title="Deliver this timer immediately and resume the workflow"
            disabled={!identified || submitting || !onResumePause}
            onClick={() => void submit(() => onResumePause!(run.id, block.blockId, block.pauseId!))}
          >
            Run now
          </button>
        </div>
      </section>
    );
  if (block.status === "waiting_timer")
    return (
      <section className="harness-pause" aria-label={`${label} timer pause`}>
        <strong>{label} is waiting for a timer</strong>
        {block.waitingUntil && <span>Scheduled for {new Date(block.waitingUntil).toLocaleString()}</span>}
        <div>
          <button
            className="allow"
            disabled={!identified || submitting || !onResumePause}
            onClick={() => void submit(() => onResumePause!(run.id, block.blockId, block.pauseId!))}
          >
            Resume now
          </button>
          {cancel}
        </div>
      </section>
    );
  if (block.status === "retry_scheduled")
    return (
      <section className="harness-pause" aria-label={`${label} retry pause`}>
        <strong>{label} is waiting to retry</strong>
        {block.error && <WorkflowError message={block.error} />}
        {block.retryAt && <span>Scheduled for {new Date(block.retryAt).toLocaleString()}</span>}
        <div>
          <button
            className="allow"
            disabled={!identified || submitting || !onRetryPause}
            onClick={() => void submit(() => onRetryPause!(run.id, block.blockId, block.pauseId!))}
          >
            Retry now
          </button>
          {cancel}
        </div>
      </section>
    );
  return null;
}
