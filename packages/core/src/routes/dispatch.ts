import { handleMcpRequest } from "./mcp.js";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { TerminalSessionHost } from "../process-manager.js";
import { WorkspaceTaskStore } from "../tasks.js";
import { UsefulFilesStore } from "../useful-files.js";
import { AgentsStore } from "../agents.js";
import { HarnessStore } from "../harnesses.js";
import { WorkflowAppService } from "../workflow-app.js";
import { HarnessRunner } from "../harness-runner.js";
import { RunConfigService } from "../run-configs.js";
import { type AcpRegistry } from "../ai/index.js";
import { ScheduleService } from "../schedules.js";
import { TriggerService } from "../triggers.js";
import { AiTimerService } from "../ai-timers.js";
import { RemoteTransferService } from "../remote-transfer.js";
import { resolveWorkflowBinding, validateWorkflowTarget } from "../request-support.js";
import { handleWorkspaceRequest } from "./workspace.js";
import { handleInventoryRequest } from "./inventory.js";
import { handleTasksRequest } from "./tasks.js";
import { handleSchedulesRequest } from "./schedules.js";
import { handleTriggersRequest } from "./triggers.js";
import { handleProcessesRequest } from "./processes.js";
import { handleTimersRequest } from "./timers.js";
import { handleSkillsRequest } from "./skills.js";
import { handleAiRequest } from "./ai.js";
import { handleToolsRequest } from "./tools.js";
import { handleAttentionRequest } from "./attention.js";
import { handleUsefulRequest } from "./useful.js";
import { handleRunConfigRequest } from "./runConfig.js";
import { handleAgentsRequest } from "./agents.js";
import { handleHarnessesRequest } from "./harnesses.js";
import { handleHttpRequest } from "./http.js";
import { handleFilesystemRequest } from "./filesystem.js";
import { handleTerminalRequest } from "./terminal.js";
import { handleGitRequest } from "./git.js";
import { handleTaskGitRequest } from "./taskGit.js";
import { handleLanguageDomainRequest } from "./language.js";
import { handlePluginsRequest } from "./plugins.js";
import { handleJavaRequest } from "./java.js";
import { createRequestContext, type SessionServices } from "./context.js";

export async function handleRequest(
  services: SessionServices,
  tasks: WorkspaceTaskStore,
  acp: AcpRegistry,
  usefulFiles: UsefulFilesStore,
  agents: AgentsStore,
  harnesses: HarnessStore,
  harnessRunner: HarnessRunner,
  workflowApps: WorkflowAppService,
  terminalHost: TerminalSessionHost,
  runConfigs: RunConfigService,
  aiTimers: AiTimerService,
  schedules: ScheduleService,
  triggers: TriggerService,
  remoteTransfers: RemoteTransferService,
  rootWorkspace: string,
  request: Request,
  bridgeWorkspace = rootWorkspace,
): Promise<unknown> {
  const context = createRequestContext(
    services,
    tasks,
    acp,
    usefulFiles,
    agents,
    harnesses,
    harnessRunner,
    workflowApps,
    terminalHost,
    runConfigs,
    aiTimers,
    schedules,
    triggers,
    remoteTransfers,
    rootWorkspace,
    request,
    bridgeWorkspace,
  );
  const { filesystem, workspacePath } = context;
  if (request.type !== "workspace.open") filesystem.getWorkspace();
  if (request.type === "filesystem.remoteTransferBegin") return remoteTransfers.begin(workspacePath, request.payload);
  if (request.type === "filesystem.remoteTransferCancel")
    return { cancelled: remoteTransfers.cancel(request.payload.token) };
  if (
    [
      "harnesses.autopilot",
      "harnesses.steer",
      "harnesses.append",
      "harnesses.permission.resolve",
      "harnesses.answer",
      "harnesses.pause.resume",
      "harnesses.pause.retry",
    ].includes(request.type)
  ) {
    const { runId } = request.payload as { runId: string };
    const run = await harnessRunner.readRun(runId);
    if (!run) throw new CoreError("FILE_NOT_FOUND", "Workflow run does not exist");
    await resolveWorkflowBinding(run, undefined, { tasks, rootWorkspace, workspacePath });
    for (const block of run.blocks.filter((block) => block.workspace)) {
      await validateWorkflowTarget(run, block.workspace!, { tasks, rootWorkspace, workspacePath });
    }
  }
  switch (request.type) {
    case "workspace.open":
    case "workspace.saveOptions":
      return handleWorkspaceRequest(context, request);
    case "inventory.page":
      return handleInventoryRequest(context, request);
    case "tasks.page":
    case "tasks.read":
    case "tasks.list":
    case "tasks.create":
    case "tasks.createFromPrompt":
    case "tasks.merge":
    case "tasks.timer.cancel":
    case "tasks.timer.fire":
    case "tasks.status":
    case "tasks.rename":
    case "tasks.archive":
    case "tasks.delete":
    case "tasks.switch":
    case "tasks.commitMessage.get":
    case "tasks.commitMessage.set":
    case "tasks.commitMessage.update":
      return handleTasksRequest(context, request);
    case "schedules.agents":
    case "schedules.page":
    case "schedules.read":
    case "schedules.list":
    case "schedules.create":
    case "schedules.update":
    case "schedules.enabled":
    case "schedules.delete":
    case "schedules.fire":
      return handleSchedulesRequest(context, request);
    case "triggers.page":
    case "triggers.read":
    case "triggers.update":
    case "triggers.history":
    case "triggers.list":
    case "triggers.create":
    case "triggers.enabled":
    case "triggers.delete":
    case "triggers.fire":
      return handleTriggersRequest(context, request);
    case "processes.list":
    case "processes.kill":
      return handleProcessesRequest(context, request);
    case "timers.create":
    case "timers.list":
    case "timers.cancel":
    case "timers.fire":
    case "timers.cancelAll":
      return handleTimersRequest(context, request);
    case "mcp.list":
    case "mcp.save":
    case "mcp.delete":
    case "mcp.oauth.start":
    case "mcp.oauth.finish":
    case "mcp.oauth.cancel":
    case "mcp.oauth.disconnect":
    case "mcp.actions":
    case "ai.mcp":
      return handleMcpRequest(context, request);
    case "skills.list":
    case "skills.read":
    case "skills.write":
    case "skills.delete":
    case "skills.policy.moveToLocal":
    case "skills.policy":
      return handleSkillsRequest(context, request);
    case "ai.skills":
    case "ai.providers":
    case "ai.installations.list":
    case "ai.installations.install":
    case "ai.installations.uninstall":
    case "ai.installations.setProtocol":
    case "ai.installations.setCredentials":
    case "ai.get":
    case "ai.messages":
    case "ai.image":
    case "ai.auth.get":
    case "ai.auth.start":
    case "ai.auth.input":
    case "ai.models":
    case "ai.configureNext":
    case "ai.configure":
    case "ai.send":
    case "ai.permission.resolve":
    case "ai.question.answer":
    case "ai.interrupt":
    case "ai.steer":
    case "ai.clear":
    case "ai.sessions":
    case "ai.restore":
    case "ai.remove":
    case "ai.usage":
    case "ai.statuses":
      return handleAiRequest(context, request);
    case "tools.list":
    case "tools.install":
    case "tools.uninstall":
      return handleToolsRequest(context, request);
    case "attention.read":
      return handleAttentionRequest(context, request);
    case "useful.list":
    case "useful.read":
    case "useful.create":
    case "useful.write":
    case "useful.rename":
    case "useful.delete":
      return handleUsefulRequest(context, request);
    case "runConfig.list":
    case "runConfig.create":
    case "runConfig.read":
    case "runConfig.write":
    case "runConfig.rename":
    case "runConfig.delete":
    case "runConfig.run":
    case "runConfig.stop":
    case "runConfig.restart":
    case "runConfig.openTerminal":
      return handleRunConfigRequest(context, request);
    case "agents.list":
    case "agents.read":
    case "agents.create":
    case "agents.write":
    case "agents.rename":
    case "agents.delete":
      return handleAgentsRequest(context, request);
    case "harnesses.templates":
    case "harnesses.list":
    case "harnesses.read":
    case "harnesses.create":
    case "harnesses.update":
    case "harnesses.delete":
    case "harnesses.validate":
    case "harnesses.messages":
    case "harnesses.output":
    case "harnesses.invoke":
    case "harnesses.blockDetail":
    case "harnesses.progress":
    case "harnesses.runs":
    case "harnesses.runs.delete":
    case "harnesses.test":
    case "harnesses.app.terminal":
    case "harnesses.app.read":
    case "harnesses.app.kill":
    case "harnesses.run":
    case "harnesses.chat":
    case "harnesses.autopilot":
    case "harnesses.steer":
    case "harnesses.append":
    case "harnesses.permission.resolve":
    case "harnesses.answer":
    case "harnesses.pause.resume":
    case "harnesses.pause.retry":
    case "harnesses.pause.cancel":
    case "harnesses.control.pause":
    case "harnesses.control.retryFailed":
    case "harnesses.cancel":
      return handleHarnessesRequest(context, request);
    case "http.execute":
      return handleHttpRequest(context, request);
    case "filesystem.listTree":
    case "filesystem.snapshot":
    case "filesystem.listDirectory":
    case "filesystem.readFile":
    case "filesystem.writeFile":
    case "filesystem.createFile":
    case "filesystem.createDirectory":
    case "filesystem.rename":
    case "filesystem.transferPreflight":
    case "filesystem.transferApply":
    case "filesystem.previewDelete":
    case "filesystem.delete":
    case "filesystem.restore":
    case "filesystem.search":
    case "filesystem.replacePreview":
    case "filesystem.replaceApply":
      return handleFilesystemRequest(context, request);
    case "terminal.list":
    case "terminal.create":
    case "terminal.watch.ack":
    case "terminal.watch.detach":
    case "terminal.watch.list":
    case "terminal.watch.attach":
    case "terminal.attach":
    case "terminal.input":
    case "terminal.resize":
    case "terminal.close":
      return handleTerminalRequest(context, request);
    case "git.summary":
    case "git.status":
    case "git.diff":
    case "git.stage":
    case "git.unstage":
    case "git.conflicts":
    case "git.resolveConflict":
    case "git.conflictAction":
    case "git.branches":
    case "git.tags":
    case "git.createTag":
    case "git.deleteTag":
    case "git.checkoutBranch":
    case "git.renameBranch":
    case "git.createBranch":
    case "git.branchDeletePreview":
    case "git.deleteBranch":
    case "git.publishBranch":
    case "git.setBranchUpstream":
    case "git.log":
    case "git.mergePreview":
    case "git.merge":
    case "git.commitFiles":
    case "git.commitMessage":
    case "git.commitDiff":
    case "git.cherryPick":
    case "git.saveCommitResults":
    case "git.saveCommitWorktreeResults":
    case "git.commitPatch":
    case "git.applyCommitHunks":
    case "git.fileHistory":
    case "git.ignore":
    case "git.compareFiles":
    case "git.compareDiff":
    case "git.rollback":
    case "git.rollbackCompared":
    case "git.rollbackSelected":
    case "git.commit":
    case "git.historyRewritePreview":
    case "git.amend":
    case "git.undoLastCommit":
    case "git.stashes":
    case "git.createStash":
    case "git.stashPreview":
    case "git.applyStash":
    case "git.popStash":
    case "git.dropStash":
    case "git.push":
    case "git.fetch":
    case "git.cancelFetch":
    case "git.pullPreview":
    case "git.pull":
    case "git.rebasePreview":
    case "git.rebaseStart":
    case "git.rebaseAbort":
      return handleGitRequest(context, request);
    case "taskGit.summary":
    case "taskGit.files":
    case "taskGit.revert":
    case "taskGit.history":
    case "taskGit.diff":
    case "taskGit.review":
    case "taskGit.restore":
      return handleTaskGitRequest(context, request);
    case "language.options":
    case "language.stop":
    case "language.run":
    case "language.list":
    case "language.load":
    case "language.configuration.read":
    case "language.configuration.save":
    case "language.tools.check":
    case "language.addSourceRoot":
    case "language.projectTree":
    case "language.symbols":
    case "language.listRunTargets":
    case "language.addRunConfiguration":
    case "language.selectRunConfiguration":
    case "language.removeRunConfiguration":
    case "language.build":
    case "language.debug.setBreakpoints":
    case "language.debug.start":
    case "language.debug.applyChanges":
    case "language.debug.variables":
    case "language.debug.command":
    case "language.check":
    case "language.lsp.completion":
    case "language.lsp.definition":
    case "language.lsp.references":
    case "language.lsp.semanticTokens":
      return handleLanguageDomainRequest(context, request);
    case "plugins.list":
      return handlePluginsRequest(context, request);
    case "java.loadMavenProject":
    case "java.configuration.read":
    case "java.configuration.save":
    case "java.tools.check":
    case "java.getOptions":
    case "java.addSourceRoot":
    case "java.getProjectTree":
    case "java.workspaceSymbols":
    case "java.listMainClasses":
    case "java.addRunConfiguration":
    case "java.selectRunConfiguration":
    case "java.build":
    case "java.run":
    case "java.stop":
    case "java.debug.setBreakpoints":
    case "java.debug.start":
    case "java.debug.applyChanges":
    case "java.debug.variables":
    case "java.debug.command":
    case "java.check":
    case "java.completeType":
    case "java.completion":
    case "java.definition":
    case "java.references":
    case "java.semanticTokens":
      return handleJavaRequest(context, request);
  }
}
