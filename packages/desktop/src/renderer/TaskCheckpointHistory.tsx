import { Check, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import type { TaskCheckpoint, TaskCheckpointFile } from "@hatopad/protocol";

export function TaskCheckpointHistory({
  checkpoints,
  onOpen,
  onReview,
  onRestore,
  onFollowUp,
  onClose,
}: {
  checkpoints: TaskCheckpoint[];
  onOpen(checkpoint: TaskCheckpoint, file: TaskCheckpointFile): void;
  onReview(checkpoint: TaskCheckpoint, file: TaskCheckpointFile): void;
  onRestore(checkpoint: TaskCheckpoint): void;
  onFollowUp(checkpoint: TaskCheckpoint): void;
  onClose?(): void;
}) {
  const [expanded, setExpanded] = useState<string>();
  return (
    <section className="task-checkpoint-history stacked-panel" aria-label="Prompt change history">
      <header>
        <strong>Prompt History</strong>
        <span>
          <small>{checkpoints.length} recorded</small>
          {onClose && (
            <button title="Close Prompt History" onClick={onClose}>
              <X size={14} />
            </button>
          )}
        </span>
      </header>
      {checkpoints.length === 0 ? (
        <div className="git-empty">Prompt checkpoints appear after an agent turn starts.</div>
      ) : (
        checkpoints.map((checkpoint) => (
          <section key={checkpoint.id} className={`task-checkpoint ${checkpoint.status}`}>
            <button
              className="task-checkpoint-prompt"
              onClick={() => setExpanded((current) => (current === checkpoint.id ? undefined : checkpoint.id))}
            >
              {expanded === checkpoint.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>
                <strong>{checkpoint.prompt || "Prompt"}</strong>
                <small>
                  {checkpoint.provider} · {new Date(checkpoint.startedAt).toLocaleString()} · {checkpoint.status}
                </small>
              </span>
              <em>{checkpoint.files.length}</em>
            </button>
            {expanded === checkpoint.id && (
              <div className="task-checkpoint-files">
                <CheckpointHandoff checkpoint={checkpoint} />
                {checkpoint.files.length === 0 ? (
                  <small>No filesystem changes recorded</small>
                ) : (
                  checkpoint.files.map((file) => (
                    <div key={`${file.originalPath ?? ""}:${file.path}`}>
                      <button onClick={() => onOpen(checkpoint, file)}>
                        <code>{file.status}</code>
                        <span>{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</span>
                        {file.binary && <small>binary</small>}
                      </button>
                      <button disabled={checkpoint.status === "running"} onClick={() => onReview(checkpoint, file)}>
                        <Check size={12} />
                        Accept file
                      </button>
                    </div>
                  ))
                )}
                <button
                  className="task-checkpoint-restore"
                  disabled={checkpoint.status === "running"}
                  onClick={() => onRestore(checkpoint)}
                >
                  <RefreshCw size={12} />
                  Restore checkpoint changes
                </button>
                <button disabled={checkpoint.status === "running"} onClick={() => onFollowUp(checkpoint)}>
                  Follow up
                </button>
              </div>
            )}
          </section>
        ))
      )}
    </section>
  );
}

export function CheckpointHandoff({ checkpoint }: { checkpoint: TaskCheckpoint }) {
  const provenance = checkpoint.provenance;
  if (!provenance) return null;
  const attachments = provenance.attachments?.map((item) => item.name).join(", ");
  return (
    <aside className="task-checkpoint-handoff" aria-label="Prompt handoff summary">
      <strong>Handoff</strong>
      <small>
        {[
          provenance.model && `Model: ${provenance.model}${provenance.reasoning ? ` (${provenance.reasoning})` : ""}`,
          provenance.agent && `Agent: ${provenance.agent.name}`,
          attachments && `Attachments: ${attachments}`,
          provenance.usage && `Usage: ${provenance.usage.total.toLocaleString()} tokens`,
          provenance.commit && `Commit: ${provenance.commit.slice(0, 12)}`,
        ]
          .filter(Boolean)
          .join(" · ") || "No additional turn metadata"}
      </small>
    </aside>
  );
}
