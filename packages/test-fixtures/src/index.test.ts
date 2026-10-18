import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeAgentPath, fixturePrompts, fixtureProviderDefinition } from "./index.js";

describe("fixtures", () => {
  it("points at the shipped agent and declares a valid definition", () => {
    expect(existsSync(fakeAgentPath)).toBe(true);
    const definition = fixtureProviderDefinition("custom");
    expect(definition).toMatchObject({ id: "custom", command: process.execPath, args: [fakeAgentPath] });
    expect(definition.options.map((option) => option.id)).toContain("askQuestions");
    expect(Object.values(fixturePrompts)).toEqual(["PERMISSION", "QUESTION", "EDIT", "SLOW"]);
  });
});
