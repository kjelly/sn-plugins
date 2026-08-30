import {
  analyzeMarkdown,
  type CommandResult,
  headingsInSection,
  nextSiblingSection,
  previousSiblingSection,
  siblingSections,
} from "./analysis.ts";
import { createTextChangeSet, type TextChange } from "../document/PositionMap.ts";

export type StructuralDirection = "up" | "down";

/**
 * Move a section subtree up or down relative to its immediate sibling sections.
 */
export function moveSubtree(
  markdown: string,
  anchor: number,
  direction: StructuralDirection,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const current = analysis.sectionByAnchor(anchor);
  if (!current) return { markdown, changed: false };

  const target = direction === "up"
    ? previousSiblingSection(analysis, anchor)
    : nextSiblingSection(analysis, anchor);

  if (!target) return { markdown, changed: false };

  if (direction === "up") {
    // Target is before current. Swap ranges: target [target.from..target.to], current [current.from..current.to]
    const rangeStart = target.from;
    const rangeEnd = current.to;
    const targetText = markdown.slice(target.from, target.to);
    const inBetweenText = markdown.slice(target.to, current.from);
    const currentText = markdown.slice(current.from, current.to);
    const replacement = currentText + inBetweenText + targetText;

    const nextMarkdown = markdown.slice(0, rangeStart) + replacement + markdown.slice(rangeEnd);
    const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
      { from: rangeStart, to: rangeEnd, insertedLength: replacement.length },
    ]);
    return { markdown: nextMarkdown, changed: true, changeSet };
  } else {
    // Current is before target. Swap ranges: current [current.from..current.to], target [target.from..target.to]
    const rangeStart = current.from;
    const rangeEnd = target.to;
    const currentText = markdown.slice(current.from, current.to);
    const inBetweenText = markdown.slice(current.to, target.from);
    const targetText = markdown.slice(target.from, target.to);
    const replacement = targetText + inBetweenText + currentText;

    const nextMarkdown = markdown.slice(0, rangeStart) + replacement + markdown.slice(rangeEnd);
    const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
      { from: rangeStart, to: rangeEnd, insertedLength: replacement.length },
    ]);
    return { markdown: nextMarkdown, changed: true, changeSet };
  }
}

/**
 * Move a source subtree immediately before a target sibling subtree.
 */
export function moveSubtreeBefore(
  markdown: string,
  sourceAnchor: number,
  targetAnchor: number,
): CommandResult {
  if (sourceAnchor === targetAnchor) return { markdown, changed: false };

  const analysis = analyzeMarkdown(markdown);
  const source = analysis.sectionByAnchor(sourceAnchor);
  const target = analysis.sectionByAnchor(targetAnchor);

  if (!source || !target) return { markdown, changed: false };
  if (source.level !== target.level || source.parentAnchor !== target.parentAnchor) {
    return { markdown, changed: false };
  }
  // Target cannot be inside source subtree
  if (target.from >= source.from && target.from < source.to) {
    return { markdown, changed: false };
  }

  const siblings = siblingSections(analysis, sourceAnchor);
  const sourceIdx = siblings.findIndex((s) => s.anchor === sourceAnchor);
  const targetIdx = siblings.findIndex((s) => s.anchor === targetAnchor);
  if (sourceIdx < 0 || targetIdx < 0) return { markdown, changed: false };

  // Reorder siblings
  const reordered = siblings.slice();
  const [removed] = reordered.splice(sourceIdx, 1);
  const newTargetIdx = reordered.findIndex((s) => s.anchor === targetAnchor);
  reordered.splice(newTargetIdx, 0, removed);

  const affectedMinIdx = Math.min(sourceIdx, targetIdx);
  const affectedMaxIdx = Math.max(sourceIdx, targetIdx);
  const rangeStart = siblings[affectedMinIdx].from;
  const rangeEnd = siblings[affectedMaxIdx].to;

  let replacement = "";
  for (let i = affectedMinIdx; i <= affectedMaxIdx; i += 1) {
    const s = reordered[i];
    replacement += markdown.slice(s.from, s.to);
  }

  if (replacement === markdown.slice(rangeStart, rangeEnd)) {
    return { markdown, changed: false };
  }

  const nextMarkdown = markdown.slice(0, rangeStart) + replacement + markdown.slice(rangeEnd);
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
    { from: rangeStart, to: rangeEnd, insertedLength: replacement.length },
  ]);
  return { markdown: nextMarkdown, changed: true, changeSet };
}

/**
 * Move a source subtree immediately after a target sibling subtree.
 */
export function moveSubtreeAfter(
  markdown: string,
  sourceAnchor: number,
  targetAnchor: number,
): CommandResult {
  if (sourceAnchor === targetAnchor) return { markdown, changed: false };

  const analysis = analyzeMarkdown(markdown);
  const source = analysis.sectionByAnchor(sourceAnchor);
  const target = analysis.sectionByAnchor(targetAnchor);

  if (!source || !target) return { markdown, changed: false };
  if (source.level !== target.level || source.parentAnchor !== target.parentAnchor) {
    return { markdown, changed: false };
  }
  if (target.from >= source.from && target.from < source.to) {
    return { markdown, changed: false };
  }

  const siblings = siblingSections(analysis, sourceAnchor);
  const sourceIdx = siblings.findIndex((s) => s.anchor === sourceAnchor);
  const targetIdx = siblings.findIndex((s) => s.anchor === targetAnchor);
  if (sourceIdx < 0 || targetIdx < 0) return { markdown, changed: false };

  // Reorder siblings
  const reordered = siblings.slice();
  const [removed] = reordered.splice(sourceIdx, 1);
  const newTargetIdx = reordered.findIndex((s) => s.anchor === targetAnchor);
  reordered.splice(newTargetIdx + 1, 0, removed);

  const affectedMinIdx = Math.min(sourceIdx, targetIdx);
  const affectedMaxIdx = Math.max(sourceIdx, targetIdx);
  const rangeStart = siblings[affectedMinIdx].from;
  const rangeEnd = siblings[affectedMaxIdx].to;

  let replacement = "";
  for (let i = affectedMinIdx; i <= affectedMaxIdx; i += 1) {
    const s = reordered[i];
    replacement += markdown.slice(s.from, s.to);
  }

  if (replacement === markdown.slice(rangeStart, rangeEnd)) {
    return { markdown, changed: false };
  }

  const nextMarkdown = markdown.slice(0, rangeStart) + replacement + markdown.slice(rangeEnd);
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
    { from: rangeStart, to: rangeEnd, insertedLength: replacement.length },
  ]);
  return { markdown: nextMarkdown, changed: true, changeSet };
}

/**
 * Promote a single ATX heading by removing one '#' marker (level 2..6 -> 1..5).
 */
export function promoteHeading(
  markdown: string,
  anchor: number,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const heading = analysis.headings.find((h) => h.from === anchor);
  if (!heading || heading.syntax !== "atx" || heading.level <= 1) {
    return { markdown, changed: false };
  }
  if (heading.markerFrom === undefined || heading.markerTo === undefined) {
    return { markdown, changed: false };
  }

  const from = heading.markerFrom;
  const to = heading.markerTo;
  const newMarker = "#".repeat(heading.level - 1);
  const nextMarkdown = markdown.slice(0, from) + newMarker + markdown.slice(to);
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
    { from, to, insertedLength: newMarker.length },
  ]);
  return { markdown: nextMarkdown, changed: true, changeSet };
}

/**
 * Demote a single ATX heading by adding one '#' marker (level 1..5 -> 2..6).
 */
export function demoteHeading(
  markdown: string,
  anchor: number,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const heading = analysis.headings.find((h) => h.from === anchor);
  if (!heading || heading.syntax !== "atx" || heading.level >= 6) {
    return { markdown, changed: false };
  }
  if (heading.markerFrom === undefined || heading.markerTo === undefined) {
    return { markdown, changed: false };
  }

  const from = heading.markerFrom;
  const to = heading.markerTo;
  const newMarker = "#".repeat(heading.level + 1);
  const nextMarkdown = markdown.slice(0, from) + newMarker + markdown.slice(to);
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
    { from, to, insertedLength: newMarker.length },
  ]);
  return { markdown: nextMarkdown, changed: true, changeSet };
}

/**
 * Promote an entire subtree by subtracting one level from every heading in the section.
 * Rejects atomically if root level is 1 or any heading is Setext.
 */
export function promoteSubtree(
  markdown: string,
  anchor: number,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const section = analysis.sectionByAnchor(anchor);
  if (!section || section.level <= 1) return { markdown, changed: false };

  const headings = headingsInSection(analysis, anchor);
  if (headings.length === 0) return { markdown, changed: false };

  // Atomic rejection: all headings must be ATX and valid marker ranges
  for (const h of headings) {
    if (h.syntax !== "atx" || h.markerFrom === undefined || h.markerTo === undefined || h.level <= 1) {
      return { markdown, changed: false };
    }
  }

  const sorted = headings.slice().sort((a, b) => a.markerFrom! - b.markerFrom!);
  const textChanges: TextChange[] = [];
  let nextMarkdown = "";
  let cursor = 0;

  for (const h of sorted) {
    const from = h.markerFrom!;
    const to = h.markerTo!;
    nextMarkdown += markdown.slice(cursor, from);
    const newMarker = "#".repeat(h.level - 1);
    nextMarkdown += newMarker;
    cursor = to;
    textChanges.push({ from, to, insertedLength: newMarker.length });
  }
  nextMarkdown += markdown.slice(cursor);

  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, textChanges);
  return { markdown: nextMarkdown, changed: true, changeSet };
}

/**
 * Demote an entire subtree by adding one level to every heading in the section.
 * Rejects atomically if any heading in the subtree is level 6 or Setext.
 */
export function demoteSubtree(
  markdown: string,
  anchor: number,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const section = analysis.sectionByAnchor(anchor);
  if (!section) return { markdown, changed: false };

  const headings = headingsInSection(analysis, anchor);
  if (headings.length === 0) return { markdown, changed: false };

  // Atomic rejection: all headings must be ATX and no heading >= 6
  for (const h of headings) {
    if (h.syntax !== "atx" || h.markerFrom === undefined || h.markerTo === undefined || h.level >= 6) {
      return { markdown, changed: false };
    }
  }

  const sorted = headings.slice().sort((a, b) => a.markerFrom! - b.markerFrom!);
  const textChanges: TextChange[] = [];
  let nextMarkdown = "";
  let cursor = 0;

  for (const h of sorted) {
    const from = h.markerFrom!;
    const to = h.markerTo!;
    nextMarkdown += markdown.slice(cursor, from);
    const newMarker = "#".repeat(h.level + 1);
    nextMarkdown += newMarker;
    cursor = to;
    textChanges.push({ from, to, insertedLength: newMarker.length });
  }
  nextMarkdown += markdown.slice(cursor);

  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, textChanges);
  return { markdown: nextMarkdown, changed: true, changeSet };
}

/**
 * Duplicate an entire subtree byte-for-byte immediately following the original section.
 */
export function duplicateSubtree(
  markdown: string,
  anchor: number,
): CommandResult {
  const analysis = analyzeMarkdown(markdown);
  const section = analysis.sectionByAnchor(anchor);
  if (!section) return { markdown, changed: false };

  const slice = markdown.slice(section.from, section.to);
  const insertPos = section.to;
  const nextMarkdown = markdown.slice(0, insertPos) + slice + markdown.slice(insertPos);
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, [
    { from: insertPos, to: insertPos, insertedLength: slice.length },
  ]);
  return { markdown: nextMarkdown, changed: true, changeSet };
}
