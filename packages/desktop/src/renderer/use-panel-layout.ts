import { useSidebarExtent } from "./SidebarExtentButton";
import { useEffect, useState } from "react";
import { readSetting, writeWorkspaceSetting } from "./settings";
import { type ClassicTaskPanel } from "./task-panel-state";
import type { MutableRefObject } from "react";
/** Owns the PanelLayout state for the workspace shell. */
export function usePanelLayout(workspaceKeyRef: MutableRefObject<string>) {
  const [sideLayout, setSideLayout] = useState<"classic" | "ai-focused">(() => readSetting("sideLayout") === "classic" ? "classic" : "ai-focused");
  const [leftSidebarExtended, setLeftSidebarExtended] = useSidebarExtent("left");
  const [rightSidebarExtended, setRightSidebarExtended] = useSidebarExtent("right");
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(520);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(360);
  const [workflowPanelMode, setWorkflowPanelMode] = useState<"design" | "run">("run");
  const [leftPanels, setLeftPanels] = useState({ tasks: true, ai: true, harness: false, timers: false, triggers: false, proc: false });
  const [rightPanels, setRightPanels] = useState({ project: true, git: true, taskGit: false, promptHistory: false, java: false, useful: false, agents: false, skills: false });
  const [classicSideView, setClassicSideView] = useState<ClassicTaskPanel>("project");
  const [classicLeftWidth, setClassicLeftWidth] = useState(260);
  const [classicRightWidth, setClassicRightWidth] = useState(300);
  const [classicTasksOpen, setClassicTasksOpen] = useState(true);
  const [classicAiOpen, setClassicAiOpen] = useState(false);
  const [classicSplit, setClassicSplit] = useState(50);

  // Persist panel layout per workspace, keeping the value as the global default for new workspaces.
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "ai-focused") { writeWorkspaceSetting(workspaceKeyRef.current, "focused.leftPanels", JSON.stringify(leftPanels)); } }, [leftPanels]);
  useEffect(() => { if (workspaceKeyRef.current) writeWorkspaceSetting(workspaceKeyRef.current, "workflow.panelMode", workflowPanelMode); }, [workflowPanelMode]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "ai-focused") { writeWorkspaceSetting(workspaceKeyRef.current, "focused.rightPanels", JSON.stringify(rightPanels)); } }, [rightPanels]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "ai-focused") { writeWorkspaceSetting(workspaceKeyRef.current, "focused.leftWidth", String(leftSidebarWidth)); } }, [leftSidebarWidth]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "ai-focused") { writeWorkspaceSetting(workspaceKeyRef.current, "focused.rightWidth", String(rightSidebarWidth)); } }, [rightSidebarWidth]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "classic") { writeWorkspaceSetting(workspaceKeyRef.current, "classic.leftWidth", String(classicLeftWidth)); } }, [classicLeftWidth]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "classic") { writeWorkspaceSetting(workspaceKeyRef.current, "classic.rightWidth", String(classicRightWidth)); } }, [classicRightWidth]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "classic") { writeWorkspaceSetting(workspaceKeyRef.current, "classic.tasksOpen", String(classicTasksOpen)); } }, [classicTasksOpen]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "classic") { writeWorkspaceSetting(workspaceKeyRef.current, "classic.aiOpen", String(classicAiOpen)); } }, [classicAiOpen]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "classic") { writeWorkspaceSetting(workspaceKeyRef.current, "classic.split", String(classicSplit)); } }, [classicSplit]);
  useEffect(() => { if (workspaceKeyRef.current && sideLayout === "classic") { writeWorkspaceSetting(workspaceKeyRef.current, "classic.sideView", classicSideView); } }, [classicSideView]);
  return {
    sideLayout,
    setSideLayout,
    leftSidebarExtended,
    setLeftSidebarExtended,
    rightSidebarExtended,
    setRightSidebarExtended,
    leftSidebarWidth,
    setLeftSidebarWidth,
    rightSidebarWidth,
    setRightSidebarWidth,
    workflowPanelMode,
    setWorkflowPanelMode,
    leftPanels,
    setLeftPanels,
    rightPanels,
    setRightPanels,
    classicSideView,
    setClassicSideView,
    classicLeftWidth,
    setClassicLeftWidth,
    classicRightWidth,
    setClassicRightWidth,
    classicTasksOpen,
    setClassicTasksOpen,
    classicAiOpen,
    setClassicAiOpen,
    classicSplit,
    setClassicSplit
  };
}
