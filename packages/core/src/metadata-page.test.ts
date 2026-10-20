import { expect, it } from "vitest";
import { metadataPage } from "./metadata-page.js";
it("budgets encoded UTF-8 and escaped names without clipping identities or skipping rows", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    path: `${index}-${"\u0001".repeat(2000)}-日本語`,
    additions: null,
  }));
  const first = metadataPage(rows, 0, 100);
  expect(Buffer.byteLength(JSON.stringify(first.rows))).toBeLessThanOrEqual(600_000);
  expect(first.rows.length).toBeGreaterThan(0);
  expect(first.rows.length).toBeLessThan(100);
  const combined = [...first.rows];
  let cursor = first.nextOffset;
  while (cursor !== undefined) {
    const page = metadataPage(rows, cursor, 100);
    combined.push(...page.rows);
    cursor = page.nextOffset;
  }
  expect(combined).toEqual(rows);
  expect(() => metadataPage(rows, 0, 100, 10)).toThrow("byte budget");
});
