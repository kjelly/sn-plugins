import type { WritingCommandName } from "./WritingCommandPlan.ts";
import type { Transaction } from "@milkdown/prose/state";

export const WRITING_TRANSACTION_ORIGIN_META = "markdown-notes-plus/writing-origin";
export const WRITING_STRUCTURAL_CONTEXT_META = "markdown-notes-plus/writing-structural-context";
export type WritingStructuralContext = "table" | "code" | "divider";
export type WritingStructuralProvenance = { context: WritingStructuralContext; version: number };
export type WritingExternalReplacement = { kind: "external-replace"; generation: number; version: number };
export type WritingMutationOrigin = "user" | { kind: "command"; command: WritingCommandName } | WritingExternalReplacement;
export type WritingOriginState = { origin: WritingMutationOrigin; structural?: WritingStructuralProvenance };

let nextStructuralContextVersion = 0;

/** Structural commands must publish provenance before their transaction dispatch. */
export function structuralProvenanceForCommand(command: WritingCommandName): WritingStructuralProvenance | undefined {
  if (command !== "table" && command !== "code" && command !== "divider") return undefined;
  return { context: command, version: ++nextStructuralContextVersion };
}

function isStructuralProvenance(value: unknown): value is WritingStructuralProvenance {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WritingStructuralProvenance>;
  return (candidate.context === "table" || candidate.context === "code" || candidate.context === "divider")
    && typeof candidate.version === "number";
}

/** Preserve a command's structural proof when Milkdown coalesces later user transactions. */
export function applyWritingOriginTransaction(transaction: Transaction, previous: WritingOriginState): WritingOriginState {
  if (!transaction.docChanged) return previous;
  const origin = transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META) ?? "user";
  if (origin !== "user" && origin.kind === "external-replace") return { origin };
  if (origin !== "user" && origin.kind === "command") {
    const structural = transaction.getMeta(WRITING_STRUCTURAL_CONTEXT_META);
    return { origin, ...(isStructuralProvenance(structural) ? { structural } : {}) };
  }
  return { origin: "user", ...(previous.structural ? { structural: previous.structural } : {}) };
}

/**
 * Guards Milkdown's markdownUpdated stream. Creating/parsing an editor is not
 * a user edit, while the first update after the editor is ready is.
 */
export class WritingEditorChangeGate {
  private ready = false;
  private externalUpdateVersion = 0;
  private pendingExternalReplacement: WritingExternalReplacement | undefined;
  private generation = 0;
  private rendered = "";

  begin(initial: string): number {
    this.generation += 1;
    this.ready = false;
    this.pendingExternalReplacement = undefined;
    this.rendered = initial;
    return this.generation;
  }

  finish(generation: number, rendered: string): void {
    if (generation !== this.generation) return;
    this.rendered = rendered;
    this.ready = true;
  }

  /** Tag a programmatic replacement so its serializer callback cannot become a local edit. */
  suppressExternalUpdate(generation: number, target?: string): WritingExternalReplacement | undefined {
    if (generation !== this.generation) return undefined;
    if (target !== undefined) this.rendered = target;
    const replacement = { kind: "external-replace" as const, generation, version: ++this.externalUpdateVersion };
    this.pendingExternalReplacement = replacement;
    return replacement;
  }

  /**
   * Kept as a compatibility alias for callers that do not yet know the
   * replacement text. New callers should use suppressExternalUpdate. An
   * unknown target is intentionally ignored; provenance is required for
   * suppression.
   */
  suppressNextExternalUpdate(generation: number, _target?: string): WritingExternalReplacement | undefined {
    return this.suppressExternalUpdate(generation);
  }

  markdownUpdated(generation: number, markdown: string, origin: WritingMutationOrigin = "user"): boolean {
    if (generation !== this.generation) return false;
    this.rendered = markdown;
    if (!this.ready) return false;
    if (origin !== "user" && origin.kind === "external-replace" && origin.generation === generation) {
      if (this.pendingExternalReplacement?.version === origin.version) this.pendingExternalReplacement = undefined;
      return false;
    }
    if (origin === "user") this.pendingExternalReplacement = undefined;
    return true;
  }

  get hasPendingExternalUpdate(): boolean { return this.pendingExternalReplacement !== undefined; }

  get renderedMarkdown(): string { return this.rendered; }
}

export type WritingRoundTripResult = { editable: boolean; reason?: string };

function hasFencedCodeBlock(markdown: string): boolean {
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})[^\r\n]*$/);
    if (!opening) continue;
    const fence = opening[1][0];
    const length = opening[1].length;
    for (let close = index + 1; close < lines.length; close += 1) {
      if (new RegExp(`^ {0,3}${fence}{${length},}[ \\t]*$`).test(lines[close])) return true;
    }
  }
  return false;
}

function hasTable(markdown: string): boolean {
  const lines = markdown.split("\n");
  return lines.some((line, index) => {
    if (index === 0 || !line.includes("|")) return false;
    const delimiter = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = delimiter.split("|").map((cell) => cell.trim());
    return cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell)) && lines[index - 1].includes("|");
  });
}

function hasThematicBreak(markdown: string): boolean {
  return markdown.split("\n").some((line) => /^ {0,3}(?:\*\s*){3,}$/.test(line) || /^ {0,3}(?:-\s*){3,}$/.test(line) || /^ {0,3}(?:_\s*){3,}$/.test(line));
}

/** Structural outputs that are intentionally introduced by an explicit command. */
function isCommandOutputSafe(command: WritingCommandName, markdown: string): boolean {
  switch (command) {
    case "table": return hasTable(markdown);
    case "code": return hasFencedCodeBlock(markdown);
    case "divider": return hasThematicBreak(markdown);
    case "task": return /(?:^|\n) {0,3}[-+*][ \t]+\[[ xX]\](?:\s+|$)/.test(markdown);
    default: return isWritingLexicallySafe(markdown);
  }
}

function newlineKind(markdown: string): "lf" | "crlf" | "cr" | "none" | "mixed" {
  const kinds = new Set<string>();
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "\r" && markdown[index] !== "\n") continue;
    if (markdown[index] === "\r" && markdown[index + 1] === "\n") { kinds.add("crlf"); index += 1; }
    else kinds.add(markdown[index] === "\r" ? "cr" : "lf");
  }
  if (kinds.size === 0) return "none";
  if (kinds.size > 1) return "mixed";
  return [...kinds][0] as "lf" | "crlf" | "cr";
}

/**
 * Milkdown is a structural editor, not a lossless Markdown editor. This
 * conservative profile is the explicit proof boundary for Writing mode.
 * Anything outside it remains editable in Source mode, where raw text is
 * canonical and no serializer is involved.
 */
export function isWritingLexicallySafe(markdown: string): boolean {
  if (markdown.includes("\r")) return false;
  if (/(?:[^ \t\r\n])[ \t]+(?:\n|$)/.test(markdown)) return false;
  if (/(?:^|\n)[ \t]{0,3}(?:```|~~~)/m.test(markdown)) return false;
  if (/(?:^|\n)[ \t]{0,3}(?:\+|\*)[ \t]+/m.test(markdown)) return false;
  if (/(?:^|\n)[ \t]{0,3}\|/m.test(markdown)) return false;
  if (/(?:^|\n)[ \t]{0,3}(?:<|>\s*<|<\/?[A-Za-z])/m.test(markdown)) return false;
  if (/(?:^|\n)[ \t]{0,3}(?:=+|-{3,})[ \t]*$/m.test(markdown)) return false;
  if (/(?:^|\n)[ \t]{4,}(?:[-+*]|\d+[.)])[ \t]+/m.test(markdown)) return false;
  return true;
}

export function structuralContextForCommand(command: WritingCommandName, markdown: string): WritingStructuralContext | undefined {
  if (command === "table" && hasTable(markdown)) return "table";
  if (command === "code" && hasFencedCodeBlock(markdown)) return "code";
  if (command === "divider" && hasThematicBreak(markdown)) return "divider";
  return undefined;
}

export function preservesWritingStructuralContext(context: WritingStructuralContext, markdown: string): boolean {
  if (context === "table") return hasTable(markdown);
  if (context === "code") return hasFencedCodeBlock(markdown);
  return hasThematicBreak(markdown);
}

function normalizeTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

/** Prove that the initial document survived Milkdown's actual serializer. */
export function assessWritingRoundTrip(source: string, serialized: string): WritingRoundTripResult {
  if (!isWritingLexicallySafe(source)) return { editable: false, reason: "Writing cannot preserve this Markdown exactly; use Source mode." };
  if (normalizeTrailingNewlines(source) !== normalizeTrailingNewlines(serialized)) {
    return { editable: false, reason: "Writing serializer changed the source; use Source mode for exact Markdown." };
  }
  return { editable: true };
}

/**
 * Prove a subsequent serializer result is still inside the same lossless
 * profile. The serializer itself supplied `next`; this check prevents a
 * mutation from introducing syntax whose spelling cannot be preserved.
 */
export function assessWritingMutation(
  previous: string,
  next: string,
  origin: WritingMutationOrigin = "user",
  structuralContext?: WritingStructuralContext,
): WritingRoundTripResult {
  // Structural command proofs must not admit serializer output containing CR
  // or CRLF. The only line-ending exception is LF-only blank-note materialization.
  if (next.includes("\r")) return { editable: false, reason: "Writing changed line endings; use Source mode for exact Markdown." };
  const safe = origin !== "user"
    ? origin.kind === "external-replace" ? false : isCommandOutputSafe(origin.command, next)
    : isWritingLexicallySafe(next) || (structuralContext !== undefined && preservesWritingStructuralContext(structuralContext, next));
  if (!safe) return { editable: false, reason: "This edit cannot be preserved exactly in Writing; use Source mode." };
  // A structural command is allowed to introduce the line breaks required by
  // its output (for example a new table in a one-line paragraph). Once the
  // source already contains line endings, preserve their exact kind too.
  // Milkdown materializes an empty document as a single LF-terminated
  // paragraph on the first real edit. That one transition is safe; a generic
  // none -> LF relaxation would admit serializer-induced line-ending changes
  // for non-empty notes.
  const isEmptyInitialMaterialization = previous === "" && newlineKind(next) === "lf";
  if ((origin === "user" && !isEmptyInitialMaterialization) || newlineKind(previous) !== "none") {
    if (newlineKind(previous) !== newlineKind(next)) return { editable: false, reason: "Writing changed line endings; use Source mode for exact Markdown." };
  }
  return { editable: true };
}
