import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectTransferProgress } from "./use-project-transfer-progress";

afterEach(() => {
  delete window.desktop;
});
it("tracks fast completions before rerender, reports success, and refreshes with current callbacks", () => {
  let progress!: Parameters<NonNullable<Window["desktop"]>["onProjectTransferProgress"]>[0];
  window.desktop = {
    onProjectTransferProgress: vi.fn((listener) => {
      progress = listener;
      return vi.fn();
    }),
  } as unknown as Window["desktop"];
  const deps = {
    projectTransfer: undefined,
    setProjectTransfer: vi.fn(),
    showStatus: vi.fn(),
    refreshTree: vi.fn().mockResolvedValue(undefined),
    refreshGit: vi.fn().mockResolvedValue(undefined),
  };
  const { result, rerender } = renderHook((props) => useProjectTransferProgress(props), { initialProps: deps });
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  rerender({ ...deps, refreshTree });
  act(() => {
    result.current({ operationId: "fast", token: "ticket", label: "Uploading file.bin", bytes: 0, total: 1 });
    progress({ operationId: "other", bytes: 1, total: 1, done: true });
    progress({ operationId: "fast", bytes: 1, total: 1, done: true });
  });
  expect(deps.showStatus).toHaveBeenCalledWith("Uploading file.bin complete", "success");
  expect(refreshTree).toHaveBeenCalledTimes(1);
  expect(deps.refreshTree).not.toHaveBeenCalled();
  expect(deps.refreshGit).toHaveBeenCalledTimes(1);
  expect(deps.setProjectTransfer).toHaveBeenLastCalledWith(undefined);
});
