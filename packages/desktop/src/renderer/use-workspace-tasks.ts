import { useRef, useState } from "react";
import type { WorkspaceTask } from "@hatopad/protocol";

/** Owns the WorkspaceTasks state for the workspace shell. */
export function useWorkspaceTasks() {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [taskFilter, setTaskFilter] = useState("");
  const [taskLifecycleFilter, setTaskLifecycleFilter] = useState<"active" | "finished" | "archived" | "all">("active");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const activeTaskRef = useRef<WorkspaceTask>();
  const selectedTaskIdRef = useRef<string>();
  const [taskSwitching, setTaskSwitching] = useState(false);
  const taskSwitchSequence = useRef(0);
  const taskSwitchActive = useRef(false);
  const queuedTaskSwitch = useRef<string | undefined | null>(null);
  const switchTaskRef = useRef<(taskId?: string) => Promise<void>>(async () => undefined);
  return {
    tasks,
    setTasks,
    taskFilter,
    setTaskFilter,
    taskLifecycleFilter,
    setTaskLifecycleFilter,
    selectedTaskId,
    setSelectedTaskId,
    activeTaskRef,
    selectedTaskIdRef,
    taskSwitching,
    setTaskSwitching,
    taskSwitchSequence,
    taskSwitchActive,
    queuedTaskSwitch,
    switchTaskRef
  };
}
