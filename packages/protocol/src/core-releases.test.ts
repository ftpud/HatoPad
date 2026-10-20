import { expect, it } from "vitest";
import { compatibleCoreTags } from "./core-releases.js";
it("selects newest compatible immutable releases without accepting malformed or incompatible tags", () => {
  expect(
    compatibleCoreTags(
      [
        "core-protocol-20-v9.0.0",
        "core-protocol-19-v0.2.0",
        "core-protocol-19-v0.10.0",
        "core-protocol-19-dev-v0.11.0",
        "core-protocol-19-main-v0.4.0",
        "core-protocol-19-other-v0.12.0",
        "core-protocol-18-v1.0.0",
        "core-protocol-19-v0.3.0-rc1",
        "main",
        "core-protocol-19-v999999999999999999999.0.0",
      ],
      { minimum: 19, maximum: 19 },
    ),
  ).toEqual([
    "core-protocol-19-dev-v0.11.0",
    "core-protocol-19-v0.10.0",
    "core-protocol-19-main-v0.4.0",
    "core-protocol-19-v0.2.0",
  ]);
});
