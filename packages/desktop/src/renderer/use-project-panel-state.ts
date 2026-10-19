import { useState } from "react";
import type { FileTreeNode, WorkspaceRoot } from "@hatopad/protocol";
import { readSetting } from "./settings";

export function useProjectPanelState() {
  const [tree, setTree] = useState<FileTreeNode[]>([]);

  const [projectFilter, setProjectFilter] = useState("");

  const [projectContentFilter, setProjectContentFilter] = useState(false);

  const [projectContentPaths, setProjectContentPaths] = useState<Set<string>>();

  const [projectContentFilterLoading, setProjectContentFilterLoading] = useState(false);

  const [showIgnored, setShowIgnored] = useState(() => readSetting("showIgnoredFiles") === "true");

  const [activeWorkspace, setActiveWorkspace] = useState("");

  const [projectName, setProjectName] = useState("");

  const [workspaceRoots, setWorkspaceRoots] = useState<WorkspaceRoot[]>([]);

  const [selectedRootId, setSelectedRootId] = useState("");

  const [projectSelection, setProjectSelection] = useState<Set<string>>(new Set());

  const [projectTransfer, setProjectTransfer] = useState<{
    operationId: string;
    token: string;
    label: string;
    bytes: number;
    total: number;
  }>();
  return {
    tree,
    setTree,
    projectFilter,
    setProjectFilter,
    projectContentFilter,
    setProjectContentFilter,
    projectContentPaths,
    setProjectContentPaths,
    projectContentFilterLoading,
    setProjectContentFilterLoading,
    showIgnored,
    setShowIgnored,
    activeWorkspace,
    setActiveWorkspace,
    projectName,
    setProjectName,
    workspaceRoots,
    setWorkspaceRoots,
    selectedRootId,
    setSelectedRootId,
    projectSelection,
    setProjectSelection,
    projectTransfer,
    setProjectTransfer,
  };
}
