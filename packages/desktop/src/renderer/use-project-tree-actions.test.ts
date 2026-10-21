import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { FileTreeNode } from "@hatopad/protocol";
import { useProjectTreeActions, type UseProjectTreeActionsDeps } from "./use-project-tree-actions";

describe("project path dialogs", () => {
  it.each([
    ["aaa/bbb/ddd", "aaa/bbb/ddd", "directory", "aaa/bbb"],
    ["folder", "folder", "directory", ""],
    ["file.ts", "src/file.ts", "file", "src"],
  ] as const)("renames %s alongside its existing path", (name, path, type, parentPath) => {
    const setProjectPathDialog = vi.fn();
    const { result } = renderHook(() =>
      useProjectTreeActions({ setProjectPathDialog } as unknown as UseProjectTreeActionsDeps),
    );
    const node: FileTreeNode = { name, path, type };
    result.current.runProjectTreeAction("rename", [node]);
    expect(setProjectPathDialog).toHaveBeenCalledWith({ mode: "rename", node, parentPath });
  });

  it("still creates files inside a compacted directory", () => {
    const setProjectPathDialog = vi.fn();
    const { result } = renderHook(() =>
      useProjectTreeActions({ setProjectPathDialog } as unknown as UseProjectTreeActionsDeps),
    );
    const node: FileTreeNode = { name: "aaa/bbb/ddd", path: "aaa/bbb/ddd", type: "directory" };
    result.current.runProjectTreeAction("createFile", [node]);
    expect(setProjectPathDialog).toHaveBeenCalledWith({ mode: "file", node, parentPath: node.path });
  });
});
