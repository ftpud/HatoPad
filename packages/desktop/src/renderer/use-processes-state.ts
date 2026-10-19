import { useState } from "react";
import type { ManagedWorkflowApp } from "@hatopad/protocol";

export function useProcessesState() {

  const [managedProcessList, setManagedProcessList] = useState<ManagedWorkflowApp[]>([]);

  const [processLoading, setProcessLoading] = useState(false);

  const [processError, setProcessError] = useState("");
  return {
    managedProcessList,
    setManagedProcessList,
    processLoading,
    setProcessLoading,
    processError,
    setProcessError
  };
}
