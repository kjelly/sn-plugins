import { createTextChangeSet, type TextChange, type TextChangeSet } from "../document/PositionMap.ts";

export type MarkdownLine = { start: number; contentEnd: number; end: number; text: string };
export type MarkdownRange = { from: number; to: number };
export type HeadingInfo = { level: number; text: string; from: number; to: number; path: string[] };
export type SectionInfo = { anchor: number; level: number; text: string; from: number; to: number; path: string[] };
export type TaskInfo = { from: number; to: number; itemStart: number; itemEnd: number; checkboxOffset: number; checked: boolean; text: string; depth: number; headingPath: string[] };
export type MarkdownStructure = { lines: MarkdownLine[]; opaqueFencedRanges: MarkdownRange[]; taskEligible: boolean[] };
export type MarkdownAnalysis = {
  headings: HeadingInfo[];
  tasks: TaskInfo[];
  sections: SectionInfo[];
  opaqueFencedRanges: MarkdownRange[];
  sectionAt: (offset: number) => SectionInfo | undefined;
  sectionByAnchor: (anchor: number) => SectionInfo | undefined;
};
export type CommandResult = { markdown: string; changed: boolean; changeSet?: TextChangeSet };
export type MindmapFilter = "all" | "open" | "hide";

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

function indentation(text: string): number {
  const body = stripBlockquotePrefix(text).body;
  const match = body.match(/^[ \t]*/);
  return match ? match[0].split("").reduce((width, character) => width + (character === "\t" ? 4 : 1), 0) : 0;
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

function isInRange(offset: number, ranges: MarkdownRange[]): boolean { return ranges.some((range) => offset >= range.from && offset < range.to); }
function listItemMatch(text: string): RegExpMatchArray | null { return stripBlockquotePrefix(text).body.match(/^([ \t]*)(?:[-+*]|\d+[.)])\s+/); }
function taskMatch(text: string): RegExpMatchArray | null { return stripBlockquotePrefix(text).body.match(/^([ \t]*)(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s+|$)(.*)$/); }

function isInsideInlineCode(text: string, index: number): boolean {
  let ticks = 0;
  for (let i = 0; i < index; i += 1) {
    if (text[i] !== "`") continue;
    const run = text.slice(i).match(/^`+/);
    if (!run) continue;
    ticks = ticks === 0 ? run[0].length : 0;
    i += run[0].length - 1;
  }
  return ticks !== 0;
}

function isTableLiteral(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("|") || /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}
function isHtmlBlock(lines: MarkdownLine[], index: number): boolean {
  const text = lines[index].text.trim();
  return text.startsWith("<!--") || /^<\/?[a-z][\w:-]*(?:\s|>|\/)/i.test(text) || text.startsWith("<?") || text.startsWith("<![CDATA[") || /^<![A-Z]/.test(text);
}
function isTableDelimiter(text: string): boolean { return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(text.trim()); }
function setextHeadingLevel(text: string): number | undefined { const trimmed = text.trim(); if (/^=+\s*$/.test(trimmed)) return 1; if (/^-+\s*$/.test(trimmed)) return 2; return undefined; }
const voidHtmlTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const rawHtmlTags = new Set(["script", "style", "textarea", "title"]);
function htmlTagDelta(text: string): { opens: number; closes: number } {
  let opens = 0;
  let closes = 0;
  const tags = /<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\/?\s*>/gi;
  for (const match of text.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    const token = match[0];
    if (token.startsWith("</")) closes += 1;
    else if (!voidHtmlTags.has(tag) && !token.endsWith("/>") && !rawHtmlTags.has(tag)) opens += 1;
  }
  return { opens, closes };
}

export function analyzeMarkdown(markdown: string): MarkdownAnalysis {
  const structure = scanMarkdownStructure(markdown);
  const lines = structure.lines;
  const headings: HeadingInfo[] = [];
  const tasks: TaskInfo[] = [];
  const headingStack: string[] = [];
  let htmlComment = false;
  let htmlBlockDepth = 0;
  let rawHtmlTag: string | undefined;
  let processingInstruction = false;
  let cdataBlock = false;
  let tableActive = false;
  let skipSetextUnderline = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (isInRange(line.start, structure.opaqueFencedRanges)) continue;
    if (skipSetextUnderline) { skipSetextUnderline = false; continue; }
    if (processingInstruction) { if (trimmed.includes("?>")) processingInstruction = false; continue; }
    if (trimmed.startsWith("<?")) { processingInstruction = !trimmed.includes("?>"); continue; }
    if (cdataBlock) { if (trimmed.includes("]]>") ) cdataBlock = false; continue; }
    if (trimmed.startsWith("<![CDATA[")) { cdataBlock = !trimmed.includes("]]>"); continue; }
    if (rawHtmlTag) { if (new RegExp(`</${rawHtmlTag}\\s*>`, "i").test(line.text)) rawHtmlTag = undefined; continue; }
    const rawOpening = trimmed.match(/^<\s*(script|style|textarea|title)\b[^>]*>/i);
    if (rawOpening) { const tag = rawOpening[1].toLowerCase(); const closePattern = new RegExp(`</${tag}\\s*>`, "i"); if (!closePattern.test(line.text.slice(rawOpening[0].length))) rawHtmlTag = tag; continue; }
    if (htmlComment) { if (trimmed.includes("-->")) htmlComment = false; continue; }
    if (trimmed.startsWith("<!--")) { htmlComment = !trimmed.includes("-->"); continue; }
    if (htmlBlockDepth > 0 || isHtmlBlock(lines, index)) { const delta = htmlTagDelta(line.text); htmlBlockDepth = Math.max(0, htmlBlockDepth + delta.opens - delta.closes); continue; }
    if (isTableDelimiter(line.text) || (lines[index + 1] && line.text.includes("|") && isTableDelimiter(lines[index + 1].text))) { tableActive = true; continue; }
    if (tableActive) { if (trimmed === "") tableActive = false; else if (line.text.includes("|")) continue; else tableActive = false; }
    if (isTableLiteral(line.text)) continue;
    const heading = line.text.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const level = heading[1].length; const text = heading[2].trim(); headingStack.splice(level - 1); headingStack.push(text); headings.push({ level, text, from: line.start, to: line.contentEnd, path: headingStack.slice() }); continue; }
    const setextLevel = lines[index + 1] && line.text.trim() !== "" && !listItemMatch(line.text) ? setextHeadingLevel(lines[index + 1].text) : undefined;
    if (setextLevel !== undefined) { const text = line.text.trim(); headingStack.splice(setextLevel - 1); headingStack.push(text); headings.push({ level: setextLevel, text, from: line.start, to: line.contentEnd, path: headingStack.slice() }); skipSetextUnderline = true; continue; }
    const item = listItemMatch(line.text);
    const depth = indentation(line.text);
    const match = taskMatch(line.text);
    if (!match || !structure.taskEligible[index]) continue;
    const blockquote = stripBlockquotePrefix(line.text);
    const markerOffset = blockquote.offset + blockquote.body.indexOf("[", match[1].length);
    if (markerOffset < 0 || isInsideInlineCode(line.text, markerOffset)) continue;
    if (!item || markerOffset < 0) continue;
    let itemEnd = line.end;
    for (let child = index + 1; child < lines.length; child += 1) { const next = lines[child]; const nextList = listItemMatch(next.text); const nextIndent = indentation(next.text); if (nextList && nextIndent <= depth) break; if (!nextList && next.text.trim() !== "" && nextIndent <= depth) break; itemEnd = next.end; }
    tasks.push({ from: line.start, to: line.contentEnd, itemStart: line.start, itemEnd, checkboxOffset: line.start + markerOffset + 1, checked: match[2].toLowerCase() === "x", text: match[3].trim(), depth, headingPath: headingStack.slice() });
  }
  const sections: SectionInfo[] = headings.map((heading, index) => { let to = markdown.length; for (let next = index + 1; next < headings.length; next += 1) { if (headings[next].level <= heading.level) { to = headings[next].from; break; } } return { ...heading, anchor: heading.from, from: heading.from, to }; });
  const analysis: MarkdownAnalysis = { headings, tasks, sections, opaqueFencedRanges: structure.opaqueFencedRanges, sectionAt: (offset) => sectionAt(analysis, offset), sectionByAnchor: (anchor) => sectionByAnchor(analysis, anchor) };
  return analysis;
}

type SectionLookup = Pick<MarkdownAnalysis, "sections">;
export function sectionAt(analysis: SectionLookup | string, offset: number): SectionInfo | undefined { const sections = typeof analysis === "string" ? analyzeMarkdown(analysis).sections : analysis.sections; for (let index = sections.length - 1; index >= 0; index -= 1) { const section = sections[index]; if (offset >= section.from && offset < section.to) return section; } return undefined; }
export function sectionByAnchor(analysis: SectionLookup | string, anchor: number): SectionInfo | undefined { const sections = typeof analysis === "string" ? analyzeMarkdown(analysis).sections : analysis.sections; return sections.find((section) => section.anchor === anchor); }
export function sectionAnchorAt(markdown: string, offset: number): number | undefined { return sectionAt(markdown, offset)?.anchor; }
export function remapSourceOffset(previous: string, next: string, offset: number): number { const bounded = Math.max(0, Math.min(offset, previous.length)); let prefix = 0; while (prefix < bounded && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1; let suffix = 0; while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1; const oldChangedEnd = previous.length - suffix; const nextChangedEnd = next.length - suffix; if (bounded === prefix && oldChangedEnd === prefix) return prefix + nextChangedEnd - prefix; if (bounded <= prefix) return bounded; if (bounded >= oldChangedEnd) return Math.max(0, bounded + next.length - previous.length); return prefix; }
export function toggleTask(markdown: string, task: TaskInfo): CommandResult { if (task.checkboxOffset < 0 || task.checkboxOffset >= markdown.length) return { markdown, changed: false }; const replacement = task.checked ? " " : "x"; return { markdown: markdown.slice(0, task.checkboxOffset) + replacement + markdown.slice(task.checkboxOffset + 1), changed: true, changeSet: createTextChangeSet(markdown.length, markdown.length, [{ from: task.checkboxOffset, to: task.checkboxOffset + 1, insertedLength: 1 }]) }; }
export function deleteTask(markdown: string, task: TaskInfo, ordinal?: number): CommandResult { const currentAnalysis = analyzeMarkdown(markdown); const currentTask = ordinal === undefined ? currentAnalysis.tasks.find((candidate) => sameTaskReference(candidate, task)) : Number.isInteger(ordinal) && ordinal >= 0 ? currentAnalysis.tasks[ordinal] : undefined; if (!currentTask || !sameTaskReference(currentTask, task)) return { markdown, changed: false }; const { itemStart, itemEnd } = currentTask; if (itemStart < 0 || itemEnd > markdown.length || itemStart >= itemEnd) return { markdown, changed: false }; return { markdown: markdown.slice(0, itemStart) + markdown.slice(itemEnd), changed: true, changeSet: createTextChangeSet(markdown.length, markdown.length - (itemEnd - itemStart), [{ from: itemStart, to: itemEnd, insertedLength: 0 }]) }; }
function sameTaskReference(left: TaskInfo, right: TaskInfo): boolean { return left.from === right.from && left.to === right.to && left.itemStart === right.itemStart && left.itemEnd === right.itemEnd && left.checkboxOffset === right.checkboxOffset && left.checked === right.checked && left.text === right.text && left.depth === right.depth && left.headingPath.length === right.headingPath.length && left.headingPath.every((part, index) => part === right.headingPath[index]); }
export function uncheckAll(markdown: string): CommandResult { const analysis = analyzeMarkdown(markdown); let output = markdown; let changed = false; const changes: TextChange[] = []; for (const task of analysis.tasks.filter((entry) => entry.checked).sort((a, b) => b.checkboxOffset - a.checkboxOffset)) { const result = toggleTask(output, { ...task, checkboxOffset: task.checkboxOffset }); output = result.markdown; changed = changed || result.changed; if (result.changed) changes.unshift({ from: task.checkboxOffset, to: task.checkboxOffset + 1, insertedLength: 1 }); } return { markdown: output, changed, ...(changed ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) }; }
export function deleteCompleted(markdown: string): CommandResult { const analysis = analyzeMarkdown(markdown); const ranges = analysis.tasks.filter((task) => task.checked).map((task) => [task.itemStart, task.itemEnd]).sort((a, b) => a[0] - b[0]); const mergedRanges: number[][] = []; for (const [from, to] of ranges) { const previous = mergedRanges[mergedRanges.length - 1]; if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to); else mergedRanges.push([from, to]); } let output = markdown; for (const [from, to] of [...mergedRanges].reverse()) output = output.slice(0, from) + output.slice(to); const changes = mergedRanges.map(([from, to]) => ({ from, to, insertedLength: 0 })); return { markdown: output, changed: mergedRanges.length > 0, ...(mergedRanges.length > 0 ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) }; }
export function outlineText(markdown: string): string { return analyzeMarkdown(markdown).headings.map((heading) => `${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.text}`).join("\n"); }
export function mindmapText(markdown: string, filter: MindmapFilter): string { const analysis = analyzeMarkdown(markdown); const headingLines = analysis.headings.map((heading) => ({ depth: heading.level - 1, text: heading.text })); const taskLines = filter === "hide" ? [] : analysis.tasks.filter((task) => filter !== "open" || !task.checked).map((task) => ({ depth: Math.min(5, task.depth / 2 + 1), text: `${task.checked ? "☑" : "☐"} ${task.text}` })); return [...headingLines, ...taskLines].map((line) => `${"  ".repeat(Math.max(0, Math.floor(line.depth)))}• ${line.text}`).join("\n"); }
export function isMindmapSuitable(markdown: string, analysis?: { headings?: unknown[]; tasks?: unknown[] }): boolean {
  if (!markdown || !markdown.trim()) return false;
  if (analysis?.headings && analysis.headings.length > 0) return true;
  if (analysis?.tasks && analysis.tasks.length > 0) return true;
  if (/^#{1,6}\s+\S/m.test(markdown)) return true;
  return /^\s*([-*+]|\d+\.)\s+\S/m.test(markdown);
}
