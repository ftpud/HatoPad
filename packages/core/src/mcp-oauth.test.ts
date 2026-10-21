import { createServer, type Server, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { McpLibrary } from "./mcp-library.js";
import { closeMcpConnections } from "./mcp-client.js";

const servers: Server[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await closeMcpConnections();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function body(request: IncomingMessage) {
  const data: Buffer[] = [];
  for await (const chunk of request) data.push(chunk);
  return Buffer.concat(data).toString();
}

async function setup(dynamic = true) {
  let base = "",
    expectedToken = "access-1",
    refreshes = 0;
  const tokenRequests: URLSearchParams[] = [],
    registrations: Record<string, unknown>[] = [],
    requests: string[] = [];
  let authorization: URL | undefined;
  const server = createServer(async (request, response) => {
    const route = new URL(request.url!, base).pathname;
    requests.push(route);
    const json = (value: unknown, status = 200) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (route === "/resource")
      return json({
        resource: `${base}/mcp`,
        authorization_servers: [`${base}/issuer`],
        scopes_supported: ["issues:write"],
      });
    if (route.includes(".well-known/oauth-authorization-server") || route.includes(".well-known/openid-configuration"))
      return json({
        issuer: `${base}/issuer`,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(dynamic ? { registration_endpoint: `${base}/register` } : {}),
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    if (route === "/register") {
      const input = JSON.parse(await body(request));
      registrations.push(input);
      return json({ ...input, client_id: "dynamic-client" }, 201);
    }
    if (route === "/token") {
      const input = new URLSearchParams(await body(request));
      tokenRequests.push(input);
      if (input.get("grant_type") === "authorization_code") {
        if (
          !authorization ||
          createHash("sha256").update(input.get("code_verifier")!).digest("base64url") !==
            authorization.searchParams.get("code_challenge")
        )
          return json({ error: "invalid_grant" }, 400);
        if (input.get("redirect_uri") !== authorization.searchParams.get("redirect_uri"))
          return json({ error: "invalid_grant" }, 400);
      } else {
        refreshes++;
        expectedToken = `access-${refreshes + 1}`;
      }
      return json({
        access_token: expectedToken,
        token_type: "Bearer",
        refresh_token: `refresh-${refreshes + 1}`,
        expires_in: 3600,
        scope: "issues:write",
      });
    }
    if (route === "/mcp") {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${expectedToken}`) {
        response.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/resource"` }).end();
        return;
      }
      const input = JSON.parse(await body(request));
      if (input.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (input.method === "initialize")
        return json({
          jsonrpc: "2.0",
          id: input.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "OAuth fixture", version: "1" },
          },
        });
      return json({
        jsonrpc: "2.0",
        id: input.id,
        result:
          input.method === "tools/list"
            ? { tools: [{ name: "issues", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: "Created issue" }] },
      });
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-oauth-"));
  directories.push(directory);
  const library = new McpLibrary(directory, path.join(directory, "state"));
  const input = {
    id: "issues",
    name: "Issues",
    url: `${base}/mcp`,
    defaultConnectionId: "bot",
    connections: [
      {
        id: "bot",
        name: "Bot",
        authType: "oauth" as const,
        oauth: {
          scope: "issues:write",
          ...(dynamic ? {} : { clientId: "registered-client", clientSecret: "registered-secret" }),
        },
      },
    ],
  };
  await library.save(input);
  const selection = { serverId: "issues", connectionId: "bot" };
  const start = async () => {
    const flow = await library.startOAuth(selection, "http://127.0.0.1:54321/mcp/oauth/callback");
    authorization = new URL(flow.authorizationUrl);
    return flow;
  };
  const callback = (flow: { state: string }) =>
    `http://127.0.0.1:54321/mcp/oauth/callback?code=authorization-code&state=${flow.state}`;
  return {
    base,
    directory,
    library,
    input,
    selection,
    start,
    callback,
    tokenRequests,
    registrations,
    requests,
    refreshes: () => refreshes,
  };
}

it("discovers the advertised authorization server, registers a client, and completes PKCE without exposing tokens", async () => {
  const fixture = await setup();
  const { library, selection } = fixture;
  await expect(library.actions(selection)).rejects.toThrow("Sign in");
  const flow = await fixture.start();
  const url = new URL(flow.authorizationUrl);
  expect(url.pathname).toBe("/authorize");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBe(flow.state);
  expect(url.searchParams.get("scope")).toBe("issues:write");
  expect(fixture.requests).toContain("/resource");
  expect(fixture.registrations).toHaveLength(1);
  await library.finishOAuth(flow.flowId, fixture.callback(flow));
  expect((await library.actions(selection))[0]?.name).toBe("issues");
  expect((await library.call(selection, "issues", {})).content).toEqual([{ type: "text", text: "Created issue" }]);
  expect((await library.list())[0]?.connections[0]?.oauth?.connected).toBe(true);
  expect(JSON.stringify(await library.list())).not.toContain("access-1");
  expect(JSON.stringify(await library.list())).not.toContain("refresh-1");
  const stored = await readFile(library.file, "utf8");
  expect(stored).toContain("access-1");
  expect(stored).not.toContain("authorization-code");
  expect(stored).not.toContain(url.searchParams.get("code_challenge")!);
  await expect(library.finishOAuth(flow.flowId, fixture.callback(flow))).rejects.toThrow("expired");
});

it("supports pre-registered clients on servers without dynamic registration", async () => {
  const fixture = await setup(false);
  const flow = await fixture.start();
  expect(new URL(flow.authorizationUrl).searchParams.get("client_id")).toBe("registered-client");
  await fixture.library.finishOAuth(flow.flowId, fixture.callback(flow));
  expect(fixture.tokenRequests[0]?.get("client_secret")).toBe("registered-secret");
  expect(JSON.stringify(await fixture.library.list())).not.toContain("registered-secret");
  expect(fixture.registrations).toHaveLength(0);
});

it("re-registers dynamic clients for a changed loopback port and preserves the old grant on cancel", async () => {
  const fixture = await setup();
  const first = await fixture.start();
  await fixture.library.finishOAuth(first.flowId, fixture.callback(first));
  const next = await fixture.library.startOAuth(fixture.selection, "http://127.0.0.1:54322/mcp/oauth/callback");
  expect(fixture.registrations).toHaveLength(2);
  fixture.library.cancelOAuth(next.flowId);
  expect((await fixture.library.actions(fixture.selection))[0]?.name).toBe("issues");
});

it("rejects mismatched callbacks, cancelled flows, changed connections and cross-project completion", async () => {
  const fixture = await setup();
  const { library } = fixture;
  let flow = await fixture.start();
  await expect(library.finishOAuth(flow.flowId, fixture.callback({ state: "wrong" }))).rejects.toThrow(
    "OAuth sign-in failed",
  );
  expect(fixture.tokenRequests).toHaveLength(0);
  flow = await fixture.start();
  library.cancelOAuth(flow.flowId);
  await expect(library.finishOAuth(flow.flowId, fixture.callback(flow))).rejects.toThrow("expired");
  flow = await fixture.start();
  const other = new McpLibrary(path.join(fixture.directory, "other"), path.join(fixture.directory, "state"));
  await expect(other.finishOAuth(flow.flowId, fixture.callback(flow))).rejects.toThrow("expired");
  await library.save({
    ...fixture.input,
    connections: [{ ...fixture.input.connections[0]!, oauth: { clientId: "changed-client" } }],
  });
  await expect(library.finishOAuth(flow.flowId, fixture.callback(flow))).rejects.toThrow("Sign in");
  expect(fixture.tokenRequests).toHaveLength(0);
});

it("refreshes expired tokens once for concurrent calls, persists rotation and disconnects", async () => {
  const fixture = await setup();
  const { library, selection } = fixture;
  const flow = await fixture.start();
  await library.finishOAuth(flow.flowId, fixture.callback(flow));
  const future = Date.now() + 3601000;
  vi.spyOn(Date, "now").mockReturnValue(future);
  await Promise.all([library.actions(selection), library.actions(selection)]);
  expect(fixture.refreshes()).toBe(1);
  expect(await readFile(library.file, "utf8")).toContain("refresh-2");
  await library.disconnectOAuth(selection);
  await expect(library.actions(selection)).rejects.toThrow("Sign in");
  expect((await library.list())[0]?.connections[0]?.oauth?.connected).toBe(false);
  expect(await readFile(library.file, "utf8")).not.toContain("access-2");
});
