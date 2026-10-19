import { describe, expect, it } from "vitest";
import { hubRelayUrl, parseHubOptions } from "./hub-connection.js";

describe("hub options", () => {
  it("is off by default and parses opt-in flags", () => {
    expect(parseHubOptions([], {})).toMatchObject({ connect: false, pairOrigin: undefined });
    expect(parseHubOptions(["--hub-connect"], {}).connect).toBe(true);
    expect(parseHubOptions([], { HATOPAD_HUB_CONNECT: "1" }).connect).toBe(true);
    expect(parseHubOptions(["--hub-pair", "https://hub.example"], {}).pairOrigin).toBe("https://hub.example");
    expect(() => parseHubOptions(["--hub-pair"], {})).toThrow();
    expect(() => parseHubOptions(["--hub-pair", "--hub-connect"], {})).toThrow();
    expect(parseHubOptions([], { HATOPAD_HUB_PAIRING_FILE: "/tmp/p.json" }).storeFile).toBe("/tmp/p.json");
  });

  it("derives the relay URL from the paired origin", () => {
    expect(hubRelayUrl("https://hub.example/ignored?x=1")).toBe("wss://hub.example/relay/connector");
  });
});
