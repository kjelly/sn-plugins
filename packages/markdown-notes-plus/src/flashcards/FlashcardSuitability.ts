import type { MarkdownAnalysis } from "../markdown/analysis.ts";

const QA_HEADING_ALIASES = new Set([
  "q&a",
  "q & a",
  "qa",
  "questions & answers",
]);

export function normalizeQaHeading(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function isQaHeading(text: string): boolean {
  return QA_HEADING_ALIASES.has(normalizeQaHeading(text));
}

export function isFlashcardSuitable(analysis: MarkdownAnalysis): boolean {
  return analysis.headings.some((heading) => isQaHeading(heading.text));
}
