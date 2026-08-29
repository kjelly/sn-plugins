export type DocumentState = {
  text: string;
  dirty: boolean;
  locked: boolean;
  pendingRemote?: string;
  resetGeneration: number;
};

import { createTextChangeSet, invertTextChangeSet, type TextChangeSet } from "./PositionMap.ts";
import { threeWayMerge } from "./ThreeWayMerge.ts";

export type DocumentTransition = { kind: "initialize" | "apply" | "undo" | "redo"; changeSet?: TextChangeSet; resetGeneration?: number };
export type DocumentListener = (state: DocumentState, transition?: DocumentTransition) => void;
export type ReceiveRemoteResult = "initialized" | "merged" | "conflicted";

type HistoryEntry = { from: string; to: string; changeSet?: TextChangeSet; inverseChangeSet?: TextChangeSet };

/** The only durable document state. All other editor data is derived or local. */
export class CanonicalDocument {
  private state: DocumentState;
  private baseText: string;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<DocumentListener>();

  constructor(text = "") {
    this.state = { text, dirty: false, locked: false, resetGeneration: 0 };
    this.baseText = text;
  }

  get text(): string { return this.state.text; }
  get dirty(): boolean { return this.state.dirty; }
  get locked(): boolean { return this.state.locked; }
  get pendingRemote(): string | undefined { return this.state.pendingRemote; }
  getBaseText(): string { return this.baseText; }
  snapshot(): DocumentState { return { ...this.state }; }

  subscribe(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  initialize(text: string): void {
    const resetGeneration = this.state.resetGeneration + 1;
    this.baseText = text;
    this.state = { ...this.state, text, dirty: false, pendingRemote: undefined, resetGeneration };
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ kind: "initialize", resetGeneration });
  }

  setLocked(locked: boolean): void {
    if (this.state.locked === locked) return;
    this.state = { ...this.state, locked };
    this.emit();
  }

  applyLocal(text: string, changeSet?: TextChangeSet): boolean {
    if (this.locked || text === this.text) return false;
    const exact = changeSet && changeSet.oldLength === this.text.length && changeSet.newLength === text.length
      ? createTextChangeSet(changeSet.oldLength, changeSet.newLength, changeSet.changes)
      : undefined;
    this.undoStack.push({
      from: this.text,
      to: text,
      ...(exact ? { changeSet: exact, inverseChangeSet: invertTextChangeSet(exact) } : {}),
    });
    this.redoStack = [];
    this.state = { ...this.state, text, dirty: true };
    this.emit({ kind: "apply", ...(exact ? { changeSet: exact } : {}) });
    return true;
  }

  receiveRemote(text: string): ReceiveRemoteResult {
    if (!this.dirty) {
      this.initialize(text);
      return "initialized";
    }
    if (text === this.text) {
      this.baseText = text;
      return "initialized";
    }
    const merge = threeWayMerge(this.baseText, this.text, text);
    if (merge.success && merge.text !== undefined) {
      this.baseText = text;
      this.applyLocal(merge.text);
      return "merged";
    }
    this.state = { ...this.state, pendingRemote: text };
    this.emit();
    return "conflicted";
  }

  markSaved(text: string): boolean {
    if (text !== this.text) return false;
    this.baseText = text;
    this.state = { ...this.state, dirty: false };
    this.emit({ kind: "initialize" });
    return true;
  }

  resolveRemote(choice: "keep-local" | "accept-remote"): boolean {
    const remote = this.pendingRemote;
    if (remote === undefined) return false;
    if (choice === "accept-remote") {
      this.initialize(remote);
      return true;
    }
    this.baseText = remote;
    this.state = { ...this.state, pendingRemote: undefined, dirty: true };
    this.emit();
    return true;
  }

  undo(): boolean {
    if (this.locked || this.undoStack.length === 0) return false;
    const entry = this.undoStack.pop()!;
    this.redoStack.push(entry);
    this.state = { ...this.state, text: entry.from, dirty: true };
    this.emit({ kind: "undo", ...(entry.inverseChangeSet ? { changeSet: entry.inverseChangeSet } : {}) });
    return true;
  }

  redo(): boolean {
    if (this.locked || this.redoStack.length === 0) return false;
    const entry = this.redoStack.pop()!;
    this.undoStack.push(entry);
    this.state = { ...this.state, text: entry.to, dirty: true };
    this.emit({ kind: "redo", ...(entry.changeSet ? { changeSet: entry.changeSet } : {}) });
    return true;
  }

  private emit(transition?: DocumentTransition): void { for (const listener of this.listeners) listener(this.snapshot(), transition); }
}
