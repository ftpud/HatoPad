import { CoreClient as SharedCoreClient } from "@remote-ide/client";
export { CoalescedAsyncAction, type LivenessOptions } from "@remote-ide/client";

/** Desktop keeps local credential access behind its Electron adapter. */
export class CoreClient extends SharedCoreClient {
  connect(host: string, port: number): Promise<void>;
  connect(options: import("@remote-ide/client").ConnectionOptions): Promise<void>;
  connect(hostOrOptions: string | import("@remote-ide/client").ConnectionOptions, port?: number): Promise<void> {
    if (typeof hostOrOptions !== "string") return super.connect(hostOrOptions);
    const host = hostOrOptions;
    return super.connect({
      url: `ws://${host}:${port}`,
      connectionLabel: `${host}:${port}`,
      clientLabel: "Desktop",
      getToken: () => typeof window !== "undefined" && window.desktop?.connectionToken
        ? window.desktop.connectionToken(host, port!) : undefined,
    });
  }
}
