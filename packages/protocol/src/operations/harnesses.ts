import type {
  HarnessDefinition,
  HarnessStateDiagnostic,
  HarnessValidationIssue,
  HarnessRun,
  HarnessBlock,
  HarnessBlockStatus,
  HarnessBlockDetail,
  HarnessProgress,
  HarnessTaskTarget,
  HarnessAppState,
  HarnessChatSettings,
} from "../types/workflow.js";
import type { AiStatus, AiMessage, AiProvider } from "@hatopad/acp";
import type { TerminalSessionSnapshot } from "../types/terminal.js";

export type HarnessesOperations = {
  "harnesses.templates": {
    payload: Record<string, never>;
    result: { templates: { id: string; name: string; description: string; blocks: number }[] };
  };
  "harnesses.list": {
    payload: Record<string, never>;
    result: { harnesses: HarnessDefinition[]; diagnostics: HarnessStateDiagnostic[] };
  };
  "harnesses.read": { payload: { id: string }; result: { harness: HarnessDefinition } };
  "harnesses.create": {
    payload: { name: string; template?: "five-minute-check-in" | "git-review-commit" };
    result: { harness: HarnessDefinition };
  };
  "harnesses.update": { payload: { harness: HarnessDefinition }; result: { harness: HarnessDefinition } };
  "harnesses.delete": { payload: { id: string }; result: Record<string, never> };
  "harnesses.validate": {
    payload: { harness: HarnessDefinition };
    result: { valid: boolean; issues: HarnessValidationIssue[]; order: string[] };
  };
  "harnesses.runs": {
    payload: { harnessId?: string; runId?: string; summary?: boolean };
    result: { runs: HarnessRun[] };
  };
  /** Bounded, read-only progress for one run: per-block status and the newest `logLimit` (1..100, default 20) log entries, each message clipped to 500 characters. Never returns definitions, chat transcripts or outputs. */
  "harnesses.messages": {
    payload: { runId: string; blockId: string; before?: string; limit?: number; maxTextLength?: number };
    result: {
      available: boolean;
      sessionId?: string;
      status: AiStatus;
      messages: AiMessage[];
      clipped: string[];
      nextBefore?: string;
    };
  };
  "harnesses.output": {
    payload: { runId: string; blockId: string; offset?: number; maxChars?: number };
    result: {
      blockId: string;
      title: string;
      type: HarnessBlock["type"];
      status: HarnessBlockStatus;
      content: string;
      totalChars: number;
      nextOffset?: number;
    };
  };
  "harnesses.invoke": {
    payload: { runId: string; callerBlockId: string; targetBlockId: string; input: string };
    result: { output: string };
  };
  "harnesses.blockDetail": {
    payload: { runId: string; blockId: string; outputChars?: number; chatLimit?: number; chatBefore?: string };
    result: { block: HarnessBlockDetail };
  };
  "harnesses.progress": { payload: { runId: string; logLimit?: number }; result: { run: HarnessProgress } };
  "harnesses.runs.delete": { payload: { runId: string }; result: Record<string, never> };
  "harnesses.test": {
    payload: {
      definition: HarnessDefinition;
      blockId: string;
      input: string;
      provider?: AiProvider;
      target?: HarnessTaskTarget;
    };
    result: { run: HarnessRun };
  };
  "harnesses.app.read": {
    payload: { harnessId: string; blockId: string; runId?: string };
    result: { app: HarnessAppState };
  };
  "harnesses.app.terminal": {
    payload: { harnessId: string; blockId: string; runId?: string };
    result: TerminalSessionSnapshot;
  };
  "harnesses.autopilot": {
    payload: { runId: string; blockId: string; sessionId: string; enabled: boolean };
    result: { run: HarnessRun };
  };
  "harnesses.steer": {
    payload: { runId: string; blockId: string; sessionId: string; input: string };
    result: { run: HarnessRun };
  };
  "harnesses.app.kill": {
    payload: { harnessId: string; blockId: string; runId?: string };
    result: Record<string, never>;
  };
  "harnesses.run": {
    payload: {
      harnessId: string;
      input: string;
      startBlockId?: string;
      rerunRunId?: string;
      provider?: AiProvider;
      target?: HarnessTaskTarget;
    };
    result: { run: HarnessRun };
  };
  "harnesses.chat": {
    payload: {
      harnessId: string;
      blockId: string;
      input: string;
      runId?: string;
      provider?: AiProvider;
      settings?: HarnessChatSettings;
      target?: HarnessTaskTarget;
    };
    result: { run: HarnessRun };
  };
  "harnesses.append": { payload: { runId: string; input: string }; result: { run: HarnessRun } };
  "harnesses.permission.resolve": {
    payload: {
      runId: string;
      blockId: string;
      sessionId: string;
      pauseId: string;
      requestId: string;
      optionId?: string;
    };
    result: { run: HarnessRun };
  };
  "harnesses.answer": {
    payload: { runId: string; blockId: string; sessionId: string; pauseId: string; input: string };
    result: { run: HarnessRun };
  };
  "harnesses.pause.resume": {
    payload: { runId: string; blockId: string; pauseId: string };
    result: { run: HarnessRun };
  };
  "harnesses.pause.retry": {
    payload: { runId: string; blockId: string; pauseId: string };
    result: { run: HarnessRun };
  };
  "harnesses.pause.cancel": {
    payload: { runId: string; blockId: string; pauseId: string };
    result: { run: HarnessRun };
  };
  "harnesses.control.pause": { payload: { runId: string; paused: boolean }; result: { run: HarnessRun } };
  "harnesses.control.retryFailed": { payload: { runId: string }; result: { run: HarnessRun } };
  "harnesses.cancel": { payload: { runId: string }; result: { run: HarnessRun } };
};
