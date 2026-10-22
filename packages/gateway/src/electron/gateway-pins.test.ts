import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readGatewayPins, updateGatewayPins, type GatewayPins } from "./gateway-pins.js";
import { JsonStateStore } from "./state-store.js";

test("pins survive Gateway state serialization and a new store instance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gateway-pins-"));
  try {
    const file = path.join(directory, "gateway.json");
    const create = () =>
      new JsonStateStore<{ pins: GatewayPins }>(
        file,
        () => ({ pins: readGatewayPins(undefined) }),
        (text) => ({ pins: readGatewayPins(JSON.parse(text).pins) }),
      );
    await create().update((state) => {
      state.pins = updateGatewayPins(state.pins, "connection", "ssh-one", true);
    });
    await create().update((state) => {
      state.pins = updateGatewayPins(state.pins, "workspace", "project", true);
    });
    assert.deepEqual((await create().read()).pins, { connections: ["ssh-one"], workspaces: ["project"] });
    await create().update((state) => {
      state.pins = updateGatewayPins(state.pins, "connection", "ssh-one", false);
    });
    assert.deepEqual((await create().read()).pins, { connections: [], workspaces: ["project"] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("old settings have no pins and malformed pin requests cannot alter another preference", () => {
  assert.deepEqual(readGatewayPins(undefined), { connections: [], workspaces: [] });
  assert.deepEqual(readGatewayPins({ connections: ["a", "a", null, ""], workspaces: false }), {
    connections: ["a"],
    workspaces: [],
  });
  assert.throws(() => updateGatewayPins({}, "repository", "a", true), /Invalid pin/);
  assert.throws(() => updateGatewayPins({}, "connection", "a", "yes"), /Invalid pin/);
});
