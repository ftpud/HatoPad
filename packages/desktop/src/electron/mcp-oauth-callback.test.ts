import { afterEach, expect, it } from "vitest";
import { McpOAuthCallbacks } from "./mcp-oauth-callback.js";

const callbacks = new McpOAuthCallbacks();
afterEach(() => callbacks.close());
const state = "s".repeat(43);

it("accepts a browser callback only for the matching owner, path and state", async () => {
  const prepared = await callbacks.prepare(1);
  expect(prepared.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/oauth\/callback$/);
  expect(() => callbacks.wait(2, prepared.id, state)).toThrow("no longer available");
  const waiting = callbacks.wait(1, prepared.id, state);
  expect((await fetch(`${prepared.redirectUri}?state=wrong&code=code`)).status).toBe(400);
  expect((await fetch(`${prepared.redirectUri.replace("/callback", "/wrong")}?state=${state}&code=code`)).status).toBe(
    400,
  );
  const callbackUrl = `${prepared.redirectUri}?state=${state}&code=code`;
  const response = await fetch(callbackUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("code=code");
  expect(await waiting).toBe(callbackUrl);
  expect(() => callbacks.wait(1, prepared.id, state)).toThrow("no longer available");
});

it("cancels superseded sign-ins and releases the loopback listener", async () => {
  const first = await callbacks.prepare(1);
  const waiting = expect(callbacks.wait(1, first.id, state)).rejects.toThrow("cancelled");
  const second = await callbacks.prepare(1);
  await waiting;
  const secondWaiting = expect(callbacks.wait(1, second.id, state)).rejects.toThrow("cancelled");
  callbacks.cancel(2, second.id);
  callbacks.cancel(1, second.id);
  await secondWaiting;
});

it("supports a configured callback port and reports port conflicts", async () => {
  const first = await callbacks.prepare(1);
  const port = Number(new URL(first.redirectUri).port);
  await expect(callbacks.prepare(2, port)).rejects.toThrow("callback port");
  callbacks.cancel(1, first.id);
  const second = await callbacks.prepare(2, port);
  expect(Number(new URL(second.redirectUri).port)).toBe(port);
});
