/**
 * Inspect a single line of text and determine if offsetInLine is within a Markdown link or URL.
 * Returns the target URL if found, or undefined.
 */
export function findMarkdownLinkAtOffset(lineText: string, offsetInLine: number): string | undefined {
  if (offsetInLine < 0 || offsetInLine > lineText.length) return undefined;

  // 1. Check standard Markdown inline links: [text](url)
  const inlineLinkRegex = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = inlineLinkRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return match[2];
    }
  }

  // 2. Check autolinks: <url>
  const autolinkRegex = /<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^>\s]+)>/g;
  while ((match = autolinkRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return match[1];
    }
  }

  // 3. Check bare URLs: https?://...
  const bareUrlRegex = /https?:\/\/[^\s\)]+/g;
  while ((match = bareUrlRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return match[0];
    }
  }

  return undefined;
}
