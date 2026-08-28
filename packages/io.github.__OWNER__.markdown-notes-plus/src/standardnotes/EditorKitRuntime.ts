import EditorKit, { type EditorKitDelegate as RuntimeEditorKitDelegate } from "@standardnotes/editor-kit";
import type { EditorKitFactory } from "./EditorKitBridge";

type RuntimeNote = Parameters<EditorKit["saveItemWithPresave"]>[0];

/** Production adapter for the pinned EditorKit package. */
export const createEditorKit: EditorKitFactory = (delegate, options) => {
  const kit = new EditorKit(delegate as RuntimeEditorKitDelegate, options);
  return {
    saveItemWithPresave(note, presave) {
      kit.saveItemWithPresave(note as unknown as RuntimeNote, presave);
    },
  };
};
