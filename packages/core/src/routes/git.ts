import path from "node:path";
import { type Request } from "@hatopad/protocol";
import { CoreError } from "../errors.js";
import { optionalByteLimit } from "../request-support.js";
import type { RequestContext } from "./context.js";

export async function handleGitRequest(context: RequestContext, request: Request): Promise<unknown> {
  const { tasks, filesystem, git } = context;
  switch (request.type) {

    case "git.summary": return git.summary(request.payload.limit, request.payload.offset);
    case "git.status": return git.status();
    case "git.diff": {
      if (typeof request.payload.path !== "string") throw new CoreError("INVALID_REQUEST", "path must be a string");
      const limit = optionalByteLimit(request.payload.maxBytes);
      const diff = await git.diff(request.payload.path, filesystem);
      if (limit !== undefined && Buffer.byteLength(diff.originalContent) + Buffer.byteLength(diff.modifiedContent) > limit) return { path: diff.path, originalContent: "", modifiedContent: "", hunks: [], tooLarge: true };
      return diff;
    }
    case "git.stage": await git.stage(request.payload.path, request.payload.hunk); return {};
    case "git.unstage": await git.unstage(request.payload.path, request.payload.hunk); return {};
    case "git.conflicts": return git.conflicts();
    case "git.resolveConflict": return git.resolveConflict(request.payload.path, request.payload.result);
    case "git.conflictAction": return { outcome: await git.conflictAction(request.payload.action) };
    case "git.branches": return { branches: await git.branches() };
    case "git.tags": return { tags: await git.tags() };
    case "git.createTag": return { tag: await git.createTag(request.payload.name, request.payload.target) };
    case "git.deleteTag": await git.deleteTag(request.payload.name); return {};
    case "git.checkoutBranch": return { branch: await git.checkoutBranch(request.payload.branch, request.payload.remote) };
    case "git.renameBranch": {
      if ((await tasks.list()).tasks.some((task) => task.branch === request.payload.branch)) throw new CoreError("INVALID_REQUEST", "Cannot rename a branch owned by a task worktree");
      return { branch: await git.renameBranch(request.payload.branch, request.payload.newName) };
    }
    case "git.createBranch": return { branch: await git.createBranch(request.payload.name) };
    case "git.branchDeletePreview": return git.branchDeletePreview(request.payload.branch, request.payload.remote);
    case "git.deleteBranch": {
      const localName = request.payload.remote ? request.payload.branch.split("/").slice(1).join("/") : request.payload.branch;
      if ((await tasks.list()).tasks.some((task) => task.branch === localName)) throw new CoreError("INVALID_REQUEST", "Cannot delete a branch owned by a task worktree");
      await git.deleteBranch(request.payload.branch, request.payload.remote, request.payload.force, request.payload.confirm); return {};
    }
    case "git.publishBranch": await git.publishBranch(request.payload.branch, request.payload.remote, request.payload.force, request.payload.confirm); return {};
    case "git.setBranchUpstream": await git.setBranchUpstream(request.payload.branch, request.payload.remote, request.payload.upstream, request.payload.confirm); return {};
    case "git.log": return git.log(request.payload.branch, request.payload.limit, request.payload.skip);
    case "git.mergePreview": return git.mergePreview(request.payload.source);
    case "git.merge": return git.merge(request.payload.source, request.payload.expectedHead, request.payload.expectedRefHead, request.payload.expectedMergeBase);
    case "git.commitFiles": return { files: await git.commitFiles(request.payload.hash) };
    case "git.commitMessage": return { message: await git.commitMessage(request.payload.hash) };
    case "git.commitDiff": return git.commitDiff(request.payload.hash, request.payload.path, request.payload.originalPath);
    case "git.cherryPick": return { branch: await git.cherryPick(request.payload.hash, request.payload.commit) };
    case "git.saveCommitResults": return git.saveCommitResults(request.payload.hash, request.payload.indexVersion, request.payload.files);
    case "git.saveCommitWorktreeResults": return git.saveCommitWorktreeResults(request.payload.hash, request.payload.files, filesystem);
    case "git.commitPatch": return git.commitPatch(request.payload.hash);
    case "git.applyCommitHunks": return git.applyCommitHunks(request.payload.hash, request.payload.indexVersion, request.payload.hunkIds);
    case "git.fileHistory": return git.fileHistory(request.payload.path, request.payload.startLine, request.payload.endLine, typeof request.payload.content === "string" ? request.payload.content : undefined);
    case "git.ignore": return { file: await git.ignore(request.payload.path) };
    case "git.compareFiles": return { files: await git.compareFiles(request.payload.ref, request.payload.path) };
    case "git.compareDiff": return git.compareDiff(request.payload.ref, request.payload.path, filesystem, request.payload.originalPath);
    case "git.rollback": await git.rollback(request.payload.path); return {};
    case "git.rollbackCompared": await git.rollbackCompared(request.payload.ref, request.payload.path); return {};
    case "git.rollbackSelected": {
      if (!Array.isArray(request.payload.paths) || typeof request.payload.deleteUntracked !== "boolean") throw new CoreError("INVALID_REQUEST", "paths and deleteUntracked are required");
      return git.rollbackSelected(request.payload.paths, request.payload.deleteUntracked);
    }
    case "git.commit": return { hash: await git.commit(request.payload.paths, request.payload.message) };
    case "git.historyRewritePreview": return git.historyRewritePreview();
    case "git.amend": return { hash: await git.amend(request.payload.confirmHistoryRewrite) };
    case "git.undoLastCommit": return { undone: await git.undoLastCommit(request.payload.confirmHistoryRewrite) };
    case "git.stashes": return { stashes: await git.stashes() };
    case "git.createStash": return { stash: await git.createStash(request.payload.include, request.payload.message, request.payload.paths) };
    case "git.stashPreview": return git.stashPreview(request.payload.reference);
    case "git.applyStash": return git.applyStash(request.payload.reference);
    case "git.popStash": return git.popStash(request.payload.reference, request.payload.confirm);
    case "git.dropStash": await git.dropStash(request.payload.reference, request.payload.confirm); return {};
    case "git.push": await git.push(); return {};
    case "git.fetch": return git.fetch();
    case "git.cancelFetch": return { cancelled: git.cancelFetch() };
    case "git.pullPreview": return git.pullPreview();
    case "git.pull": return git.pull(request.payload.strategy, request.payload.expectedHead, request.payload.expectedUpstreamHead);
    case "git.rebasePreview": return git.rebasePreview();
    case "git.rebaseStart": return git.rebaseStart(request.payload.expectedHead, request.payload.expectedUpstreamHead, request.payload.base, request.payload.items);
    case "git.rebaseAbort": return git.rebaseAbort();
  }
}
