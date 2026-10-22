import crypto from "node:crypto";
import { createServer, type Server } from "node:http";

type Callback = {
  owner: number;
  server: Server;
  redirectUri: string;
  state?: string;
  result: Promise<string>;
  resolve(value: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  waiting?: boolean;
};

/** The loopback listener runs beside the browser, even when Core is remote. */
export class McpOAuthCallbacks {
  private readonly pending = new Map<string, Callback>();
  constructor(private readonly timeoutMs = 300000) {}
  async prepare(owner: number, port = 0) {
    if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535)))
      throw new Error("Invalid OAuth callback port");
    for (const [id, item] of this.pending) if (item.owner === owner) this.cancel(owner, id);
    const id = crypto.randomUUID();
    let resolve!: (value: string) => void, reject!: (error: Error) => void;
    const result = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void result.catch(() => {});
    const server = createServer((request, response) => {
      const item = this.pending.get(id);
      let url: URL;
      try {
        url = new URL(request.url ?? "/", item?.redirectUri ?? "http://127.0.0.1");
      } catch {
        response.writeHead(400).end("Invalid OAuth callback");
        return;
      }
      if (
        !item ||
        request.method !== "GET" ||
        request.headers.host !== new URL(item.redirectUri).host ||
        url.origin !== new URL(item.redirectUri).origin ||
        url.pathname !== "/mcp/oauth/callback" ||
        !item.state ||
        url.searchParams.get("state") !== item.state ||
        url.searchParams.getAll("state").length !== 1 ||
        (request.url?.length ?? 0) > 16000
      ) {
        response.writeHead(400).end("Invalid OAuth callback");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
        "referrer-policy": "no-referrer",
      });
      response.end(
        "<!doctype html><title>HatoPad sign-in</title><p>Return to HatoPad to finish connecting. You can close this tab.</p>",
      );
      this.pending.delete(id);
      clearTimeout(item.timer);
      server.close();
      item.resolve(url.href);
    });
    try {
      await new Promise<void>((yes, no) => {
        server.once("error", no);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", no);
          yes();
        });
      });
    } catch {
      server.close();
      throw new Error("Could not open the OAuth callback port. Choose another port or use automatic.");
    }
    server.unref();
    const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp/oauth/callback`;
    const timer = setTimeout(() => this.cancel(owner, id, "OAuth sign-in timed out. Try again."), this.timeoutMs);
    timer.unref();
    this.pending.set(id, { owner, server, redirectUri, result, resolve, reject, timer });
    return { id, redirectUri };
  }
  wait(owner: number, id: string, state: string) {
    const item = this.pending.get(id);
    if (
      !item ||
      item.owner !== owner ||
      item.waiting ||
      typeof state !== "string" ||
      !/^[A-Za-z0-9_-]{32,200}$/.test(state)
    )
      throw new Error("OAuth callback no longer available");
    item.state = state;
    item.waiting = true;
    return item.result;
  }
  cancel(owner: number, id: string, message = "OAuth sign-in cancelled") {
    const item = this.pending.get(id);
    if (!item || item.owner !== owner) return;
    this.pending.delete(id);
    clearTimeout(item.timer);
    item.server.close();
    item.server.closeAllConnections();
    item.reject(new Error(message));
  }
  close(owner?: number) {
    for (const [id, item] of this.pending) if (owner === undefined || item.owner === owner) this.cancel(item.owner, id);
  }
}
