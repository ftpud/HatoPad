// Public entry point; domain modules preserve the protocol package API.
export { compatibleCoreTags } from "./core-releases.js";
export { applyLegacyEnvironment, applyLegacyEnvironmentWithWarning } from "./legacy-env.js";
export { protocolCompatibility, serverProtocolVersion } from "./protocol-versions.js";
export type {
  AiAuthentication,
  AiAuthMethod,
  AiAuthInput,
  AiProviderInstallation,
  AiProviderOrigin,
  AiProtocolVersion,
  AiCredentialSource,
  AiContextCategory,
  AiContextEntry,
  AiContextSection,
  AiContextSnapshot,
  AiAgent,
  AiAgentPreset,
  AiCommand,
  AiConfiguration,
  AiContentBlock,
  AiFailure,
  AiFailureKind,
  AiMessage,
  AiModel,
  AiMcpServer,
  AiOption,
  AiPermissionRequest,
  AiQuestionAction,
  AiQuestionAnswer,
  AiQuestionChoice,
  AiQuestionField,
  AiQuestionRequest,
  AiProvider,
  AiProviderCapabilities,
  AiProviderDescriptor,
  AiSession,
  AiSettingsLayout,
  AiSettingsSection,
  AiStatus,
  AiTaskSummary,
  AiTokenUsage,
  AiUsage,
} from "@hatopad/acp";
export { isServerEvent, serverEventTypes } from "./server-events.js";
export * from "./operations/index.js";
export * from "./types/storage.js";
export * from "./types/filesystem.js";
export * from "./types/workspace.js";
export * from "./types/transport.js";
export * from "./types/git.js";
export * from "./types/terminal.js";
export * from "./types/supervision.js";
export * from "./types/configuration.js";
export * from "./types/events.js";
export * from "./types/workflow.js";
export * from "./types/automation.js";
export * from "./types/http.js";
export * from "./types/java.js";
export * from "./types/language.js";
export * from "./request-registry.js";

export type {
  McpSelection,
  McpAction,
  McpConnection,
  McpLibraryServer,
  McpServerInput,
  McpOAuthConfiguration,
} from "./types/mcp.js";
