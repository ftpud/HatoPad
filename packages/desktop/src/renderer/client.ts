import { CoreClient as SharedCoreClient } from "@hatopad/client";
export { CoalescedAsyncAction, type LivenessOptions } from "@hatopad/client";

/** Desktop keeps local credential access behind its Electron adapter. */
export class CoreClient extends SharedCoreClient {
  connect(host: string, port: number): Promise<void>;
  connect(options: import("@hatopad/client").ConnectionOptions): Promise<void>;
  connect(hostOrOptions: string | import("@hatopad/client").ConnectionOptions, port?: number): Promise<void> {
    if (typeof hostOrOptions !== "string") return super.connect({ deferSessionImages: true, ...hostOrOptions });
    const host = hostOrOptions;
    return super.connect({
      url: `ws://${host}:${port}`,
      connectionLabel: `${host}:${port}`,
      clientLabel: "Desktop",
      deferSessionImages: true,
      getToken: () =>
        typeof window !== "undefined" && window.desktop?.connectionToken
          ? window.desktop.connectionToken(host, port!)
          : undefined,
    });
  }
}
