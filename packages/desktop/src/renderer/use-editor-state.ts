import { ParsedHttpRequest } from "./editor-helpers";
import { useState } from "react";
import type { FileColor, HttpResponse, SearchResult, WorkspaceSearchQueries } from "@hatopad/protocol";
import { initialLayout, type LayoutModel } from "./model";

export function useEditorState() {
  const [layout, setLayout] = useState<LayoutModel>(initialLayout);

  const [terminalHeight, setTerminalHeight] = useState(240);

  const [fileColors, setFileColors] = useState<Record<string, FileColor>>({});

  const [httpResult, setHttpResult] = useState<{
    request: ParsedHttpRequest;
    response?: HttpResponse;
    error?: string;
    loading: boolean;
  }>();

  const [workspaceOptionsReady, setWorkspaceOptionsReady] = useState(false);

  const [draggedTabId, setDraggedTabId] = useState<string>();

  const [searchScope, setSearchScope] = useState<string>();

  const [searchQueries, setSearchQueries] = useState<WorkspaceSearchQueries>({});

  const [pendingNavigation, setPendingNavigation] = useState<{ result: SearchResult; matchLength: number }>();
  return {
    layout,
    setLayout,
    terminalHeight,
    setTerminalHeight,
    fileColors,
    setFileColors,
    httpResult,
    setHttpResult,
    workspaceOptionsReady,
    setWorkspaceOptionsReady,
    draggedTabId,
    setDraggedTabId,
    searchScope,
    setSearchScope,
    searchQueries,
    setSearchQueries,
    pendingNavigation,
    setPendingNavigation,
  };
}
