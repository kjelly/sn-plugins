import { analyzeMarkdown, type HeadingInfo } from "../markdown/analysis.ts";

export type OutlineHeading = HeadingInfo;

export function outlineIndex(markdown: string): HeadingInfo[] {
  return analyzeMarkdown(markdown).headings;
}
