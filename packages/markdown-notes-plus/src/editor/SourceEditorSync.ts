import { history } from "@codemirror/commands";
import { Compartment, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type SourceEditorView = Pick<EditorView, "state" | "dispatch">;

/**
 * Apply canonical text to Source mode and establish a new history boundary.
 * The history compartment must be the one that owns the editor's history().
 */
export function synchronizeSourceEditor(
  view: SourceEditorView,
  value: string,
  historyCompartment: Compartment,
  previousResetGeneration: number,
  resetGeneration: number,
): void {
  const textChanged = view.state.doc.toString() !== value;
  const resetHistory = textChanged || previousResetGeneration !== resetGeneration;
  if (textChanged) {
    const replacement: TransactionSpec = {
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    };
    view.dispatch(replacement);
  }

  if (resetHistory) {
    // addToHistory(false) deliberately preserves old history as mapped state;
    // removing and re-adding the field creates an empty undo and redo branch.
    view.dispatch({ effects: historyCompartment.reconfigure([]) });
    view.dispatch({ effects: historyCompartment.reconfigure(history()) });
  }
}
