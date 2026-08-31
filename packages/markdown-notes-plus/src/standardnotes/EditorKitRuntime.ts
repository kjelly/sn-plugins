import EditorKit, { type EditorKitDelegate as RuntimeEditorKitDelegate } from "@standardnotes/editor-kit";
import type { EditorKitFactory } from "./EditorKitBridge";
import { AndroidCompatibleEditorKit } from "./AndroidCompatibleEditorKit";

type RuntimeNote = Parameters<EditorKit["saveItemWithPresave"]>[0];

/** Production adapter for the pinned EditorKit package. */
export const createEditorKit: EditorKitFactory = (delegate, options) => {
  const query = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search);
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

  const kit = new EditorKit(delegate as RuntimeEditorKitDelegate, options);
  return {
    saveItemWithPresave(note, presave) {
      kit.saveItemWithPresave(note as unknown as RuntimeNote, presave);
    },
  };
};
