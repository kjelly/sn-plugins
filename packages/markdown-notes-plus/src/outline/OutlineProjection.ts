import type { HeadingInfo, MarkdownAnalysis } from "../markdown/analysis.ts";
import { mapTextPosition, type TextChangeSet } from "../document/PositionMap.ts";

/**
 * Check if a heading has at least one descendant heading in the hierarchy.
 */
export function hasDescendantHeadings(analysis: MarkdownAnalysis, anchor: number): boolean {
  const headingIndex = analysis.headings.findIndex((h) => h.from === anchor);
  if (headingIndex < 0) return false;
  const root = analysis.headings[headingIndex];
  for (let i = headingIndex + 1; i < analysis.headings.length; i += 1) {
    const next = analysis.headings[i];
    if (next.level <= root.level) break;
    return true;
  }
  return false;
}

/**
 * Return all anchors of headings that have at least one descendant heading.
 */
export function getAllCollapsibleAnchors(analysis: MarkdownAnalysis): number[] {
  const result: number[] = [];
  for (let index = 0; index + 1 < analysis.headings.length; index += 1) {
    const heading = analysis.headings[index];
    if (analysis.headings[index + 1].level > heading.level) result.push(heading.from);
  }
  return result;
}

/**
 * Filter headings based on outline collapsed anchors.
 * When a heading is collapsed, all its descendant headings are hidden.
 */
export function getVisibleOutlineHeadings(
  analysis: MarkdownAnalysis,
  collapsedAnchors: Set<number>,
): HeadingInfo[] {
  const visible: HeadingInfo[] = [];
  let hiddenUntilLevel: number | undefined = undefined;

  for (const heading of analysis.headings) {
    if (hiddenUntilLevel !== undefined) {
      if (heading.level > hiddenUntilLevel) {
        // Skip descendant
        continue;
      } else {
        // Exited hidden subtree
        hiddenUntilLevel = undefined;
      }
    }

    visible.push(heading);

    if (collapsedAnchors.has(heading.from)) {
      hiddenUntilLevel = heading.level;
    }
  }

  return visible;
}

export type OutlineSectionFacts = {
  taskCount: number;
  completedCount: number;
  openCount: number;
  hasSetext: boolean;
  hasLevelSix: boolean;
  hasPreviousSibling: boolean;
  hasNextSibling: boolean;
};

/** Build row facts once instead of scanning all headings and tasks per row. */
export function buildOutlineSectionFacts(analysis: MarkdownAnalysis): Map<number, OutlineSectionFacts> {
  const facts = new Map<number, OutlineSectionFacts>();
  const lastSibling = new Map<string, OutlineSectionFacts>();
  for (const section of analysis.sections) {
    const row: OutlineSectionFacts = {
      taskCount: 0,
      completedCount: 0,
      openCount: 0,
      hasSetext: false,
      hasLevelSix: false,
      hasPreviousSibling: false,
      hasNextSibling: false,
    };
    facts.set(section.anchor, row);
    const siblingKey = `${section.parentAnchor ?? "root"}:${section.level}`;
    const previous = lastSibling.get(siblingKey);
    if (previous) {
      previous.hasNextSibling = true;
      row.hasPreviousSibling = true;
    }
    lastSibling.set(siblingKey, row);
  }

  for (const heading of analysis.headings) {
    let section = analysis.sectionByAnchor(heading.from);
    while (section) {
      const row = facts.get(section.anchor);
      if (row) {
        if (heading.syntax === "setext") row.hasSetext = true;
        if (heading.level >= 6) row.hasLevelSix = true;
      }
      section = section.parentAnchor === undefined ? undefined : analysis.sectionByAnchor(section.parentAnchor);
    }
  }

  for (const task of analysis.tasks) {
    let low = 0;
    let high = analysis.sections.length - 1;
    let sectionIndex = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (analysis.sections[middle].from <= task.itemStart) {
        sectionIndex = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    let section = sectionIndex < 0 ? undefined : analysis.sections[sectionIndex];
    while (section) {
      if (task.itemEnd <= section.to) {
        const row = facts.get(section.anchor);
        if (row) {
          row.taskCount += 1;
          if (task.checked) row.completedCount += 1;
          else row.openCount += 1;
        }
      }
      section = section.parentAnchor === undefined ? undefined : analysis.sectionByAnchor(section.parentAnchor);
    }
  }
  return facts;
}

/**
 * Reconcile collapsed outline anchors across a canonical text transition.
 */
export function reconcileOutlineAnchors(
  collapsedAnchors: Set<number>,
  changeSet?: TextChangeSet,
  nextAnalysis?: MarkdownAnalysis,
): Set<number> {
  if (!changeSet || !nextAnalysis) return new Set();
  const nextSet = new Set<number>();
  const validAnchors = new Set(nextAnalysis.headings.map((h) => h.from));

  for (const anchor of collapsedAnchors) {
    const remapped = mapTextPosition(changeSet, anchor);
    if (remapped !== undefined && validAnchors.has(remapped)) {
      nextSet.add(remapped);
    }
  }
  return nextSet;
}
