import { useEffect, useRef } from "react";
import type { UseProjectFileActionsDeps } from "./use-project-file-actions";

type Deps = Pick<
  UseProjectFileActionsDeps,
  "projectTransfer" | "setProjectTransfer" | "showStatus" | "refreshTree" | "refreshGit"
>;

export function useProjectTransferProgress(deps: Deps) {
  const latest = useRef(deps);
  latest.current = deps;
  const active = useRef(deps.projectTransfer);
  active.current = deps.projectTransfer;
  const track = (transfer: Deps["projectTransfer"]) => {
    active.current = transfer;
    latest.current.setProjectTransfer(transfer);
  };
  useEffect(
    () =>
      window.desktop?.onProjectTransferProgress((progress) => {
        const current = active.current;
        if (!current || current.operationId !== progress.operationId) return;
        const { showStatus, refreshTree, refreshGit } = latest.current;
        if (progress.error) {
          track(undefined);
          showStatus(progress.error, "error");
        } else if (progress.done) {
          track(undefined);
          showStatus(`${current.label} complete`, "success");
          void Promise.all([refreshTree(), refreshGit()]).catch((error) =>
            showStatus(error instanceof Error ? error.message : "Could not refresh workspace", "error"),
          );
        } else {
          track({ ...current, bytes: progress.bytes });
          showStatus(
            `${current.label}: ${Math.floor((progress.bytes / Math.max(1, progress.total)) * 100)}%`,
            "progress",
          );
        }
      }),
    [],
  );
  return track;
}
