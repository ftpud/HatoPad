import { protocolCompatibility } from "./protocol-versions.js";
import type { BundleManifest } from "./bundled-runtime.js";

export type ManagedCloudCore = { workspaceId: string; target: string; release?: string };
export type CloudCoreUpdateInfo = { available: boolean; updateNeeded: boolean; bundledVersion?: string; bundledRelease?: string; currentRelease?: string; reason?: string; source?: "git" | "bundle"; tag?: string; branch?: string };
export class CoreUpdateCheckError extends Error {}
/** Only fixed, locally classified messages cross IPC; remote command output stays private. */
export function coreUpdateCheckReason(error: unknown, branch?: string): string {
  const text = error instanceof Error ? error.message : "";
  const channel = branch ? ` on ${branch}` : "";
  if (/No (?:protocol-compatible|compatible tagged) Core/.test(text)) return `No compatible Core release tag is available${channel}. A compatible release must be tagged before this Core can update.`;
  if (/Node.js and npm were not found|No installed NVM Node|requires Node.js|Could not select the NVM Node/.test(text)) return "The SSH host has no usable Node/npm runtime. Reconnect its portable Core runtime or install Node 24 for this SSH user.";
  if (/git: (?:command )?not found|git: command not found/.test(text)) return "Git is missing on the SSH host. Install Git, then retry the update check.";
  return `The compatible Git release check failed${channel}. Check the saved SSH connection and Git access, then retry.`;
}
export class CloudCoreUpdates {
  constructor(private readonly options: {
    bundle?: BundleManifest;
    git?: { check(core: ManagedCloudCore, origin: string): Promise<{ commit: string; tag: string; branch: string } | undefined>; deploy(workspaceId: string, commit: string, origin: string): Promise<unknown> };
    resolve(origin: string, coreId: string): Promise<ManagedCloudCore | undefined>;
    deploy(workspaceId: string): Promise<unknown>;
    run<T>(workspaceId: string, action: () => Promise<T>): Promise<T>;
  }) {}
  private inspect(core?: ManagedCloudCore): CloudCoreUpdateInfo {
    const bundle = this.options.bundle;
    if (!core && this.options.git) return { available: false, updateNeeded: false, reason: "No matching saved local/SSH workspace was found. Reconnect the management connection originally paired with this Core, then refresh." };
    if (!bundle) return { available: false, updateNeeded: false, reason: "Core updates require a packaged Gateway with bundled Core releases." };
    if (!core) return { available: false, updateNeeded: false, bundledVersion: bundle.version, reason: "No matching saved local/SSH server is reachable. Add or reconnect its management connection to update this Core." };
    const shipped = bundle.cores[core.target];
    if (!shipped) return { available: false, updateNeeded: false, bundledVersion: bundle.version, reason: `Gateway has no bundled Core for ${core.target}.` };
    if (!Number.isSafeInteger(shipped.protocol) || shipped.protocol! < protocolCompatibility.minimum || shipped.protocol! > protocolCompatibility.maximum) return { available: false, updateNeeded: false, reason: "Bundled Core protocol is incompatible or unknown. Check for a compatible Git release." };
    const updateNeeded = core.release !== shipped.release;
    return { available: true, source: "bundle", updateNeeded, bundledVersion: bundle.version, bundledRelease: shipped.release, ...(core.release ? { currentRelease: core.release } : {}), ...(!updateNeeded ? { reason: `Already running Gateway bundle ${bundle.version} (${shipped.commit.slice(0, 12)}).` } : {}) };
  }
  private async inspectLatest(core: ManagedCloudCore | undefined, origin: string): Promise<CloudCoreUpdateInfo> {
    if (core && this.options.git) {
      let latest;
      try { latest = await this.options.git.check(core, origin); }
      catch (error) {
        const fallback = this.inspect(core);
        const reason = error instanceof CoreUpdateCheckError ? error.message : coreUpdateCheckReason(error);
        return { ...fallback, reason: fallback.available ? `${reason} ${fallback.updateNeeded ? "A compatible bundled Core is available." : "The compatible bundled Core is already selected."}` : `${reason} ${fallback.reason ?? ""}`.trim() };
      }
      if (latest) return { available: true, source: "git", branch: latest.branch, tag: latest.tag, bundledRelease: latest.commit, currentRelease: core.release, updateNeeded: !core.release?.startsWith(`${latest.commit}-node`) };
    }
    return this.inspect(core);
  }
  async info(origin: string, coreId: string): Promise<CloudCoreUpdateInfo> {
    return this.inspectLatest(this.options.bundle || this.options.git ? await this.options.resolve(origin, coreId) : undefined, origin);
  }
  async update(origin: string, coreId: string, expectedRelease: string): Promise<CloudCoreUpdateInfo> {
    const selected = this.options.bundle || this.options.git ? await this.options.resolve(origin, coreId) : undefined;
    const info = await this.inspectLatest(selected, origin);
    if (!info.available || !selected) throw new Error(info.reason);
    return this.options.run(selected.workspaceId, async () => {
      const current = await this.options.resolve(origin, coreId);
      const before = await this.inspectLatest(current, origin);
      if (!current || current.workspaceId !== selected.workspaceId || !before.available) throw new Error("The server's cloud pairing changed. Refresh before updating.");
      if (!expectedRelease || before.bundledRelease !== expectedRelease) throw new Error("The bundled release changed or a newer Git release appeared. Refresh before updating.");
      if (!before.updateNeeded) return before;
      if (before.source === "git") await this.options.git!.deploy(current.workspaceId, expectedRelease, origin);
      else await this.options.deploy(current.workspaceId);
      const after = await this.inspectLatest(await this.options.resolve(origin, coreId), origin);
      if (!after.available || !(before.source === "git" ? after.currentRelease?.startsWith(`${expectedRelease}-node`) : after.currentRelease === expectedRelease)) throw new Error("Core update could not be verified. Check the provisioning log before retrying.");
      return after;
    });
  }
}
