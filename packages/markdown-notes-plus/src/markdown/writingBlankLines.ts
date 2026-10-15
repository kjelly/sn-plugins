import { $remark } from "@milkdown/utils";
import type { RemarkPluginRaw, Root } from "@milkdown/transformer";

/**
 * Restore top-level empty paragraphs from Writing's ordinary LF spacing.
 * The serializer separates blocks with two LFs, including empty paragraphs;
 * CommonMark otherwise discards those paragraphs when the note is reopened.
 * Only reconstruct that exact spelling. Other source whitespace continues
 * through the normal format review, and nested/code content is untouched.
 */
export const remarkWritingBlankLines: RemarkPluginRaw<Record<string, never>> = function () {
  return (tree: Root, file: { toString: () => string }) => {
    const source = file.toString();
    const children: Root["children"] = [];
    const appendBlanks = (gap: string, betweenBlocks: boolean) => {
      if (!/^\n+$/.test(gap) || gap.length % 2 !== 0) return;
      const count = gap.length / 2 - (betweenBlocks ? 1 : 0);
      for (let index = 0; index < count; index += 1) {
        children.push({ type: "paragraph", children: [] });
      }
    };

    // An all-blank document has N-1 separators for N empty paragraphs.
    if (tree.children.length === 0) {
      if (source.length > 0 && /^\n+$/.test(source) && source.length % 2 === 0) {
        appendBlanks(source, false);
        children.push({ type: "paragraph", children: [] });
        tree.children = children;
      }
      return tree;
    }

    let end = 0;
    for (const [index, child] of tree.children.entries()) {
      const start = child.position?.start.offset;
      const childEnd = child.position?.end.offset;
      // Do not infer gaps for synthetic nodes supplied by other extensions.
      if (start === undefined || childEnd === undefined) return tree;
      appendBlanks(source.slice(end, start), index > 0);
      children.push(child);
      end = childEnd;
    }
    appendBlanks(source.slice(end), false);
    tree.children = children;
    return tree;
  };
};

export const writingBlankLines = $remark("writingBlankLines", () => remarkWritingBlankLines);
