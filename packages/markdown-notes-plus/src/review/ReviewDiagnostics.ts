import { analyzeMarkdown, type CommandResult, type MarkdownAnalysis, type MarkdownRange } from "../markdown/analysis.ts";
import { createTextChangeSet } from "../document/PositionMap.ts";
import { scanReviewSemantics, type ReviewSemanticScan } from "./ReviewSemanticScanner.ts";

/** Section ownership warning is deliberately below the note-level 500/900 KB thresholds. */
export const OVERLONG_SECTION_THRESHOLD_BYTES = 100 * 1024;

export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticCategory = "structure" | "task" | "links" | "complexity";
export type AutoFixType = "fix-level-jump" | "remove-empty-heading";

/** A source range uses the same UTF-16 offsets as the Markdown analysis. */
export interface SourceRange {
  from: number;
  to: number;
}

export interface DiagnosticIssue {
  id: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  message: string;
  anchor?: number;
  /** Diagnostic source location; for fixable issues this is the exact changed range. */
  sourceRange?: SourceRange;
  line?: number;
  canAutoFix?: boolean;
  fixType?: AutoFixType;
}

export interface LargestSectionInfo {
  title: string;
  /** UTF-8 byte size of this heading's exclusive, non-overlapping ownership range. */
  bytes: number;
  percentage: number;
  anchor: number;
  sourceRange: SourceRange;
}

export interface NoteMetrics {
  bytes: number;
  words: number;
  lines: number;
  headingsCount: number;
  tasksCount: number;
  openTasksCount: number;
  completedTasksCount: number;
  codeBlocksCount: number;
  tablesCount: number;
  sizeLevel: "normal" | "warning" | "high";
  largestSections: LargestSectionInfo[];
}

export interface ReviewReport {
  metrics: NoteMetrics;
  issues: DiagnosticIssue[];
  healthScore: number;
}

type ReviewVisibleHeading = {
  analysisIndex: number;
  heading: MarkdownAnalysis["headings"][number];
};

type ReviewVisibleTask = {
  analysisIndex: number;
  task: MarkdownAnalysis["tasks"][number];
};

type ReviewVisibleSection = {
  heading: ReviewVisibleHeading;
  from: number;
  to: number;
  exclusiveTo: number;
};

type ReviewVisibleProjection = {
  headings: ReviewVisibleHeading[];
  tasks: ReviewVisibleTask[];
  sections: ReviewVisibleSection[];
};

function createReviewVisibleProjection(
  markdown: string,
  analysis: MarkdownAnalysis,
  semantic: ReviewSemanticScan,
): ReviewVisibleProjection {
  const effectiveAnalysis = analyzeMarkdown(semantic.effectiveSource);
  const headings = effectiveAnalysis.headings
    .map((heading, effectiveIndex) => {
      const sharedIndex = analysis.headings.findIndex((candidate) => candidate.from === heading.from);
      return {
        analysisIndex: sharedIndex >= 0 ? sharedIndex : effectiveIndex,
        heading: sharedIndex >= 0 ? analysis.headings[sharedIndex] : heading,
      };
    })
    .filter(({ heading }) => !isHeadingStructuralTokenProtected(heading, semantic));
  const tasks = effectiveAnalysis.tasks
    .map((task, effectiveIndex) => {
      const sharedIndex = analysis.tasks.findIndex((candidate) => candidate.from === task.from);
      return {
        analysisIndex: sharedIndex >= 0 ? sharedIndex : effectiveIndex,
        task: sharedIndex >= 0 ? analysis.tasks[sharedIndex] : task,
      };
    })
    .filter(({ task }) => isTaskStructuralTokenVisible(task, semantic));
  const sections = headings.map((heading, visibleIndex) => {
    let to = markdown.length;
    for (let next = visibleIndex + 1; next < headings.length; next += 1) {
      if (headings[next].heading.level <= heading.heading.level) {
        to = headings[next].heading.from;
        break;
      }
    }
    return {
      heading,
      from: heading.heading.from,
      to,
      exclusiveTo: headings[visibleIndex + 1]?.heading.from ?? markdown.length,
    };
  });
  return { headings, tasks, sections };
}

function isHeadingStructuralTokenProtected(
  heading: MarkdownAnalysis["headings"][number],
  semantic: ReviewSemanticScan,
): boolean {
  if (heading.markerFrom !== undefined && heading.markerTo !== undefined) {
    return rangesOverlap({ from: heading.markerFrom, to: heading.markerTo }, semantic.protectedRanges);
  }
  const underline = semantic.lines.find((line) => line.end === heading.headingTo && line.start >= heading.from);
  const structuralRange = underline
    ? { from: underline.start, to: underline.contentEnd }
    : { from: heading.from, to: Math.min(heading.from + 1, heading.to) };
  return rangesOverlap(structuralRange, semantic.protectedRanges);
}

function isTaskStructuralTokenVisible(
  task: MarkdownAnalysis["tasks"][number],
  semantic: ReviewSemanticScan,
): boolean {
  const lineIndex = lineIndexAtOffset(semantic.lines, task.from);
  return lineIndex !== undefined
    && !semantic.opaqueLines[lineIndex]
    && !rangesOverlap({ from: task.checkboxOffset, to: task.checkboxOffset + 1 }, semantic.protectedRanges);
}

export function computeNoteMetrics(markdown: string, analysis: MarkdownAnalysis): NoteMetrics {
  const semantic = scanReviewSemantics(markdown);
  const projection = createReviewVisibleProjection(markdown, analysis, semantic);
  const bytes = new TextEncoder().encode(markdown).length;
  const lines = markdown.length === 0 ? 0 : markdown.split(/\r?\n/).length;
  const words = markdown.trim().length === 0 ? 0 : markdown.trim().split(/\s+/).length;
  const headingsCount = projection.headings.length;
  const tasksCount = projection.tasks.length;
  const openTasksCount = projection.tasks.filter(({ task }) => !task.checked).length;
  const completedTasksCount = projection.tasks.filter(({ task }) => task.checked).length;

  const codeBlocksCount = semantic.fencedCodeBlocks;
  const tablesCount = semantic.tableLines.filter((isTableLine, index) => isTableLine && (index === 0 || !semantic.tableLines[index - 1])).length;

  let sizeLevel: "normal" | "warning" | "high" = "normal";
  if (bytes >= 900 * 1024) {
    sizeLevel = "high";
  } else if (bytes >= 500 * 1024) {
    sizeLevel = "warning";
  }

  // Review uses exclusive heading ownership: each heading owns only the bytes
  // before the immediately following heading, regardless of heading level.
  const sectionsList: LargestSectionInfo[] = [];
  for (const section of projection.sections) {
      const sourceRange: SourceRange = { from: section.from, to: section.exclusiveTo };
      const sectionText = markdown.slice(sourceRange.from, sourceRange.to);
      const sectionBytes = new TextEncoder().encode(sectionText).length;
      const percentage = bytes > 0 ? Math.round((sectionBytes / bytes) * 100) : 0;
      sectionsList.push({
        title: section.heading.heading.text || "Untitled Section",
        bytes: sectionBytes,
        percentage,
        anchor: section.heading.heading.from,
        sourceRange,
      });
  }
  sectionsList.sort((a, b) => b.bytes - a.bytes || a.sourceRange.from - b.sourceRange.from);
  const largestSections = sectionsList.slice(0, 3);

  return {
    bytes,
    words,
    lines,
    headingsCount,
    tasksCount,
    openTasksCount,
    completedTasksCount,
    codeBlocksCount,
    tablesCount,
    sizeLevel,
    largestSections,
  };
}

export function slugifyAnchor(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\w\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function analyzeNoteHealth(markdown: string, customAnalysis?: MarkdownAnalysis): ReviewReport {
  const analysis = customAnalysis ?? analyzeMarkdown(markdown);
  const metrics = computeNoteMetrics(markdown, analysis);
  const issues: DiagnosticIssue[] = [];

  const semantic = scanReviewSemantics(markdown);
  const projection = createReviewVisibleProjection(markdown, analysis, semantic);
  const rawLines = semantic.lines;

  // 1. Structure Diagnostics: H1 Presence & Count
  const h1s = projection.headings.filter(({ heading }) => heading.level === 1);
  if (h1s.length === 0) {
    issues.push({
      id: "no-h1",
      category: "structure",
      severity: "warning",
      message: "Note has headings but no top-level # (H1) title",
    });
  } else if (h1s.length > 1) {
    issues.push({
      id: "multiple-h1",
      category: "structure",
      severity: "info",
      message: `Note contains ${h1s.length} top-level # (H1) headings`,
      anchor: h1s[1].heading.from,
    });
  }

  // 2. Heading Level Jumps & Duplicate Anchors
  const anchorCounts = new Map<string, number>();
  let prevLevel = 0;

  projection.headings.forEach(({ heading, analysisIndex }) => {
    // Heading level jump check
    if (prevLevel > 0 && heading.level > prevLevel + 1) {
      const canFixHeadingLevel = heading.markerFrom !== undefined && heading.markerTo !== undefined;
      issues.push({
        id: `level-jump-${analysisIndex}`,
        category: "structure",
        severity: "warning",
        message: `Heading level jump: H${prevLevel} directly followed by H${heading.level} ("${heading.text}")`,
        anchor: heading.from,
        sourceRange: canFixHeadingLevel
          ? { from: heading.markerFrom!, to: heading.markerTo! }
          : undefined,
        ...(canFixHeadingLevel ? { canAutoFix: true, fixType: "fix-level-jump" as const } : {}),
      });
    }
    prevLevel = heading.level;

    // Duplicate anchor check
    const slug = slugifyAnchor(heading.text);
    if (slug) {
      const count = (anchorCounts.get(slug) ?? 0) + 1;
      anchorCounts.set(slug, count);
      if (count > 1) {
        issues.push({
          id: `duplicate-anchor-${analysisIndex}`,
          category: "structure",
          severity: "info",
          message: `Duplicate heading title "#${slug}" may cause local anchor ambiguity`,
          anchor: heading.from,
        });
      }
    }
  });

  // 3. Empty Headings & Empty Tasks Check. Raw matches are constrained by the
  // same fence/HTML/list eligibility view used by the shared analysis.
  rawLines.forEach((line, lineIdx) => {
    if (semantic.opaqueLines[lineIdx] || rangesOverlap({ from: line.start, to: line.contentEnd }, semantic.protectedRanges)) return;

    const emptyHeadingMatch = matchEmptyAtxHeading(line.text);
    if (emptyHeadingMatch) {
      issues.push({
        id: `empty-heading-${lineIdx}`,
        category: "structure",
        severity: "warning",
        message: `Empty H${emptyHeadingMatch[2].length} heading at line ${lineIdx + 1}`,
        anchor: line.start,
        sourceRange: { from: line.start, to: line.end },
        line: lineIdx + 1,
        canAutoFix: true,
        fixType: "remove-empty-heading",
      });
    }

    const emptyTask = projection.tasks.find(({ task }) => task.from === line.start && task.text === "")?.task;
    if (emptyTask && isEligibleTaskLine(semantic, lineIdx, emptyTask.checkboxOffset)) {
      issues.push({
        id: `empty-task-${lineIdx}`,
        category: "task",
        severity: "warning",
        message: `Empty task item at line ${lineIdx + 1}`,
        anchor: line.start,
        line: lineIdx + 1,
      });
    }
  });

  // Empty sections are evaluated over the exclusive owner range, then over
  // the recursive descendant range to avoid flagging a parent that only has a
  // child heading but meaningful content below that child.
  const visibleHeadingStarts = new Set(projection.headings.map(({ heading }) => heading.from));
  for (const section of projection.sections) {
    const heading = section.heading.heading;
    const exclusiveRange = { from: section.from, to: section.exclusiveTo };
    if (!hasMeaningfulSectionContent(semantic, visibleHeadingStarts, section.from, section.to)) {
      issues.push({
        id: `empty-section-${section.heading.analysisIndex}`,
        category: "structure",
        severity: "warning",
        message: `Empty section: "${heading.text || "Untitled Section"}" has no meaningful content`,
        anchor: heading.from,
        sourceRange: exclusiveRange,
        line: lineNumberAtOffset(rawLines, section.from),
      });
    }
    const exclusiveBytes = new TextEncoder().encode(markdown.slice(exclusiveRange.from, exclusiveRange.to)).length;
    if (exclusiveBytes >= OVERLONG_SECTION_THRESHOLD_BYTES) {
      issues.push({
        id: `overlong-section-${section.heading.analysisIndex}`,
        category: "complexity",
        severity: "warning",
        message: `Section "${heading.text || "Untitled Section"}" owns ${Math.round(exclusiveBytes / 1024)} KB (>= ${OVERLONG_SECTION_THRESHOLD_BYTES / 1024} KB); consider splitting it`,
        anchor: heading.from,
        sourceRange: exclusiveRange,
        line: lineNumberAtOffset(rawLines, section.from),
      });
    }
  }

  // 4. Local Link Validation: AST links whose destination starts with #
  const allKnownAnchors = new Set(
    projection.headings.map(({ heading }) => slugifyAnchor(heading.text)).filter(Boolean),
  );

  for (const link of semantic.linkFacts) {
    if (isRangeFullyProtected(link, semantic.protectedRanges) || !link.destination.startsWith("#")) continue;
    const targetAnchor = link.destination.slice(1).toLowerCase();
    if (!allKnownAnchors.has(targetAnchor)) {
      issues.push({
        id: `broken-link-${link.from}`,
        category: "links",
        severity: "warning",
        message: `Broken local link: "#${targetAnchor}" does not match any heading in this note`,
        anchor: link.from,
      });
    }
  }

  // 5. Complexity Warnings
  if (metrics.sizeLevel === "high") {
    issues.push({
      id: "note-size-high",
      category: "complexity",
      severity: "error",
      message: `Note size (${Math.round(metrics.bytes / 1024)} KB) is >= 900 KB. Consider archiving or splitting.`,
    });
  } else if (metrics.sizeLevel === "warning") {
    issues.push({
      id: "note-size-warning",
      category: "complexity",
      severity: "warning",
      message: `Note size (${Math.round(metrics.bytes / 1024)} KB) is large (>= 500 KB).`,
    });
  }

  // Health Score Calculation
  let penalties = 0;
  for (const issue of issues) {
    if (issue.severity === "error") penalties += 20;
    else if (issue.severity === "warning") penalties += 8;
    else if (issue.severity === "info") penalties += 3;
  }
  const healthScore = Math.max(0, Math.min(100, 100 - penalties));

  return {
    metrics,
    issues,
    healthScore,
  };
}

function isEligibleTaskLine(semantic: ReviewSemanticScan, lineIndex: number, checkboxOffset: number): boolean {
  return semantic.taskEligible[lineIndex] === true && !semantic.opaqueLines[lineIndex] && !rangesOverlap({ from: checkboxOffset, to: checkboxOffset + 1 }, semantic.protectedRanges);
}

function lineIndexAtOffset(lines: Array<{ start: number; end: number }>, offset: number): number | undefined {
  const index = lines.findIndex((line) => offset >= line.start && offset < line.end);
  return index >= 0 ? index : undefined;
}

function lineNumberAtOffset(lines: Array<{ start: number; end: number }>, offset: number): number | undefined {
  const index = lineIndexAtOffset(lines, offset);
  return index === undefined ? undefined : index + 1;
}

function hasMeaningfulSectionContent(
  semantic: ReviewSemanticScan,
  headingStarts: Set<number>,
  from: number,
  to: number,
): boolean {
  for (let index = 0; index < semantic.lines.length; index += 1) {
    const line = semantic.lines[index];
    if (
      line.start < from ||
      line.start >= to ||
      semantic.opaqueLines[index] ||
      headingStarts.has(line.start) ||
      matchEmptyAtxHeading(line.text)
    ) continue;
    if (hasVisibleTextOutsideRanges(line, [...semantic.commentRanges, ...semantic.protectedRanges])) return true;
    if (semantic.inlineCodeRanges.some((range) => rangesOverlap({ from: line.start, to: line.contentEnd }, [range]))) return true;
  }
  return false;
}

function hasVisibleTextOutsideRanges(
  line: { start: number; contentEnd: number; text: string },
  hiddenRanges: SourceRange[],
): boolean {
  let visibleFrom = line.start;
  for (const hidden of hiddenRanges.sort((left, right) => left.from - right.from)) {
    if (hidden.to <= line.start) continue;
    if (hidden.from >= line.contentEnd) break;

    const hiddenFrom = Math.max(hidden.from, line.start);
    if (hiddenFrom > visibleFrom && line.text.slice(visibleFrom - line.start, hiddenFrom - line.start).trim() !== "") {
      return true;
    }
    visibleFrom = Math.max(visibleFrom, Math.min(hidden.to, line.contentEnd));
  }

  return line.text.slice(visibleFrom - line.start).trim() !== "";
}

function matchEmptyAtxHeading(text: string): RegExpMatchArray | null {
  return text.match(/^([ \t]{0,3})(#{1,6})(?:[ \t]+(#+))?[ \t]*$/);
}

function rangesOverlap(source: SourceRange, ranges: SourceRange[]): boolean {
  return ranges.some((range) => source.from < range.to && range.from < source.to);
}

function isRangeFullyProtected(source: SourceRange, ranges: SourceRange[]): boolean {
  return ranges.some((range) => range.from <= source.from && source.to <= range.to);
}

export function applyDiagnosticAutoFix(
  markdown: string,
  issueId: string,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const semantic = scanReviewSemantics(markdown);
  const projection = createReviewVisibleProjection(markdown, analysis, semantic);
  const report = analyzeNoteHealth(markdown, analysis);
  const issue = report.issues.find((i) => i.id === issueId);
  if (!issue || !issue.canAutoFix || !issue.fixType) return { markdown, changed: false };

  const edit = diagnosticEdit(markdown, projection, semantic, issue);
  return edit ? applyDiagnosticEdits(markdown, [edit], semantic.protectedRanges) : { markdown, changed: false };
}

export type SafeAutoFixResult = CommandResult & { fixedCount: number };

export function applyAllSafeAutoFixes(markdown: string): SafeAutoFixResult {
  const analysis = analyzeMarkdown(markdown);
  const semantic = scanReviewSemantics(markdown);
  const projection = createReviewVisibleProjection(markdown, analysis, semantic);
  const report = analyzeNoteHealth(markdown, analysis);
  const safeIssues = report.issues.filter((issue) => issue.canAutoFix && issue.fixType);
  // Removing an empty heading owns its whole line, so it takes precedence over
  // a level edit targeting that heading's marker range. Select those edits
  // first and omit any overlapping normalization from the canonical mutation.
  const removeEmptyHeadingEdits: DiagnosticEdit[] = [];
  for (const issue of safeIssues.filter((candidate) => candidate.fixType === "remove-empty-heading")) {
    const edit = diagnosticEdit(markdown, projection, semantic, issue);
    if (!edit) return { markdown, changed: false, fixedCount: 0 };
    removeEmptyHeadingEdits.push(edit);
  }

  const edits: DiagnosticEdit[] = [...removeEmptyHeadingEdits];
  let previousNormalizedLevel = 0;
  for (const visibleHeading of projection.headings) {
    const heading = visibleHeading.heading;
    const isRemovedHeading = rangesOverlap({ from: heading.from, to: heading.to }, removeEmptyHeadingEdits.map((edit) => edit.range));
    if (isRemovedHeading) continue;

    const issue = safeIssues.find((candidate) => candidate.id === `level-jump-${visibleHeading.analysisIndex}`);
    let normalizedLevel = heading.level;
    const needsNormalizedAtxLevel = heading.syntax === "atx" && previousNormalizedLevel > 0 && heading.level > previousNormalizedLevel + 1;
    if (issue?.fixType === "fix-level-jump" || needsNormalizedAtxLevel) {
      const edit = issue?.fixType === "fix-level-jump"
        ? diagnosticEdit(markdown, projection, semantic, issue, previousNormalizedLevel)
        : normalizedAtxHeadingEdit(markdown, heading, previousNormalizedLevel + 1);
      if (!edit) return { markdown, changed: false, fixedCount: 0 };
      edits.push(edit);
      normalizedLevel = previousNormalizedLevel + 1;
    }
    previousNormalizedLevel = normalizedLevel;
  }
  const result = applyDiagnosticEdits(markdown, edits, semantic.protectedRanges);
  return { ...result, fixedCount: result.changed ? edits.length : 0 };
}

type DiagnosticEdit = { range: SourceRange; replacement: string };

function normalizedAtxHeadingEdit(
  markdown: string,
  heading: MarkdownAnalysis["headings"][number],
  level: number,
): DiagnosticEdit | undefined {
  if (heading.syntax !== "atx" || heading.markerFrom === undefined || heading.markerTo === undefined) return undefined;
  const range = { from: heading.markerFrom, to: heading.markerTo };
  if (markdown.slice(range.from, range.to) !== "#".repeat(heading.level)) return undefined;
  return { range, replacement: "#".repeat(level) };
}

function diagnosticEdit(
  markdown: string,
  projection: ReviewVisibleProjection,
  semantic: ReviewSemanticScan,
  issue: DiagnosticIssue,
  normalizedPreviousLevel?: number,
): DiagnosticEdit | undefined {
  const range = issue.sourceRange;
  if (!range || !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.from > range.to || range.to > markdown.length) return undefined;
  if (rangesOverlap(range, semantic.protectedRanges)) return undefined;

  if (issue.fixType === "remove-empty-heading") {
    const source = markdown.slice(range.from, range.to).replace(/\r?\n$/, "");
    return matchEmptyAtxHeading(source) ? { range, replacement: "" } : undefined;
  }

  if (issue.fixType === "fix-level-jump" && typeof issue.anchor === "number") {
    const targetIndex = projection.headings.findIndex(({ heading }) => heading.from === issue.anchor);
    if (targetIndex <= 0) return undefined;
    const previous = projection.headings[targetIndex - 1].heading;
    const target = projection.headings[targetIndex].heading;
    if (target.markerFrom === undefined || target.markerTo === undefined) return undefined;
    if (range.from !== target.markerFrom || range.to !== target.markerTo) return undefined;
    if (markdown.slice(range.from, range.to) !== "#".repeat(target.level)) return undefined;
    return { range, replacement: "#".repeat((normalizedPreviousLevel ?? previous.level) + 1) };
  }

  return undefined;
}

function applyDiagnosticEdits(markdown: string, edits: DiagnosticEdit[], protectedRanges: MarkdownRange[]): CommandResult {
  const sorted = [...edits].sort((left, right) => left.range.from - right.range.from);
  let previousTo = 0;
  for (const edit of sorted) {
    const { from, to } = edit.range;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < previousTo || from < 0 || to < from || to > markdown.length || rangesOverlap(edit.range, protectedRanges)) {
      return { markdown, changed: false };
    }
    previousTo = to;
  }
  if (sorted.length === 0) return { markdown, changed: false };

  let nextMarkdown = markdown;
  for (const edit of [...sorted].reverse()) {
    nextMarkdown = nextMarkdown.slice(0, edit.range.from) + edit.replacement + nextMarkdown.slice(edit.range.to);
  }
  const changes = sorted.map((edit) => ({
    from: edit.range.from,
    to: edit.range.to,
    insertedLength: edit.replacement.length,
  }));
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, changes);
  if (!changeSet) return { markdown, changed: false };
  return { markdown: nextMarkdown, changed: true, changeSet };
}
