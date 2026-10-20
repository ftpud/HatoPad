import type { GitBranch as GitBranchInfo } from "@hatopad/protocol";
import { CoreClient } from "./client";
import { gitRefNameError, requestConfirm, requestFields, requestText } from "./dialogs";

export interface UseBranchActionsDeps {
  setBranchMenu: React.Dispatch<
    React.SetStateAction<{ branches: GitBranchInfo[]; selected?: string; loading: boolean } | undefined>
  >;
  clientRef: React.MutableRefObject<CoreClient | undefined>;
  setStatusMessage: (message: string) => void;
  branchMenu: { branches: GitBranchInfo[]; selected?: string; loading: boolean } | undefined;
  setGitBranch: React.Dispatch<React.SetStateAction<string>>;
  refreshGit: (client?: CoreClient | undefined) => Promise<void>;
  refreshTree: (includeIgnored?: boolean) => Promise<void>;
}

export function useBranchActions(deps: UseBranchActionsDeps) {
  const { setBranchMenu, clientRef, setStatusMessage, branchMenu, setGitBranch, refreshGit, refreshTree } = deps;

  const loadBranchMenu = async () => {
    setBranchMenu({ branches: [], loading: true });
    try {
      setBranchMenu({ branches: (await clientRef.current!.request("git.branches", {})).branches, loading: false });
    } catch (error) {
      setBranchMenu(undefined);
      setStatusMessage(error instanceof Error ? error.message : "Could not load branches");
    }
  };

  const toggleBranchMenu = async () => {
    if (branchMenu) {
      setBranchMenu(undefined);
      return;
    }
    await loadBranchMenu();
  };

  const checkoutBranch = async (branch: GitBranchInfo) => {
    if (!clientRef.current || branch.current) return;
    try {
      const result = await clientRef.current.request("git.checkoutBranch", {
        branch: branch.name,
        ...(branch.remote ? { remote: true } : {}),
      });
      setGitBranch(result.branch);
      setBranchMenu(undefined);
      await Promise.all([refreshGit(), refreshTree()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not checkout branch");
    }
  };

  const renameBranch = async (branch: GitBranchInfo) => {
    const newName = await requestText({
      title: "Rename branch",
      message: `Rename ${branch.name}. Its upstream is kept.`,
      label: "New name",
      defaultValue: branch.name,
      validate: gitRefNameError,
      confirmLabel: "Rename",
    });
    if (!clientRef.current || !newName || newName === branch.name) return;
    try {
      const result = await clientRef.current.request("git.renameBranch", { branch: branch.name, newName });
      setGitBranch(result.branch);
      setBranchMenu(undefined);
      await refreshGit();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not rename branch");
    }
  };

  const createBranch = async () => {
    const name = await requestText({
      title: "Create branch",
      message: "Create a local branch from the current commit and switch to it.",
      label: "Branch name",
      placeholder: "feature/my-change",
      validate: (value) =>
        gitRefNameError(value) ??
        ((branchMenu?.branches ?? []).some((item) => !item.remote && item.name === value)
          ? "A local branch with this name exists"
          : undefined),
      confirmLabel: "Create",
    });
    if (!clientRef.current || !name) return;
    try {
      await clientRef.current.request("git.createBranch", { name });
      await loadBranchMenu();
      setStatusMessage(`Created branch ${name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create branch");
    }
  };

  const deleteBranch = async (branch: GitBranchInfo) => {
    if (!clientRef.current) return;
    try {
      const preview = await clientRef.current.request("git.branchDeletePreview", {
        branch: branch.name,
        remote: branch.remote,
      });
      const force = !branch.remote && preview.unmerged.length > 0;
      const details = preview.unmerged.length
        ? `\n\n${preview.unmerged.length} commit(s) are not merged into the current branch.${force ? " This will force-delete the branch." : ""}`
        : "";
      if (
        !(await requestConfirm({
          title: `Delete ${branch.remote ? "remote" : "local"} branch?`,
          message: `${branch.remote ? "Delete remote" : "Delete local"} branch ${branch.name}?${details}`,
          confirmLabel: force ? "Force delete" : "Delete",
          danger: true,
        }))
      )
        return;
      await clientRef.current.request("git.deleteBranch", {
        branch: branch.name,
        remote: branch.remote,
        force,
        confirm: true,
      });
      await loadBranchMenu();
      setStatusMessage(`Deleted ${branch.remote ? "remote" : "local"} branch ${branch.name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete branch");
    }
  };

  const publishBranch = async (branch: GitBranchInfo) => {
    const remote = await requestText({
      title: "Publish branch",
      message: `Push ${branch.name} and set it to track the same branch on the remote.`,
      label: "Remote",
      defaultValue: "origin",
      confirmLabel: "Publish",
    });
    if (!clientRef.current || !remote) return;
    try {
      await clientRef.current.request("git.publishBranch", {
        branch: branch.name,
        remote,
        force: false,
        confirm: true,
      });
      await Promise.all([loadBranchMenu(), refreshGit()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not publish branch");
    }
  };

  const setBranchUpstream = async (branch: GitBranchInfo) => {
    const values = await requestFields({
      title: "Set upstream",
      message: `Choose the remote branch ${branch.name} pulls from and pushes to.`,
      fields: [
        { id: "remote", label: "Remote", defaultValue: "origin" },
        { id: "upstream", label: "Remote branch", defaultValue: branch.name, validate: gitRefNameError },
      ],
      confirmLabel: "Set upstream",
    });
    if (!clientRef.current || !values) return;
    try {
      await clientRef.current.request("git.setBranchUpstream", {
        branch: branch.name,
        remote: values.remote!,
        upstream: values.upstream!,
        confirm: true,
      });
      await refreshGit();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not set branch upstream");
    }
  };
  return {
    loadBranchMenu,
    toggleBranchMenu,
    checkoutBranch,
    renameBranch,
    createBranch,
    deleteBranch,
    publishBranch,
    setBranchUpstream,
  };
}
