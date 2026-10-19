import type {
  AiProviderDescriptor,
  AiProviderInstallation,
  AiProvider,
  AiProtocolVersion,
  AiCredentialSource,
  AiSession,
  AiAuthentication,
  AiAuthInput,
  AiModel,
  AiConfiguration,
  AiAgentPreset,
  AiContentBlock,
  AiMcpServer,
  AiAgent,
  AiQuestionAction,
  AiQuestionAnswer,
  AiUsage,
  AiStatus,
  AiPermissionRequest,
  AiQuestionRequest,
  AiMessage,
  AiTaskSummary,
} from "@hatopad/acp";

export type AiOperations = {
  /** Installed providers only; see `ai.installations.list` for every known provider. */
  "ai.providers": { payload: Record<string, never>; result: { providers: AiProviderDescriptor[] } };
  "ai.installations.list": { payload: { checkLatest?: boolean }; result: { installations: AiProviderInstallation[] } };
  /** Installs or updates to the latest version. Returns at once; poll `ai.installations.list` for completion. */
  "ai.installations.install": { payload: { provider: AiProvider }; result: { installation: AiProviderInstallation } };
  "ai.installations.uninstall": { payload: { provider: AiProvider }; result: { installation: AiProviderInstallation } };
  /** Selects ACP v1 or the experimental v2 for the provider's new connections; idle agents reconnect. */
  "ai.installations.setProtocol": {
    payload: { provider: AiProvider; protocol: AiProtocolVersion };
    result: { installation: AiProviderInstallation };
  };
  /** Chooses whether the agent gets the Core host's API-key variables or uses its own sign-in; idle agents restart. */
  "ai.installations.setCredentials": {
    payload: { provider: AiProvider; credentials: AiCredentialSource };
    result: { installation: AiProviderInstallation };
  };
  "ai.get": {
    /** `summary: true` returns session metadata with `messages: []` (see `ai.messages` for transcripts). */ payload: {
      provider?: AiProvider;
      summary?: boolean;
    };
    result: { session: AiSession };
  };
  "ai.auth.get": {
    payload: { provider?: AiProvider; discover?: boolean };
    result: { authentication: AiAuthentication };
  };
  "ai.auth.start": {
    payload: { provider?: AiProvider; methodId: string };
    result: { authentication: AiAuthentication };
  };
  "ai.auth.input": { payload: { provider?: AiProvider } & AiAuthInput; result: { authentication: AiAuthentication } };
  "ai.models": { payload: { provider?: AiProvider }; result: { models: AiModel[] } };
  "ai.configureNext": {
    payload: { provider?: AiProvider; configuration: { model?: string; reasoning?: string } };
    result: { session: AiSession };
  };
  "ai.configure": {
    payload: { provider?: AiProvider; model?: string; reasoning?: string; configuration?: AiConfiguration };
    result: { session: AiSession };
  };
  "ai.skills": {
    payload: { provider?: AiProvider; ids: string[]; sessionId: string; agentPreset?: AiAgentPreset | null };
    result: { session: AiSession };
  };
  "ai.send": {
    payload: {
      provider?: AiProvider;
      prompt: string;
      content?: AiContentBlock[];
      model?: string;
      reasoning?: string;
      configuration?: AiConfiguration;
      mcpServers?: AiMcpServer[];
      agent?: AiAgent;
      agentPreset?: AiAgentPreset;
    };
    result: { session: AiSession };
  };
  "ai.permission.resolve": {
    payload: {
      provider?: AiProvider;
      requestId: string;
      optionId?: string;
      target?: { taskId?: string; sessionId?: string };
    };
    result: { session: AiSession };
  };
  "ai.question.answer": {
    payload: {
      provider?: AiProvider;
      requestId: string;
      action: AiQuestionAction;
      answer?: AiQuestionAnswer;
      target?: { taskId?: string; sessionId?: string };
    };
    result: { session: AiSession };
  };
  "ai.interrupt": { payload: { provider?: AiProvider }; result: { session: AiSession } };
  "ai.steer": { payload: { provider?: AiProvider; prompt: string }; result: { session: AiSession } };
  "ai.clear": { payload: { provider?: AiProvider }; result: { session: AiSession } };
  "ai.sessions": {
    /** Without options the full legacy list is returned. `summary` drops transcripts; `limit` (1..100, default 30) and `before` (a session id from `nextBefore`) page the list. */ payload: {
      provider?: AiProvider;
      summary?: boolean;
      limit?: number;
      before?: string;
    };
    result: { sessions: AiSession[]; nextBefore?: string };
  };
  "ai.restore": { payload: { provider?: AiProvider; sessionId: string }; result: { session: AiSession } };
  "ai.remove": { payload: { provider?: AiProvider; sessionId: string }; result: { session: AiSession } };
  "ai.usage": { payload: { provider?: AiProvider }; result: { usage: AiUsage } };
  /** Bounded newest-first page of the selected task's conversation. `before` is a message id from `nextBefore`; text is clipped to `maxTextLength` (default 4000, max 20000), clipped message ids are listed in `clipped`, and attached `content` blocks are omitted. */
  "ai.messages": {
    payload: {
      provider?: AiProvider;
      before?: string;
      limit?: number /* 1..100, default 30 */;
      maxTextLength?: number;
    };
    result: {
      sessionId?: string;
      status: AiStatus;
      pendingPermission?: AiPermissionRequest;
      pendingQuestion?: AiQuestionRequest;
      messages: AiMessage[];
      clipped: string[];
      nextBefore?: string;
    };
  };
  "ai.statuses": {
    payload: Record<string, never>;
    result: { root: AiTaskSummary; tasks: Record<string, AiTaskSummary> };
  };
};
