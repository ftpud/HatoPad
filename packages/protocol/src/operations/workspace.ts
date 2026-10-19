import type { WorkspaceRoot, WorkspaceRootId, WorkspaceOptions } from "../types/workspace.js";
import type { FileTreeNode } from "../types/filesystem.js";

export type WorkspaceOperations = {
  "workspace.roots": {
    payload: Record<string, never>;
    result: { roots: WorkspaceRoot[]; selectedRootId: WorkspaceRootId };
  };
  "workspace.addRoot": {
    payload: { path: string; alias: string };
    result: { root: WorkspaceRoot; roots: WorkspaceRoot[] };
  };
  "workspace.selectRoot": {
    /** `includeTree: false` returns `tree: []` (capability `workspace.selectRoot.includeTree`). */ payload: {
      rootId: WorkspaceRootId;
      includeIgnored?: boolean;
      preserveTaskSelection?: boolean;
      includeTree?: boolean;
    };
    result: {
      root: WorkspaceRoot;
      workspace: string;
      projectName: string;
      tree: FileTreeNode[];
      options: WorkspaceOptions;
    };
  };
  "workspace.removeRoot": {
    payload: { rootId: WorkspaceRootId };
    result: { roots: WorkspaceRoot[]; selectedRootId: WorkspaceRootId };
  };
  "workspace.open": {
    /** `includeTree: false` returns `tree: []`; the connection still subscribes to events (capability `workspace.open.includeTree`). */
    payload: { includeIgnored?: boolean; includeTree?: boolean };
    result: { workspace: string; projectName: string; tree: FileTreeNode[]; options: WorkspaceOptions };
  };
  "workspace.saveOptions": {
    payload: { options: WorkspaceOptions };
    result: Record<string, never>;
  };
};
