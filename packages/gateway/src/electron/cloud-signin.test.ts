import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow, HandlerDetails, WindowOpenHandlerResponse } from "electron";
import { configureCloudSignInWindow, isCloudSignInUrl, selectCloudPasskey } from "./cloud-signin.js";

class SignInWindow extends EventEmitter {
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), {
    session: {},
    open: undefined as ((details: HandlerDetails) => WindowOpenHandlerResponse) | undefined,
    setWindowOpenHandler(handler: (details: HandlerDetails) => WindowOpenHandlerResponse) {
      this.open = handler;
    },
  });
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}
test("cloud authentication allows secure provider popups and rejects unsafe schemes", () => {
  for (const url of [
    "https://accounts.google.com/signin",
    "https://login.example/passkey",
    "about:blank",
    "http://localhost:8080/auth/callback",
  ])
    assert.equal(isCloudSignInUrl(url), true);
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hi",
    "http://login.example",
    "https://user:secret@login.example/",
    "invalid",
  ])
    assert.equal(isCloudSignInUrl(url), false);
});
test("cloud sign-in popups inherit the cloud session and stay sandboxed, including nested popups", () => {
  const parent = new SignInWindow();
  configureCloudSignInWindow(parent as unknown as BrowserWindow);
  const allowed = parent.webContents.open!({ url: "https://accounts.example/signin" } as HandlerDetails);
  assert.equal(allowed.action, "allow");
  assert.equal(allowed.overrideBrowserWindowOptions?.parent, parent);
  assert.deepEqual(allowed.overrideBrowserWindowOptions?.webPreferences, {
    session: parent.webContents.session,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  });
  assert.equal(parent.webContents.open!({ url: "file:///tmp/x" } as HandlerDetails).action, "deny");
  const child = new SignInWindow();
  const grandchild = new SignInWindow();
  parent.webContents.emit("did-create-window", child);
  child.webContents.emit("did-create-window", grandchild);
  assert.equal(child.webContents.open!({ url: "https://accounts.example/passkey" } as HandlerDetails).action, "allow");
  let prevented = false;
  child.webContents.emit(
    "will-navigate",
    {
      preventDefault() {
        prevented = true;
      },
    },
    "file:///tmp/x",
  );
  assert.equal(prevented, true);
  prevented = false;
  child.webContents.emit(
    "will-redirect",
    {
      preventDefault() {
        prevented = true;
      },
    },
    "javascript:alert(1)",
  );
  assert.equal(prevented, true);
  parent.destroy();
  assert.equal(child.destroyed, true);
  assert.equal(grandchild.destroyed, true);
});
test("passkey account selection returns the chosen credential once", async () => {
  const calls: (string | undefined)[] = [];
  await selectCloudPasskey(
    [
      { credentialId: "one", displayName: "First", name: "first@example.com" },
      { credentialId: "two", name: "second@example.com" },
    ],
    async (labels) => {
      assert.deepEqual(labels, ["First (first@example.com)", "second@example.com"]);
      return 1;
    },
    (selected) => calls.push(selected),
  );
  assert.deepEqual(calls, ["two"]);
});
test("cancelled, empty and failed passkey choosers always cancel the credential request once", async () => {
  for (const choose of [async () => -1, async () => 1]) {
    const calls: (string | undefined)[] = [];
    await selectCloudPasskey([{ credentialId: "one" }], choose, (selected) => calls.push(selected));
    assert.deepEqual(calls, [undefined]);
  }
  const calls: (string | undefined)[] = [];
  await assert.rejects(
    selectCloudPasskey(
      [{ credentialId: "one" }],
      async () => {
        throw Error("Dialog closed");
      },
      (selected) => calls.push(selected),
    ),
    /Dialog closed/,
  );
  assert.deepEqual(calls, [undefined]);
  const emptyCalls: (string | undefined)[] = [];
  await selectCloudPasskey(
    [],
    async () => {
      throw Error("Unexpected dialog");
    },
    (selected) => emptyCalls.push(selected),
  );
  assert.deepEqual(emptyCalls, [undefined]);
});
