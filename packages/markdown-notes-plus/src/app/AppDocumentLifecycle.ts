import { CanonicalDocument, type DocumentState, type DocumentTransition } from "../document/CanonicalDocument.ts";
import type { TextChangeSet } from "../document/PositionMap.ts";

type FallbackListener = (fallback: string | undefined) => void;

/**
 * Owns the App-only Writing fallback and the admission boundary for local
 * canonical writers. The fallback is user input, not document state: only an
 * explicit Source action may commit or discard it.
 */
export class AppDocumentLifecycle {
  private sourceFallbackText: string | undefined;
  private readonly fallbackListeners = new Set<FallbackListener>();

  constructor(private readonly canonical: CanonicalDocument) {}

  get fallback(): string | undefined { return this.sourceFallbackText; }
  get hasFallback(): boolean { return this.sourceFallbackText !== undefined; }

  subscribeFallback(listener: FallbackListener): () => void {
    this.fallbackListeners.add(listener);
    listener(this.sourceFallbackText);
    return () => this.fallbackListeners.delete(listener);
  }

  /** Canonical provenance, rather than text inequality alone, controls F's lifetime. */
  observeCanonicalTransition(_previousText: string, _next: DocumentState, transition?: DocumentTransition): void {
    if (transition?.kind === "initialize") this.retireFallback();
  }

  preserveWritingFallback(text: string): void { this.setFallback(text); }

  canApplyLocal(): boolean { return !this.hasFallback; }

  applyLocal(text: string, changeSet?: TextChangeSet): boolean {
    if (!this.canApplyLocal()) return false;
    return this.canonical.applyLocal(text, changeSet);
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

  private retireFallback(): void {
    if (!this.hasFallback) return;
    this.setFallback(undefined);
  }

  private setFallback(next: string | undefined): void {
    if (this.sourceFallbackText === next) return;
    this.sourceFallbackText = next;
    for (const listener of this.fallbackListeners) listener(next);
  }
}
