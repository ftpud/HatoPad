import { inventoryPage } from "../inventory-page.js";
import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { AppEventBridge } from "../app-events.js";
import { withAppTools } from "../app-tools.js";
import { permissionTargetWorkspace } from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleTasksRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, acp, terminalHost, aiTimers, rootWorkspace, bridgeWorkspace, filesystem, workspaceState, workspacePath } = context;
  switch (request.type) {

    case "tasks.page": {
      const registry = await tasks.list(), status = request.payload.status ?? "all";
      if (request.payload.sort !== undefined && !["name", "branch"].includes(request.payload.sort)) throw new CoreError("INVALID_REQUEST", "Choose a task sort order");
      if (!["active", "finished", "archived", "all"].includes(status)) throw new CoreError("INVALID_REQUEST", "Choose a task state");
      inventoryPage(`${request.rootId}:${status}`, "tasks", [], request.payload);
      const query = (request.payload.query ?? "").toLowerCase();
      const filtered = registry.tasks.filter(task => (status === "all" || (status === "archived" ? task.archived : !task.archived && task.status === status)) && (!query || `${task.name} ${task.branch}`.toLowerCase().includes(query)));
      const page = inventoryPage(`${request.rootId}:${status}`, "tasks", filtered.map(task => ({ id: task.id, name: task.name, state: task.archived ? "archived" : task.status, detail: task.branch })), { ...request.payload, query: undefined, order: request.payload.sort === "branch" ? "detail" : "name" });
      const byId = new Map(filtered.map(task => [task.id, task]));
      return { tasks: page.rows.map(row => { const task = byId.get(row.id)!; return { ...task, name: task.name.slice(0, 180), branch: task.branch.slice(0, 4096), baseBranch: task.baseBranch.slice(0, 4096) }; }), total: page.total, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), ...(page.restarted ? { restarted: true } : {}) };
    }
    case "tasks.read": {
      if (typeof request.payload.taskId !== "string" || !request.payload.taskId || request.payload.taskId.length > 128) throw new CoreError("INVALID_REQUEST", "Choose a task");
      const task = (await tasks.list()).tasks.find(task => task.id === request.payload.taskId);
      if (!task) throw new CoreError("FILE_NOT_FOUND", "Task is unavailable in this root"); return { task };
    }
    case "tasks.list": return tasks.list();
    case "tasks.create": return { task: await tasks.create(request.payload.branch, request.payload.existing, request.payload.remote) };
    case "tasks.createFromPrompt": {
      if (workspacePath !== rootWorkspace) throw new CoreError("INVALID_REQUEST", "New tasks can only be started from the root workspace");
      const provider = acp.get(request.payload.provider);
      const task = await tasks.createRandom(false);
      try {
        const appTools = withAppTools(rootWorkspace, tasks.taskPath(task.id), request.payload.mcpServers, request.payload.agent, request.payload.provider, bridgeWorkspace);
        await provider.send(tasks.taskPath(task.id), {
          prompt: request.payload.prompt,
          content: request.payload.content,
          configuration: request.payload.configuration,
          mcpServers: appTools.servers,
          agent: appTools.agent,
          agentPreset: request.payload.agentPreset,
          skillIds: request.payload.skillIds
        });
        return { task };
      } catch (error) {
        await tasks.delete(task.id).catch(() => undefined);
        throw error;
      }
    }
    case "tasks.merge": return tasks.merge(request.payload.taskId, request.payload.strategy);
    case "tasks.timer.cancel": {
      const target = await permissionTargetWorkspace(tasks, rootWorkspace, request.payload.taskId);
      return { cancelled: await aiTimers.cancelNext(target) };
    }
    case "tasks.timer.fire": {
      const target = await permissionTargetWorkspace(tasks, rootWorkspace, request.payload.taskId);
      return { fired: await aiTimers.fireNext(target) };
    }
    case "tasks.status": return { task: await tasks.setStatus(request.payload.taskId, request.payload.status) };
    case "tasks.rename": return { task: await tasks.rename(request.payload.taskId, request.payload.name) };
    case "tasks.archive": return { task: await tasks.setArchived(request.payload.taskId, request.payload.archived) };
    case "tasks.delete": {
      if (!(await tasks.list()).tasks.some((task) => task.id === request.payload.taskId)) throw new CoreError("INVALID_REQUEST", "Task does not exist");
      await aiTimers.cancelWorkspace(tasks.taskPath(request.payload.taskId));
      const result = await tasks.delete(request.payload.taskId);
      terminalHost.closeWorkspace(tasks.taskPath(request.payload.taskId));
      return result;
    }
    case "tasks.switch": {
      const registry = await tasks.list();
      return { workspace: workspacePath, projectName: path.basename(path.resolve(rootWorkspace)), tree: request.payload.includeTree === false ? [] : await filesystem.listTree(request.payload.includeIgnored === true), options: await workspaceState.load(), ...registry };
    }
    case "tasks.commitMessage.get": return tasks.getCommitMessage(request.payload.taskId);
    case "tasks.commitMessage.set": {
      await tasks.getCommitMessage(request.payload.taskId);
      const result = await tasks.setCommitMessage(tasks.taskPath(request.payload.taskId), request.payload.message);
      await new AppEventBridge(bridgeWorkspace).emit({ type: "commit-message.changed", workspace: tasks.taskPath(request.payload.taskId), message: result.message });
      return { message: result.message };
    }
    case "tasks.commitMessage.update": {
      if (typeof request.payload.expectedHead !== "string" || !/^[0-9a-f]{40,64}$/.test(request.payload.expectedHead)) throw new CoreError("INVALID_REQUEST", "Expected task HEAD is required");
      return tasks.updateGitCommitMessage(request.payload.taskId, request.payload.message, request.payload.expectedHead);
    }
  }
}
