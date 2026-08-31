import type { EditorKitFactory } from "./EditorKitBridge";
import { StandardNotesComponentTransport } from "./StandardNotesComponentTransport";

/** Production adapter for the editor-owned Component API transport. */
export const createEditorKit: EditorKitFactory = (delegate, options) => {
  const transport = new StandardNotesComponentTransport(delegate, options);
  return {
    saveItemWithPresave(note, presave) {
      transport.saveItemWithPresave(note, presave);
    },
  };
};
