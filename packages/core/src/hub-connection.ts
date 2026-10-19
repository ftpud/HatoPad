import { stateHome } from "./state-home.js";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export interface HubOptions {
  /** Pair this Core with a hub, then exit. */
  pairOrigin?: string;
  /** Maintain an outbound connection to the paired hub. */
  connect: boolean;
  /** Path of the private pairing credential file. */
  storeFile: string;
}

export function defaultPairingFile(environment = process.env): string {
  return environment.HATOPAD_HUB_PAIRING_FILE || path.join(stateHome(), "hub", "pairing.json");
}

/** `--hub-pair <https origin>` and `--hub-connect` (or HATOPAD_HUB_CONNECT=1). Both are opt-in; direct Core use needs neither. */
export function parseHubOptions(argv: string[], environment = process.env): HubOptions {
  const pairIndex = argv.indexOf("--hub-pair");
  const pairOrigin = pairIndex >= 0 ? argv[pairIndex + 1] : undefined;
  if (pairIndex >= 0 && (!pairOrigin || pairOrigin.startsWith("--")))
    throw new Error("--hub-pair requires the hub origin, e.g. https://hub.example");
  return {
    pairOrigin,
    connect: argv.includes("--hub-connect") || environment.HATOPAD_HUB_CONNECT === "1",
    storeFile: defaultPairingFile(environment),
  };
}

/** Relay WebSocket URL for a paired hub origin. */
export function hubRelayUrl(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/relay/connector";
  url.search = "";
  return url.toString();
}

/** Interactive pairing on this machine. The code and prompt go to the terminal only; nothing is logged. */
export async function runHubPairing(options: HubOptions): Promise<boolean> {
  const { PairingStore, pairDevice } = await import("@hatopad/connector");
  const result = await pairDevice({
    hubOrigin: options.pairOrigin!,
    deviceName: os.hostname().slice(0, 80) || "Core",
    store: new PairingStore(options.storeFile),
    showCode: (code, expiresAt) => console.log(`Enter this code in the hub web UI: ${code} (expires ${expiresAt}).`),
    confirmLocally: async (claimant) => {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log(
          `${claimant.name} <${claimant.email}> claimed this pairing code. Pairing gives them control of this Core, including its roots and command execution.`,
        );
        return /^y(es)?$/i.test(
          (await prompt.question("Only accept if you just entered the code yourself. Pair this Core? [y/N] ")).trim(),
        );
      } finally {
        prompt.close();
      }
    },
  });
  if (result.status === "paired") console.log("Paired. Start Core with --hub-connect to go online.");
  else console.error(`Pairing failed: ${result.reason}`);
  return result.status === "paired";
}

/** Start the connector for an already paired Core. Returns a stop function. */
export async function startHubConnector(
  options: HubOptions,
  port: number,
  token: string,
): Promise<(() => Promise<void>) | undefined> {
  const { CoreConnector, PairingStore } = await import("@hatopad/connector");
  const pairing = await new PairingStore(options.storeFile).load();
  if (!pairing) {
    console.error("[core] hub connection requested but this Core is not paired; run with --hub-pair <origin>");
    return undefined;
  }
  const connector = new CoreConnector({
    hubUrl: hubRelayUrl(pairing.hubUrl),
    credential: pairing.credential,
    localCoreUrl: `ws://127.0.0.1:${port}`,
    localToken: token,
    onStatus: (status) => console.log(`[core] hub: ${status.state}${"reason" in status ? ` (${status.reason})` : ""}`),
    onDiagnostic: (message) => console.log(`[core] hub: ${message}`),
  });
  connector.start();
  return () => connector.stop();
}
