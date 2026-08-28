export type SourceSelectionUpdate = { selectionSet: boolean; docChanged: boolean };

/** Report source selection only for user-originated view updates. */
export function shouldReportSourceSelection(update: SourceSelectionUpdate, applyingExternal: boolean): boolean {
  return !applyingExternal && (update.selectionSet || update.docChanged);
}
