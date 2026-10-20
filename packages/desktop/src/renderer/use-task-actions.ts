import { useCallback } from "react";
import { type WorkspaceTask, type AiTaskSummary } from "@hatopad/protocol";
import { requestText } from "./dialogs";
import { type CoreClient } from "./client";
import { type AiAttachment } from "./AiPanel";
import { type StatusKind } from "./app-shared";

export interface TaskActionsDeps {
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  taskSwitching: boolean;
  setTaskSwitching: React.Dispatch<React.SetStateAction<boolean>>;
  setTasks: React.Dispatch<React.SetStateAction<WorkspaceTask[]>>;
  switchTask: (taskId?: string) => Promise<void>;
  setStatusMessage: (message: string) => void;
  selectedTaskId: string | undefined;
  setSelectedTaskId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setAiAttachments: React.Dispatch<React.SetStateAction<Record<string, AiAttachment[]>>>;
  setAiStatuses: React.Dispatch<React.SetStateAction<{ root: AiTaskSummary; tasks: Record<string, AiTaskSummary> }>>;
  aiStatusesApplied: React.MutableRefObject<number>;
  aiStatusesRequested: React.MutableRefObject<number>;
  refreshAiStatuses: (client?: CoreClient | undefined, canApply?: () => boolean) => Promise<void>;
  setMergeDialog: React.Dispatch<React.SetStateAction<WorkspaceTask | undefined>>;
  showStatus: (message: string, kind: StatusKind) => void;
}

/** Moved from App; statement bodies are unchanged. */
export function useTaskActions(deps: TaskActionsDeps) {
  const {
    clientRef,
    taskSwitching,
    setTaskSwitching,
    setTasks,
    switchTask,
    setStatusMessage,
    selectedTaskId,
    setSelectedTaskId,
    setAiAttachments,
    setAiStatuses,
    aiStatusesApplied,
    aiStatusesRequested,
    refreshAiStatuses,
    setMergeDialog,
    showStatus,
  } = deps;
  const createTask = useCallback(
    async (branch: string, existing?: { remote: boolean }) => {
      if (!clientRef.current || taskSwitching) return;
      try {
        setTaskSwitching(true);
        const result = await clientRef.current.request("tasks.create", {
          branch,
          existing: Boolean(existing),
          remote: existing?.remote,
        });
        setTasks((current) => [...current, result.task]);
        setTaskSwitching(false);
        await switchTask(result.task.id);
      } catch (error) {
        setTaskSwitching(false);
        setStatusMessage(error instanceof Error ? error.message : "Could not create task");
        throw error;
      }
    },
    [switchTask, taskSwitching],
  );

  const deleteTask = useCallback(
    async (task: WorkspaceTask) => {
      if (
        !clientRef.current ||
        taskSwitching ||
        !window.confirm(
          `Delete task "${task.name}"?\n\nIts copied workspace and any uncommitted files inside it will be permanently removed.`,
        )
      )
        return;
      try {
        if (selectedTaskId === task.id) await switchTask();
        setTaskSwitching(true);
        const result = await clientRef.current.request("tasks.delete", { taskId: task.id });
        setTasks(result.tasks);
        setSelectedTaskId(result.selectedTaskId);
        setAiAttachments((current) => {
          const next = { ...current };
          delete next[task.id];
          return next;
        });
        setAiStatuses((current) => {
          aiStatusesApplied.current = aiStatusesRequested.current;
          const nextTasks = { ...current.tasks };
          delete nextTasks[task.id];
          return { ...current, tasks: nextTasks };
        });
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not delete task");
      } finally {
        setTaskSwitching(false);
      }
    },
    [selectedTaskId, switchTask, taskSwitching],
  );

  const setTaskStatus = useCallback(
    async (task: WorkspaceTask, status: WorkspaceTask["status"]) => {
      if (!clientRef.current || taskSwitching) return;
      try {
        const result = await clientRef.current.request("tasks.status", { taskId: task.id, status });
        setTasks((current) => current.map((item) => (item.id === task.id ? result.task : item)));
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : `Could not mark task ${status}`);
      }
    },
    [taskSwitching],
  );

  const renameTask = useCallback(
    async (task: WorkspaceTask) => {
      const name = await requestText({
        title: "Rename task",
        label: "Task name",
        defaultValue: task.name,
        confirmLabel: "Rename",
      });
      if (!clientRef.current || taskSwitching || !name || name === task.name) return;
      try {
        const result = await clientRef.current.request("tasks.rename", { taskId: task.id, name });
        setTasks((current) => current.map((item) => (item.id === task.id ? result.task : item)));
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not rename task");
      }
    },
    [taskSwitching],
  );

  const setTaskArchived = useCallback(
    async (task: WorkspaceTask, archived: boolean) => {
      if (!clientRef.current || taskSwitching) return;
      try {
        const result = await clientRef.current.request("tasks.archive", { taskId: task.id, archived });
        setTasks((current) => current.map((item) => (item.id === task.id ? result.task : item)));
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : `Could not ${archived ? "archive" : "unarchive"} task`,
        );
      }
    },
    [taskSwitching],
  );

  const timerAction = useCallback(
    async (task: WorkspaceTask | undefined, action: "cancel" | "fire") => {
      if (!clientRef.current || taskSwitching) return;
      try {
        const payload = task ? { taskId: task.id } : {};
        const changed =
          action === "cancel"
            ? (await clientRef.current.request("tasks.timer.cancel", payload)).cancelled
            : (await clientRef.current.request("tasks.timer.fire", payload)).fired;
        if (!changed) setStatusMessage(`The ${task ? "task" : "root workspace"} timer is no longer active`);
        await refreshAiStatuses();
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : `Could not ${action} ${task ? "task" : "root workspace"} timer`,
        );
      }
    },
    [refreshAiStatuses, taskSwitching],
  );

  const mergeTask = useCallback(
    async (task: WorkspaceTask, strategy: "merge" | "smart") => {
      if (!clientRef.current || taskSwitching) return;
      setMergeDialog(undefined);
      try {
        setTaskSwitching(true);
        const result = await clientRef.current.request("tasks.merge", { taskId: task.id, strategy });
        setTaskSwitching(false);
        await switchTask();
        showStatus(`Merged ${task.name} into ${result.targetBranch}`, "success");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not merge task");
      } finally {
        setTaskSwitching(false);
      }
    },
    [switchTask, taskSwitching],
  );
  return { createTask, deleteTask, setTaskStatus, renameTask, setTaskArchived, timerAction, mergeTask };
}
