import { stateHome } from "./state-home.js";
import crypto from "node:crypto";
import { CONFIGURATION_REFERENCES } from "./self-configuration-reference.js";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

export const CONFIGURATION_AGENT_NAME = "hatopad-configurator.md";
export const CONFIGURATION_SKILL_ID = "global/hatopad-self-configuration";
export const CONFIGURATION_AGENT = `---
name: HatoPad Configurator
description: Configure HatoPad workflows, triggers, agents, skills, tasks, run configurations and useful files.
mcpServers:
  - hatopad
---

Configure HatoPad according to the user's request. Use the hatopad MCP
configuration_list, configuration_read and configuration_write tools to edit
logical configuration documents, rather than guessing private state file paths.
Read skills/global/hatopad-self-configuration/SKILL.md for the configuration workflow.
Use the existing task tools for creating worktrees, starting sessions and lifecycle
operations. Saving a workflow does not run it. Keep unrelated configuration and
credentials unchanged, preserve the user's requested scope, and report what changed.
`;

export const CONFIGURATION_SKILL = `---
name: hatopad-self-configuration
description: Create or edit HatoPad workflows, agent presets, skills, task metadata, run configurations and global or local useful files through the app configuration MCP interface.
---

Use configuration_list to discover documents and their formats. The workspace
reported by that tool is the invoking chat's workspace; local agents, local skills, skill policy,
useful files and workflows belong to its root project and are shared by every task, while
workspace agents and workspace skills belong to the invoking checkout. Global documents are shared by
all projects on this Core host. Honor an explicit scope; use project-local scope
for project-specific instructions and global scope for reusable configuration.

Read a document with configuration_read before editing it. Supply its revision as
expected_revision to configuration_write, preserving unrelated fields. For a new
agent, skill or useful file, use a new logical resource name and null revision.
Read workflows/new.json for a starter workflow; writing it creates a workflow and
returns its actual resource ID. To retry, read that returned resource instead of
creating another workflow. Do not replace private registry files or durable runs.
On a revision conflict, reload and reconcile the requested change; stop if it
conflicts with another user's edits instead of repeatedly overwriting their work.

Use skills/local/{name}/SKILL.md for skills shared by all tasks in this project,
skills/workspace/{name}/SKILL.md for checkout files and skills/global/{name}/SKILL.md
for host-wide skills. All three scopes can be created and edited through the tools.
After creating SKILL.md, use skills/{scope}/{name}/{relative/path} to read, create
and update supporting text files, including files in nested directories.

Agent and skill documents are Markdown with name/description frontmatter. Include
mcpServers: [hatopad] in agents that need app tools. Skill policy is JSON with
allowed/defaults arrays and optional scoped agent assignments; preserve assignments
when changing defaults. null in an assignment permits a chat with no agent preset.
New skills are not auto-enabled: update policy only when requested. Project allowlists
and agent assignments control instruction delivery, not a provider's filesystem access.

Workflows are JSON definitions: retain block and edge IDs when editing, use provider
IDs from the catalogue and actual scoped agent references, and check returned graph
validation issues. Saving a workflow never starts it; use the app's run controls
when the user asks to execute it. Workflow-created scripts remain instructions until
execution is separately requested. Task documents expose only name, status and archived;
create or start tasks through task_create or task_create_and_start. Do not edit task
worktree paths, branches, provider transcripts or workflow-run state as configuration.

Run configurations are editable through languages/{id}.json (node for npm,
java for Maven) in the invoking checkout. Read the plugin's defaults and preserve
unrelated project settings. Set the project manifest path, named run profiles,
selected profile, arguments, environment, working directory and tool overrides
as requested. Saving registers the project and never starts a process. Shell
configurations use runs/{local|global}/{name}.sh; their content is shell commands.
Local shell configurations are shared by the root project's tasks. Read before
writing and pass the returned revision, or null when creating a configuration.

After a write, read back the resource and report the affected scope and behavior.
The app receives a configuration change event and refreshes the relevant panels.
Global agent and skill edits affect every project on this host; do not broaden a
project-only request into global changes. Existing chats keep their skill selections;
agent or skill instruction changes take effect on a subsequent turn.

## Detailed reference

Before designing or changing a workflow, read [Blocks and connections](references/blocks.md).
For complete configuration document formats and write examples, read
[Configuration formats](references/configuration.md). For every app and workflow
command, including argument schemas and limits, read [Commands](references/commands.md).
These files are installed beside this SKILL.md on Core. Read them with
configuration_read using skills/global/hatopad-self-configuration/ followed by
the relative path, or use a file-reading tool with the returned baseDirectory.
The live MCP tool catalogue is authoritative for commands available in this session.

Choose script for short, non-interactive commands, tests, builds and data transforms.
Choose run_app for a named managed service. Use terminal_control only for persistent
terminal sessions where interactive input may be needed; do not use it for small tasks,
one-shot scripts or spawning AI agents. List terminals first and reuse suitable sessions.

Triggers (triggers/{id}.json) start a prompt or workflow when a file changes or data
arrives on a named pipe. Read triggers/new.json for a starter and the format in
configuration_list. Core persists and re-arms them after restart. Create them disabled
(enabled: false) unless the user asks for them to be active, and keep the quiet period
and maxFiresPerHour conservative: an agent that edits the file it is triggered by can
loop. Triggers cannot be deleted through configuration; the Triggers panel does that.
`;

// Exact fingerprints of previously shipped skills; never replace user-edited instructions.
const PREVIOUS_CONFIGURATION_SKILL_HASHES = new Set([
  "b83737e61efdefeca8c8114330d901dfa7e88657cdc71b6b31966d2a8639b9c4",
  // Shipped before the HatoPad rebrand (text and file names said "Vibe").
  "d40367d45835b080b23bca0825aff3d7633f7b5273210823680bdd0d3e5db2cf",
  "c75c693c7248e855cd6b2d26589c66593c43257f04b10e0a5baa46aee39a18af",
  "56930e7d161a65f291803724978469e20af359e3dc2a7e43c55e32cd9c901ea6",
  "22c077677a7c43786df14bc1fd7126b31a3901508aae14b3b7727229c61f5155",
  "497f968c35f9f855f3dcacab9aa0aafd0524567701ef97e2a1c5f88da87a457b",
  "9117b20c14d3d139f68318a20837c7c5633c1114bc89e2976c877b5f7e9da894",
]);

/** Exact fingerprints of earlier shipped references, keyed by file name. */
const PREVIOUS_REFERENCE_HASHES: Record<string, Set<string>> = {
  "blocks.md": new Set([
    "552a116bbe89d3faf58e23852218084d9850ef4c27d6d39210ee535f6640b86e",
    "faa8c3ecbf3ead61885f1b69a83134c650c609b7fca6f6da0ee197c43d7a6763",
  ]),
  "commands.md": new Set([
    "5054464943837a9225c2bc0d2b59e51443497642ff5e958209a89dc1d97892ff",
    "7fc4de08342eba0236ba5f912129a5cc3febd30060e8f3b9ba2666f652e03d26",
  ]),
  "configuration.md": new Set([
    "302ced36701ada596b9ac1152a5b938224c400857171599e766ca67509a6ca3c",
    "926ce68a7662b262f717bb9359cd6da26d90cdc0b4243184464bb6f4efad22c2",
    "268e8d9d5f5fbe4e2784f0d6381388d7840081c31c1e3e048134daac99dd1a2b",
    "3684c16fc3ee025fb0806a486ab4b813b9e70846b8c95daed9b822f623c3e7b1",
  ]),
};

const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const LEGACY_AGENT_HASHES = new Set(["8136d0169d9ce93039ae3f6305fa7c98ff9454a77b69df2dcf3aa97fd347c59f"]);

/**
 * Removes the pre-rename Configurator agent and skill (`vibe-configurator.md`, `global/vibe-self-configuration`)
 * once the renamed copies exist, but only when every file is still an untouched shipped copy; edited files are kept.
 */
async function removeLegacySelfConfiguration(stateDirectory: string): Promise<void> {
  const agent = path.join(stateDirectory, "agents", "global", "vibe-configurator.md");
  try {
    if (LEGACY_AGENT_HASHES.has(sha(await readFile(agent, "utf8")))) await rm(agent);
  } catch {
    /* absent or unreadable: leave it */
  }
  const directory = path.join(stateDirectory, "skills", "global", "vibe-self-configuration");
  try {
    const known = (name: string, content: string) =>
      name === "SKILL.md"
        ? PREVIOUS_CONFIGURATION_SKILL_HASHES.has(sha(content))
        : PREVIOUS_REFERENCE_HASHES[name]?.has(sha(content)) === true;
    const references = await readdir(path.join(directory, "references")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const files = [
      ["SKILL.md", path.join(directory, "SKILL.md")],
      ...references.map((name) => [name, path.join(directory, "references", name)] as const),
    ];
    for (const [name, file] of files) if (!known(name, await readFile(file, "utf8"))) return;
    await rm(directory, { recursive: true });
  } catch {
    /* absent or customised: leave it */
  }
}

/** Install shipped global defaults on every Core host, preserving user edits. */
export async function ensureSelfConfiguration(
  stateDirectory = process.env.HATOPAD_STATE_DIR ?? path.join(stateHome(), "workspaces"),
): Promise<void> {
  const skillDirectory = path.join(stateDirectory, "skills", "global", "hatopad-self-configuration");
  for (const [name, content] of Object.entries(CONFIGURATION_REFERENCES)) {
    const target = path.join(skillDirectory, "references", name);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Only an untouched copy of an earlier shipped reference is refreshed; user edits are kept.
      const current = await readFile(target, "utf8");
      if (PREVIOUS_REFERENCE_HASHES[name]?.has(crypto.createHash("sha256").update(current).digest("hex")))
        await writeFile(target, content, "utf8");
    }
  }
  for (const [target, content] of [
    [path.join(stateDirectory, "agents", "global", CONFIGURATION_AGENT_NAME), CONFIGURATION_AGENT],
    [path.join(stateDirectory, "skills", "global", "hatopad-self-configuration", "SKILL.md"), CONFIGURATION_SKILL],
  ] as const) {
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (content === CONFIGURATION_SKILL) {
        const current = await readFile(target, "utf8");
        if (PREVIOUS_CONFIGURATION_SKILL_HASHES.has(crypto.createHash("sha256").update(current).digest("hex")))
          await writeFile(target, content, "utf8");
      }
    }
  }
  await removeLegacySelfConfiguration(stateDirectory);
}
