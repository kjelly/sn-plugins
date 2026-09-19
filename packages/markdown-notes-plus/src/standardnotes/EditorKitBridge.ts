import { CanonicalDocument } from "../document/CanonicalDocument.ts";
import { EditorKitLifecycle, type IncomingTextKind } from "./EditorKitLifecycle.ts";
import { evaluateRecurringTasks } from "../tasks/RecurringTasks.ts";

type HostNote = { content?: { text?: unknown; [key: string]: unknown }; [key: string]: unknown };
export type EditorKitDelegate = {
  setEditorRawText: (text: string) => void;
  handleRequestForContentHeight: () => number | undefined;
  clearUndoHistory?: () => void;
  onNoteLockToggle?: (locked: boolean) => void;
  onNoteValueChange?: (note: unknown) => Promise<void>;
  onThemesChange?: () => void;
};
type BridgeKit = {
  saveItemWithPresave: (note: HostNote, presave?: () => void) => void;
  dispose?: () => void;
};
export type BridgeTimer = ReturnType<typeof globalThis.setTimeout>;
export type BridgeScheduler = {
  setTimeout: (handler: () => void, delay: number) => BridgeTimer;
  clearTimeout: (timer: BridgeTimer) => void;
};

const browserScheduler: BridgeScheduler = {
  setTimeout: (handler, delay) => globalThis.setTimeout(handler, delay),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

export type EditorKitFactory = (delegate: EditorKitDelegate, options: {
  mode: "markdown";
  coallesedSaving: boolean;
  coallesedSavingDelay: number;
}) => BridgeKit;

const missingEditorKitFactory: EditorKitFactory = () => {
  throw new Error("EditorKitBridge requires the runtime EditorKit factory");
};

export type EditorKitBridgeState = {
  localDirty: boolean;
  saveRequested: boolean;
  /** The pinned EditorKit API has no host-confirmed save signal. */
  hostConfirmed: false;
};

/** The sole host transport and save owner. It deliberately uses only the pinned EditorKit API. */
export class EditorKitBridge {
  private kit?: BridgeKit;
  private latestNote?: HostNote;
  private incomingNote?: HostNote;
  private started = false;
  private incomingKind: IncomingTextKind | undefined;
  private saveRequested = false;
  private pendingSaveTimer?: BridgeTimer;
  private pendingSaveText?: string;
  private saveGeneration = 0;
  private disposed = false;
  private readonly lifecycle = new EditorKitLifecycle();
  private pendingRecurringEvaluationTimer?: BridgeTimer;
  private recurringEvaluationGeneration = 0;

  constructor(
    private readonly document: CanonicalDocument,
    private readonly onHostChange: () => void = () => undefined,
    private readonly createKit: EditorKitFactory = missingEditorKitFactory,
    private readonly scheduler: BridgeScheduler = browserScheduler,
    private readonly onClearUndoHistory: () => void = () => undefined,
  ) {}

  private cancelPendingSave(): void {
    if (this.pendingSaveTimer !== undefined) {
      this.scheduler.clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = undefined;
    }
    this.pendingSaveText = undefined;
    this.saveGeneration += 1;
  }

  private requestSave(note: HostNote, text: string): void {
    this.saveRequested = true;
    this.kit?.saveItemWithPresave(note, () => {
      if (!note.content) note.content = {};
      note.content.text = text;
    });
  }

  private scheduleSave(text: string): void {
    this.cancelPendingSave();
    const generation = this.saveGeneration;
    this.pendingSaveText = text;
    this.pendingSaveTimer = this.scheduler.setTimeout(() => {
      if (generation !== this.saveGeneration) return;
      this.pendingSaveTimer = undefined;
      this.pendingSaveText = undefined;
      if (this.document.pendingRemote !== undefined || !this.document.dirty || this.document.locked || !this.latestNote || !this.kit) return;
      if (text !== this.document.text) return;
      this.requestSave(this.latestNote, text);
      this.onHostChange();
    }, 300);
  }

  /** Defer recurring-task work until after the initial note delivery yields. */
  private scheduleRecurringEvaluation(text: string): void {
    this.cancelRecurringEvaluation();
    if (!/@repeat\(/i.test(text) || !/@done\(/i.test(text)) return;

    const generation = this.recurringEvaluationGeneration;
    const token = this.document.token;
    this.pendingRecurringEvaluationTimer = this.scheduler.setTimeout(() => {
      this.pendingRecurringEvaluationTimer = undefined;
      if (this.disposed || generation !== this.recurringEvaluationGeneration) return;
      if (
        this.document.token.instanceId !== token.instanceId ||
        this.document.token.revision !== token.revision ||
        this.document.text !== text ||
        this.document.dirty ||
        this.document.locked ||
        this.document.pendingRemote !== undefined
      ) return;

      const evaluated = evaluateRecurringTasks(text, new Date());
      if (!evaluated.changed) return;

      // The note may have changed while the deferred scan was waiting or
      // while the scan was being prepared. Never apply a stale reset.
      if (
        this.document.token.instanceId !== token.instanceId ||
        this.document.token.revision !== token.revision ||
        this.document.text !== text ||
        this.document.dirty ||
        this.document.locked ||
        this.document.pendingRemote !== undefined
      ) return;

      if (this.document.applyLocal(evaluated.markdown)) {
        this.scheduleSave(evaluated.markdown);
        this.onHostChange();
      }
    }, 0);
  }

  private cancelRecurringEvaluation(): void {
    if (this.pendingRecurringEvaluationTimer !== undefined) {
      this.scheduler.clearTimeout(this.pendingRecurringEvaluationTimer);
      this.pendingRecurringEvaluationTimer = undefined;
    }
    this.recurringEvaluationGeneration += 1;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const delegate: EditorKitDelegate = {
      setEditorRawText: (text) => {
        if (this.disposed) return;
        const kind = this.incomingKind ?? "remote-update";
        const incomingNote = this.incomingNote;
        this.incomingKind = undefined;
        this.incomingNote = undefined;
        if (incomingNote !== undefined) this.latestNote = incomingNote;
        if (kind === "initial-context") {
          this.cancelPendingSave();
          this.cancelRecurringEvaluation();
          this.document.initialize(text);
          this.saveRequested = false;
          this.scheduleRecurringEvaluation(text);
        }
        else if (kind !== "metadata") {
          this.cancelRecurringEvaluation();
          const result = this.document.receiveRemote(text);
          if (result === "merged") {
            this.scheduleSave(this.document.text);
          } else {
            this.cancelPendingSave();
          }
        }
        this.onHostChange();
      },
      handleRequestForContentHeight: () => typeof document === "undefined" ? 0 : document.documentElement.scrollHeight,
      clearUndoHistory: () => {
        if (this.disposed) return;
        this.onClearUndoHistory();
      },
      onNoteLockToggle: (locked) => {
        if (this.disposed) return;
        this.document.setLocked(locked);
        this.onHostChange();
      },
      onNoteValueChange: (note) => {
        if (this.disposed) return Promise.resolve();
        const incomingNote = note as HostNote;
        const metadataOnly = incomingNote.isMetadataUpdate === true;
        this.incomingKind = this.lifecycle.classifyContext(incomingNote.uuid, metadataOnly);
        if (metadataOnly) {
          this.incomingNote = undefined;
          return Promise.resolve();
        }
        this.incomingNote = incomingNote;
        return Promise.resolve();
      },
      onThemesChange: () => {
        if (this.disposed) return;
        if (typeof globalThis !== "undefined") globalThis.dispatchEvent(new Event("sn-theme-change"));
        this.onHostChange();
      },
    };
    this.kit = this.createKit(delegate, {
      mode: "markdown",
      // Bridge owns the only cancellable debounce boundary. EditorKit's
      // internal timer cannot be cancelled after a conflict arrives.
      coallesedSaving: false,
      coallesedSavingDelay: 300,
    });
  }

  notifyLocalChange(text: string): void {
    if (this.disposed || this.document.locked || !this.kit) return;
    this.cancelRecurringEvaluation();
    this.scheduleSave(text);
    this.onHostChange();
  }

  /** Send the current pending local generation once, if it is still valid. */
  flush(): boolean {
    const text = this.pendingSaveText;
    if (text === undefined) return false;
    this.cancelPendingSave();
    if (this.document.pendingRemote !== undefined || !this.document.dirty || this.document.locked || !this.latestNote || !this.kit || text !== this.document.text) return false;
    this.requestSave(this.latestNote, text);
    this.onHostChange();
    return true;
  }

  /** Flush pending local work and invalidate callbacks owned by this bridge. */
  dispose(): boolean {
    const flushed = this.flush();
    this.cancelRecurringEvaluation();
    this.cancelPendingSave();
    this.kit?.dispose?.();
    this.disposed = true;
    return flushed;
  }

  getState(): EditorKitBridgeState {
    return { localDirty: this.document.dirty, saveRequested: this.saveRequested, hostConfirmed: false };
  }

  resolveConflict(choice: "keep-local" | "accept-remote"): boolean {
    if (this.disposed) return false;
    if (this.document.pendingRemote === undefined) return false;
    this.cancelRecurringEvaluation();
    if (choice === "keep-local" && (!this.latestNote || !this.kit)) return false;
    this.cancelPendingSave();
    if (choice === "accept-remote") {
      const resolved = this.document.resolveRemote(choice);
      if (resolved) this.saveRequested = false;
      this.onHostChange();
      return resolved;
    }
    if (!this.document.resolveRemote(choice)) return false;
    this.requestSave(this.latestNote!, this.document.text);
    this.onHostChange();
    return true;
  }
}
