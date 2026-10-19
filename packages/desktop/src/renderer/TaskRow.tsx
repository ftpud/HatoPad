import { ContextMenu } from "./ContextMenu";
import {
  Archive,
  Check,
  GitMerge,
  LoaderCircle,
  MoreVertical,
  Pencil,
  Play,
  ShieldAlert,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AiStatus, AiTaskSummary } from "@hatopad/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const formatAiStatus = (status: AiStatus) =>
  ({
    idle: "",
    in_progress: "In progress",
    user_prompt: "User prompt",
    waiting: "Waiting",
    done: "Done",
    error: "Error",
  })[status];

export function TaskRow({
  icon,
  name,
  branch,
  summary,
  finished = false,
  archived = false,
  selected,
  disabled,
  onClick,
  onSetFinished,
  onRename,
  onSetArchived,
  onMerge,
  onDelete,
  onCancelTimer,
  onFireTimer,
}: {
  icon: ReactNode;
  name: string;
  branch?: string;
  summary: AiTaskSummary;
  finished?: boolean;
  archived?: boolean;
  selected: boolean;
  disabled: boolean;
  onClick(): void;
  onSetFinished?(): void;
  onRename?(): void;
  onSetArchived?(): void;
  onMerge?(): void;
  onDelete?(): void;
  onCancelTimer?(): void;
  onFireTimer?(): void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (summary.status !== "waiting" || !summary.waitingUntil) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [summary.status, summary.waitingUntil]);
  const waiting =
    summary.status === "waiting" && summary.waitingUntil
      ? `Waiting · ${formatCountdown(new Date(summary.waitingUntil).getTime() - now)}`
      : undefined;
  const hasTimer = Boolean(summary.waitingUntil);
  const hasActions = Boolean(
    onSetFinished || onRename || onSetArchived || onDelete || (hasTimer && (onCancelTimer || onFireTimer)),
  );
  const preview = summary.pendingPermission
    ? "Waiting for permission approval"
    : waiting
      ? `Continuation scheduled in ${formatCountdown(new Date(summary.waitingUntil!).getTime() - now)}`
      : summary.preview || "No AI activity yet";
  const openMenu = (x: number, y: number) =>
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 170)),
    });
  return (
    <div
      className={`task-row ${selected ? "selected" : ""} ${finished ? "finished" : ""} ${archived ? "archived" : ""}`}
      onContextMenu={(event) => {
        if (!hasActions || disabled) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      <button
        className="task-open"
        disabled={disabled}
        title={`${name}${branch && branch !== name ? `\nBranch: ${branch}` : ""}\n${preview}`}
        onClick={onClick}
      >
        <span className="task-icon">{icon}</span>
        <span className="task-content">
          <span className="task-title">
            <strong>{name}</strong>
            {finished && <small className="task-finished-status">Finished</small>}
            {archived && <small className="task-finished-status">Archived</small>}
            {(summary.additions > 0 || summary.deletions > 0) && (
              <span className="task-diff-stat">
                <small>+{summary.additions}</small>
                <small>-{summary.deletions}</small>
              </span>
            )}
            {summary.pendingPermission ? (
              <small className="task-ai-status permission">
                <ShieldAlert size={13} /> Permission needed
              </small>
            ) : (
              summary.status !== "idle" && (
                <small className={`task-ai-status ${summary.status}`}>
                  {summary.status === "in_progress" && <LoaderCircle className="task-progress-spinner" size={13} />}
                  {waiting ?? formatAiStatus(summary.status)}
                </small>
              )
            )}
          </span>
          {branch && branch !== name && <span className="task-branch">{branch}</span>}
          <span className="task-preview">
            <TaskPreviewMarkdown>{preview}</TaskPreviewMarkdown>
          </span>
        </span>
        {selected && <Check className="task-check" size={13} />}
      </button>
      {hasActions && (
        <button
          className="task-actions"
          title={`Actions for ${name}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            openMenu(bounds.right - 180, bounds.bottom + 2);
          }}
        >
          <MoreVertical size={14} />
        </button>
      )}
      {menu && (
        <div className="context-menu-layer" onMouseDown={() => setMenu(undefined)}>
          <ContextMenu
            className="context-menu task-actions-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {onSetFinished && (
              <button
                onClick={() => {
                  setMenu(undefined);
                  onSetFinished();
                }}
              >
                <Check size={14} />
                <span>{finished ? "Restore task" : "Mark as Finished"}</span>
              </button>
            )}
            {onRename && (
              <button
                onClick={() => {
                  setMenu(undefined);
                  onRename();
                }}
              >
                <Pencil size={14} />
                <span>Rename task</span>
              </button>
            )}
            {onSetArchived && (
              <button
                onClick={() => {
                  setMenu(undefined);
                  onSetArchived();
                }}
              >
                <Archive size={14} />
                <span>{archived ? "Unarchive task" : "Archive task"}</span>
              </button>
            )}
            {hasTimer && (
              <button
                onClick={() => {
                  setMenu(undefined);
                  onFireTimer?.();
                }}
              >
                <Play size={14} />
                <span>Run timer now</span>
              </button>
            )}
            {hasTimer && (
              <button
                onClick={() => {
                  setMenu(undefined);
                  onCancelTimer?.();
                }}
              >
                <Square size={14} />
                <span>Cancel timer</span>
              </button>
            )}
            {onMerge && (
              <button
                onClick={() => {
                  setMenu(undefined);
                  onMerge();
                }}
              >
                <GitMerge size={14} />
                <span>Merge to main workspace</span>
              </button>
            )}
            {onDelete && (
              <button
                className="danger"
                onClick={() => {
                  setMenu(undefined);
                  onDelete();
                }}
              >
                <Trash2 size={14} />
                <span>Delete task</span>
              </button>
            )}
          </ContextMenu>
        </div>
      )}
    </div>
  );
}

export function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function TaskPreviewMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: value }) => <span>{value}</span>,
        strong: ({ children: value }) => <em>{value}</em>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
