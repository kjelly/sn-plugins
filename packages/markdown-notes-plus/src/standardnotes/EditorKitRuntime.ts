import ComponentRelay from "@standardnotes/component-relay";
import type { EditorKitFactory } from "./EditorKitBridge";
import { AndroidCompatibleEditorKit } from "./AndroidCompatibleEditorKit";

type RuntimeNote = {
  uuid?: string;
  isMetadataUpdate?: boolean;
  content?: { text?: string; [key: string]: unknown };
  [key: string]: unknown;
};
type RelayNote = Parameters<ComponentRelay["getItemAppDataValue"]>[0];
type RelaySaveNote = Parameters<ComponentRelay["saveItemWithPresave"]>[0];

/**
 * The upstream EditorKit ignores metadata-only context updates. That is fine
 * for text rendering, but Standard Notes also carries the note's locked state
 * in those updates. Keep the relay directly here so a Prevent Editing change
 * reaches the editor even when there is no new text to render.
 */
class StandardNotesEditorKit {
  private readonly relay: ComponentRelay;
  private note?: RuntimeNote;

  constructor(private readonly delegate: Parameters<EditorKitFactory>[0], options: Parameters<EditorKitFactory>[1]) {
    this.relay = new ComponentRelay({
      targetWindow: globalThis.window,
      options: {
        coallesedSaving: options.coallesedSaving,
        coallesedSavingDelay: options.coallesedSavingDelay,
      },
      onThemesChange: delegate.onThemesChange,
      handleRequestForContentHeight: () => delegate.handleRequestForContentHeight(),
    });

    this.relay.streamContextItem(async (note) => {
      const previous = this.note;
      this.note = note as RuntimeNote;
      const isNewNote = previous === undefined || previous.uuid !== note.uuid;

      const previousLocked = this.relay.getItemAppDataValue(previous as RelayNote, "locked") === true;
      const nextLocked = this.relay.getItemAppDataValue(this.note as RelayNote, "locked") === true;

      if (note.isMetadataUpdate) {
        if (previousLocked !== nextLocked) delegate.onNoteLockToggle?.(nextLocked);
        return;
      }

      const text = note.content?.text || "";
      await delegate.onNoteValueChange?.(note);
      delegate.setEditorRawText(text);

      if (previousLocked !== nextLocked) delegate.onNoteLockToggle?.(nextLocked);
      if (isNewNote) delegate.clearUndoHistory?.();
    });
  }

  saveItemWithPresave(note: RuntimeNote, presave?: () => void): void {
    this.relay.saveItemWithPresave(note as unknown as RelaySaveNote, presave);
  }

  dispose(): void {
    this.relay.deinit();
  }
}

/** Production adapter for the pinned Standard Notes component relay. */
export const createEditorKit: EditorKitFactory = (delegate, options) => {
  const query = typeof globalThis.window === "undefined" ? undefined : new URLSearchParams(globalThis.window.location.search);
  const forceOfficialTransport = query?.get("sn-legacy-mobile-transport") === "1";
  const useAndroidCompatibility = !forceOfficialTransport && (query?.get("sn-android-compat") === "1"
    || (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)));

  if (useAndroidCompatibility) {
    const kit = new AndroidCompatibleEditorKit(delegate, options);
    return {
      saveItemWithPresave(note, presave) {
        kit.saveItemWithPresave(note, presave);
      },
      dispose() {
        kit.deinit();
      },
    };
  }

  const kit = new StandardNotesEditorKit(delegate, options);
  return {
    saveItemWithPresave(note, presave) {
      kit.saveItemWithPresave(note as RuntimeNote, presave);
    },
    dispose() {
      kit.dispose();
    },
  };
};
