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
  for (const h of analysis.headings) {
    if (hasDescendantHeadings(analysis, h.from)) {
      result.push(h.from);
    }
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
