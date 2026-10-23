import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { editor } from "monaco-editor";
import { useEditorIntegration, type UseEditorIntegrationDeps } from "./use-editor-integration";
import type { EditorTab, LayoutModel } from "./model";

const diffTab = (id: string, path: string, content: string): EditorTab => ({
  id,
  type: "diff",
  rootId: "root",
  title: path,
  path,
  dirty: false,
  content,
  savedContent: content,
  originalContent: "",
  loading: false,
});

function fakeDiffEditor(initial: string) {
  let value = initial;
  const changes: (() => void)[] = [];
  const disposals: (() => void)[] = [];
  const modified = {
    getModel: () => undefined,
    getValue: () => value,
    onDidChangeCursorPosition: () => ({ dispose() {} }),
    onDidChangeModelContent: (listener: () => void) => changes.push(listener),
    onDidDispose: (listener: () => void) => disposals.push(listener),
  };
  return {
    instance: { getModifiedEditor: () => modified } as unknown as editor.IStandaloneDiffEditor,
    edit(next: string) {
      value = next;
      for (const listener of changes) listener();
    },
    dispose: () => disposals.forEach((listener) => listener()),
  };
}

function setup(disk: Record<string, string>) {
  const a = diffTab("a", "A.txt", "a-original");
  const b = diffTab("b", "B.txt", "b-original");
  const layoutRef = {
    current: { editorGroups: [{ id: "g", tabs: [a, b], activeTabId: "a" }] } as unknown as LayoutModel,
  };
  const request = vi.fn(async (name: string, payload: { path: string; content?: string }) => {
    if (name === "filesystem.readFile")
      return { path: payload.path, content: disk[payload.path], revision: { identity: "i", version: payload.path } };
    if (name === "filesystem.writeFile") {
      disk[payload.path] = payload.content!;
      return { path: payload.path, bytesWritten: 0, revision: { identity: "i", version: "next" } };
    }
    return {};
  });
  const selectedRootIdRef = { current: "root" };
  const setStatusMessage = vi.fn();
  const { result } = renderHook(() =>
    useEditorIntegration({
      activeTab: a,
      selectedRootIdRef,
      clientRef: { current: { request } },
      layoutRef,
      diffRollbackTimer: { current: undefined },
      editorViewStates: { clearMounted() {} },
      editorStatusBarRef: { current: null },
      monacoDiffEditorRef: { current: undefined },
      cursorPositions: { get: () => undefined, update() {} },
      selfWriteUntil: { current: new Map() },
      gitEntries: [],
      updateGroup: vi.fn(),
      refreshGit: vi.fn(async () => undefined),
      refreshTree: vi.fn(async () => undefined),
      setStatusMessage,
    } as unknown as UseEditorIntegrationDeps),
  );
  return { result, layoutRef, request, selectedRootIdRef, setStatusMessage, disk };
}

describe("working diff edits", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes a delayed edit to its own tab after another diff tab becomes active", async () => {
    const { result, layoutRef, request, disk } = setup({ "A.txt": "a-original", "B.txt": "b-original" });
    const diff = fakeDiffEditor("a-original");
    result.current.mountWorkingDiff(diff.instance);
    diff.edit("content from A");
    layoutRef.current.editorGroups[0]!.activeTabId = "b";
    await vi.advanceTimersByTimeAsync(250);
    expect(disk).toEqual({ "A.txt": "content from A", "B.txt": "b-original" });
    expect(request).toHaveBeenCalledWith("filesystem.writeFile", {
      path: "A.txt",
      content: "content from A",
      expectedRevision: { identity: "i", version: "A.txt" },
    });
  });

  it("flushes the pending edit to its own file when the diff editor is disposed", async () => {
    const { result, disk } = setup({ "A.txt": "a-original", "B.txt": "b-original" });
    const diff = fakeDiffEditor("a-original");
    result.current.mountWorkingDiff(diff.instance);
    diff.edit("content from A");
    diff.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(disk["A.txt"]).toBe("content from A");
  });

  it("refuses to overwrite content that changed outside the diff", async () => {
    const { result, request, setStatusMessage, disk } = setup({ "A.txt": "external", "B.txt": "b-original" });
    const diff = fakeDiffEditor("a-original");
    result.current.mountWorkingDiff(diff.instance);
    diff.edit("content from A");
    await vi.advanceTimersByTimeAsync(250);
    expect(disk["A.txt"]).toBe("external");
    expect(request).not.toHaveBeenCalledWith("filesystem.writeFile", expect.anything());
    expect(setStatusMessage).toHaveBeenCalledWith(expect.stringContaining("changed outside the diff"));
  });

  it("discards the pending edit after a workspace root switch", async () => {
    const { result, request, selectedRootIdRef } = setup({ "A.txt": "a-original", "B.txt": "b-original" });
    const diff = fakeDiffEditor("a-original");
    result.current.mountWorkingDiff(diff.instance);
    diff.edit("content from A");
    selectedRootIdRef.current = "other";
    await vi.advanceTimersByTimeAsync(250);
    expect(request).not.toHaveBeenCalled();
  });
});
