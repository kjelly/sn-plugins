import { remark } from "remark";
import remarkGfm from "remark-gfm";

export type FlashcardMarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  children?: FlashcardMarkdownNode[];
};

export function parseFlashcardMarkdown(markdown: string): FlashcardMarkdownNode {
  return remark().use(remarkGfm).parse({ value: markdown, cwd: "" }) as unknown as FlashcardMarkdownNode;
}
