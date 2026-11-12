import { expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { terminalLinks } from "./terminal-links";

it("opens the complete URL from any wrapped row", () => {
  const rows = ["prefix https://exam", "ple.com/a-very-long", "-path?value=123 end"];
  const lines = rows.map((text, i) => ({
    isWrapped: i > 0,
    length: text.length,
    translateToString: () => text,
    getCell: (x: number) => ({ getWidth: () => 1, getChars: () => text[x] ?? "" }),
  }));
  const terminal = { buffer: { active: { getLine: (i: number) => lines[i] } } } as unknown as Terminal;
  for (const row of [1, 2, 3]) {
    const links = terminalLinks(terminal, row, vi.fn());
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe("https://example.com/a-very-long-path?value=123");
    expect(links[0]?.range).toEqual({ start: { x: 8, y: 1 }, end: { x: 15, y: 3 } });
  }
});
