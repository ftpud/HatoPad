const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Parse the one local Core endpoint the connector may dial. Browser input never reaches this. */
export function parseLocalCoreUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "ws:") throw new Error("Local Core endpoint must use ws://");
  if (!loopbackHosts.has(url.hostname)) throw new Error("Local Core endpoint must be loopback");
  if (url.username || url.password) throw new Error("Local Core endpoint must not embed credentials");
  return url;
}

/** Hubs must be reached over WSS; plain ws:// is allowed only to loopback for tests. */
export function parseHubUrl(value: string, allowInsecureLoopback = false): URL {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Hub URL must not embed credentials");
  if (url.protocol === "wss:") return url;
  if (url.protocol === "ws:" && allowInsecureLoopback && loopbackHosts.has(url.hostname)) return url;
  throw new Error("Hub URL must use wss://");
}
