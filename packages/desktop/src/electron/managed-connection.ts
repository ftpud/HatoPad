import { readFile } from "node:fs/promises";
import { Client, type ConnectConfig } from "ssh2";
import { createCloudBridge } from "./cloud-tunnel.js";
import { SshTunnel } from "./ssh-tunnel.js";
import { consumeConnectionHandoff } from "./connection-handoff.js";

export type ManagedDesktopConnection = {
  host: string;
  port: string;
  token?: string;
  cloudOrigin?: string;
  rootId?: string;
  stop(): void;
  reconnect?(): void;
};

export async function startManagedConnection(file: string): Promise<ManagedDesktopConnection> {
  const connection = await consumeConnectionHandoff(file);
  if (connection.kind === "cloud") {
    const bridge = await createCloudBridge({
      origin: connection.origin!,
      coreId: connection.coreId!,
      cookie: async () => connection.cookie!,
    });
    return {
      host: "127.0.0.1",
      port: String(bridge.port),
      token: bridge.token,
      cloudOrigin: connection.origin!,
      ...(connection.rootId ? { rootId: connection.rootId } : {}),
      stop: () => bridge.close(),
    };
  }
  const config: ConnectConfig = {
    host: connection.host!,
    port: connection.port!,
    username: connection.username!,
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
    hostHash: "sha256",
    hostVerifier: (hash: string) =>
      `SHA256:${hash}` === connection.hostKeyFingerprint!.replace(/^(?!SHA256:)/, "SHA256:"),
  };
  if (connection.authenticationMethod === "password") config.password = connection.password!;
  else if (connection.authenticationMethod === "agent") config.agent = connection.agentSocket!;
  else {
    config.privateKey = await readFile(connection.privateKeyPath!);
    if (connection.passphrase) config.passphrase = connection.passphrase;
  }
  const tunnel = new SshTunnel({
    localPort: 0,
    remotePort: connection.remotePort!,
    connect: () =>
      new Promise<Client>((resolve, reject) => {
        const ssh = new Client();
        const fail = (error: Error) => {
          ssh.end();
          reject(error);
        };
        ssh.once("error", fail);
        ssh.once("ready", () => {
          ssh.off("error", fail);
          ssh.on("error", () => undefined);
          resolve(ssh);
        });
        ssh.connect(config);
      }),
  });
  try {
    const localPort = await tunnel.start();
    return {
      host: "127.0.0.1",
      port: String(localPort),
      ...(connection.sessionToken ? { token: connection.sessionToken } : {}),
      ...(connection.rootId ? { rootId: connection.rootId } : {}),
      stop: () => tunnel.stop(),
      reconnect: () => tunnel.reconnect(),
    };
  } catch (error) {
    tunnel.stop();
    throw error;
  }
}
