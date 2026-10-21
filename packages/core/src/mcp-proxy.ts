import { closeMcpConnections } from "./mcp-client.js";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AiMcpServer } from "@hatopad/acp";
import type { McpSelection } from "@hatopad/protocol";
import { McpLibrary } from "./mcp-library.js";

/** ACP sees a local MCP server with references only; credentials remain in Core state. */
export function libraryMcpServer(rootWorkspace: string, selection: McpSelection, stateDirectory: string): AiMcpServer {
  const source = import.meta.url.endsWith(".ts");
  return {
    transport: "stdio",
    name: `library-${selection.serverId}`,
    command: process.execPath,
    args: [
      ...(source ? ["--import", "tsx"] : []),
      fileURLToPath(new URL(source ? "mcp-proxy.ts" : "mcp-proxy.js", import.meta.url)),
    ],
    env: {
      HATOPAD_STATE_DIR: stateDirectory,
      HATOPAD_MCP_ROOT: rootWorkspace,
      HATOPAD_MCP_SERVER: selection.serverId,
      ...(selection.connectionId ? { HATOPAD_MCP_CONNECTION: selection.connectionId } : {}),
    },
  };
}

async function main() {
  const library = new McpLibrary(process.env.HATOPAD_MCP_ROOT!);
  const selection = { serverId: process.env.HATOPAD_MCP_SERVER!, connectionId: process.env.HATOPAD_MCP_CONNECTION };
  const lines = createInterface({ input: process.stdin, terminal: false });
  const pending = new Set<Promise<void>>();
  lines.on("line", (line) => {
    const call = (async () => {
      let request: {
        id?: string | number;
        method: string;
        params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> };
      };
      try {
        request = JSON.parse(line);
      } catch {
        return;
      }
      if (request.id === undefined) return;
      const reply = (result: unknown) =>
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
      try {
        if (request.method === "initialize")
          reply({
            protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "hatopad-mcp-proxy", version: "0.1.0" },
          });
        else if (request.method === "ping") reply({});
        else if (request.method === "tools/list") reply({ tools: await library.actions(selection) });
        else if (request.method === "tools/call")
          reply(await library.call(selection, request.params?.name ?? "", request.params?.arguments ?? {}));
        else
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } })}\n`,
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : "MCP request failed";
        if (request.method === "tools/call") reply({ content: [{ type: "text", text: message }], isError: true });
        else
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message } })}\n`,
          );
      }
    })();
    pending.add(call);
    void call.finally(() => pending.delete(call));
  });
  lines.on("close", () => {
    void Promise.allSettled([...pending]).then(() => closeMcpConnections());
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
