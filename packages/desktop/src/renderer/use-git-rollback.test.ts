import { expect, it } from "vitest";
import { rollbackHunkContent } from "./use-git-actions";

const hunk = (originalStart: number, originalLines: number, modifiedStart: number, modifiedLines: number) =>
  ({ originalStart, originalLines, modifiedStart, modifiedLines }) as Parameters<typeof rollbackHunkContent>[2];

it("keeps the original final newline when rolling back an insertion at end of file", () => {
  expect(rollbackHunkContent("a\n", "a\nX", hunk(1, 0, 2, 1))).toBe("a\n");
});

it("restores replaced lines in the middle of a file", () => {
  expect(rollbackHunkContent("a\nb\nc\n", "a\nB\nc\n", hunk(2, 1, 2, 1))).toBe("a\nb\nc\n");
});

it("preserves a missing final newline", () => {
  expect(rollbackHunkContent("a\nb", "a\nB", hunk(2, 1, 2, 1))).toBe("a\nb");
});
