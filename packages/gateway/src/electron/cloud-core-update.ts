import type { Compatibility } from "./client-compatibility.js";
import { compatibleCoreTags, protocolCompatibility } from "./protocol-versions.js";
import type { BundleManifest } from "./bundled-runtime.js";

export type ManagedCloudCore = { workspaceId: string; target: string; release?: string };
export type CloudCoreUpdateInfo = {
  available: boolean;
  updateNeeded: boolean;
  bundledVersion?: string;
  bundledRelease?: string;
  currentRelease?: string;
  reason?: string;
  source?: "git" | "bundle";
  tag?: string;
  branch?: string;
};
export class CoreUpdateCheckError extends Error {}
/** Only fixed, locally classified messages cross IPC; remote command output stays private. */
export function coreUpdateCheckReason(error: unknown, branch?: string): string {
  const text = error instanceof Error ? error.message : "";
  const channel = branch ? ` on ${branch}` : "";
  if (/No (?:protocol-compatible(?: tagged)?|compatible tagged) Core/.test(text))
    return `No compatible Core release tag is available${channel}. A compatible release must be tagged before this Core can update.`;
  if (/Node.js and npm were not found|No installed NVM Node|requires Node.js|Could not select the NVM Node/.test(text))
    return "The SSH host has no usable Node/npm runtime. Reconnect its portable Core runtime or install Node 24 for this SSH user.";
  if (/Git is not installed on this Gateway/.test(text))
    return "Git is missing on this Gateway. Install Git, then retry the release check.";
  if (/git: (?:command )?not found|git: command not found/.test(text))
    return "Git is missing on the SSH host. Install Git, then retry the update check.";
  return `The compatible Git release check failed${channel}. Check GitHub access and Git on this Gateway, then retry.`;
}
export class CloudCoreUpdates {
  constructor(
    private readonly options: {
      bundle?: BundleManifest;
      compatibility?(origin: string): Promise<Compatibility>;
      git?: {
        check(
          core: ManagedCloudCore,
          origin: string,
        ): Promise<{ commit: string; tag: string; branch: string } | undefined>;
        deploy(workspaceId: string, commit: string, origin: string): Promise<unknown>;
      };
      resolve(origin: string, coreId: string): Promise<ManagedCloudCore | undefined>;
      deploy(workspaceId: string): Promise<unknown>;
      /** Hub-directed update performed by the Core's own release supervisor; "unavailable" falls back to SSH deployment. */
      hub?(origin: string, coreId: string, branch: string, commit: string): Promise<"started" | "unavailable">;
      poll?: { intervalMs: number; timeoutMs: number };
      run<T>(workspaceId: string, action: () => Promise<T>): Promise<T>;
    },
  ) {}
  private inspect(core?: ManagedCloudCore, compatibility = protocolCompatibility): CloudCoreUpdateInfo {
    const bundle = this.options.bundle;
    if (!core && this.options.git)
      return {
        available: false,
        updateNeeded: false,
        reason:
          "No matching saved local/SSH workspace was found. Reconnect the management connection originally paired with this Core, then refresh.",
      };
    if (!bundle)
      return {
        available: false,
        updateNeeded: false,
        reason: "No compatible Core release is available. Check GitHub access and retry.",
      };
    if (!core)
      return {
        available: false,
        updateNeeded: false,
        bundledVersion: bundle.version,
        reason:
          "No matching saved local/SSH server is reachable. Add or reconnect its management connection to update this Core.",
      };
    const shipped = bundle.cores[core.target];
    if (!shipped)
      return {
        available: false,
        updateNeeded: false,
        bundledVersion: bundle.version,
        reason: `Gateway has no bundled Core for ${core.target}.`,
      };
    if (
      !Number.isSafeInteger(shipped.protocol) ||
      shipped.protocol! < compatibility.minimum ||
      shipped.protocol! > compatibility.maximum
    )
      return {
        available: false,
        updateNeeded: false,
        reason: "Bundled Core protocol is incompatible or unknown. Check for a compatible Git release.",
      };
    const updateNeeded = core.release !== shipped.release;
    return {
      available: true,
      source: "bundle",
      updateNeeded,
      bundledVersion: bundle.version,
      bundledRelease: shipped.release,
      ...(core.release ? { currentRelease: core.release } : {}),
      ...(!updateNeeded
        ? { reason: `Already running Gateway bundle ${bundle.version} (${shipped.commit.slice(0, 12)}).` }
        : {}),
    };
  }
  private async inspectLatest(core: ManagedCloudCore | undefined, origin: string): Promise<CloudCoreUpdateInfo> {
    let compatibility = protocolCompatibility;
    try {
      compatibility = (await this.options.compatibility?.(origin)) ?? protocolCompatibility;
    } catch (error) {
      return {
        available: false,
        updateNeeded: false,
        reason:
          error instanceof CoreUpdateCheckError
            ? error.message
            : "Could not read Hub protocol requirements. Reconnect to Hub and retry.",
      };
    }
    if (core && this.options.git) {
      let latest;
      try {
        latest = await this.options.git.check(core, origin);
      } catch (error) {
        const fallback = this.inspect(core, compatibility);
        const reason = error instanceof CoreUpdateCheckError ? error.message : coreUpdateCheckReason(error);
        return {
          ...fallback,
          reason: fallback.available
            ? `${reason} ${fallback.updateNeeded ? "A compatible bundled Core is available." : "The compatible bundled Core is already selected."}`
            : reason,
        };
      }
      if (
        latest &&
        (!/^[a-f0-9]{40}$/.test(latest.commit) || compatibleCoreTags([latest.tag], compatibility).length !== 1)
      )
        return {
          available: false,
          updateNeeded: false,
          reason: "The selected Git release does not match Hub protocol requirements. Refresh before updating.",
        };
      if (latest)
        return {
          available: true,
          source: "git",
          branch: latest.branch,
          tag: latest.tag,
          bundledRelease: latest.commit,
          currentRelease: core.release,
          updateNeeded: core.release !== latest.commit && !core.release?.startsWith(`${latest.commit}-node`),
        };
    }
    return this.inspect(core, compatibility);
  }
  /** The Core restarts itself; observe the supervisor's committed selection and never replay the request. */
  private async awaitRelease(origin: string, coreId: string, commit: string): Promise<void> {
    const { intervalMs, timeoutMs } = this.options.poll ?? { intervalMs: 5_000, timeoutMs: 15 * 60_000 };
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      try {
        const core = await this.options.resolve(origin, coreId);
        if (core?.release === commit || core?.release?.startsWith(`${commit}-node`)) return;
      } catch {
        /* The host may be restarting; keep observing. */
      }
    }
    throw new Error(
      "Core accepted the update but the new release was not confirmed. Refresh its status before trying again.",
    );
  }
  /** Other host-level operations take the same per-workspace lock as updates. */
  runExclusive<T>(workspaceId: string, action: () => Promise<T>): Promise<T> {
    return this.options.run(workspaceId, action);
  }
  async info(origin: string, coreId: string): Promise<CloudCoreUpdateInfo> {
    try {
      return await this.inspectLatest(
        this.options.bundle || this.options.git ? await this.options.resolve(origin, coreId) : undefined,
        origin,
      );
    } catch (error) {
      return {
        available: false,
        updateNeeded: false,
        reason:
          error instanceof CoreUpdateCheckError
            ? error.message
            : "Could not inspect the saved management connection. Reconnect it and retry.",
      };
    }
  }
  async update(origin: string, coreId: string, expectedRelease: string): Promise<CloudCoreUpdateInfo> {
    const selected = this.options.bundle || this.options.git ? await this.options.resolve(origin, coreId) : undefined;
    const info = await this.inspectLatest(selected, origin);
    if (!info.available || !selected) throw new Error(info.reason);
    return this.options.run(selected.workspaceId, async () => {
      const current = await this.options.resolve(origin, coreId);
      const before = await this.inspectLatest(current, origin);
      if (!current || current.workspaceId !== selected.workspaceId || !before.available)
        throw new Error("The server's cloud pairing changed. Refresh before updating.");
      if (!expectedRelease || before.bundledRelease !== expectedRelease)
        throw new Error("The bundled release changed or a newer Git release appeared. Refresh before updating.");
      if (!before.updateNeeded) return before;
      if (before.source === "git") {
        const started =
          before.branch && this.options.hub
            ? await this.options.hub(origin, coreId, before.branch, expectedRelease)
            : "unavailable";
        if (started === "started") await this.awaitRelease(origin, coreId, expectedRelease);
        else await this.options.git!.deploy(current.workspaceId, expectedRelease, origin);
      } else await this.options.deploy(current.workspaceId);
      const after = await this.inspectLatest(await this.options.resolve(origin, coreId), origin);
      if (
        !after.available ||
        !(before.source === "git"
          ? after.currentRelease === expectedRelease || after.currentRelease?.startsWith(`${expectedRelease}-node`)
          : after.currentRelease === expectedRelease)
      )
        throw new Error("Core update could not be verified. Check the provisioning log before retrying.");
      return after;
    });
  }
}
