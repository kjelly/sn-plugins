import {
  scanMarkdownStructure,
  type MarkdownLine,
  type MarkdownRange,
} from "../markdown/analysis.ts";
import { remark } from "remark";
import remarkGfm from "remark-gfm";

export type ReviewSemanticScan = {
  lines: MarkdownLine[];
  taskEligible: boolean[];
  /** Fence ownership after Review-owned HTML bytes have been neutralized. */
  effectiveFenceRanges: MarkdownRange[];
  /** Source projection used to derive Review structural facts. */
  effectiveSource: string;
  htmlRanges: MarkdownRange[];
  opaqueRanges: MarkdownRange[];
  opaqueLines: boolean[];
  commentRanges: MarkdownRange[];
  inlineCodeRanges: MarkdownRange[];
  protectedRanges: MarkdownRange[];
  linkFacts: ReviewAstLinkFact[];
  tableLines: boolean[];
  fencedCodeBlocks: number;
};

export type ReviewAstLinkFact = MarkdownRange & {
  destination: string;
};

/**
 * Review-only eligibility view. The canonical Markdown scanner supplies the
 * initial fence/list facts; Review then recomputes fence ownership after
 * resolving HTML opacity, without changing shared parser semantics.
 */
export function scanReviewSemantics(markdown: string): ReviewSemanticScan {
  const structure = scanMarkdownStructure(markdown);
  const lines = structure.lines;
  const resolved = resolveReviewRanges(markdown, lines, structure.opaqueFencedRanges);
  const htmlRanges = resolved.htmlRanges;
  const commentRanges = resolved.commentRanges;
  const htmlSource = maskRanges(markdown, [...htmlRanges, ...commentRanges]);
  const astRanges = markdownAstRanges(htmlSource);
  const inlineCodeRanges = mergeRanges([
    ...resolved.inlineCodeRanges,
    ...astRanges.inlineCode.filter((range) => !rangesOverlapAny(range, [...structure.opaqueFencedRanges, ...htmlRanges, ...commentRanges])),
  ]);
  const orphanedFenceTerminatorLines = findOrphanedFenceTerminatorLines(
    structure.opaqueFencedRanges,
    inlineCodeRanges,
    lines,
  );
  const effectiveSource = maskRanges(htmlSource, [...inlineCodeRanges, ...orphanedFenceTerminatorLines]);
  const effectiveStructure = scanMarkdownStructure(effectiveSource);
  const effectiveAstRanges = markdownAstRanges(effectiveSource);
  const linkFacts = mergeLinkFacts([...astRanges.links, ...effectiveAstRanges.links]);
  // Keep adjacent fence blocks distinct: this is both a source fact and the
  // code-block metric, while merged ranges remain appropriate for protection.
  const effectiveFenceRanges = effectiveStructure.opaqueFencedRanges;
  const opaqueLines = lines.map((line) => effectiveFenceRanges.some((range) => overlaps(line, range)));
  const opaqueRanges = mergeRanges([...effectiveFenceRanges, ...htmlRanges]);
  for (const range of htmlRanges) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (range.from <= line.start && range.to >= line.contentEnd) opaqueLines[index] = true;
    }
  }
  for (const range of commentRanges) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (range.from <= line.start && range.to >= line.contentEnd) opaqueLines[index] = true;
    }
  }
  const protectedRanges = mergeRanges([...opaqueRanges, ...commentRanges, ...inlineCodeRanges]);
  const tableLines = findTableLines(lines, opaqueLines, protectedRanges);
  const fencedCodeBlocks = effectiveFenceRanges.length;

  return {
    lines,
    taskEligible: effectiveStructure.taskEligible,
    effectiveFenceRanges,
    effectiveSource,
    htmlRanges,
    opaqueRanges,
    opaqueLines,
    commentRanges,
    inlineCodeRanges,
    protectedRanges,
    linkFacts,
    tableLines,
    fencedCodeBlocks,
  };
}

type MdastNode = {
  type: string;
  children?: MdastNode[];
  url?: string;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

function markdownAstRanges(markdown: string): { inlineCode: MarkdownRange[]; links: ReviewAstLinkFact[] } {
  const tree = remark().use(remarkGfm).parse({ value: markdown, cwd: "" }) as unknown as MdastNode;
  const inlineCode: MarkdownRange[] = [];
  const links: ReviewAstLinkFact[] = [];
  const visit = (node: MdastNode): void => {
    if (node.type === "inlineCode" || node.type === "link") {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (from !== undefined && to !== undefined && from < to) {
        if (node.type === "inlineCode") inlineCode.push({ from, to });
        else if (typeof node.url === "string") links.push({ from, to, destination: node.url });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return { inlineCode, links };
}

type ResolvedReviewRanges = {
  htmlRanges: MarkdownRange[];
  commentRanges: MarkdownRange[];
  inlineCodeRanges: MarkdownRange[];
};

type ResolvedHtmlRange = { range: MarkdownRange; isComment: boolean };

/**
 * Resolve Review opacity in source order. A region that is found first owns
 * all of its contents, so HTML markers cannot pair through code and backticks
 * cannot create HTML opacity inside a real code span.
 */
function resolveReviewRanges(markdown: string, lines: MarkdownLine[], fenceRanges: MarkdownRange[]): ResolvedReviewRanges {
  const htmlRanges: MarkdownRange[] = [];
  const commentRanges: MarkdownRange[] = [];
  const inlineCodeRanges: MarkdownRange[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const html = findNextHtmlRange(markdown, lines, cursor, fenceRanges);
    const inlineCode = findNextInlineCodeRange(markdown, cursor, fenceRanges);
    if (html === undefined && inlineCode === undefined) break;

    if (inlineCode !== undefined && (html === undefined || inlineCode.from < html.range.from)) {
      inlineCodeRanges.push(inlineCode);
      cursor = inlineCode.to;
      continue;
    }

    if (html!.isComment) commentRanges.push(html!.range);
    else htmlRanges.push(html!.range);
    cursor = Math.max(html!.range.to, html!.range.from + 1);
  }

  return { htmlRanges, commentRanges, inlineCodeRanges };
}

function findNextHtmlRange(
  markdown: string,
  lines: MarkdownLine[],
  offset: number,
  fenceRanges: MarkdownRange[],
): ResolvedHtmlRange | undefined {
  let commentStart = findNextHtmlCommentStart(markdown, offset, fenceRanges);
  while (commentStart >= 0 && isInRange(commentStart, fenceRanges)) {
    commentStart = findNextHtmlCommentStart(markdown, commentStart + 4, fenceRanges);
  }

  let blockLineIndex: number | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.start < offset || isInRange(line.start, fenceRanges)) continue;
    if (isHtmlBlock(line.text.trim())) {
      blockLineIndex = index;
      break;
    }
  }

  if (commentStart < 0 && blockLineIndex === undefined) return undefined;
  const blockStart = blockLineIndex === undefined ? Number.POSITIVE_INFINITY : lines[blockLineIndex].start;
  if (commentStart >= 0 && commentStart < blockStart) {
    // The comment already owns this source interval. Canonical fences that
    // begin inside it must not hide its raw terminator.
    const end = findNextUnprotectedMarker(markdown, "-->", commentStart + 4, []);
    return { range: { from: commentStart, to: end < 0 ? markdown.length : end + 3 }, isComment: true };
  }

  return { range: resolveHtmlBlockRange(markdown, lines, blockLineIndex!), isComment: false };
}

function resolveHtmlBlockRange(
  markdown: string,
  lines: MarkdownLine[],
  startIndex: number,
): MarkdownRange {
  const firstLine = lines[startIndex];
  const trimmed = firstLine.text.trim();

  if (trimmed.startsWith("<?")) return resolveLineDelimitedHtmlRange(markdown, lines, startIndex, "?>");
  if (trimmed.startsWith("<![CDATA[")) return resolveLineDelimitedHtmlRange(markdown, lines, startIndex, "]]>");

  const rawOpening = trimmed.match(/^<\s*(script|style|textarea|title)\b[^>]*>/i);
  if (rawOpening) {
    const tag = rawOpening[1].toLowerCase();
    const closePattern = new RegExp(`</${tag}\\s*>`, "i");
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (closePattern.test(line.text)) return { from: firstLine.start, to: line.end };
    }
    return { from: firstLine.start, to: markdown.length };
  }

  let depth = 0;
  let rawTag: string | undefined;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const delta = htmlTagDelta(line.text, rawTag);
    rawTag = delta.rawTag;
    depth = Math.max(0, depth + delta.opens - delta.closes);
    if (depth === 0) return { from: firstLine.start, to: line.end };
  }
  return { from: firstLine.start, to: markdown.length };
}

function resolveLineDelimitedHtmlRange(
  markdown: string,
  lines: MarkdownLine[],
  startIndex: number,
  terminator: string,
): MarkdownRange {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text.trim().includes(terminator)) return { from: lines[startIndex].start, to: line.end };
  }
  return { from: lines[startIndex].start, to: markdown.length };
}

/**
 * Remark cannot expose inline-code spans when a line inside the span is
 * promoted to a block node. Pair delimiter runs lexically as a Review-only
 * supplement, but only after source-order HTML/code ownership is resolved.
 */
function findNextInlineCodeRange(markdown: string, offset: number, fenceRanges: MarkdownRange[]): MarkdownRange | undefined {
  let cursor = offset;
  while (cursor < markdown.length) {
    const ignored = fenceRanges.find((range) => cursor >= range.from && cursor < range.to);
    if (ignored) {
      cursor = ignored.to;
      continue;
    }
    if (markdown[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let runEnd = cursor + 1;
    while (runEnd < markdown.length && markdown[runEnd] === "`") runEnd += 1;
    const length = runEnd - cursor;
    if (!isEscaped(markdown, cursor)) {
      const closingEnd = findMatchingBacktickRun(markdown, runEnd, length);
      if (closingEnd !== undefined) return { from: cursor, to: closingEnd };
    }
    cursor = runEnd;
  }
  return undefined;
}

function findMatchingBacktickRun(markdown: string, offset: number, length: number): number | undefined {
  let cursor = offset;
  while (cursor < markdown.length) {
    if (markdown[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let runEnd = cursor + 1;
    while (runEnd < markdown.length && markdown[runEnd] === "`") runEnd += 1;
    if (runEnd - cursor === length && !isEscaped(markdown, cursor)) return runEnd;
    cursor = runEnd;
  }
  return undefined;
}

type ReviewFenceDelimiter = { character: "`" | "~"; length: number; start: number };

function findOrphanedFenceTerminatorLines(
  canonicalFenceRanges: MarkdownRange[],
  inlineCodeRanges: MarkdownRange[],
  lines: MarkdownLine[],
): MarkdownRange[] {
  const terminatorLines: MarkdownRange[] = [];
  for (const canonical of canonicalFenceRanges) {
    if (!isInRange(canonical.from, inlineCodeRanges)) continue;
    const opener = lines.find((line) => line.start === canonical.from);
    const terminator = lines.find((line) => line.end === canonical.to);
    if (!opener || !terminator || terminator.start <= opener.start) continue;

    const delimiter = sourceFenceDelimiter(opener.text);
    if (delimiter && isSourceFenceClose(terminator.text, delimiter)) {
      terminatorLines.push({ from: terminator.start, to: terminator.end });
    }
  }
  return mergeRanges(terminatorLines);
}

/**
 * The canonical range proves that the opener is a real fence. Read only its
 * source delimiter here; container indentation and list/blockquote grammar
 * belong to scanMarkdownStructure and must not be approximated in Review.
 */
function sourceFenceDelimiter(text: string): ReviewFenceDelimiter | undefined {
  const match = text.match(/(`{3,}|~{3,})/);
  if (!match || match.index === undefined) return undefined;
  return { character: match[0][0] as "`" | "~", length: match[0].length, start: match.index };
}

function isSourceFenceClose(text: string, opener: ReviewFenceDelimiter): boolean {
  const delimiter = sourceFenceDelimiter(text);
  if (!delimiter || delimiter.character !== opener.character || delimiter.length < opener.length) return false;
  return /^[ \t]*$/.test(text.slice(delimiter.start + delimiter.length));
}

function mergeLinkFacts(linkFacts: ReviewAstLinkFact[]): ReviewAstLinkFact[] {
  const merged: ReviewAstLinkFact[] = [];
  for (const link of linkFacts) {
    if (!merged.some((existing) => existing.from === link.from && existing.to === link.to && existing.destination === link.destination)) {
      merged.push(link);
    }
  }
  return merged;
}

function isEscaped(text: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function findNextUnprotectedMarker(
  text: string,
  marker: string,
  offset: number,
  ignoredRanges: MarkdownRange[],
): number {
  let markerOffset = text.indexOf(marker, offset);
  while (markerOffset >= 0) {
    if (!ignoredRanges.some((range) => markerOffset >= range.from && markerOffset < range.to)) return markerOffset;
    markerOffset = text.indexOf(marker, markerOffset + marker.length);
  }
  return -1;
}

/** Replace Review-owned bytes without changing line breaks or UTF-16 offsets. */
function maskRanges(text: string, ranges: MarkdownRange[]): string {
  const masked = text.split("");
  for (const range of ranges) {
    const from = Math.max(0, range.from);
    const to = Math.min(text.length, range.to);
    for (let offset = from; offset < to; offset += 1) {
      if (text[offset] !== "\r" && text[offset] !== "\n") masked[offset] = " ";
    }
  }
  return masked.join("");
}

function findNextHtmlCommentStart(text: string, offset: number, ignoredRanges: MarkdownRange[]): number {
  let markerOffset = findNextUnprotectedMarker(text, "<!--", offset, ignoredRanges);
  while (markerOffset >= 0 && isEscaped(text, markerOffset)) {
    markerOffset = findNextUnprotectedMarker(text, "<!--", markerOffset + 4, ignoredRanges);
  }
  return markerOffset;
}

function overlaps(line: MarkdownLine, range: MarkdownRange): boolean {
  return line.start < range.to && line.end > range.from;
}

function isInRange(offset: number, ranges: MarkdownRange[]): boolean {
  return ranges.some((range) => offset >= range.from && offset < range.to);
}

function rangesOverlapAny(range: MarkdownRange, candidates: MarkdownRange[]): boolean {
  return candidates.some((candidate) => range.from < candidate.to && candidate.from < range.to);
}

function isHtmlBlock(trimmed: string): boolean {
  return /^<\/?[a-z][\w:-]*(?:\s|>|\/)/i.test(trimmed) || trimmed.startsWith("<?") || trimmed.startsWith("<![CDATA[") || /^<![A-Z]/.test(trimmed);
}

function htmlTagDelta(text: string, activeRawTag?: string): { opens: number; closes: number; rawTag: string | undefined } {
  let opens = 0;
  let closes = 0;
  const voidHtmlTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const rawHtmlTags = new Set(["script", "style", "textarea", "title"]);
  let rawTag = activeRawTag;
  const tags = /<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\/?\s*>/gi;
  for (const match of text.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    const token = match[0];
    if (rawTag !== undefined) {
      if (token.startsWith("</") && tag === rawTag) rawTag = undefined;
      continue;
    }
    if (token.startsWith("</")) closes += 1;
    else if (!voidHtmlTags.has(tag) && !token.endsWith("/>")) {
      if (rawHtmlTags.has(tag)) rawTag = tag;
      else opens += 1;
    }
  }
  return { opens, closes, rawTag };
}

function mergeRanges(ranges: MarkdownRange[]): MarkdownRange[] {
  const sorted = ranges.filter((range) => range.from < range.to).sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: MarkdownRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function stripBlockquotePrefix(text: string): { body: string; depth: number } {
  let offset = 0;
  let depth = 0;
  while (true) {
    const match = text.slice(offset).match(/^ {0,3}>[ \t]?/);
    if (!match) break;
    offset += match[0].length;
    depth += 1;
  }
  return { body: text.slice(offset), depth };
}

function findTableLines(lines: MarkdownLine[], opaqueLines: boolean[], protectedRanges: MarkdownRange[]): boolean[] {
  const tableLines = lines.map(() => false);
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (opaqueLines[index] || opaqueLines[index + 1]) continue;
    const header = tableCellText(visibleTableLineText(lines[index], protectedRanges));
    const delimiter = tableCellText(visibleTableLineText(lines[index + 1], protectedRanges));
    if (!header.includes("|") || !isTableDelimiter(delimiter)) continue;
    tableLines[index] = true;
    tableLines[index + 1] = true;
    for (let row = index + 2; row < lines.length && !opaqueLines[row]; row += 1) {
      if (lines[row].text.trim() === "") break;
      if (!tableCellText(visibleTableLineText(lines[row], protectedRanges)).includes("|")) break;
      tableLines[row] = true;
    }
    index += 1;
  }
  return tableLines;
}

function visibleTableLineText(line: MarkdownLine, protectedRanges: MarkdownRange[]): string {
  let visible = line.text;
  const ranges = protectedRanges
    .map((range) => ({
      from: Math.max(range.from, line.start) - line.start,
      to: Math.min(range.to, line.contentEnd) - line.start,
    }))
    .filter((range) => range.from < range.to)
    .sort((left, right) => left.from - right.from);
  for (const range of ranges) {
    visible = `${visible.slice(0, range.from)}${" ".repeat(range.to - range.from)}${visible.slice(range.to)}`;
  }
  return visible;
}

function tableCellText(text: string): string {
  return stripBlockquotePrefix(text).body.trim();
}

function isTableDelimiter(text: string): boolean {
  const cells = text.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
