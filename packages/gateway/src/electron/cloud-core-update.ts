import type { BundleManifest } from "./bundled-runtime.js";

export type ManagedCloudCore = { workspaceId: string; target: string; release?: string };
export type CloudCoreUpdateInfo = { available: boolean; updateNeeded: boolean; bundledVersion?: string; bundledRelease?: string; currentRelease?: string; reason?: string };
export class CloudCoreUpdates {
  constructor(private readonly options: {
    bundle?: BundleManifest;
    resolve(origin: string, coreId: string): Promise<ManagedCloudCore | undefined>;
    deploy(workspaceId: string): Promise<unknown>;
    run<T>(workspaceId: string, action: () => Promise<T>): Promise<T>;
  }) {}
  private inspect(core?: ManagedCloudCore): CloudCoreUpdateInfo {
    const bundle = this.options.bundle;
    if (!bundle) return { available: false, updateNeeded: false, reason: "Core updates require a packaged Gateway with bundled Core releases." };
    if (!core) return { available: false, updateNeeded: false, bundledVersion: bundle.version, reason: "No matching saved local/SSH server is reachable. Add or reconnect its management connection to update this Core." };
    const shipped = bundle.cores[core.target];
    if (!shipped) return { available: false, updateNeeded: false, bundledVersion: bundle.version, reason: `Gateway has no bundled Core for ${core.target}.` };
    const updateNeeded = core.release !== shipped.release;
    return { available: true, updateNeeded, bundledVersion: bundle.version, bundledRelease: shipped.release, ...(core.release ? { currentRelease: core.release } : {}), ...(!updateNeeded ? { reason: `Already running Gateway bundle ${bundle.version} (${shipped.commit.slice(0, 12)}).` } : {}) };
  }
  async info(origin: string, coreId: string): Promise<CloudCoreUpdateInfo> {
    return this.inspect(this.options.bundle ? await this.options.resolve(origin, coreId) : undefined);
  }
  async update(origin: string, coreId: string, expectedRelease: string): Promise<CloudCoreUpdateInfo> {
    const selected = this.options.bundle ? await this.options.resolve(origin, coreId) : undefined;
    const info = this.inspect(selected);
    if (!info.available || !selected) throw new Error(info.reason);
    return this.options.run(selected.workspaceId, async () => {
      // Revalidate the pairing after acquiring the workspace's deployment lock.
      const current = await this.options.resolve(origin, coreId);
      const before = this.inspect(current);
      if (!current || current.workspaceId !== selected.workspaceId || !before.available) throw new Error("The server's cloud pairing changed. Refresh before updating.");
      if (!expectedRelease || before.bundledRelease !== expectedRelease) throw new Error("The bundled release changed. Refresh before updating.");
      if (!before.updateNeeded) return before;
      await this.options.deploy(current.workspaceId);
      const after = this.inspect(await this.options.resolve(origin, coreId));
      if (!after.available || after.currentRelease !== expectedRelease) throw new Error("Core update could not be verified. Check the provisioning log before retrying.");
      return after;
    });
  }
}
