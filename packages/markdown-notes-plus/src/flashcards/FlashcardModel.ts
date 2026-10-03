import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { analyzeMarkdown, type HeadingInfo, type MarkdownAnalysis, type MarkdownRange } from "../markdown/analysis.ts";
import { isQaHeading } from "./FlashcardSuitability.ts";
import type { Flashcard, FlashcardModel, FlashcardSection, FlashcardSourceRange } from "./FlashcardTypes.ts";

type MdastNode = {
  type: string;
  children?: MdastNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type Marker = {
  kind: "q" | "a";
  lineFrom: number;
  lineTo: number;
  contentFrom: number;
};

function astProtectedRanges(markdown: string): MarkdownRange[] {
  const tree = remark().use(remarkGfm).parse({ value: markdown, cwd: "" }) as unknown as MdastNode;
  const ranges: MarkdownRange[] = [];
  const visit = (node: MdastNode): void => {
    if (node.type === "code" || node.type === "inlineCode" || node.type === "html") {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (from !== undefined && to !== undefined && from < to) ranges.push({ from, to });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function rangeContains(ranges: MarkdownRange[], offset: number): boolean {
  return ranges.some((range) => offset >= range.from && offset < range.to);
}

function trimRange(markdown: string, from: number, to: number): FlashcardSourceRange {
  while (from < to && /\s/u.test(markdown[from])) from += 1;
  while (to > from && /\s/u.test(markdown[to - 1])) to -= 1;
  return { from, to };
}

function trimLeadingBlankLines(markdown: string, from: number, to: number): number {
  let cursor = from;
  while (cursor < to) {
    const end = markdown.indexOf("\n", cursor);
    const lineEnd = end < 0 || end >= to ? to : end + 1;
    if (markdown.slice(cursor, end < 0 || end >= to ? to : end).replace(/\r$/u, "").trim() !== "") break;
    cursor = lineEnd;
  }
  return cursor;
}

function sectionEnd(headings: HeadingInfo[], index: number, markdownLength: number): number {
  const heading = headings[index];
  for (let next = index + 1; next < headings.length; next += 1) {
    if (headings[next].level <= heading.level) return headings[next].from;
  }
  return markdownLength;
}

function markersInRange(
  analysis: MarkdownAnalysis,
  from: number,
  to: number,
  protectedRanges: MarkdownRange[],
): Marker[] {
  const markers: Marker[] = [];
  for (const line of analysis.physicalLines) {
    if (line.start < from || line.start >= to) continue;
    const match = line.text.match(/^ {0,3}([qa])\s*[:：][ \t]*/iu);
    if (!match || rangeContains(protectedRanges, line.start + (match.index ?? 0))) continue;
    markers.push({
      kind: match[1].toLocaleLowerCase() as "q" | "a",
      lineFrom: line.start,
      lineTo: Math.min(line.eolTo, to),
      contentFrom: line.start + match[0].length,
    });
  }
  return markers;
}

function categoryAt(analysis: MarkdownAnalysis, sectionHeading: HeadingInfo, offset: number): { path: string[]; anchor?: number } {
  const containing = analysis.sections
    .filter((candidate) => candidate.from > sectionHeading.from && candidate.from <= offset && candidate.to > offset)
    .sort((left, right) => left.level - right.level);
  return { path: containing.map((candidate) => candidate.text), anchor: containing.at(-1)?.anchor };
}

function cardsForSection(
  markdown: string,
  analysis: MarkdownAnalysis,
  heading: HeadingInfo,
  section: FlashcardSection,
  protectedRanges: MarkdownRange[],
): Flashcard[] {
  const nestedQaRanges = analysis.headings.flatMap((candidate, index) => {
    if (candidate.from <= heading.from || candidate.from >= section.sourceRange.to || !isQaHeading(candidate.text)) return [];
    return [{ from: candidate.from, to: sectionEnd(analysis.headings, index, markdown.length) }];
  });
  const markers = markersInRange(analysis, heading.headingTo, section.sourceRange.to, protectedRanges)
    .filter((marker) => !rangeContains(nestedQaRanges, marker.lineFrom));
  const nestedQaStarts = nestedQaRanges.map((range) => range.from);
  const cards: Flashcard[] = [];
  let pendingQuestion: Marker | undefined;
  let pendingAnswer: Marker | undefined;
  let nextNestedQa = 0;

  const emit = (end: number): void => {
    if (!pendingQuestion || !pendingAnswer) return;
    const questionRange = trimRange(markdown, pendingQuestion.contentFrom, pendingAnswer.lineFrom);
    const answerFrom = trimLeadingBlankLines(markdown, pendingAnswer.contentFrom, end);
    const answerRange = { from: answerFrom, to: end };
    const question = markdown.slice(questionRange.from, questionRange.to);
    const answerMarkdown = markdown.slice(answerRange.from, answerRange.to);
    if (!question.trim() || !answerMarkdown.trim()) return;
    const category = categoryAt(analysis, heading, pendingQuestion.lineFrom);
    cards.push({
      id: `card:${pendingQuestion.lineFrom}:${pendingAnswer.lineFrom}:${end}`,
      sectionId: section.id,
      sectionTitle: section.title,
      headingPath: category.path,
      categoryAnchor: category.anchor,
      question,
      answerMarkdown,
      questionRange,
      answerRange,
      sourceRange: { from: pendingQuestion.lineFrom, to: end },
    });
  };

  const endBeforeNestedQa = (before: number): void => {
    while (nextNestedQa < nestedQaStarts.length && nestedQaStarts[nextNestedQa] <= before) {
      emit(nestedQaStarts[nextNestedQa]);
      pendingQuestion = undefined;
      pendingAnswer = undefined;
      nextNestedQa += 1;
    }
  };

  for (const marker of markers) {
    endBeforeNestedQa(marker.lineFrom);
    if (marker.kind === "q") {
      emit(marker.lineFrom);
      pendingQuestion = marker;
      pendingAnswer = undefined;
      continue;
    }
    if (pendingQuestion && !pendingAnswer) pendingAnswer = marker;
  }
  endBeforeNestedQa(section.sourceRange.to);
  emit(section.sourceRange.to);
  return cards;
}

export function analyzeFlashcards(
  markdown: string,
  analysis: MarkdownAnalysis = analyzeMarkdown(markdown),
): FlashcardModel {
  const protectedRanges = [...analysis.opaqueFencedRanges, ...astProtectedRanges(markdown)];
  const sections: FlashcardSection[] = [];
  const cards: Flashcard[] = [];

  analysis.headings.forEach((heading, index) => {
    if (!isQaHeading(heading.text)) return;
    const to = sectionEnd(analysis.headings, index, markdown.length);
    const section: FlashcardSection = {
      id: `section:${heading.from}:${to}`,
      title: heading.text,
      headingPath: heading.path.slice(),
      headingLevel: heading.level,
      sourceRange: { from: heading.from, to },
    };
    sections.push(section);
    cards.push(...cardsForSection(markdown, analysis, heading, section, protectedRanges));
  });

  return { markdown, sections, cards };
}
