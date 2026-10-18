import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixtureProviderDefinition, fixturePrompts } from "@remote-ide/test-fixtures";
import { createAcpRegistry } from "./index.js";

afterEach(() => vi.unstubAllEnvs());

async function settle<T>(read: () => Promise<T>, until: (session: T) => boolean) {
  let session = await read();
  for (let attempt = 0; !until(session) && attempt < 300; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 20)); session = await read(); }
  return session;
}

describe("@remote-ide/test-fixtures agent", () => {
  it("drives echo, permission, question and edit turns through a real provider", async () => {
    const definitions = await mkdtemp(path.join(os.tmpdir(), "fixture-defs-"));
    await writeFile(path.join(definitions, "fixture-agent.json"), JSON.stringify(fixtureProviderDefinition()));
    vi.stubEnv("REMOTE_IDE_PROVIDER_DEFINITIONS_DIR", definitions);
    vi.stubEnv("REMOTE_IDE_STATE_DIR", await mkdtemp(path.join(os.tmpdir(), "fixture-state-")));
    const registry = createAcpRegistry(() => undefined);
    try {
      const provider = registry.get("fixture-agent");
      const workspace = await mkdtemp(path.join(os.tmpdir(), "fixture-workspace-"));
      const read = () => provider.get(workspace);
      const said = (value: string) => (session: { status?: string; messages?: { text: string }[] }) => session.status !== "in_progress" && session.messages?.some((message) => message.text.includes(value)) === true;

      await provider.send(workspace, { prompt: "hello there", configuration: { model: "model-a" } });
      let session = await settle(read, said("echo: "));
      expect(said("echo: ")(session)).toBe(true);

      await provider.send(workspace, { prompt: fixturePrompts.permission, configuration: { model: "model-a" } });
      session = await settle(read, (value) => value.pendingPermission !== undefined);
      expect(session.pendingPermission).toMatchObject({ title: "Run tests", options: [{ optionId: "allow" }, { optionId: "reject" }] });
      await provider.resolvePermission(workspace, session.pendingPermission!.id, "allow");
      session = await settle(read, said("permission: allow"));
      expect(said("permission: allow")(session)).toBe(true);

      await provider.configure(workspace, { askQuestions: true });
      await provider.send(workspace, { prompt: fixturePrompts.question, configuration: { model: "model-a", askQuestions: true } });
      session = await settle(read, (value) => value.pendingQuestion !== undefined);
      expect(session.pendingQuestion).toMatchObject({ message: "Which branch?", fields: [{ id: "branch", type: "text", required: true }] });
      await provider.answerQuestion(workspace, session.pendingQuestion!.id, "accept", { branch: "main" });
      session = await settle(read, said("answer:"));
      expect(said('answer: {"branch":"main"}')(session)).toBe(true);

      await provider.send(workspace, { prompt: fixturePrompts.edit, configuration: { model: "model-a", askQuestions: true } });
      await settle(read, said("edited fixture-edit.txt"));
      expect(await readFile(path.join(workspace, "fixture-edit.txt"), "utf8")).toBe("edited by fixture agent\n");
    } finally { await registry.shutdown(); }
  }, 30_000);
});
