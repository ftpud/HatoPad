import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { GitService } from "../git.js";
import { summarizeAiSessions } from "../ai/summary.js";
import { withAppTools } from "../app-tools.js";
import { pageMessages } from "../ai/message-page.js";
import {
  boundPermission,
  boundQuestion,
  limitSessionMessages,
  pageSessions,
  sessionListLimits,
} from "../ai/session-bounds.js";
import { permissionTargetWorkspace, assertSessionChangeAllowed } from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleAiRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, acp, aiTimers, rootWorkspace, bridgeWorkspace, workspacePath } = context;
  switch (request.type) {
    case "ai.skills":
      return {
        session: await acp
          .get(request.payload.provider)
          .setSkills(workspacePath, request.payload.ids, request.payload.sessionId, request.payload.agentPreset),
      };
    case "ai.providers":
      return { providers: await acp.available() };
    case "ai.installations.list":
      return { installations: await acp.installations(request.payload.checkLatest === true) };
    case "ai.installations.install":
      return { installation: await acp.get(request.payload.provider).install() };
    case "ai.installations.uninstall":
      return { installation: await acp.get(request.payload.provider).uninstall() };
    case "ai.installations.setProtocol": {
      if (request.payload.protocol !== "v1" && request.payload.protocol !== "v2")
        throw new CoreError("INVALID_REQUEST", "Protocol must be v1 or v2");
      return { installation: await acp.get(request.payload.provider).setProtocol(request.payload.protocol) };
    }
    case "ai.installations.setCredentials": {
      if (request.payload.credentials !== "environment" && request.payload.credentials !== "login")
        throw new CoreError("INVALID_REQUEST", "Credentials must be environment or login");
      return { installation: await acp.get(request.payload.provider).setCredentials(request.payload.credentials) };
    }
    case "ai.get": {
      if (request.payload.summary !== undefined && typeof request.payload.summary !== "boolean")
        throw new CoreError("INVALID_REQUEST", "summary must be a boolean");
      const tail = request.payload.tail;
      if (
        tail !== undefined &&
        (typeof tail !== "number" ||
          !Number.isSafeInteger(tail) ||
          tail < 1 ||
          tail > sessionListLimits.maxResponseMessages)
      )
        throw new CoreError(
          "INVALID_REQUEST",
          `tail must be an integer from 1 to ${sessionListLimits.maxResponseMessages}`,
        );
      const session = await acp.get(request.payload.provider).get(workspacePath);
      return {
        session:
          request.payload.summary === true
            ? limitSessionMessages(session, 0)
            : tail !== undefined
              ? limitSessionMessages(session, tail)
              : session,
      };
    }
    case "ai.messages": {
      const session = await acp.get(request.payload.provider).get(workspacePath);
      return {
        ...(session.id ? { sessionId: session.id } : {}),
        status: session.status,
        ...(session.pendingPermission ? { pendingPermission: boundPermission(session.pendingPermission) } : {}),
        ...(session.pendingQuestion ? { pendingQuestion: boundQuestion(session.pendingQuestion) } : {}),
        ...pageMessages(session, request.payload),
      };
    }
    case "ai.auth.get":
      return {
        authentication: await acp.get(request.payload.provider).authentication(workspacePath, request.payload.discover),
      };
    case "ai.auth.start":
      return {
        authentication: await acp.get(request.payload.provider).authenticate(workspacePath, request.payload.methodId),
      };
    case "ai.auth.input":
      return {
        authentication: await acp.get(request.payload.provider).authenticationInput(workspacePath, request.payload),
      };
    case "ai.models":
      return { models: await acp.get(request.payload.provider).models() };
    case "ai.configureNext": {
      const configuration = request.payload.configuration;
      if (
        !configuration ||
        typeof configuration !== "object" ||
        Array.isArray(configuration) ||
        Object.keys(configuration).some((key) => !["model", "reasoning"].includes(key)) ||
        Object.values(configuration).some((value) => typeof value !== "string" || value.length > 200)
      )
        throw new CoreError("INVALID_REQUEST", "Choose valid next-turn model and reasoning values");
      const provider = acp.get(request.payload.provider);
      if (!Object.keys(configuration).length)
        return { session: await provider.configureNext(workspacePath, configuration) };
      const session = await provider.get(workspacePath);
      const models = await provider.models();
      const selected = models.find((model) => model.id === (configuration.model ?? session.model));
      if (configuration.model !== undefined && (!configuration.model || !selected || selected.available === false))
        throw new CoreError("INVALID_REQUEST", "Choose an available model");
      if (
        configuration.reasoning !== undefined &&
        configuration.reasoning !== "" &&
        selected &&
        !selected.reasoningLevels.includes(configuration.reasoning)
      )
        throw new CoreError("INVALID_REQUEST", "Choose a supported reasoning level");
      return { session: await provider.configureNext(workspacePath, configuration) };
    }
    case "ai.configure":
      return {
        session: await acp.get(request.payload.provider).configure(workspacePath, {
          ...request.payload.configuration,
          ...(request.payload.model ? { model: request.payload.model } : {}),
          ...(request.payload.reasoning ? { reasoning: request.payload.reasoning } : {}),
        }),
      };
    case "ai.send": {
      const appTools = withAppTools(
        rootWorkspace,
        workspacePath,
        request.payload.mcpServers,
        request.payload.agent,
        request.payload.provider,
        bridgeWorkspace,
      );
      return {
        session: await acp.get(request.payload.provider).send(workspacePath, {
          prompt: request.payload.prompt,
          content: request.payload.content,
          configuration: {
            ...request.payload.configuration,
            ...(request.payload.model ? { model: request.payload.model } : {}),
            ...(request.payload.reasoning ? { reasoning: request.payload.reasoning } : {}),
          },
          mcpServers: appTools.servers,
          agent: appTools.agent,
          agentPreset: request.payload.agentPreset,
        }),
      };
    }
    case "ai.permission.resolve": {
      // Permission cards can remain mounted while the user changes tasks. A target supplied by the
      // renderer must therefore win over this connection's selected workspace, which may already
      // point somewhere else by the time the click reaches the server.
      const targetWorkspace = request.payload.target
        ? await permissionTargetWorkspace(tasks, rootWorkspace, request.payload.target.taskId)
        : workspacePath;
      const provider = acp.get(request.payload.provider);
      const session = await provider.get(targetWorkspace);
      if (request.payload.target?.sessionId && session.id !== request.payload.target.sessionId)
        throw new CoreError("INVALID_REQUEST", "Permission request belongs to a different conversation");
      if (session.pendingPermission?.id !== request.payload.requestId)
        throw new CoreError("INVALID_REQUEST", "Permission request is no longer pending");
      return {
        session: await provider.resolvePermission(targetWorkspace, request.payload.requestId, request.payload.optionId),
      };
    }
    case "ai.question.answer": {
      // Like permission cards, a question card names the task and conversation it belongs to.
      const targetWorkspace = request.payload.target
        ? await permissionTargetWorkspace(tasks, rootWorkspace, request.payload.target.taskId)
        : workspacePath;
      const provider = acp.get(request.payload.provider);
      const session = await provider.get(targetWorkspace);
      if (request.payload.target?.sessionId && session.id !== request.payload.target.sessionId)
        throw new CoreError("INVALID_REQUEST", "Question belongs to a different conversation");
      return {
        session: await provider.answerQuestion(
          targetWorkspace,
          request.payload.requestId,
          request.payload.action,
          request.payload.answer,
        ),
      };
    }
    case "ai.interrupt": {
      const provider = acp.get(request.payload.provider);
      await aiTimers.cancelProvider(workspacePath, provider.descriptor.id);
      try {
        return { session: await provider.interrupt(workspacePath) };
      } finally {
        await aiTimers.cancelProvider(workspacePath, provider.descriptor.id);
      }
    }
    case "ai.steer":
      return { session: await acp.get(request.payload.provider).steer(workspacePath, request.payload.prompt) };
    case "ai.clear": {
      const provider = acp.get(request.payload.provider);
      await assertSessionChangeAllowed(aiTimers, workspacePath, provider.descriptor.id);
      return { session: await provider.clear(workspacePath) };
    }
    case "ai.sessions":
      return pageSessions(await acp.get(request.payload.provider).sessions(workspacePath), request.payload);
    case "ai.restore": {
      const provider = acp.get(request.payload.provider);
      await assertSessionChangeAllowed(aiTimers, workspacePath, provider.descriptor.id);
      return { session: await provider.restore(workspacePath, request.payload.sessionId) };
    }
    case "ai.remove": {
      const provider = acp.get(request.payload.provider);
      await assertSessionChangeAllowed(aiTimers, workspacePath, provider.descriptor.id);
      return { session: await provider.remove(workspacePath, request.payload.sessionId) };
    }
    case "ai.usage":
      return { usage: await acp.get(request.payload.provider).usage(workspacePath) };
    case "ai.statuses": {
      const registry = await tasks.list();
      const summarize = async (target: string) => {
        const summary = summarizeAiSessions(await Promise.all(acp.list().map((item) => acp.get(item.id).get(target))));
        const timer = await aiTimers.next(target);
        return {
          ...summary,
          ...(timer
            ? {
                ...(summary.status !== "in_progress" && summary.status !== "user_prompt"
                  ? { status: "waiting" as const }
                  : {}),
                waitingUntil: timer.dueAt,
              }
            : {}),
          ...(await new GitService(target).diffStats()),
        };
      };
      const entries = await Promise.all(
        registry.tasks.map(async (task) => [task.id, await summarize(tasks.taskPath(task.id))] as const),
      );
      return { root: await summarize(rootWorkspace), tasks: Object.fromEntries(entries) };
    }
  }
}
