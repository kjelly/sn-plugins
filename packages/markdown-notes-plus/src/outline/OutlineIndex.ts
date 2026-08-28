import { analyzeMarkdown, type HeadingInfo } from "../markdown/analysis";

export function outlineIndex(markdown: string): HeadingInfo[] { return analyzeMarkdown(markdown).headings; }
