import { useCallback, useRef } from "react";
import { mergeWorkflowHistory } from "./workflow-context";
import { CoreClient } from "./client";
import {
  type HarnessRun,
  type HarnessDefinition,
  type HarnessStateDiagnostic,
  type AiProvider,
} from "@hatopad/protocol";

export interface HarnessActionsDeps {
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  setHarnesses: React.Dispatch<React.SetStateAction<HarnessDefinition[]>>;
  setHarnessDiagnostics: React.Dispatch<React.SetStateAction<HarnessStateDiagnostic[]>>;
  setHarnessesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  harnessRunsRef: React.MutableRefObject<HarnessRun[]>;
  setHarnessRuns: React.Dispatch<React.SetStateAction<HarnessRun[]>>;
  setHarnessRunsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  aiProviderRef: React.MutableRefObject<string>;
  selectedTaskIdRef: React.MutableRefObject<string | undefined>;
}

/** Moved from App; statement bodies are unchanged. */
export function useHarnessActions(deps: HarnessActionsDeps) {
  const {
    clientRef,
    setHarnesses,
    setHarnessDiagnostics,
    setHarnessesLoading,
    harnessRunsRef,
    setHarnessRuns,
    setHarnessRunsLoading,
    aiProviderRef,
    selectedTaskIdRef,
  } = deps;
  const refreshHarnesses = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const rootId = client.getRoot();
    const current = () =>
      canApply() && clientRef.current === client && client.isConnected() && client.getRoot() === rootId;
    try {
      const result = await client.request("harnesses.list", {});
      if (current()) {
        setHarnesses(result.harnesses);
        setHarnessDiagnostics(result.diagnostics);
      }
    } finally {
      if (current()) setHarnessesLoading(false);
    }
  }, []);
  const refreshHarnessRuns = useCallback(async (client = clientRef.current, canApply: () => boolean = () => true) => {
    if (!client) return;
    const rootId = client.getRoot();
    const baseline = harnessRunsRef.current;
    const current = () =>
      canApply() && clientRef.current === client && client.isConnected() && client.getRoot() === rootId;
    try {
      const { runs } = await client.request("harnesses.runs", { summary: true });
      if (current()) setHarnessRuns((existing) => mergeWorkflowHistory(existing, runs, baseline));
    } finally {
      if (current()) setHarnessRunsLoading(false);
    }
  }, []);
  const pendingHarnessDetails = useRef(new Map<string, { client: CoreClient; promise: Promise<HarnessRun> }>());
  const readHarnessRun = useCallback((runId: string): Promise<HarnessRun> => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error("Backend is disconnected"));
    const rootId = client.getRoot();
    const key = `${rootId}:${runId}`;
    const pending = pendingHarnessDetails.current.get(key);
    if (pending?.client === client) return pending.promise;
    const baseline = harnessRunsRef.current.find((run) => run.id === runId);
    const promise = client
      .request("harnesses.runs", { runId })
      .then(({ runs }) => {
        if (clientRef.current !== client || client.getRoot() !== rootId)
          throw new Error("Workspace changed while loading run details");
        const run = runs[0];
        if (!run) throw new Error("Workflow run is no longer available");
        setHarnessRuns((current) => {
          const existing = current.find((item) => item.id === runId);
          if (existing && existing !== baseline && !existing.summary) return current;
          return [run, ...current.filter((item) => item.id !== runId)];
        });
        return run;
      })
      .finally(() => {
        if (pendingHarnessDetails.current.get(key)?.promise === promise) pendingHarnessDetails.current.delete(key);
      });
    pendingHarnessDetails.current.set(key, { client, promise });
    return promise;
  }, []);
  const createHarness = useCallback(async (name: string, template?: "five-minute-check-in" | "git-review-commit") => {
    const result = await clientRef.current!.request("harnesses.create", { name, template });
    setHarnesses((current) => [result.harness, ...current]);
    return result.harness;
  }, []);
  const readHarness = useCallback(async (id: string) => {
    return (await clientRef.current!.request("harnesses.read", { id })).harness;
  }, []);
  const saveHarness = useCallback(async (harness: HarnessDefinition) => {
    const result = await clientRef.current!.request("harnesses.update", { harness });
    setHarnesses((current) => current.map((item) => (item.id === result.harness.id ? result.harness : item)));
    return result.harness;
  }, []);
  const deleteHarness = useCallback(async (id: string) => {
    await clientRef.current!.request("harnesses.delete", { id });
    setHarnesses((current) => current.filter((item) => item.id !== id));
  }, []);
  const testHarnessBlock = useCallback(async (definition: HarnessDefinition, blockId: string, input: string) => {
    const { run } = await clientRef.current!.request("harnesses.test", {
      definition,
      blockId,
      input,
      provider: aiProviderRef.current,
      target: { taskId: selectedTaskIdRef.current },
    });
    setHarnessRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    return run;
  }, []);
  const readHarnessApp = useCallback(
    async (harnessId: string, blockId: string, runId?: string) =>
      (await clientRef.current!.request("harnesses.app.read", { harnessId, blockId, runId })).app,
    [],
  );
  const killHarnessApp = useCallback(async (harnessId: string, blockId: string, runId?: string) => {
    await clientRef.current!.request("harnesses.app.kill", { harnessId, blockId, runId });
  }, []);
  const runHarness = useCallback(
    async (harnessId: string, input: string, startBlockId?: string, rerunRunId?: string) => {
      const result = await clientRef.current!.request("harnesses.run", {
        harnessId,
        input,
        startBlockId,
        rerunRunId,
        provider: aiProviderRef.current,
        target: { taskId: selectedTaskIdRef.current },
      });
      setHarnessRuns((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)]);
      return result.run;
    },
    [],
  );
  const chatHarness = useCallback(
    async (
      harnessId: string,
      blockId: string,
      input: string,
      runId?: string,
      settings?: import("@hatopad/protocol").HarnessChatSettings,
    ) => {
      const result = await clientRef.current!.request("harnesses.chat", {
        harnessId,
        blockId,
        input,
        runId,
        settings,
        provider: aiProviderRef.current,
        target: { taskId: selectedTaskIdRef.current },
      });
      setHarnessRuns((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)]);
      return result.run;
    },
    [],
  );
  const steerHarnessChat = useCallback(async (runId: string, blockId: string, sessionId: string, input: string) => {
    const { run } = await clientRef.current!.request("harnesses.steer", { runId, blockId, sessionId, input });
    setHarnessRuns((current) => current.map((item) => (item.id === runId ? run : item)));
    return run;
  }, []);
  const setHarnessAutopilot = useCallback(
    async (runId: string, blockId: string, sessionId: string, enabled: boolean) => {
      const { run } = await clientRef.current!.request("harnesses.autopilot", { runId, blockId, sessionId, enabled });
      setHarnessRuns((current) => current.map((item) => (item.id === runId ? run : item)));
      return run;
    },
    [],
  );
  const appendHarnessRun = useCallback(async (runId: string, input: string) => {
    const result = await clientRef.current!.request("harnesses.append", { runId, input });
    setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
    return result.run;
  }, []);
  const resolveHarnessPermission = useCallback(
    async (
      runId: string,
      blockId: string,
      sessionId: string,
      pauseId: string,
      requestId: string,
      optionId?: string,
    ) => {
      const result = await clientRef.current!.request("harnesses.permission.resolve", {
        runId,
        blockId,
        sessionId,
        pauseId,
        requestId,
        optionId,
      });
      setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
      return result.run;
    },
    [],
  );
  const answerHarnessQuestion = useCallback(
    async (runId: string, blockId: string, sessionId: string, pauseId: string, input: string) => {
      const result = await clientRef.current!.request("harnesses.answer", {
        runId,
        blockId,
        sessionId,
        pauseId,
        input,
      });
      setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
      return result.run;
    },
    [],
  );
  const resumeHarnessPause = useCallback(async (runId: string, blockId: string, pauseId: string) => {
    const result = await clientRef.current!.request("harnesses.pause.resume", { runId, blockId, pauseId });
    setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
    return result.run;
  }, []);
  const retryHarnessPause = useCallback(async (runId: string, blockId: string, pauseId: string) => {
    const result = await clientRef.current!.request("harnesses.pause.retry", { runId, blockId, pauseId });
    setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
    return result.run;
  }, []);
  const cancelHarnessPause = useCallback(async (runId: string, blockId: string, pauseId: string) => {
    const result = await clientRef.current!.request("harnesses.pause.cancel", { runId, blockId, pauseId });
    setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
    return result.run;
  }, []);
  const cancelHarnessRun = useCallback(async (runId: string) => {
    const result = await clientRef.current!.request("harnesses.cancel", { runId });
    setHarnessRuns((current) => current.map((item) => (item.id === runId ? result.run : item)));
  }, []);
  const deleteHarnessRun = useCallback(async (runId: string) => {
    await clientRef.current!.request("harnesses.runs.delete", { runId });
    setHarnessRuns((current) => current.filter((item) => item.id !== runId));
  }, []);
  const loadHarnessModels = useCallback(
    async (provider: AiProvider) => (await clientRef.current!.request("ai.models", { provider })).models,
    [],
  );
  const validateHarnessDefinition = useCallback(
    async (harness: HarnessDefinition) => clientRef.current!.request("harnesses.validate", { harness }),
    [],
  );
  return {
    refreshHarnesses,
    refreshHarnessRuns,
    pendingHarnessDetails,
    readHarnessRun,
    createHarness,
    readHarness,
    saveHarness,
    deleteHarness,
    testHarnessBlock,
    readHarnessApp,
    killHarnessApp,
    runHarness,
    chatHarness,
    steerHarnessChat,
    setHarnessAutopilot,
    appendHarnessRun,
    resolveHarnessPermission,
    answerHarnessQuestion,
    resumeHarnessPause,
    retryHarnessPause,
    cancelHarnessPause,
    cancelHarnessRun,
    deleteHarnessRun,
    loadHarnessModels,
    validateHarnessDefinition,
  };
}
