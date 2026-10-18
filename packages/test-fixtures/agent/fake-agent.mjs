// Scripted ACP v1 agent for end-to-end tests. It has no network or model access.
// The prompt text selects the behavior (case-sensitive keywords):
//   PERMISSION  asks for permission to "Run tests", then reports the outcome
//   QUESTION    asks a form question ("Which branch?"), then reports the answer
//   EDIT        writes fixture-edit.txt in the session directory, then reports it
//   SLOW        streams until the turn is cancelled
//   anything else  streams a short reply that echoes the end of the prompt (providers may prepend context)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const notify = (sessionId, update) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
const text = (sessionId, value) => notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } });
const pending = new Map();
let nextId = 1000;
let cwd = process.cwd();
let live = null;
let cancelled = false;

const callClient = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); send({ jsonrpc: "2.0", id, method, params }); });
const options = () => [{ type: "select", id: "model", name: "Model", category: "model", currentValue: "model-a", options: [{ value: "model-a", name: "MODEL-A" }] }];

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id !== undefined && !message.method) { pending.get(message.id)?.(message.result ?? message.error); pending.delete(message.id); return; }
  const ok = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize": return ok({ protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "fixture-agent", version: "1" } });
    case "session/new": cwd = message.params.cwd ?? cwd; return ok({ sessionId: "fixture-session", modes: null, configOptions: options() });
    case "session/set_config_option": return ok({ configOptions: options() });
    case "session/cancel": cancelled = true; return;
    case "session/prompt": {
      const id = message.params.sessionId;
      const prompt = message.params.prompt.map((block) => block.text ?? "").join("");
      live = id; cancelled = false;
      if (prompt.includes("SLOW")) {
        text(id, "working");
        for (let i = 0; i < 200 && !cancelled; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      } else if (prompt.includes("PERMISSION")) {
        const response = await callClient("session/request_permission", { sessionId: id, toolCall: { toolCallId: "fixture-tool", title: "Run tests", kind: "execute", rawInput: { command: "npm test" } }, options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] });
        text(id, `permission: ${response?.outcome?.optionId ?? response?.outcome?.outcome ?? "none"}`);
      } else if (prompt.includes("QUESTION")) {
        const response = await callClient("elicitation/create", { sessionId: id, mode: "form", message: "Which branch?", requestedSchema: { type: "object", properties: { branch: { type: "string", title: "Branch" } }, required: ["branch"] } });
        text(id, `answer: ${response?.action === "accept" ? JSON.stringify(response.content) : response?.action ?? "none"}`);
      } else if (prompt.includes("EDIT")) {
        await writeFile(path.join(cwd, "fixture-edit.txt"), `edited by fixture agent\n`);
        notify(id, { sessionUpdate: "tool_call", toolCallId: "edit-1", title: "Write fixture-edit.txt", kind: "edit", status: "completed" });
        text(id, "edited fixture-edit.txt");
      } else {
        text(id, `echo: ${prompt.slice(-200)}`);
      }
      live = null;
      return ok({ stopReason: "end_turn" });
    }
    default: if (message.id !== undefined) ok({});
  }
});
