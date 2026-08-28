import { analyzeMarkdown } from "../markdown/analysis.ts";
import { mapTextPosition, type TextChangeSet } from "./PositionMap.ts";

/** Reconcile a selected source heading only through exact canonical provenance. */
export function reconcileSectionAnchor(nextText: string, changeSet: TextChangeSet | undefined, anchor: number | undefined): number | undefined {
  if (anchor === undefined || changeSet === undefined) return undefined;
  const mapped = mapTextPosition(changeSet, anchor);
  return mapped === undefined || !analyzeMarkdown(nextText).sectionByAnchor(mapped) ? undefined : mapped;
}
