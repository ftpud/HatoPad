import type { WorkspaceTask, WorkspaceOptions } from "../types/workspace.js";
import type { AiProvider, AiContentBlock, AiConfiguration, AiMcpServer, AiAgent, AiAgentPreset } from "@hatopad/acp";
import type { FileTreeNode } from "../types/filesystem.js";

export type TasksOperations = {
  "tasks.page": {
    payload: {
      sort?: "name" | "branch";
      limit?: number;
      cursor?: string;
      query?: string;
      status?: "active" | "finished" | "archived" | "all";
    };
    result: { tasks: WorkspaceTask[]; total: number; nextCursor?: string; restarted?: boolean };
  };
  "tasks.read": { payload: { taskId: string }; result: { task: WorkspaceTask } };
  "tasks.list": { payload: Record<string, never>; result: { tasks: WorkspaceTask[]; selectedTaskId?: string } };
  "tasks.create": {
    payload: { branch: string; existing?: boolean; remote?: boolean };
    result: { task: WorkspaceTask };
  };
  "tasks.createFromPrompt": {
    payload: {
      provider?: AiProvider;
      prompt: string;
      content?: AiContentBlock[];
      configuration: AiConfiguration;
      mcpServers?: AiMcpServer[];
      agent?: AiAgent;
      agentPreset?: AiAgentPreset;
      skillIds?: string[];
    };
    result: { task: WorkspaceTask };
  };
  "tasks.merge": { payload: { taskId: string; strategy?: "merge" | "smart" }; result: { targetBranch: string } };
  "tasks.timer.cancel": { payload: { taskId?: string }; result: { cancelled: boolean } };
  "tasks.timer.fire": { payload: { taskId?: string }; result: { fired: boolean } };
  "tasks.status": { payload: { taskId: string; status: "active" | "finished" }; result: { task: WorkspaceTask } };
  "tasks.rename": { payload: { taskId: string; name: string }; result: { task: WorkspaceTask } };
  "tasks.archive": { payload: { taskId: string; archived: boolean }; result: { task: WorkspaceTask } };
  "tasks.switch": {
    /** `includeTree: false` skips building the file tree and returns `tree: []`. */ payload: {
      taskId?: string;
      includeIgnored?: boolean;
      includeTree?: boolean;
    };
    result: {
      workspace: string;
      projectName: string;
      tree: FileTreeNode[];
      options: WorkspaceOptions;
      tasks: WorkspaceTask[];
      selectedTaskId?: string;
    };
  };
  "tasks.delete": { payload: { taskId: string }; result: { tasks: WorkspaceTask[]; selectedTaskId?: string } };
  "tasks.commitMessage.get": { payload: { taskId: string }; result: { message: string; head: string } };
  "tasks.commitMessage.set": { payload: { taskId: string; message: string }; result: { message: string } };
  "tasks.commitMessage.update": {
    payload: { taskId: string; message: string; expectedHead: string };
    result: { previousCommit: string; commit: string; message: string };
  };
};
