import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  compatibleCoreTags,
  protocolCompatibility,
  type ProtocolCompatibility,
  type CoreUpdateStatus,
} from "@hatopad/protocol";
import { CoreError } from "./errors.js";
const exec = promisify(execFile);
export type UpdateTarget = {
  branch: "dev" | "main";
  expectedCurrent: string;
  expectedLatest: string;
  compatibility?: ProtocolCompatibility;
};
const sha = /^[a-f0-9]{40}$/;
export function updateTarget(value: unknown, apply = false): UpdateTarget {
  const data = value as Record<string, unknown>;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !["dev", "main"].includes(String(data.branch)) ||
    Object.keys(data).some(
      (key) => !(apply ? ["branch", "expectedCurrent", "expectedLatest"] : ["branch"]).includes(key),
    ) ||
    (apply && (!sha.test(String(data.expectedCurrent)) || !sha.test(String(data.expectedLatest))))
  )
    throw new CoreError("INVALID_REQUEST", "Invalid Core update request");
  return data as UpdateTarget;
}
/** Installation Git only. Never executes a browser command or touches a workspace repository. */
export class CoreUpdates {
  private busy = false;
  private aborted = false;
  constructor(
    private readonly options?: {
      repository: string;
      runningCommit: string;
      restart(target: UpdateTarget): Promise<void>;
      failure?: boolean;
      release?: boolean;
    },
  ) {}
  private async git(...args: string[]) {
    return (
      await exec("git", args, {
        cwd: this.options!.repository,
        timeout: 30_000,
        maxBuffer: 64_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      })
    ).stdout.trim();
  }
  async check(
    value: unknown,
    applying = false,
    compatibility: ProtocolCompatibility = protocolCompatibility,
  ): Promise<CoreUpdateStatus> {
    const { branch } = updateTarget(value);
    const base = {
      branch,
      available: false,
      updateAvailable: false,
      canUpdate: false,
      phase: this.busy ? ("restarting" as const) : ("idle" as const),
    };
    if (!this.options || !sha.test(this.options.runningCommit))
      return { ...base, reason: "This installation is not managed by the Git Core launcher." };
    if (this.busy && !applying) return { ...base, available: true };
    try {
      // Release installations are immutable detached clones: the supervisor stages a new release instead of merging in place.
      const release = this.options.release === true;
      const current = await this.git("rev-parse", "HEAD");
      const localBranch = release ? branch : await this.git("symbolic-ref", "--short", "HEAD");
      await this.git(
        "fetch",
        "--no-tags",
        "origin",
        `+${branch}:refs/remotes/origin/${branch}`,
        "refs/tags/core-protocol-*:refs/tags/core-protocol-*",
      );
      const tags = (
        await this.git("tag", "--merged", `refs/remotes/origin/${branch}`, "--list", "core-protocol-*-v*")
      ).split("\n");
      const tag = compatibleCoreTags(tags, compatibility)[0];
      if (!tag)
        return { ...base, available: true, reason: "No compatible tagged Core release is available on this branch." };
      const latest = await this.git("rev-parse", `refs/tags/${tag}^{commit}`);
      const dirty = release ? "" : await this.git("status", "--porcelain", "--untracked-files=normal");
      let reason = this.options.failure
        ? "The previous update failed; the previous Core was restarted."
        : this.aborted
          ? "The last update could not be prepared; this Core was kept running."
          : undefined;
      if (localBranch !== branch)
        reason = `This installation uses ${localBranch}; start it from ${branch} to update here.`;
      else if (current !== this.options.runningCommit)
        reason = "Installation changed since Core started. Restart it through the launcher.";
      else if (dirty) reason = "The installation has local changes. Commit or remove them before updating.";
      else {
        try {
          await this.git("merge-base", "--is-ancestor", current, latest);
        } catch {
          reason = "The installation has diverged from its update branch.";
        }
      }
      const blocked =
        localBranch !== branch ||
        current !== this.options.runningCommit ||
        Boolean(dirty) ||
        reason === "The installation has diverged from its update branch.";
      return {
        ...base,
        available: true,
        current: this.options.runningCommit,
        latest,
        tag,
        updateAvailable: latest !== this.options.runningCommit,
        canUpdate: !blocked && latest !== this.options.runningCommit,
        ...(reason ? { reason } : {}),
      };
    } catch {
      return { ...base, reason: "Unable to check installation updates. Check Git access on the Core machine." };
    }
  }
  async apply(
    value: unknown,
    compatibility: ProtocolCompatibility = protocolCompatibility,
  ): Promise<{ accepted: true }> {
    const target = updateTarget(value, true);
    if (this.busy) throw new CoreError("CONFLICT", "A Core update is already in progress");
    this.busy = true;
    this.aborted = false;
    try {
      const status = await this.check({ branch: target.branch }, true, compatibility);
      if (!status.canUpdate || status.current !== target.expectedCurrent || status.latest !== target.expectedLatest)
        throw new CoreError("CONFLICT", "Core update changed or is blocked. Refresh before trying again.");
      // The response is queued before graceful shutdown; a lost response must never be retried automatically.
      setTimeout(() => {
        void this.options!.restart({ ...target, compatibility }).catch(() => {
          this.busy = false;
          this.aborted = true;
        });
      }, 100).unref();
      return { accepted: true };
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }
}
