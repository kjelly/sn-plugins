import { CanonicalDocument, type DocumentState, type DocumentToken, type DocumentTransition } from "../document/CanonicalDocument.ts";
import type { TextChangeSet } from "../document/PositionMap.ts";
import type { WritingCapabilityProof } from "../editor/WritingEditorLifecycle.ts";

type FallbackListener = (fallback: string | undefined) => void;
type WritingEditorEpochListener = (epoch: number) => void;

type WritingApplyInFlight = {
  instanceId: string;
  revision: number;
  resetGeneration: number;
  text: string;
};

/**
 * Owns the App-only Writing fallback and the admission boundary for local
 * canonical writers. The fallback is user input, not document state: only an
 * explicit Source action may commit or discard it.
 */
export class AppDocumentLifecycle {
  private sourceFallbackText: string | undefined;
  private readonly fallbackListeners = new Set<FallbackListener>();
  private readonly writingEditorEpochListeners = new Set<WritingEditorEpochListener>();
  private writingEpoch = 0;
  private writingApplyInFlight: WritingApplyInFlight | undefined;
  private lastObservedToken: DocumentToken;
  private lastObservedResetGeneration: number;

  constructor(private readonly canonical: CanonicalDocument) {
    this.lastObservedToken = canonical.token;
    this.lastObservedResetGeneration = canonical.snapshot().resetGeneration;
    canonical.subscribe((next, transition) => this.observeCanonicalTransition("", next, transition));
  }

  get fallback(): string | undefined { return this.sourceFallbackText; }
  get hasFallback(): boolean { return this.sourceFallbackText !== undefined; }
  get writingEditorEpoch(): number { return this.writingEpoch; }

  subscribeFallback(listener: FallbackListener): () => void {
    this.fallbackListeners.add(listener);
    listener(this.sourceFallbackText);
    return () => this.fallbackListeners.delete(listener);
  }

  subscribeWritingEditorEpoch(listener: WritingEditorEpochListener): () => void {
    this.writingEditorEpochListeners.add(listener);
    listener(this.writingEpoch);
    return () => this.writingEditorEpochListeners.delete(listener);
  }

  /** Retire all callbacks and projection state owned by the current Writing editor. */
  retireWritingEditor(): void {
    this.writingEpoch += 1;
    for (const listener of this.writingEditorEpochListeners) listener(this.writingEpoch);
  }

  /** Canonical provenance, rather than text inequality alone, controls F's lifetime. */
  observeCanonicalTransition(_previousText: string, next: DocumentState, transition?: DocumentTransition): void {
    if (transition?.kind === "initialize") this.retireFallback();

    const currentToken = this.canonical.token;
    const revisionChanged = currentToken.instanceId !== this.lastObservedToken.instanceId ||
      currentToken.revision !== this.lastObservedToken.revision;
    const resetGenerationChanged = next.resetGeneration !== this.lastObservedResetGeneration;
    const writingApply = this.writingApplyInFlight;
    const isCurrentWritingApply = transition?.kind === "apply" &&
      writingApply !== undefined &&
      currentToken.instanceId === writingApply.instanceId &&
      currentToken.revision === writingApply.revision + 1 &&
      next.resetGeneration === writingApply.resetGeneration &&
      next.text === writingApply.text;

    // Every canonical revision/reset retires the mounted projection unless
    // this exact synchronous apply was admitted by the current Writing proof.
    // Revision-only notifications cover remote conflicts, which have no
    // DocumentTransition payload.
    if ((transition?.kind === "initialize" || transition?.kind === "apply" ||
      transition?.kind === "undo" || transition?.kind === "redo" || revisionChanged || resetGenerationChanged) &&
      !isCurrentWritingApply) {
      this.retireWritingEditor();
    }
    this.writingApplyInFlight = undefined;
    this.lastObservedToken = currentToken;
    this.lastObservedResetGeneration = next.resetGeneration;
  }

  preserveWritingFallback(text: string): void { this.setFallback(text); }

  canApplyLocal(): boolean { return !this.hasFallback; }

  applyLocal(text: string, changeSet?: TextChangeSet): boolean {
    if (!this.canApplyLocal()) return false;
    return this.canonical.applyLocal(text, changeSet);
  }

  applyLocalIfCurrent(token: DocumentToken, text: string, changeSet?: TextChangeSet): boolean {
    if (!this.canApplyLocal()) return false;
    return this.canonical.applyLocalIfCurrent(token, text, changeSet);
  }

  applyWritingLocalIfCurrent(proof: WritingCapabilityProof, editorGeneration: number, text: string, changeSet?: TextChangeSet): boolean {
    const current = this.canonical.snapshot();
    const token = this.canonical.token;
    if (
      proof.documentInstanceId !== token.instanceId ||
      proof.documentRevision !== token.revision ||
      proof.documentGeneration !== current.resetGeneration ||
      proof.editorGeneration !== editorGeneration ||
      proof.editorGeneration !== this.writingEpoch
    ) return false;
    const writingApply: WritingApplyInFlight = {
      instanceId: token.instanceId,
      revision: token.revision,
      resetGeneration: current.resetGeneration,
      text,
    };
    this.writingApplyInFlight = writingApply;
    try {
      return this.applyLocalIfCurrent(token, text, changeSet);
    } finally {
      if (this.writingApplyInFlight === writingApply) this.writingApplyInFlight = undefined;
    }
  }

  applySourceEdit(text: string, changeSet?: TextChangeSet): boolean {
    if (this.canonical.locked) return false;
    if (this.hasFallback) {
      // The CodeMirror change set is relative to F. Retire F first even when
      // the explicit edit resolves exactly to the canonical C (a discard).
      this.retireFallback();
      return this.canonical.applyLocal(text);
    }
    return this.canonical.applyLocal(text, changeSet);
  }

  applyHistory(mutation: () => boolean): boolean {
    if (!this.canApplyLocal()) return false;
    return mutation();
  }

  sourceValue(canonicalText: string): string { return this.sourceFallbackText ?? canonicalText; }

  retireFallback(): void {
    if (!this.hasFallback) return;
    this.setFallback(undefined);
  }

  private setFallback(next: string | undefined): void {
    if (this.sourceFallbackText === next) return;
    this.sourceFallbackText = next;
    for (const listener of this.fallbackListeners) listener(next);
  }
}
