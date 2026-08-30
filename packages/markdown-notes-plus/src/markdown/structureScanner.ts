export type MarkdownLine = { start: number; contentEnd: number; end: number; text: string };
export type MarkdownRange = { from: number; to: number };
export type MarkdownStructure = { lines: MarkdownLine[]; opaqueFencedRanges: MarkdownRange[]; taskEligible: boolean[] };

export function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  while (start < markdown.length) {
    const newline = markdown.indexOf("\n", start);
    if (newline < 0) {
      lines.push({ start, contentEnd: markdown.length, end: markdown.length, text: markdown.slice(start) });
      break;
    }
    const contentEnd = newline > start && markdown[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({ start, contentEnd, end: newline + 1, text: markdown.slice(start, contentEnd) });
    start = newline + 1;
  }
  return lines;
}

type BlockquotePrefix = { body: string; offset: number; depth: number };

function stripBlockquotePrefix(text: string): BlockquotePrefix {
  let offset = 0;
  let depth = 0;
  while (true) {
    const match = text.slice(offset).match(/^ {0,3}>[ \t]?/);
    if (!match) break;
    offset += match[0].length;
    depth += 1;
  }
  return { body: text.slice(offset), offset, depth };
}

type LeadingWhitespace = { end: number; columns: number };

function leadingWhitespace(text: string, startColumn = 0): LeadingWhitespace {
  let end = 0;
  let columns = startColumn;
  while (end < text.length && (text[end] === " " || text[end] === "\t")) {
    if (text[end] === "\t") columns += 4 - (columns % 4);
    else columns += 1;
    end += 1;
  }
  return { end, columns };
}

type ConsumedIndent = { index: number; overage: number };

function consumeIndent(text: string, columns: number): ConsumedIndent | undefined {
  if (columns === 0) return { index: 0, overage: 0 };
  const whitespace = leadingWhitespace(text);
  if (whitespace.columns < columns) return undefined;
  let consumed = 0;
  let index = 0;
  while (index < whitespace.end && consumed < columns) {
    const next = text[index] === "\t" ? consumed + (4 - (consumed % 4)) : consumed + 1;
    index += 1;
    if (next >= columns) return { index, overage: next - columns };
    consumed = next;
  }
  return undefined;
}

type ListItemContainer = { quoteDepth: number; markerIndent: number; contentIndent: number };
type ListItemInfo = ListItemContainer & { contentStart: number };

function parseListItem(body: string): ListItemInfo | undefined {
  const match = body.match(/^([ \t]*)(?:[-+*]|\d+[.)])([ \t]+)/);
  if (!match) return undefined;
  const leading = leadingWhitespace(match[1]);
  const marker = match[0].slice(match[1].length, match[0].length - match[2].length);
  const markerEndColumn = leading.columns + marker.length;
  const contentIndent = leadingWhitespace(match[2], markerEndColumn).columns;
  return { quoteDepth: 0, markerIndent: leading.columns, contentIndent, contentStart: match[0].length };
}

type FenceMarker = { character: "`" | "~"; length: number; start: number };

function parseFenceMarker(text: string, start: number, maxIndent: number): FenceMarker | undefined {
  const whitespace = leadingWhitespace(text.slice(start));
  if (whitespace.columns > maxIndent) return undefined;
  const markerStart = start + whitespace.end;
  const character = text[markerStart];
  if (character !== "`" && character !== "~") return undefined;
  let end = markerStart;
  while (end < text.length && text[end] === character) end += 1;
  const length = end - markerStart;
  if (length < 3) return undefined;
  const tail = text.slice(end);
  if (character === "`" && tail.includes("`")) return undefined;
  return { character, length, start: markerStart };
}

function isFenceClose(text: string, start: number, fence: FenceMarker, maxIndent = 3): boolean {
  const marker = parseFenceMarker(text, start, maxIndent);
  if (!marker || marker.character !== fence.character || marker.length < fence.length) return false;
  return /^[ \t]*$/.test(text.slice(marker.start + marker.length));
}

function sameQuoteContainer(text: string, quoteDepth: number): BlockquotePrefix | undefined {
  const prefix = stripBlockquotePrefix(text);
  return prefix.depth === quoteDepth ? prefix : undefined;
}

function pruneListContainers(containers: ListItemContainer[], quoteDepth: number, body: string, isBlank: boolean): void {
  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const container = containers[index];
    if (container.quoteDepth > quoteDepth) {
      containers.splice(index, 1);
      continue;
    }
    if (container.quoteDepth === quoteDepth && !isBlank) {
      const bodyIndent = leadingWhitespace(body).columns;
      if (bodyIndent < container.contentIndent) containers.splice(index, 1);
    }
  }
}

function canStartListItem(containers: ListItemContainer[], item: ListItemInfo): boolean {
  if (item.markerIndent <= 3) return true;
  return containers.some((container) => container.quoteDepth === item.quoteDepth && item.markerIndent >= container.contentIndent);
}

function addListContainer(containers: ListItemContainer[], item: ListItemInfo): void {
  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const container = containers[index];
    if (container.quoteDepth > item.quoteDepth || (container.quoteDepth === item.quoteDepth && container.markerIndent >= item.markerIndent)) containers.splice(index, 1);
  }
  containers.push({ quoteDepth: item.quoteDepth, markerIndent: item.markerIndent, contentIndent: item.contentIndent });
}

function listContainerForLine(containers: ListItemContainer[], quoteDepth: number, body: string): ListItemContainer | undefined {
  const bodyIndent = leadingWhitespace(body).columns;
  return containers.slice().reverse().find((container) => container.quoteDepth === quoteDepth && bodyIndent >= container.contentIndent);
}

function fenceForLine(text: string, containers: ListItemContainer[], listItem: ListItemInfo | undefined): { marker: FenceMarker; quoteDepth: number; contentIndent: number } | undefined {
  const prefix = stripBlockquotePrefix(text);
  const item = listItem && canStartListItem(containers, listItem) ? { ...listItem, quoteDepth: prefix.depth } : undefined;
  if (item) {
    const marker = parseFenceMarker(prefix.body, item.contentStart, 3);
    if (marker) return { marker, quoteDepth: prefix.depth, contentIndent: item.contentIndent };
  }
  const container = listContainerForLine(containers, prefix.depth, prefix.body);
  const contentIndent = container?.contentIndent ?? 0;
  const consumed = consumeIndent(prefix.body, contentIndent);
  if (consumed === undefined) return undefined;
  const marker = parseFenceMarker(prefix.body, consumed.index, Math.max(0, 3 - consumed.overage));
  return marker ? { marker, quoteDepth: prefix.depth, contentIndent } : undefined;
}

function fenceCloseForLine(text: string, quoteDepth: number, contentIndent: number, fence: FenceMarker): boolean {
  const prefix = sameQuoteContainer(text, quoteDepth);
  if (!prefix) return false;
  const consumed = consumeIndent(prefix.body, contentIndent);
  if (consumed !== undefined && isFenceClose(prefix.body, consumed.index, fence, Math.max(0, 3 - consumed.overage))) return true;
  if (contentIndent > 0) {
    const marker = parseFenceMarker(prefix.body, 0, 3);
    if (marker && marker.character === fence.character && marker.length >= fence.length) return /^[ \t]*$/.test(prefix.body.slice(marker.start + marker.length));
  }
  return false;
}

function fenceContinuesForLine(text: string, quoteDepth: number, contentIndent: number): boolean {
  const prefix = sameQuoteContainer(text, quoteDepth);
  if (!prefix) return false;
  if (prefix.body.trim() === "") return true;
  return contentIndent === 0 || leadingWhitespace(prefix.body).columns >= contentIndent;
}

type IndentedCodeBlock = { quoteDepth: number; indent: number; from: number };

function indentedCodeBlockForLine(text: string, containers: ListItemContainer[]): Omit<IndentedCodeBlock, "from"> | undefined {
  const prefix = stripBlockquotePrefix(text);
  if (prefix.body.trim() === "") return undefined;
  const container = listContainerForLine(containers, prefix.depth, prefix.body);
  if (!container) return undefined;
  const bodyIndent = leadingWhitespace(prefix.body).columns;
  const indent = container.contentIndent + 4;
  return bodyIndent >= indent ? { quoteDepth: prefix.depth, indent } : undefined;
}

function continuesIndentedCodeBlock(text: string, block: IndentedCodeBlock): boolean {
  const prefix = sameQuoteContainer(text, block.quoteDepth);
  if (!prefix) return false;
  if (prefix.body.trim() === "") return true;
  return leadingWhitespace(prefix.body).columns >= block.indent;
}

export function scanMarkdownStructure(markdown: string): MarkdownStructure {
  const lines = splitMarkdownLines(markdown);
  const opaqueFencedRanges: MarkdownRange[] = [];
  const taskEligible = lines.map(() => false);
  const listContainers: ListItemContainer[] = [];
  let openFence: { marker: FenceMarker; quoteDepth: number; contentIndent: number; from: number } | undefined;
  let openIndentedCode: IndentedCodeBlock | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (openFence) {
      if (fenceCloseForLine(line.text, openFence.quoteDepth, openFence.contentIndent, openFence.marker)) {
        opaqueFencedRanges.push({ from: openFence.from, to: line.end });
        openFence = undefined;
        continue;
      }
      if (!fenceContinuesForLine(line.text, openFence.quoteDepth, openFence.contentIndent)) {
        opaqueFencedRanges.push({ from: openFence.from, to: line.start });
        openFence = undefined;
      } else continue;
    }
    const prefix = stripBlockquotePrefix(line.text);
    const isBlank = prefix.body.trim() === "";
    if (openIndentedCode) {
      if (continuesIndentedCodeBlock(line.text, openIndentedCode)) continue;
      opaqueFencedRanges.push({ from: openIndentedCode.from, to: line.start });
      openIndentedCode = undefined;
    }
    pruneListContainers(listContainers, prefix.depth, prefix.body, isBlank);
    const listItem = parseListItem(prefix.body);
    if (listItem) listItem.quoteDepth = prefix.depth;
    if (listItem && canStartListItem(listContainers, listItem)) taskEligible[index] = true;
    const indentedCode = indentedCodeBlockForLine(line.text, listContainers);
    if (indentedCode) {
      openIndentedCode = { ...indentedCode, from: line.start };
      continue;
    }
    if (listItem && canStartListItem(listContainers, listItem)) addListContainer(listContainers, listItem);
    const fence = fenceForLine(line.text, listContainers, listItem);
    if (fence) openFence = { ...fence, from: line.start };
  }
  if (openFence) opaqueFencedRanges.push({ from: openFence.from, to: markdown.length });
  if (openIndentedCode) opaqueFencedRanges.push({ from: openIndentedCode.from, to: markdown.length });
  return { lines, opaqueFencedRanges, taskEligible };
}
