import type { Node as ProseNode } from "@milkdown/prose/model";

/** The stringify settings shared by the Writing editor and its proof tests. */
export const WRITING_CODEC_OPTIONS = {
  bullet: "-",
  bulletOther: "*",
  listItemIndent: "one",
  resourceLink: true,
} as const;

export type WritingNormalizationCategory =
  | "line-ending"
  | "bullet"
  | "blank-line"
  | "trailing-space"
  | "final-newline"
  | "hard-break"
  | "gfm-structure";

export type WritingNormalizationChange = {
  category: WritingNormalizationCategory;
  count: number;
};

export type WritingCodec = {
  parse: (markdown: string) => ProseNode | undefined;
  serialize: (document: ProseNode) => string;
};

export type WritingNormalizationScan = {
  markdown: string;
  changes: WritingNormalizationChange[];
  unsupportedReason?: string;
};

type LineToken = { text: string; newline: string };

const unsupported = {
  html: "Raw HTML",
  reference: "reference links",
  unknown: "unsupported Markdown extension",
} as const;

function addChange(changes: Map<WritingNormalizationCategory, number>, category: WritingNormalizationCategory, count = 1): void {
  changes.set(category, (changes.get(category) ?? 0) + count);
}

function tokenizeLines(markdown: string): LineToken[] {
  const lines: LineToken[] = [];
  let start = 0;
  for (let index = 0; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character !== "\r" && character !== "\n") continue;
    const newline = character === "\r" && markdown[index + 1] === "\n" ? "\r\n" : character;
    lines.push({ text: markdown.slice(start, index), newline });
    index += newline.length - 1;
    start = index + 1;
  }
  if (start < markdown.length || lines.length === 0) lines.push({ text: markdown.slice(start), newline: "" });
  return lines;
}

function isRawHtml(line: string): boolean {
  const withoutAutolinks = line.replace(/<(?:https?|mailto):[^>]+>/gi, "");
  return /<!--|<\/?[A-Za-z][^>]*>|<![A-Z]|<\?[A-Za-z]/.test(withoutAutolinks);
}

function isReferenceSyntax(line: string): boolean {
  return /^ {0,3}\[[^\]]+\]:\s*\S/.test(line) || /\[[^\]]+\]\[[^\]]*\]/.test(line);
}

function isUnknownExtension(line: string): boolean {
  return /^ {0,3}:::{3,}/.test(line) || /^ {0,3}\[\^[^\]]+\](?::|\s)/.test(line) || /(^|\s)\?\?[^?]+\?\?(?=\s|$)/.test(line);
}

function listMarker(line: string): { marker: string; prefixLength: number } | undefined {
  const match = line.match(/^( {0,3})([*+-])([ \t]+)/);
  return match ? { marker: match[2], prefixLength: match[1].length } : undefined;
}

function isAtxHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line);
}

function makeChanges(changes: Map<WritingNormalizationCategory, number>): WritingNormalizationChange[] {
  return [...changes.entries()].filter(([, count]) => count > 0).map(([category, count]) => ({ category, count }));
}

function unsupportedScanReason(reason: string): string {
  return `${reason} are not supported in Writing mode; use Source mode.`;
}

/**
 * Scan and normalize only the deliberately small whitespace surface owned by
 * Writing. Every newline is retained as a token until the policy has made its
 * decision, so tabs and protected Markdown are never lost accidentally.
 */
export function scanWritingNormalization(markdown: string): WritingNormalizationScan {
  const sourceLines = tokenizeLines(markdown);
  const changes = new Map<WritingNormalizationCategory, number>();
  const lines: string[] = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index].text;
    if (isRawHtml(line)) return { markdown, changes: [], unsupportedReason: unsupportedScanReason(unsupported.html) };
    if (isReferenceSyntax(line)) return { markdown, changes: [], unsupportedReason: unsupportedScanReason(unsupported.reference) };
    if (isUnknownExtension(line)) return { markdown, changes: [], unsupportedReason: unsupportedScanReason(unsupported.unknown) };

    // Tables and fenced code blocks are first-class GFM nodes in the Writing
    // preset. Their exact spelling is admitted later only when the live
    // Milkdown parser and serializer prove an AST-equivalent, idempotent
    // normalized result.

    let normalized = line;
    const marker = listMarker(normalized);
    if (marker?.marker === "*") {
      normalized = `${normalized.slice(0, marker.prefixLength)}-${normalized.slice(marker.prefixLength + 1)}`;
      addChange(changes, "bullet");
    } else if (marker?.marker === "+") {
      return { markdown, changes: [], unsupportedReason: unsupportedScanReason("plus bullets") };
    }
    if (normalized.endsWith(" ") && !normalized.endsWith("  ") && !normalized.endsWith("\\ ")) {
      normalized = normalized.slice(0, -1);
      addChange(changes, "trailing-space");
    }
    lines.push(normalized);
    const newline = sourceLines[index].newline;
    if (newline !== "" && newline !== "\n") addChange(changes, "line-ending");
  }

  // Empty lines are structural whitespace. Collapse only truly empty lines;
  // a line containing a tab or spaces is intentionally retained.
  const compacted: string[] = [];
  let emptyRun = 0;
  for (const line of lines) {
    if (line === "") {
      emptyRun += 1;
      if (emptyRun > 1) addChange(changes, "blank-line");
      if (emptyRun > 1) continue;
    } else {
      emptyRun = 0;
    }
    compacted.push(line);
  }

  // Milkdown emits a separating blank line after an ATX heading before the
  // next block. Add it only at this verified heading boundary.
  const spaced: string[] = [];
  for (const line of compacted) {
    const previous = spaced[spaced.length - 1];
    if (previous !== undefined && previous !== "" && isAtxHeading(previous) && line !== "") {
      spaced.push("");
      addChange(changes, "blank-line");
    }
    spaced.push(line);
  }

  while (spaced[0] === "") {
    spaced.shift();
    addChange(changes, "blank-line");
  }
  while (spaced.length > 0 && spaced[spaced.length - 1] === "") spaced.pop();

  let normalizedMarkdown = spaced.join("\n");
  if (normalizedMarkdown !== "" && !normalizedMarkdown.endsWith("\n")) {
    normalizedMarkdown += "\n";
    addChange(changes, "final-newline");
  } else if (normalizedMarkdown === "" && markdown !== "") {
    normalizedMarkdown = "\n";
    addChange(changes, "final-newline");
  }

  if (normalizedMarkdown === markdown) return { markdown: normalizedMarkdown, changes: [] };
  if (changes.size === 0) return { markdown: normalizedMarkdown, changes: [{ category: "final-newline", count: 1 }] };
  return { markdown: normalizedMarkdown, changes: makeChanges(changes) };
}

export function writingAstEquivalent(left: ProseNode, right: ProseNode): boolean {
  return left.eq(right);
}

export function proveWritingNormalization(source: string, candidate: string, codec: WritingCodec): string | undefined {
  // Markdown line endings are a transport spelling difference. Parse the
  // source with the same LF tokenization used by the candidate while still
  // requiring the live serializer to emit the exact candidate text below.
  const sourceDocument = codec.parse(source.replace(/\r\n?/g, "\n"));
  const candidateDocument = codec.parse(candidate);
  if (!sourceDocument || !candidateDocument || !writingAstEquivalent(sourceDocument, candidateDocument)) return "Milkdown changed the Markdown structure; use Source mode.";
  if (codec.serialize(candidateDocument) !== candidate) return "Writing serializer could not prove the normalized Markdown; use Source mode.";
  return undefined;
}
