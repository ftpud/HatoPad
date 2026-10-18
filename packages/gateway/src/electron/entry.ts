import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EDITOR_FLAG, loadBundle } from "./bundled-runtime.js";
import { legacyUserDataPath } from "./legacy-user-data.js";

// A packaged Gateway ships the Editor's app files, not a second Electron runtime:
// started with `--hatopad`, this executable runs the bundled Editor instead.
if (app.isPackaged && process.argv.includes(EDITOR_FLAG)) {
  const bundle = await loadBundle(process.resourcesPath);
  // Same settings directory as the standalone HatoPad, separate from Gateway's.
  app.setPath("userData", legacyUserDataPath(app.getPath("appData"), "Vibe Editor", "HatoPad"));
  await import(pathToFileURL(path.join(process.resourcesPath, "bundle", bundle.desktopApp, "dist-electron", "main.js")).href);
} else await import("./main.js");
