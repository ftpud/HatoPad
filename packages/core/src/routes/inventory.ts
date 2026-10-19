import { inventoryPage, inventoryKinds } from "../inventory-page.js";
import { type Request } from "@hatopad/protocol";
import { watchSummary } from "../terminal-watch.js";
import { CoreError } from "../errors.js";
import { SkillsStore } from "../skills.js";
import type { RequestContext } from "./context.js";

export async function handleInventoryRequest(context: RequestContext, request: Request): Promise<unknown> {
  const {
    tasks,
    usefulFiles,
    agents,
    harnesses,
    terminalHost,
    runConfigs,
    schedules,
    triggers,
    rootWorkspace,
    ownedTimers,
    workspacePath,
  } = context;
  switch (request.type) {
    case "inventory.page": {
      const { kind } = request.payload;
      if (!inventoryKinds.includes(kind)) throw new CoreError("INVALID_REQUEST", "Choose an inventory kind");
      inventoryPage(request.rootId!, kind, [], request.payload);
      let rows: import("@hatopad/protocol").InventoryRow[] = [],
        truncated = false;
      const registry = await tasks.list();
      const targets = [
        { workspace: rootWorkspace, taskId: undefined as string | undefined },
        ...registry.tasks.slice(0, 500).map((task) => ({ workspace: tasks.taskPath(task.id), taskId: task.id })),
      ];
      switch (kind) {
        case "tasks":
          rows = registry.tasks.map((task) => ({
            id: task.id,
            name: task.name,
            state: task.archived ? "archived" : task.status,
            detail: task.branch,
            taskId: task.id,
          }));
          break;
        case "workflows": {
          const [definitions, runs] = await Promise.all([harnesses.list(), harnesses.summaries()]);
          const latest = new Map<string, string>();
          for (const run of [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
            if (!latest.has(run.harnessId)) latest.set(run.harnessId, run.status);
          rows = definitions.map((item) => ({
            id: item.id,
            name: item.name,
            detail: `${item.blocks.length} blocks`,
            ...(latest.has(item.id) ? { state: latest.get(item.id) } : {}),
          }));
          break;
        }
        case "runs": {
          const names = new Map((await harnesses.list()).map((item) => [item.id, item.name]));
          rows = (await harnesses.summaries()).map((item) => ({
            id: item.id,
            runId: item.id,
            harnessId: item.harnessId,
            name: names.get(item.harnessId) ?? item.harnessId,
            state: item.status,
            detail: item.createdAt,
            createdAt: item.createdAt,
            startedAt: item.startedAt,
            completedAt: item.completedAt,
            ...(item.binding?.taskId ? { taskId: item.binding.taskId } : {}),
          }));
          break;
        }
        case "schedules":
          rows = schedules
            .list()
            .filter((item) => item.rootId === request.rootId)
            .map((item) => ({
              id: item.id,
              name: item.name,
              state: item.enabled ? "enabled" : "disabled",
              detail: item.dueAt,
              ...(item.taskId ? { taskId: item.taskId } : {}),
            }));
          break;
        case "triggers":
          rows = triggers
            .list()
            .filter((item) => item.rootId === request.rootId)
            .map((item) => ({
              id: item.id,
              name: item.name,
              state: item.firing ? "firing" : item.enabled ? "armed" : "disabled",
              detail: item.lastError ?? item.lastSkipped ?? `${item.fireCount} fires`,
              ...(item.taskId ? { taskId: item.taskId } : {}),
            }));
          break;
        case "timers":
          rows = (await ownedTimers()).map((item) => ({
            id: item.id,
            name: item.provider,
            detail: item.dueAt,
            ...(item.workflowRunId ? { runId: item.workflowRunId } : {}),
            ...(targets.find((target) => target.workspace === item.workspace)?.taskId
              ? { taskId: targets.find((target) => target.workspace === item.workspace)!.taskId }
              : {}),
          }));
          break;
        case "terminals":
          truncated = registry.tasks.length > 500;
          rows = targets.flatMap((target) =>
            terminalHost.list(target.workspace).map((terminal) => {
              const item = watchSummary(terminal);
              return {
                id: item.terminalId,
                terminalId: item.terminalId,
                name: item.displayName ?? "Terminal",
                state: item.status,
                ...(target.taskId ? { taskId: target.taskId } : {}),
              };
            }),
          );
          break;
        case "runConfigs":
          rows = (await runConfigs.list(workspacePath)).map((item) => ({
            id: `${item.scope}/${item.name}`,
            name: item.name,
            state: item.status,
            detail: item.scope,
            ...(item.terminalId ? { terminalId: item.terminalId } : {}),
          }));
          break;
        case "useful":
          rows = (await usefulFiles.list()).map((item) => ({
            id: `${item.scope}/${item.name}`,
            name: item.name,
            detail: item.scope,
          }));
          break;
        case "agents":
          rows = (await agents.list(workspacePath)).map((item) => ({
            id: `${item.scope}/${item.name}`,
            name: item.name,
            detail: `${item.scope}${item.agent.mcpServers?.length ? ` · MCP: ${item.agent.mcpServers.join(", ").slice(0, 300)}` : ""}`,
          }));
          break;
        case "skills": {
          const catalog = await new SkillsStore(undefined, rootWorkspace).list(workspacePath);
          rows = catalog.skills.map((item) => ({
            id: item.id,
            name: item.title || item.name,
            state: catalog.policy.allowed.includes(item.id) ? "allowed" : "disabled",
            detail: item.description,
          }));
          break;
        }
      }
      return inventoryPage(request.rootId!, kind, rows, request.payload, truncated);
    }
  }
}
