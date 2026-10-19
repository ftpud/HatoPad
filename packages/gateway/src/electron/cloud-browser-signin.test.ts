import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { signInCloudWithBrowser } from "./cloud-browser-signin.js";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("browser sign-in verifies state, binds PKCE, and exchanges the code only in Gateway's session", async () => {
  let authorization: URL | undefined;
  let exchanges = 0;
  const code = "A".repeat(43);
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://hub.example");
    assert.equal(options?.credentials, "include");
    assert.equal(options?.redirect, "error");
    if (url.pathname === "/api/desktop/capabilities") return json({ version: 1 });
    assert.equal(url.pathname, "/api/desktop/exchange"); exchanges++;
    assert.equal(options?.method, "POST");
    const body = JSON.parse(String(options.body));
    assert.equal(body.code, code);
    assert.equal(body.redirect_uri, authorization!.searchParams.get("redirect_uri"));
    assert.equal(createHash("sha256").update(body.verifier).digest("base64url"), authorization!.searchParams.get("code_challenge"));
    assert.equal(authorization!.searchParams.has("verifier"), false);
    assert.equal((options.headers as Record<string, string>).origin, undefined);
    return json({ ok: true });
  };
  await signInCloudWithBrowser({ origin: "https://hub.example", fetch: request, openExternal: async (url) => {
    authorization = new URL(url);
    assert.equal(authorization.pathname, "/auth/desktop");
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    assert.equal(callback.hostname, "127.0.0.1");
    callback.searchParams.set("code", code); callback.searchParams.set("state", "invalid");
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(exchanges, 0);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    const result = await fetch(callback); assert.equal(result.status, 200);
    assert.match(await result.text(), /Signed in/);
  } });
  assert.equal(exchanges, 1);
  await assert.rejects(fetch(authorization!.searchParams.get("redirect_uri")!));
});

test("older Hubs get an actionable error without opening a broken browser flow", async () => {
  let opened = false;
  await assert.rejects(signInCloudWithBrowser({ origin: "https://hub.example", fetch: async () => json({}, 404), openExternal: async () => { opened = true; } }), /Hub needs the browser sign-in update/);
  assert.equal(opened, false);
});

test("sign-in cancellation closes the callback listener", async () => {
  const controller = new AbortController();
  let callback = "";
  await assert.rejects(signInCloudWithBrowser({ origin: "https://hub.example", fetch: async () => json({ version: 1 }), signal: controller.signal, openExternal: async url => {
    callback = new URL(url).searchParams.get("redirect_uri")!; controller.abort();
  } }), /cancelled/);
  await assert.rejects(fetch(callback));
});

test("a browser launch failure closes the callback listener", async () => {
  let callback = "";
  await assert.rejects(signInCloudWithBrowser({ origin: "https://hub.example", fetch: async () => json({ version: 1 }), openExternal: async url => {
    callback = new URL(url).searchParams.get("redirect_uri")!; throw new Error("Could not open browser");
  } }), /Could not open browser/);
  await assert.rejects(fetch(callback));
});

test("a failed exchange is not retried automatically", async () => {
  let exchanges = 0;
  const attempt = signInCloudWithBrowser({ origin: "https://hub.example", fetch: async input => {
    if (String(input).endsWith("/capabilities")) return json({ version: 1 });
    exchanges++; return json({}, 400);
  }, openExternal: async url => {
    const authorization = new URL(url); const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", authorization.searchParams.get("state")!); callback.searchParams.set("code", "A".repeat(43));
    assert.equal((await fetch(callback)).status, 502);
  } });
  await assert.rejects(attempt, /Could not complete cloud sign-in/);
  assert.equal(exchanges, 1);
});
