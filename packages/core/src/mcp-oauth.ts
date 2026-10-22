import crypto from "node:crypto";
import {
  auth,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthConfiguration } from "@hatopad/protocol";
import { connectMcpClient } from "./mcp-client.js";

export type StoredOAuth = McpOAuthConfiguration & {
  clientSecret?: string;
  generation: string;
  registration?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  expiresAt?: number;
  discovery?: OAuthDiscoveryState;
  redirectUri?: string;
};
export class McpSignInRequired extends Error {
  constructor() {
    super("Sign in to this MCP connection in the MCP panel.");
  }
}
type Access = { read(): Promise<StoredOAuth>; update(change: (oauth: StoredOAuth) => void): Promise<void> };
type Interactive = { state: string; redirectUri: string; verifier?: string; authorizationUrl?: string };

export function secureOAuthUrl(value: string | URL): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("OAuth requires HTTPS (or a local loopback URL).");
  return url;
}
export const oauthFetch: typeof fetch = (target, init) => {
  secureOAuthUrl(target instanceof Request ? target.url : String(target));
  return fetch(target, {
    ...init,
    redirect: "error",
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
};

/** SDK handles discovery, issuer/resource binding, PKCE, registration and refresh. */
export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly access: Access,
    private readonly config: StoredOAuth,
    private readonly interactive?: Interactive,
  ) {}
  get redirectUrl() {
    return this.interactive?.redirectUri ?? this.config.redirectUri ?? "http://127.0.0.1/mcp/oauth/callback";
  }
  get clientMetadata() {
    return {
      client_name: "HatoPad",
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    };
  }
  state() {
    if (!this.interactive) throw new McpSignInRequired();
    return this.interactive.state;
  }
  async clientInformation() {
    const oauth = await this.access.read();
    return (
      oauth.registration ??
      (oauth.clientId
        ? { client_id: oauth.clientId, ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}) }
        : undefined)
    );
  }
  async saveClientInformation(value: OAuthClientInformationMixed) {
    await this.access.update((oauth) => {
      oauth.registration = value;
    });
  }
  async tokens() {
    return (await this.access.read()).tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    await this.access.update((oauth) => {
      oauth.tokens = {
        ...tokens,
        ...(!tokens.refresh_token && oauth.tokens?.refresh_token ? { refresh_token: oauth.tokens.refresh_token } : {}),
      };
      oauth.expiresAt = tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000;
    });
  }
  redirectToAuthorization(url: URL) {
    if (!this.interactive) throw new McpSignInRequired();
    this.interactive.authorizationUrl = secureOAuthUrl(url).href;
  }
  saveCodeVerifier(verifier: string) {
    if (!this.interactive) throw new McpSignInRequired();
    this.interactive.verifier = verifier;
  }
  codeVerifier() {
    if (!this.interactive?.verifier) throw new Error("OAuth sign-in expired. Start again.");
    return this.interactive.verifier;
  }
  async discoveryState() {
    return (await this.access.read()).discovery;
  }
  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    const issuer = secureOAuthUrl(discovery.authorizationServerUrl);
    const metadata = discovery.authorizationServerMetadata;
    if (metadata?.issuer && new URL(metadata.issuer).href !== issuer.href)
      throw new Error("OAuth authorization server issuer mismatch");
    for (const endpoint of [
      metadata?.authorization_endpoint,
      metadata?.token_endpoint,
      metadata?.registration_endpoint,
    ])
      if (endpoint) secureOAuthUrl(endpoint);
    await this.access.update((oauth) => {
      oauth.discovery = discovery;
    });
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await this.access.update((oauth) => {
      if (scope === "all" || scope === "tokens") {
        delete oauth.tokens;
        delete oauth.expiresAt;
      }
      if (scope === "all" || scope === "client") delete oauth.registration;
      if (scope === "all" || scope === "discovery") delete oauth.discovery;
    });
    if (this.interactive && (scope === "all" || scope === "verifier")) delete this.interactive.verifier;
  }
}

export type PendingOAuth = {
  file: string;
  serverId: string;
  connectionId: string;
  generation: string;
  serverUrl: string;
  oauth: StoredOAuth;
  interaction: Interactive;
  expiresAt: number;
};
const flows = new Map<string, PendingOAuth>();
export function rememberOAuth(flow: PendingOAuth): string {
  for (const [id, item] of flows)
    if (item.file === flow.file && item.serverId === flow.serverId && item.connectionId === flow.connectionId)
      flows.delete(id);
  const id = crypto.randomUUID();
  flows.set(id, flow);
  const timer = setTimeout(() => flows.delete(id), 300000);
  timer.unref();
  return id;
}
export function takeOAuth(file: string, id: string): PendingOAuth {
  const flow = flows.get(id);
  if (!flow || flow.file !== file || flow.expiresAt < Date.now())
    throw new Error("OAuth sign-in expired. Start again.");
  flows.delete(id);
  return flow;
}
export function cancelOAuth(file: string, id: string) {
  if (flows.get(id)?.file === file) flows.delete(id);
}

export async function beginOAuth(flow: PendingOAuth, headers: Record<string, string>) {
  secureOAuthUrl(flow.serverUrl);
  let resourceMetadataUrl: URL | undefined;
  let scope = flow.oauth.scope;
  try {
    const client = await connectMcpClient(flow.serverUrl, headers, undefined, (response) => {
      const challenge = extractWWWAuthenticateParams(response);
      resourceMetadataUrl = challenge.resourceMetadataUrl ? secureOAuthUrl(challenge.resourceMetadataUrl) : undefined;
      scope ||= challenge.scope;
    });
    await client.close();
  } catch {
    /* Discovery below also handles servers without an unauthenticated MCP session. */
  }
  const provider = new McpOAuthProvider(
    { read: async () => flow.oauth, update: async (change) => change(flow.oauth) },
    flow.oauth,
    flow.interaction,
  );
  await auth(provider, { serverUrl: flow.serverUrl, resourceMetadataUrl, scope, fetchFn: oauthFetch });
  if (!flow.interaction.authorizationUrl) throw new Error("This MCP server did not provide an OAuth sign-in URL.");
}

export async function completeOAuth(flow: PendingOAuth, callbackUrl: string) {
  if (typeof callbackUrl !== "string" || callbackUrl.length > 16000) throw new Error("Invalid OAuth callback");
  const callback = new URL(callbackUrl);
  const redirect = new URL(flow.interaction.redirectUri);
  const state = callback.searchParams.get("state");
  if (
    callback.origin !== redirect.origin ||
    callback.pathname !== redirect.pathname ||
    state !== flow.interaction.state ||
    callback.hash ||
    callback.searchParams.getAll("state").length !== 1
  )
    throw new Error("OAuth callback did not match this sign-in.");
  if (callback.searchParams.has("error")) throw new Error("OAuth sign-in was declined. Start again when ready.");
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.getAll("code").length !== 1)
    throw new Error("OAuth callback is missing its authorization code.");
  const issuer = callback.searchParams.get("iss");
  if (issuer && new URL(issuer).href !== new URL(flow.oauth.discovery!.authorizationServerUrl).href)
    throw new Error("OAuth callback issuer mismatch");
  const provider = new McpOAuthProvider(
    { read: async () => flow.oauth, update: async (change) => change(flow.oauth) },
    flow.oauth,
    flow.interaction,
  );
  const result = await auth(provider, {
    serverUrl: flow.serverUrl,
    authorizationCode: code,
    scope: flow.oauth.scope,
    fetchFn: oauthFetch,
  });
  if (result !== "AUTHORIZED" || !flow.oauth.tokens) throw new Error("OAuth sign-in did not return a token.");
  flow.oauth.redirectUri = flow.interaction.redirectUri;
}

export function oauthError(error: unknown): Error {
  if (error instanceof McpSignInRequired) return error;
  if (/registration|client information|client_id|client id/i.test(error instanceof Error ? error.message : ""))
    return new Error(
      "This server requires a registered OAuth client. Enter its client ID and, if required, client secret in the connection settings.",
    );
  return new Error(
    "OAuth sign-in failed. Check the client registration, callback URL and server availability, then try again.",
  );
}
