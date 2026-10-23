import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildInstanceAddress,
  claimBuildInstance,
  desktopBuildFingerprint,
  parseBuildInstanceLaunch,
  type BuildInstanceLaunch,
} from "./build-instance.js";

const temporary: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function directory(): string {
  const value = mkdtempSync(path.join(os.tmpdir(), "hp-bi-"));
  temporary.push(value);
  return value;
}
function build(root: string, renderer = "<script src=assets/a.js>", main = "export {};") {
  mkdirSync(path.join(root, "dist-electron"), { recursive: true });
  mkdirSync(path.join(root, "dist-renderer"), { recursive: true });
  writeFileSync(path.join(root, "dist-electron", "main.js"), main);
  writeFileSync(path.join(root, "dist-electron", "preload.cjs"), "module.exports = {};");
  writeFileSync(path.join(root, "dist-renderer", "index.html"), renderer);
  writeFileSync(path.join(root, "compatibility.json"), '{"connectionHandoff":1}');
  return root;
}
function address(): string {
  return buildInstanceAddress("a".repeat(24), directory());
}

describe("Desktop build fingerprint", () => {
  it("matches identical builds in different folders and separates any content change", () => {
    const first = desktopBuildFingerprint(build(directory()));
    expect(desktopBuildFingerprint(build(directory()))).toBe(first);
    expect(desktopBuildFingerprint(build(directory(), "<script src=assets/b.js>"))).not.toBe(first);
    expect(desktopBuildFingerprint(build(directory(), undefined, "export const changed = 1;"))).not.toBe(first);
    expect(desktopBuildFingerprint(build(directory()), ["other settings"])).not.toBe(first);
  });
});

describe("Desktop build instance address", () => {
  it("uses a named pipe on Windows and a short temp path when the settings path is too long", () => {
    expect(buildInstanceAddress("f".repeat(24), "C:\\Users\\me", "win32")).toBe(
      `\\\\.\\pipe\\hatopad-desktop-${"f".repeat(24)}`,
    );
    expect(buildInstanceAddress("f".repeat(24), `/${"x".repeat(120)}`, "darwin", "/tmp")).toBe(
      `/tmp/hatopad-desktop-${"f".repeat(24)}.sock`,
    );
    expect(buildInstanceAddress("f".repeat(24), "/home/me/.config/HatoPad", "linux")).toBe(
      `/home/me/.config/HatoPad/instances/desktop-${"f".repeat(24)}.sock`,
    );
  });
});

describe("Desktop build instance claim", () => {
  it("forwards a second launch of the same build to the first process", async () => {
    const socket = address();
    const received: BuildInstanceLaunch[] = [];
    const primary = await claimBuildInstance(socket, {}, (launch) => received.push(launch));
    expect(primary.role).toBe("primary");
    if (primary.role !== "forwarded") closers.push(primary.close);
    const launch = { connectionFile: "/private/connection-x.json", rootId: "root_1" };
    expect((await claimBuildInstance(socket, launch, vi.fn())).role).toBe("forwarded");
    await vi.waitFor(() => expect(received).toEqual([launch]));
  });

  it("takes over after the previous owner closed", async () => {
    const socket = address();
    const first = await claimBuildInstance(socket, {}, vi.fn());
    if (first.role !== "forwarded") first.close();
    expect(existsSync(socket)).toBe(false);
    const next = await claimBuildInstance(socket, {}, vi.fn());
    expect(next.role).toBe("primary");
    if (next.role !== "forwarded") closers.push(next.close);
  });

  it.skipIf(process.platform === "win32")("replaces the socket a crashed owner left behind", async () => {
    const socket = address();
    mkdirSync(path.dirname(socket), { recursive: true });
    const owner = spawn(process.execPath, [
      "-e",
      `require("net").createServer().listen(${JSON.stringify(socket)}, () => console.log("ready"))`,
    ]);
    await new Promise((resolve) => owner.stdout.once("data", resolve));
    owner.kill("SIGKILL");
    await new Promise((resolve) => owner.once("exit", resolve));
    expect(existsSync(socket)).toBe(true);
    const claim = await claimBuildInstance(socket, {}, vi.fn());
    expect(claim.role).toBe("primary");
    if (claim.role !== "forwarded") closers.push(claim.close);
  });

  it("runs standalone instead of failing when the owner never answers", async () => {
    const socket = address();
    mkdirSync(path.dirname(socket), { recursive: true });
    const silent = net.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(socket, resolve));
    closers.push(() => silent.close());
    const claim = await claimBuildInstance(socket, {}, vi.fn(), { timeoutMs: 100 });
    expect(claim.role).toBe("standalone");
  });
});

describe("Desktop build instance launch message", () => {
  it("accepts only bounded string fields and absolute connection files", () => {
    expect(parseBuildInstanceLaunch({ host: "127.0.0.1", port: "7331", extra: 1 })).toEqual({
      host: "127.0.0.1",
      port: "7331",
    });
    expect(() => parseBuildInstanceLaunch({ connectionFile: "relative.json" })).toThrow();
    expect(() => parseBuildInstanceLaunch({ host: "a\nb" })).toThrow();
    expect(() => parseBuildInstanceLaunch({ port: 7331 })).toThrow();
    expect(() => parseBuildInstanceLaunch(null)).toThrow();
  });
});
