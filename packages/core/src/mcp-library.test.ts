import { closeMcpConnections } from "./mcp-client.js";
import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpLibrary, executeWorkflowMcp } from "./mcp-library.js";
import { HarnessStore } from "./harnesses.js";
import { HarnessRunner } from "./harness-runner.js";
import type { HarnessBlock, AiSession } from "@hatopad/protocol";
import { spawn } from "node:child_process";
import { libraryMcpServer } from "./mcp-proxy.js";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const directories: string[] = [];
const servers: Server[] = [];
const runners: HarnessRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.drain();
  await closeMcpConnections();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hatopad-mcp-"));
  directories.push(directory);
  const authorizations: (string | undefined)[] = [];
  const calls: unknown[] = [];
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    authorizations.push(req.headers.authorization);
    if (req.headers.authorization === "Bearer rejected") {
      res.writeHead(401).end("secret-from-server");
      return;
    }
    const buffers: Buffer[] = [];
    for await (const buffer of req) buffers.push(buffer);
    const request = JSON.parse(Buffer.concat(buffers).toString());
    methods.push(request.method);
    if (request.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result: unknown;
    if (request.method === "initialize")
      result = {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "fixture", version: "1" },
        capabilities: { tools: {} },
      };
    else if (request.method === "tools/list")
      result = request.params?.cursor
        ? { tools: [{ name: "comment", description: "Comment on an issue", inputSchema: { type: "object" } }] }
        : { tools: [{ name: "issues", inputSchema: { type: "object" } }], nextCursor: "next" };
    else {
      calls.push(request.params);
      result = { content: [{ type: "text", text: `Called ${request.params.name}` }] };
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  const library = new McpLibrary(directory, path.join(directory, "state"));
  const input = {
    id: "github",
    name: "GitHub",
    url,
    defaultConnectionId: "bot",
    connections: [
      { id: "bot", name: "Bot", token: "bot-secret" },
      { id: "personal", name: "Personal", token: "personal-secret" },
    ],
  };
  await library.save(input);
  return { directory, library, input, authorizations, calls, methods };
}

it("stores private credentials outside the project and never includes them in public records", async () => {
  const { library, input, directory } = await setup();
  const publicServers = await library.list();
  expect(JSON.stringify(publicServers)).not.toContain("secret");
  expect(publicServers[0]?.connections[0]).toEqual({ id: "bot", name: "Bot", hasCredentials: true, authType: "token" });
  expect((await stat(library.file)).mode & 0o777).toBe(0o600);
  expect((await stat(path.dirname(library.file))).mode & 0o777).toBe(0o700);
  await library.save({
    ...input,
    name: "Renamed",
    connections: input.connections.map(({ token, ...connection }) => connection),
  });
  expect(await readFile(library.file, "utf8")).toContain("bot-secret");
  expect(await new McpLibrary(path.join(directory, "other"), path.join(directory, "state")).list()).toEqual([]);
  await library.save({
    ...input,
    url: input.url + "/changed",
    connections: input.connections.map(({ token, ...connection }) => connection),
  });
  expect(await readFile(library.file, "utf8")).not.toContain("secret");
});

it("discovers every page and calls tools with the selected or default connection", async () => {
  const { library, input, authorizations, calls, methods } = await setup();
  expect((await library.actions({ serverId: "github" })).map((action) => action.name)).toEqual(["issues", "comment"]);
  expect(authorizations.every((header) => header === "Bearer bot-secret")).toBe(true);
  await library.actions({ serverId: "github" });
  expect(methods.filter((method) => method === "initialize")).toHaveLength(1);
  authorizations.length = 0;
  const result = await library.call({ serverId: "github", connectionId: "personal" }, "comment", { text: "Hi" });
  expect(result.content).toEqual([{ type: "text", text: "Called comment" }]);
  expect(calls).toEqual([{ name: "comment", arguments: { text: "Hi" } }]);
  expect(authorizations.every((header) => header === "Bearer personal-secret")).toBe(true);
  authorizations.length = 0;
  await library.save({ ...input, defaultConnectionId: "personal" });
  await library.actions({ serverId: "github" });
  expect(authorizations.every((header) => header === "Bearer personal-secret")).toBe(true);
});

it("falls back to legacy SSE and authenticates both the event stream and POST requests", async () => {
  const { library, input } = await setup();
  const sessions = new Map<string, SSEServerTransport>();
  const authorizations: (string | undefined)[] = [];
  const server = createServer(async (request, response) => {
    authorizations.push(request.headers.authorization);
    if (request.method === "GET" && request.url === "/sse") {
      const mcp = new McpServer({ name: "legacy", version: "1" }, { capabilities: { tools: {} } });
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: "legacy_tool", inputSchema: { type: "object" } }],
      }));
      const transport = new SSEServerTransport("/messages", response);
      sessions.set(transport.sessionId, transport);
      await mcp.connect(transport);
    } else if (request.method === "POST" && request.url?.startsWith("/messages")) {
      const id = new URL(request.url, "http://localhost").searchParams.get("sessionId")!;
      await sessions.get(id)!.handlePostMessage(request, response);
    } else response.writeHead(405).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await library.save({ ...input, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/sse` });
  expect((await library.actions({ serverId: "github" }))[0]?.name).toBe("legacy_tool");
  expect(authorizations.length).toBeGreaterThan(2);
  expect(authorizations.every((header) => header === "Bearer bot-secret")).toBe(true);
});

it("validates connections and redacts transport authentication errors", async () => {
  const { library, input } = await setup();
  await expect(library.save({ ...input, url: "file:///tmp/token" })).rejects.toThrow("HTTP");
  await expect(library.save({ ...input, defaultConnectionId: "missing" })).rejects.toThrow("default");
  await expect(library.validateSelections([{ serverId: "github", connectionId: "missing" }])).rejects.toThrow(
    "no longer exists",
  );
  await library.save({ ...input, connections: [{ id: "bot", name: "Bot", token: "rejected" }] });
  await expect(library.actions({ serverId: "github" })).rejects.toThrow("MCP authentication failed");
  await library.delete("github");
  expect(await library.list()).toEqual([]);
  await expect(library.call({ serverId: "github" }, "issues", {})).rejects.toThrow("no longer exists");
});

it("exposes remote tools to an ACP client through a credential-free stdio proxy", async () => {
  const { directory, authorizations } = await setup();
  const config = libraryMcpServer(
    directory,
    { serverId: "github", connectionId: "personal" },
    path.join(directory, "state"),
  );
  expect(JSON.stringify(config)).not.toContain("secret");
  if (config.transport !== "stdio") throw new Error("Expected a stdio proxy");
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let text = "",
      errors = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(text) : reject(new Error(errors))));
    child.stdin.end(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "comment", arguments: {} } },
      ]
        .map((message) => JSON.stringify(message))
        .join("\n") + "\n",
    );
  });
  const replies = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(replies.find((reply) => reply.id === 2).result.tools).toHaveLength(2);
  expect(replies.find((reply) => reply.id === 3).result.content).toEqual([{ type: "text", text: "Called comment" }]);
  expect(authorizations.every((header) => header === "Bearer personal-secret")).toBe(true);
});

it.each(["ai", "chatbox"] as const)(
  "lets a connected %s discover and invoke MCP actions with connection pulses",
  async (type) => {
    const { directory } = await setup();
    vi.stubEnv("HATOPAD_STATE_DIR", path.join(directory, "state"));
    const store = new HarnessStore(directory, path.join(directory, "workflow-state"));
    const runner = new HarnessRunner(store, () => {}, 1);
    runners.push(runner);
    const draft = await store.create("MCP tools");
    const mcp: HarnessBlock = {
      id: "mcp",
      type: "mcp",
      label: "GitHub",
      prompt: "",
      mcp: { serverId: "github" },
      position: { x: 200, y: 0 },
    };
    const definition = await store.update({
      ...draft,
      blocks: [{ id: "agent", type, label: "Agent", prompt: "Manage issues", position: { x: 0, y: 0 } }, mcp],
      edges: [{ id: "use-mcp", from: "agent", to: "mcp", type: "use" }],
    });
    const dispatch: Parameters<HarnessRunner["start"]>[2] = async (block, input, runtime) => {
      if (block.type === "mcp") return executeWorkflowMcp(block, input, directory, runtime.assertActive);
      const list = await runner.flowTool(runtime.runId, "agent", "workflow_use_block", {
        block_id: "mcp",
        input: '{"action":"list"}',
      });
      expect(JSON.stringify(list)).toContain("comment");
      const result = await runner.flowTool(runtime.runId, "agent", "workflow_use_block", {
        block_id: "mcp",
        input: '{"action":"call","name":"comment","arguments":{"text":"Hello"}}',
      });
      expect(JSON.stringify(result)).toContain("Called comment");
      return {
        id: "agent-session",
        status: "idle",
        messages: [{ id: "response", role: "assistant", text: "Done", timestamp: new Date().toISOString() }],
      } as AiSession;
    };
    const run = await runner.start(definition.id, "Manage issues", dispatch, "fake", undefined, "agent");
    await vi.waitFor(async () =>
      expect((await store.runs()).find((item) => item.id === run.id)?.status).toBe("succeeded"),
    );
    const completed = (await store.runs()).find((item) => item.id === run.id)!;
    expect(
      completed.connectionTraces?.filter((connection) => connection.edgeId === "use-mcp").length,
    ).toBeGreaterThanOrEqual(4);
  },
);
