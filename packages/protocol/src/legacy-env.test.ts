import { describe, expect, it } from "vitest";
import { applyLegacyEnvironment, applyLegacyEnvironmentWithWarning } from "./legacy-env.js";

describe("legacy environment", () => {
  it("maps pre-rename names without overriding explicit HATOPAD_ values", () => {
    const env: Record<string, string | undefined> = { REMOTE_IDE_STATE_DIR: "/old", REMOTE_IDE_TOOLS_DIR: "/tools", HATOPAD_TOOLS_DIR: "/new-tools", VIBE_TREE_MAX_NODES: "9", UNRELATED: "x", REMOTE_IDE_EMPTY: undefined };
    expect(applyLegacyEnvironment(env)).toEqual(["REMOTE_IDE_STATE_DIR", "VIBE_TREE_MAX_NODES"]);
    expect(env.HATOPAD_STATE_DIR).toBe("/old");
    expect(env.HATOPAD_TOOLS_DIR).toBe("/new-tools");
    expect(env.HATOPAD_TREE_MAX_NODES).toBe("9");
    expect(env.HATOPAD_EMPTY).toBeUndefined();
    expect(env.UNRELATED).toBe("x");
  });

  it("keeps an explicitly empty canonical value instead of the inherited legacy one", () => {
    // Gateway deliberately sets an empty token together with a token file; an inherited legacy token must not shadow it.
    const env: Record<string, string | undefined> = { HATOPAD_SESSION_TOKEN: "", REMOTE_IDE_SESSION_TOKEN: "inherited", VIBE_NODE_EXECUTABLE: "/usr/bin/node" };
    expect(applyLegacyEnvironment(env)).toEqual(["VIBE_NODE_EXECUTABLE"]);
    expect(env.HATOPAD_SESSION_TOKEN).toBe("");
    expect(env.HATOPAD_NODE_EXECUTABLE).toBe("/usr/bin/node");
  });

  it("warns once with the names and is silent when nothing is legacy", () => {
    const warnings: string[] = [];
    applyLegacyEnvironmentWithWarning({ REMOTE_IDE_SESSION_TOKEN: "t" }, (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("REMOTE_IDE_SESSION_TOKEN");
    expect(warnings[0]).not.toContain("= t");
    applyLegacyEnvironmentWithWarning({ HATOPAD_STATE_DIR: "/x" }, (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
  });
});

it("explicit empty canonical token wins over a legacy token", () => {
 const env = { HATOPAD_SESSION_TOKEN: "", REMOTE_IDE_SESSION_TOKEN: "legacy", VIBE_NODE_EXECUTABLE: "/node" };
 expect(applyLegacyEnvironment(env)).toEqual(["VIBE_NODE_EXECUTABLE"]);
 expect(env.HATOPAD_SESSION_TOKEN).toBe("");
});

it("honors existing MCP bridge launch environments", () => {
 const env: Record<string, string | undefined> = { VIBE_EDITOR_ROOT_WORKSPACE: "/root", VIBE_EDITOR_CURRENT_WORKSPACE: "/task", VIBE_EDITOR_SKILLS_ONLY: "1" };
 expect(applyLegacyEnvironment(env)).toHaveLength(3);
 expect(env.HATOPAD_ROOT_WORKSPACE).toBe("/root");
 expect(env.HATOPAD_CURRENT_WORKSPACE).toBe("/task");
 expect(env.HATOPAD_SKILLS_ONLY).toBe("1");
});
