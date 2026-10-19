/** Hub HTTP contracts stay local to Gateway; Gateway does not import other workspaces. */
export type CloudCore = { id: string; name: string; status: string; access: "owner" | "operator" };
export type CloudAccount = { origin: string; user: { id: string; name: string; email: string }; cores: CloudCore[] };
export function cloudOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Cloud URL must be an HTTPS origin (HTTP is allowed for localhost).");
  return url.origin;
}
export class CloudClient {
  constructor(readonly origin: string, private readonly request: typeof fetch) {}
  async call(path: string, payload?: unknown): Promise<any> {
    const session = payload === undefined ? undefined : await this.call("/api/session");
    const response = await this.request(new URL(path, this.origin).href, {
      method: payload === undefined ? "GET" : "POST", redirect: "error", credentials: "include",
      headers: payload === undefined ? {} : { "content-type": "application/json", origin: this.origin, "x-csrf-token": session.csrfToken },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 401) throw new Error("Sign in to cloud to continue.");
    if (!response.ok) throw new Error(`Cloud request failed (HTTP ${response.status}).`);
    return response.json();
  }
  async account(): Promise<CloudAccount> {
    const { user } = await this.call("/api/session");
    const cores: CloudCore[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.call(`/api/cores${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!Array.isArray(page.cores) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new Error("Invalid cloud server list.");
      cores.push(...page.cores); cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Cloud server pagination did not advance.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return { origin: this.origin, user, cores };
  }
}

/** Runs on the Core host. Only the pairing code crosses back to Gateway. */
export function cloudPairingScript(origin: string, email: string, name: string): string {
  return `const {PairingStore,pairDevice}=await import('@hatopad/connector');
const store=new PairingStore(process.env.HATOPAD_HUB_PAIRING_FILE);
if(await store.load())throw Error('This server is already paired. Manage its pairing in cloud before adding it again.');
const result=await pairDevice({hubOrigin:${JSON.stringify(origin)},deviceName:${JSON.stringify(name.slice(0, 80))},store,signal:AbortSignal.timeout(120_000),
showCode:code=>console.log('HATOPAD_PAIR_CODE:'+code),
confirmLocally:async claimant=>claimant.email===${JSON.stringify(email)}});
if(result.status!=='paired')throw Error('Cloud pairing failed: '+result.reason);`;
}
