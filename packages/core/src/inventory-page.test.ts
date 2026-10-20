import { expect, it } from "vitest";
import { inventoryPage } from "./inventory-page.js";
it("pages stable metadata and restarts foreign, changed and filtered inventories", () => {
  const rows = [
    { id: "b", name: "Beta" },
    { id: "a", name: "Alpha" },
  ];
  const first = inventoryPage("root", "tasks", rows, { limit: 1 });
  expect(first.rows[0]!.id).toBe("a");
  expect(inventoryPage("root", "tasks", rows, { cursor: first.nextCursor }).rows[0]!.id).toBe("b");
  for (const [root, kind] of [
    ["other", "tasks"],
    ["root", "runs"],
  ] as const)
    expect(inventoryPage(root, kind, rows, { cursor: first.nextCursor }).restarted).toBe(true);
  expect(inventoryPage("root", "tasks", rows, { query: "beta" }).total).toBe(1);
  expect(inventoryPage("root", "tasks", rows, { order: "name" }).rows.map((row) => row.name)).toEqual([
    "Alpha",
    "Beta",
  ]);
  expect(() => inventoryPage("root", "tasks", rows, { order: "__proto__" as never })).toThrow();
  expect(() => inventoryPage("root", "tasks", rows, { state: 42 })).toThrow();
  expect(() => inventoryPage("root", "tasks", rows, { limit: 51 })).toThrow();
  expect(() => inventoryPage("root", "tasks", rows, { cursor: "bad" })).toThrow();
});
