export type IncomingTextKind = "initial-context" | "remote-update" | "metadata";

/** Classifies EditorKit context callbacks without owning document state. */
export class EditorKitLifecycle {
  private hasInitialContext = false;
  private activeNoteUuid?: string;

  classifyContext(noteUuid: unknown, metadataOnly = false): IncomingTextKind {
    if (metadataOnly) return "metadata";

    const incomingNoteUuid = typeof noteUuid === "string" && noteUuid.length > 0 ? noteUuid : undefined;
    const switchedNote = this.hasInitialContext
      && this.activeNoteUuid !== undefined
      && incomingNoteUuid !== undefined
      && incomingNoteUuid !== this.activeNoteUuid;

    if (!this.hasInitialContext || switchedNote) {
      this.hasInitialContext = true;
      if (incomingNoteUuid !== undefined) this.activeNoteUuid = incomingNoteUuid;
      return "initial-context";
    }

    if (incomingNoteUuid !== undefined) this.activeNoteUuid = incomingNoteUuid;
    return "remote-update";
  }

  get hasContext(): boolean { return this.hasInitialContext; }
}
