import type { ILink, Terminal } from "@xterm/xterm";

const urlPattern = /https?:\/\/[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~\[\]`()<>]/gi;

/** Find links over the whole logical line, including all terminal-wrapped rows. */
export function terminalLinks(terminal: Terminal, row: number, activate: ILink["activate"]): ILink[] {
  const buffer = terminal.buffer.active;
  let start = row - 1;
  if (!buffer.getLine(start)) return [];
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  const positions: { x: number; y: number }[] = [];
  let text = "";
  for (let y = start; ; y++) {
    const line = buffer.getLine(y);
    if (!line || (y > start && !line.isWrapped)) break;
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || " ";
      text += chars;
      for (let i = 0; i < chars.length; i++) positions.push({ x: x + 1, y: y + 1 });
    }
  }
  const links: ILink[] = [];
  for (const match of text.matchAll(urlPattern)) {
    try {
      new URL(match[0]);
    } catch {
      continue;
    }
    const first = positions[match.index!];
    const last = positions[match.index! + match[0].length - 1];
    if (first && last && row >= first.y && row <= last.y)
      links.push({ text: match[0], range: { start: first, end: last }, activate });
  }
  return links;
}
