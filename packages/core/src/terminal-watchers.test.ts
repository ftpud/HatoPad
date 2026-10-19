import { expect, it } from "vitest";
import type { ServerEvent } from "@hatopad/protocol";
import { TerminalWatchers, watcherLimits } from "./terminal-watchers.js";
const scope = { rootId: "root-a", workspace: "/workspace" };
it("sends live output only to acknowledged watchers, with independent flow control", () => {
  const events: { socket: object; event: ServerEvent }[] = [];
  const manager = new TerminalWatchers<object>((socket, event) => {
    events.push({ socket, event });
    return true;
  });
  const a = {},
    b = {};
  const wa = manager.attach(a, scope, "pty"),
    wb = manager.attach(b, scope, "pty");
  manager.output(scope.workspace, "pty", "replay gap");
  expect(events).toHaveLength(0);
  manager.acknowledge(a, scope, wa, 0);
  expect(events).toHaveLength(1);
  expect(events[0]!.socket).toBe(a);
  manager.acknowledge(b, scope, wb, 0);
  expect(events).toHaveLength(2);
  manager.output(scope.workspace, "another", "wrong PTY");
  manager.output("/foreign", "pty", "wrong workspace");
  expect(events).toHaveLength(2);
  expect(() => manager.acknowledge(b, scope, wa, 1)).toThrow("unavailable");
  expect(() => manager.acknowledge(a, { ...scope, rootId: "other" }, wa, 1)).toThrow("unavailable");
  expect(() => manager.acknowledge(a, scope, wa, 99)).toThrow("acknowledgement");
  manager.detach(a, scope, wa);
  manager.output(scope.workspace, "pty", "live");
  expect(events.at(-1)!.socket).toBe(b);
  manager.disconnect(b);
  const count = events.length;
  manager.output(scope.workspace, "pty", "after close");
  expect(events).toHaveLength(count);
});
it("bounds outstanding and queued bytes, marks dropped output, preserves UTF-8 and drains before exit", () => {
  const events: ServerEvent[] = [];
  const socket = {};
  const manager = new TerminalWatchers<object>((_socket, event) => {
    events.push(event);
    return true;
  });
  const id = manager.attach(socket, scope, "pty");
  manager.acknowledge(socket, scope, id, 0);
  manager.output(scope.workspace, "pty", "a".repeat(watcherLimits.windowBytes));
  expect(events).toHaveLength(4);
  manager.output(scope.workspace, "pty", "🙂".repeat(watcherLimits.pendingBytes));
  manager.exit(scope.workspace, "pty", 3);
  expect(events).toHaveLength(4);
  manager.acknowledge(socket, scope, id, 4);
  expect(events).toHaveLength(9);
  expect(events.at(-1)!.type).toBe("terminal.watch.exit");
  const output = events.slice(4, 8).map((event) => {
    if (event.type !== "terminal.watch.output") throw new Error();
    return event;
  });
  expect(output[0]!.payload.truncated).toBe(true);
  expect(output.reduce((sum, event) => sum + Buffer.byteLength(event.payload.data), 0)).toBe(
    watcherLimits.pendingBytes,
  );
  expect(output.some((event) => event.payload.data.includes("\ufffd"))).toBe(false);
  expect(() => manager.acknowledge(socket, scope, id, 3)).toThrow("acknowledgement");
  manager.acknowledge(socket, scope, id, 8);
  manager.acknowledge(socket, scope, id, 8);
  expect(events).toHaveLength(9);
});
it("limits per connection and cleans up when transport rejects a frame", () => {
  const manager = new TerminalWatchers<object>(() => false);
  const socket = {};
  const first = manager.attach(socket, scope, "pty");
  for (let i = 1; i < watcherLimits.perConnection; i++) manager.attach(socket, scope, `pty-${i}`);
  expect(() => manager.attach(socket, scope, "overflow")).toThrow("Too many");
  manager.acknowledge(socket, scope, first, 0);
  manager.output(scope.workspace, "pty", "data");
  expect(() => manager.acknowledge(socket, scope, first, 1)).toThrow("unavailable");
  expect(manager.attach(socket, scope, "new")).toEqual(expect.any(String));
});
