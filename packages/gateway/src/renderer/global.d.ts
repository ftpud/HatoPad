type GatewayCloudCoreUpdateInfo = {
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
type GatewayAutostart = { state: "on" | "off" | "unsupported" | "unknown"; detail?: string };
type GatewayCloudRoot = { id: string; alias: string; path: string; primary: boolean };
type GatewayCloudCore = { id: string; name: string; status: string; access: "owner" | "operator" };
type GatewayCloudAccount = {
  origin: string;
  user: { id: string; name: string; email: string };
  cores: GatewayCloudCore[];
};
type GatewayConnection = {
  id: string;
  kind: "ssh" | "local";
  name: string;
  host: string;
  port: number;
  username: string;
  authenticationMethod: "password" | "privateKey" | "agent";
  privateKeyPath?: string;
  hostKeyFingerprint?: string;
};
type GatewayWorkspace = {
  id: string;
  connectionId: string;
  name: string;
  directory: string;
  remotePort: number;
  migrationDestination?: string;
  migrationSource?: string;
};
type GatewayPortTunnel = { id: string; connectionId: string; port: number; remotePort?: number; cloudOrigin?: string };
type GatewayState = {
  pins?: { connections: string[]; workspaces: string[] };
  connections: GatewayConnection[];
  workspaces: GatewayWorkspace[];
  portTunnels: GatewayPortTunnel[];
};
type GatewayRuntime = {
  status: "idle" | "working" | "server" | "client" | "error";
  message: string;
  updatedAt?: string;
  stage?: string;
  logs?: string[];
  retryable?: boolean;
  repairable?: boolean;
};
type GatewayTunnelRuntime = {
  status: "idle" | "working" | "running" | "error";
  message: string;
  updatedAt?: string;
  stage?: string;
};
type GatewayConnectionRuntime = {
  status: "unknown" | "reconnecting" | "online" | "slow" | "offline";
  message: string;
  latencyMs?: number;
  updatedAt?: string;
  stage?: string;
};
type GatewayRepositorySettings = { repository: string; branch: string; autoUpdate: boolean };

interface Window {
  gateway: {
    cloudSaveOrigin(origin: string): Promise<string>;
    cloudGet(): Promise<GatewayCloudAccount | undefined>;
    cloudCancelSignIn(): Promise<void>;
    cloudConnect(origin: string): Promise<GatewayCloudAccount>;
    cloudDisconnect(): Promise<void>;
    cloudCoreUpdateInfo(id: string): Promise<GatewayCloudCoreUpdateInfo>;
    cloudUpdateCore(id: string, release: string): Promise<GatewayCloudCoreUpdateInfo>;
    cloudAutostartInfo(id: string): Promise<GatewayAutostart>;
    cloudSetAutostart(id: string, enabled: boolean): Promise<GatewayAutostart>;
    cloudListCores(id: string): Promise<GatewayCloudRoot[]>;
    cloudOpen(id: string, rootId: string): Promise<void>;
    cloudAddServer(workspaceId: string): Promise<GatewayCloudAccount>;
    platform?: string;
    onFullscreenChange?(listener: (fullscreen: boolean) => void): () => void;
    get(): Promise<{
      cloudOrigin?: string;
      state: GatewayState;
      distribution?: "source" | "bundled";
      repository: GatewayRepositorySettings;
      runtimes: Record<string, GatewayRuntime>;
      tunnelRuntimes: Record<string, GatewayTunnelRuntime>;
      connectionRuntimes: Record<string, GatewayConnectionRuntime>;
    }>;
    saveRepository(value: GatewayRepositorySettings): Promise<GatewayRepositorySettings>;
    refreshStatuses(connectionId?: string): Promise<void>;
    copyDiagnostics(connectionId: string): Promise<{ copiedAt: string }>;
    pickPrivateKey(): Promise<string | undefined>;
    testConnection(value: {
      id?: string;
      kind?: "ssh" | "local";
      host: string;
      port: number;
      username: string;
      authenticationMethod: "password" | "privateKey" | "agent";
      password?: string;
      privateKeyPath?: string;
      passphrase?: string;
      hostKeyFingerprint?: string;
    }): Promise<{ message: string; hostKeyFingerprint?: string }>;
    saveConnection(
      value: Partial<GatewayConnection> & {
        kind?: "ssh" | "local";
        name: string;
        host: string;
        port: number;
        username: string;
        authenticationMethod: "password" | "privateKey" | "agent";
        password?: string;
        passphrase?: string;
      },
    ): Promise<GatewayState>;
    setPinned(kind: "connection" | "workspace", id: string, pinned: boolean): Promise<GatewayState>;
    deleteConnection(id: string): Promise<GatewayState>;
    discoverWorkspaceDirectories(connectionId: string): Promise<string[]>;
    pickWorkspaceDirectory(): Promise<string | undefined>;
    openWorkspaceRoot(id: string, rootId?: string): Promise<void>;
    listWorkspaceRoots(id: string): Promise<GatewayCloudRoot[]>;
    previewWorkspaceMigration(
      id: string,
      destination: string,
      sourceDirectory?: string,
    ): Promise<{
      source: string;
      destination: string;
      stateEntries: number;
      taskWorkspaces: number;
      completed?: boolean;
    }>;
    migrateWorkspace(id: string, destination: string, sourceDirectory?: string): Promise<GatewayState>;
    saveWorkspace(
      value: Partial<GatewayWorkspace> & { connectionId: string; name: string; directory: string; remotePort: number },
    ): Promise<GatewayState>;
    deleteWorkspace(id: string): Promise<GatewayState>;
    savePortTunnel(value: Partial<GatewayPortTunnel> & { connectionId: string; port: number }): Promise<GatewayState>;
    deletePortTunnel(id: string): Promise<GatewayState>;
    startPortTunnel(id: string): Promise<void>;
    stopPortTunnel(id: string): Promise<void>;
    startServer(id: string): Promise<{ remotePort: number }>;
    repairServer(id: string): Promise<{ remotePort: number }>;
    cancelProvisioning(id: string): Promise<void>;
    stopServer(id: string): Promise<void>;
    startClient(id: string): Promise<void>;
    onStatus(listener: (id: string, status: GatewayRuntime) => void): () => void;
    onTunnelStatus(listener: (id: string, status: GatewayTunnelRuntime) => void): () => void;
    onConnectionStatus(listener: (id: string, status: GatewayConnectionRuntime) => void): () => void;
  };
}
