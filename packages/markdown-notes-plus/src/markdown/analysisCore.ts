import { createTextChangeSet, type TextChange, type TextChangeSet } from "../document/PositionMap.ts";
import { updateTaskTextForToggle } from "../tasks/RecurringTasks.ts";
import { scanMarkdownStructure as scanSharedMarkdownStructure, splitMarkdownLines as splitSharedMarkdownLines } from "./structureScanner.ts";

export type MarkdownLine = { start: number; contentEnd: number; end: number; text: string };
export type MarkdownRange = { from: number; to: number };
export type HeadingSyntax = "atx" | "setext";
export type HeadingInfo = {
  level: number;
  text: string;
  from: number;
  to: number;
  path: string[];
  syntax: HeadingSyntax;
  headingFrom: number;
  headingTo: number;
  markerFrom?: number;
  markerTo?: number;
};
export type SectionInfo = {
  anchor: number;
  level: number;
  text: string;
  from: number;
  to: number;
  path: string[];
  headingIndex: number;
  parentAnchor?: number;
};
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
  return splitSharedMarkdownLines(markdown);
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

export function scanMarkdownStructure(markdown: string): MarkdownStructure {
  return scanSharedMarkdownStructure(markdown);
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
    const heading = line.text.match(/^([ \t]{0,3})(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[2].length;
      const text = heading[3].trim();
      headingStack.splice(level - 1);
      headingStack.push(text);
      const leadingSpaces = heading[1].length;
      const markerFrom = line.start + leadingSpaces;
      const markerTo = markerFrom + level;
      headings.push({
        level,
        text,
        from: line.start,
        to: line.contentEnd,
        path: headingStack.slice(),
        syntax: "atx",
        headingFrom: line.start,
        headingTo: line.end,
        markerFrom,
        markerTo,
      });
      continue;
    }
    const setextLevel = lines[index + 1] && line.text.trim() !== "" && !listItemMatch(line.text) ? setextHeadingLevel(lines[index + 1].text) : undefined;
    if (setextLevel !== undefined) {
      const text = line.text.trim();
      headingStack.splice(setextLevel - 1);
      headingStack.push(text);
      headings.push({
        level: setextLevel,
        text,
        from: line.start,
        to: line.contentEnd,
        path: headingStack.slice(),
        syntax: "setext",
        headingFrom: line.start,
        headingTo: lines[index + 1].end,
        markerFrom: undefined,
        markerTo: undefined,
      });
      skipSetextUnderline = true;
      continue;
    }
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
  const sections: SectionInfo[] = headings.map((heading, index) => {
    let to = markdown.length;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next].level <= heading.level) {
        to = headings[next].from;
        break;
      }
    }
    let parentAnchor: number | undefined = undefined;
    for (let prev = index - 1; prev >= 0; prev -= 1) {
      if (headings[prev].level < heading.level) {
        parentAnchor = headings[prev].from;
        break;
      }
    }
    return {
      ...heading,
      anchor: heading.from,
      from: heading.from,
      to,
      headingIndex: index,
      parentAnchor,
    };
  });
  const analysis: MarkdownAnalysis = { headings, tasks, sections, opaqueFencedRanges: structure.opaqueFencedRanges, sectionAt: (offset) => sectionAt(analysis, offset), sectionByAnchor: (anchor) => sectionByAnchor(analysis, anchor) };
  return analysis;
}

export function headingIndexByAnchor(analysis: MarkdownAnalysis, anchor: number): number | undefined {
  return analysis.sectionByAnchor(anchor)?.headingIndex;
}

export function parentSection(analysis: MarkdownAnalysis, anchor: number): SectionInfo | undefined {
  const section = analysis.sectionByAnchor(anchor);
  if (!section || section.parentAnchor === undefined) return undefined;
  return analysis.sectionByAnchor(section.parentAnchor);
}

export function siblingSections(analysis: MarkdownAnalysis, anchor: number): SectionInfo[] {
  const section = analysis.sectionByAnchor(anchor);
  if (!section) return [];
  return analysis.sections.filter(
    (candidate) => candidate.level === section.level && candidate.parentAnchor === section.parentAnchor,
  );
}

export function previousSiblingSection(analysis: MarkdownAnalysis, anchor: number): SectionInfo | undefined {
  const siblings = siblingSections(analysis, anchor);
  const index = siblings.findIndex((s) => s.anchor === anchor);
  if (index <= 0) return undefined;
  return siblings[index - 1];
}

export function nextSiblingSection(analysis: MarkdownAnalysis, anchor: number): SectionInfo | undefined {
  const siblings = siblingSections(analysis, anchor);
  const index = siblings.findIndex((s) => s.anchor === anchor);
  if (index < 0 || index >= siblings.length - 1) return undefined;
  return siblings[index + 1];
}

export function headingsInSection(analysis: MarkdownAnalysis, anchor: number): HeadingInfo[] {
  const section = analysis.sectionByAnchor(anchor);
  if (!section) return [];
  return analysis.headings.filter((h) => h.from >= section.from && h.to <= section.to);
}

type SectionLookup = Pick<MarkdownAnalysis, "sections">;
export function sectionAt(analysis: SectionLookup | string, offset: number): SectionInfo | undefined { const sections = typeof analysis === "string" ? analyzeMarkdown(analysis).sections : analysis.sections; for (let index = sections.length - 1; index >= 0; index -= 1) { const section = sections[index]; if (offset >= section.from && offset < section.to) return section; } return undefined; }
export function sectionByAnchor(analysis: SectionLookup | string, anchor: number): SectionInfo | undefined { const sections = typeof analysis === "string" ? analyzeMarkdown(analysis).sections : analysis.sections; return sections.find((section) => section.anchor === anchor); }
export function sectionAnchorAt(markdown: string, offset: number): number | undefined { return sectionAt(markdown, offset)?.anchor; }
export function remapSourceOffset(previous: string, next: string, offset: number): number { const bounded = Math.max(0, Math.min(offset, previous.length)); let prefix = 0; while (prefix < bounded && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1; let suffix = 0; while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1; const oldChangedEnd = previous.length - suffix; const nextChangedEnd = next.length - suffix; if (bounded === prefix && oldChangedEnd === prefix) return prefix + nextChangedEnd - prefix; if (bounded <= prefix) return bounded; if (bounded >= oldChangedEnd) return Math.max(0, bounded + next.length - previous.length); return prefix; }
export function toggleTask(markdown: string, task: TaskInfo, today: Date = new Date()): CommandResult {
  if (task.checkboxOffset < 0 || task.checkboxOffset >= markdown.length) return { markdown, changed: false };
  const lineStart = task.from;
  const lineEnd = task.to;
  const lineText = markdown.slice(lineStart, lineEnd);
  const nextChecked = !task.checked;
  const replacement = nextChecked ? "x" : " ";
  const replacedChar = lineText.slice(0, task.checkboxOffset - lineStart) + replacement + lineText.slice(task.checkboxOffset - lineStart + 1);
  const updatedLineText = updateTaskTextForToggle(replacedChar, nextChecked, today);

  if (updatedLineText === lineText) return { markdown, changed: false };

  const nextMarkdown = markdown.slice(0, lineStart) + updatedLineText + markdown.slice(lineEnd);
  const changes: TextChange[] = updatedLineText.length === lineText.length
    ? [{ from: task.checkboxOffset, to: task.checkboxOffset + 1, insertedLength: 1 }]
    : [{ from: lineStart, to: lineEnd, insertedLength: updatedLineText.length }];

  return {
    markdown: nextMarkdown,
    changed: true,
    changeSet: createTextChangeSet(markdown.length, nextMarkdown.length, changes),
  };
}
export function deleteTask(markdown: string, task: TaskInfo, ordinal?: number): CommandResult { const currentAnalysis = analyzeMarkdown(markdown); const currentTask = ordinal === undefined ? currentAnalysis.tasks.find((candidate) => sameTaskReference(candidate, task)) : Number.isInteger(ordinal) && ordinal >= 0 ? currentAnalysis.tasks[ordinal] : undefined; if (!currentTask || !sameTaskReference(currentTask, task)) return { markdown, changed: false }; const { itemStart, itemEnd } = currentTask; if (itemStart < 0 || itemEnd > markdown.length || itemStart >= itemEnd) return { markdown, changed: false }; return { markdown: markdown.slice(0, itemStart) + markdown.slice(itemEnd), changed: true, changeSet: createTextChangeSet(markdown.length, markdown.length - (itemEnd - itemStart), [{ from: itemStart, to: itemEnd, insertedLength: 0 }]) }; }
function sameTaskReference(left: TaskInfo, right: TaskInfo): boolean { return left.from === right.from && left.to === right.to && left.itemStart === right.itemStart && left.itemEnd === right.itemEnd && left.checkboxOffset === right.checkboxOffset && left.checked === right.checked && left.text === right.text && left.depth === right.depth && left.headingPath.length === right.headingPath.length && left.headingPath.every((part, index) => part === right.headingPath[index]); }
export function uncheckAll(markdown: string): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  let output = markdown;
  let changed = false;
  const changes: TextChange[] = [];
  for (const task of analysis.tasks.filter((entry) => entry.checked).sort((a, b) => b.from - a.from)) {
    const result = toggleTask(output, task);
    output = result.markdown;
    changed = changed || result.changed;
    if (result.changed && result.changeSet) {
      changes.unshift(...result.changeSet.changes);
    }
  }
  return { markdown: output, changed, ...(changed ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) };
}
export function deleteCompleted(markdown: string): CommandResult { const analysis = analyzeMarkdown(markdown); const ranges = analysis.tasks.filter((task) => task.checked).map((task) => [task.itemStart, task.itemEnd]).sort((a, b) => a[0] - b[0]); const mergedRanges: number[][] = []; for (const [from, to] of ranges) { const previous = mergedRanges[mergedRanges.length - 1]; if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to); else mergedRanges.push([from, to]); } let output = markdown; for (const [from, to] of [...mergedRanges].reverse()) output = output.slice(0, from) + output.slice(to); const changes = mergedRanges.map(([from, to]) => ({ from, to, insertedLength: 0 })); return { markdown: output, changed: mergedRanges.length > 0, ...(mergedRanges.length > 0 ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) }; }
export function outlineText(markdown: string): string { return analyzeMarkdown(markdown).headings.map((heading) => `${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.text}`).join("\n"); }
export function mindmapText(markdown: string, filter: MindmapFilter): string { const analysis = analyzeMarkdown(markdown); const headingLines = analysis.headings.map((heading) => ({ depth: heading.level - 1, text: heading.text })); const taskLines = filter === "hide" ? [] : analysis.tasks.filter((task) => filter !== "open" || !task.checked).map((task) => ({ depth: Math.min(5, task.depth / 2 + 1), text: `${task.checked ? "☑" : "☐"} ${task.text}` })); return [...headingLines, ...taskLines].map((line) => `${"  ".repeat(Math.max(0, Math.floor(line.depth)))}• ${line.text}`).join("\n"); }
export function checkAllInSection(markdown: string, sectionAnchor: number): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const section = analysis.sectionByAnchor(sectionAnchor);
  if (!section) return { markdown, changed: false };
  const targetTasks = analysis.tasks.filter((task) => !task.checked && task.itemStart >= section.from && task.itemEnd <= section.to);
  if (targetTasks.length === 0) return { markdown, changed: false };
  let output = markdown;
  let changed = false;
  const changes: TextChange[] = [];
  for (const task of targetTasks.sort((a, b) => b.from - a.from)) {
    const result = toggleTask(output, task);
    output = result.markdown;
    changed = changed || result.changed;
    if (result.changed && result.changeSet) {
      changes.unshift(...result.changeSet.changes);
    }
  }
  return { markdown: output, changed, ...(changed ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) };
}

export function uncheckAllInSection(markdown: string, sectionAnchor: number): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const section = analysis.sectionByAnchor(sectionAnchor);
  if (!section) return { markdown, changed: false };
  const targetTasks = analysis.tasks.filter((task) => task.checked && task.itemStart >= section.from && task.itemEnd <= section.to);
  if (targetTasks.length === 0) return { markdown, changed: false };
  let output = markdown;
  let changed = false;
  const changes: TextChange[] = [];
  for (const task of targetTasks.sort((a, b) => b.from - a.from)) {
    const result = toggleTask(output, task);
    output = result.markdown;
    changed = changed || result.changed;
    if (result.changed && result.changeSet) {
      changes.unshift(...result.changeSet.changes);
    }
  }
  return { markdown: output, changed, ...(changed ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) };
}

export function deleteCompletedInSection(markdown: string, sectionAnchor: number): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const section = analysis.sectionByAnchor(sectionAnchor);
  if (!section) return { markdown, changed: false };
  const targetTasks = analysis.tasks.filter((task) => task.checked && task.itemStart >= section.from && task.itemEnd <= section.to);
  if (targetTasks.length === 0) return { markdown, changed: false };
  const ranges = targetTasks.map((task) => [task.itemStart, task.itemEnd]).sort((a, b) => a[0] - b[0]);
  const mergedRanges: number[][] = [];
  for (const [from, to] of ranges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
    else mergedRanges.push([from, to]);
  }
  let output = markdown;
  for (const [from, to] of [...mergedRanges].reverse()) output = output.slice(0, from) + output.slice(to);
  const changes = mergedRanges.map(([from, to]) => ({ from, to, insertedLength: 0 }));
  return { markdown: output, changed: mergedRanges.length > 0, ...(mergedRanges.length > 0 ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) };
}

function sameHeadingPath(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

export function uncheckAllInHeadingPath(markdown: string, headingPath: string[]): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const targetTasks = analysis.tasks.filter((task) => task.checked && sameHeadingPath(task.headingPath, headingPath));
  if (targetTasks.length === 0) return { markdown, changed: false };
  let output = markdown;
  let changed = false;
  const changes: TextChange[] = [];
  for (const task of targetTasks.sort((a, b) => b.from - a.from)) {
    const result = toggleTask(output, task);
    output = result.markdown;
    changed = changed || result.changed;
    if (result.changed && result.changeSet) {
      changes.unshift(...result.changeSet.changes);
    }
  }
  return { markdown: output, changed, ...(changed ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) };
}

export function deleteCompletedInHeadingPath(markdown: string, headingPath: string[]): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const targetTasks = analysis.tasks.filter((task) => task.checked && sameHeadingPath(task.headingPath, headingPath));
  if (targetTasks.length === 0) return { markdown, changed: false };
  const ranges = targetTasks.map((task) => [task.itemStart, task.itemEnd]).sort((a, b) => a[0] - b[0]);
  const mergedRanges: number[][] = [];
  for (const [from, to] of ranges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
    else mergedRanges.push([from, to]);
  }
  let output = markdown;
  for (const [from, to] of [...mergedRanges].reverse()) output = output.slice(0, from) + output.slice(to);
  const changes = mergedRanges.map(([from, to]) => ({ from, to, insertedLength: 0 }));
  return { markdown: output, changed: mergedRanges.length > 0, ...(mergedRanges.length > 0 ? { changeSet: createTextChangeSet(markdown.length, output.length, changes) } : {}) };
}

export function isMindmapSuitable(markdown: string, analysis?: { headings?: unknown[]; tasks?: unknown[] }): boolean {
  if (!markdown || !markdown.trim()) return false;
  if (analysis?.headings && analysis.headings.length > 0) return true;
  if (analysis?.tasks && analysis.tasks.length > 0) return true;
  if (/^#{1,6}\s+\S/m.test(markdown)) return true;
  return /^\s*([-*+]|\d+\.)\s+\S/m.test(markdown);
}
