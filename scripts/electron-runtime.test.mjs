import assert from "node:assert/strict";
import test from "node:test";
import { macFinderLaunch } from "./electron-runtime.mjs";

test("Finder launch opens the app bundle through LaunchServices with arguments preserved", () => {
  const launch = macFinderLaunch(
    "/repo/packages/gateway/.electron-runtime/HatoPad Gateway.app/Contents/MacOS/Electron",
    "/repo/packages/gateway",
    ["--example", "path with spaces"],
    {
      HATOPAD_NODE_EXECUTABLE: "/runtime/bin/node",
      HATOPAD_DESKTOP_EXECUTABLE: "/runtime/HatoPad.app/Contents/MacOS/Electron",
      HATOPAD_DESKTOP_ICON: "/repo/icon.png",
      ANTHROPIC_API_KEY: "NEVER-FORWARD",
      ELECTRON_RUN_AS_NODE: "1",
      VITE_DEV_SERVER_URL: "http://localhost:5174",
    },
  );
  assert.equal(launch.command, "/usr/bin/open");
  assert.deepEqual(launch.args.slice(0, 3), [
    "-n",
    "-a",
    "/repo/packages/gateway/.electron-runtime/HatoPad Gateway.app",
  ]);
  assert.deepEqual(
    launch.args.slice(-4),
    ["--args", "/repo/packages/gateway", "--example", "path with spaces"].slice(-4),
  );
  assert.ok(launch.args.includes("HATOPAD_NODE_EXECUTABLE=/runtime/bin/node"));
  assert.ok(launch.args.includes("ELECTRON_RUN_AS_NODE="));
  assert.ok(launch.args.includes("VITE_DEV_SERVER_URL="));
  assert.ok(!launch.args.some((arg) => arg.includes("NEVER-FORWARD")));
  assert.ok(!launch.args.includes("-W"));
});
test("Finder launch requires an application bundle", () => {
  assert.throws(() => macFinderLaunch("/usr/local/bin/electron", "/repo", [], {}), /application bundle/);
});
