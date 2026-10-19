import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

type BrowserSignInOptions = {
  origin: string;
  fetch: typeof fetch;
  openExternal(url: string): Promise<unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
};
const page = (message: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HatoPad Gateway</title><body><h1>HatoPad Gateway</h1><p>${message}</p></body></html>`;

/** External-browser authorization, with a one-use code bound to this process by PKCE. */
export async function signInCloudWithBrowser(options: BrowserSignInOptions): Promise<void> {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs ?? 300_000)]);
  const call = (url: URL, init?: RequestInit) => options.fetch(url.href, { ...init, credentials: "include", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  const capabilities = await call(new URL("/api/desktop/capabilities", options.origin));
  const supported = capabilities.ok ? await capabilities.json().catch(() => undefined) : undefined;
  if (supported?.version !== 1) throw new Error("Hub needs the browser sign-in update before Gateway can use passkeys. Update Hub and try again.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let redirectUri = "";
  let processing = false;
  let succeed!: () => void;
  let fail!: (reason: Error) => void;
  const completed = new Promise<void>((resolve, reject) => { succeed = resolve; fail = reject; });
  // Attach immediately: cancellation can arrive before the browser launch finishes.
  void completed.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const reject = (status: number) => { response.writeHead(status); response.end(page("This sign-in response was not accepted. Return to Gateway and try again.")); };
    if (request.method !== "GET") { reject(405); return; }
    if (!redirectUri || request.headers.host !== new URL(redirectUri).host) { reject(403); return; }
    const callback = new URL(request.url ?? "/", redirectUri);
    if (callback.pathname !== "/callback") { reject(404); return; }
    const supplied = callback.searchParams.get("state") ?? "";
    if (callback.searchParams.getAll("state").length !== 1 || Buffer.byteLength(supplied) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(state))) { reject(400); return; }
    if (processing) { reject(409); return; }
    if (callback.searchParams.get("error") === "access_denied") {
      response.end(page("Sign-in was cancelled. You can return to Gateway.")); fail(new Error("Cloud sign-in was cancelled.")); return;
    }
    const code = callback.searchParams.get("code");
    if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code) || callback.searchParams.getAll("code").length !== 1) { reject(400); return; }
    processing = true;
    void call(new URL("/api/desktop/exchange", options.origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier, redirect_uri: redirectUri })
    }).then(async (result) => {
      if (!result.ok || (await result.json()).ok !== true) throw new Error("Could not complete cloud sign-in. Start sign-in again in Gateway.");
      response.end(page("Signed in. You can close this tab and return to Gateway."), succeed);
    }).catch((error: unknown) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(502); response.end(page("Could not finish sign-in. Return to Gateway and try again.")); } fail(error instanceof Error ? error : new Error("Cloud sign-in failed.")); });
  });
  const abort = () => fail(new Error(options.signal?.aborted ? "Cloud sign-in was cancelled." : "Cloud sign-in timed out."));
  signal.addEventListener("abort", abort, { once: true });
  server.on("error", fail);
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not open the cloud sign-in callback.");
    redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const authorization = new URL("/auth/desktop", options.origin);
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    await options.openExternal(authorization.href);
    await completed;
  } finally {
    signal.removeEventListener("abort", abort);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
