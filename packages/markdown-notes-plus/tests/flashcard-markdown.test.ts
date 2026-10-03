function assert(condition: unknown, message = "assertion failed"): asserts condition { if (!condition) throw new Error(message); }
function assertEquals<T>(actual: T, expected: T): void { if (actual !== expected) throw new Error(`${String(actual)} !== ${String(expected)}`); }
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { parseFlashcardMarkdown, type FlashcardMarkdownNode } from "../src/flashcards/FlashcardMarkdownAst.ts";
import { isSafeExternalUrl, openExternalLink } from "../src/utils/linkOpener.ts";

function collect(node: FlashcardMarkdownNode, type: string): FlashcardMarkdownNode[] {
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((child) => collect(child, type))];
}

Deno.test("flashcard Markdown parser supports GFM structure without interpreting raw HTML", () => {
  const tree = parseFlashcardMarkdown("**bold**\n\n- item\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>");
  assertEquals(collect(tree, "strong").length, 1);
  assertEquals(collect(tree, "list").length, 1);
  assertEquals(collect(tree, "table").length, 1);
  assertEquals(collect(tree, "html").length, 1);
});

Deno.test("flashcard Markdown keeps unsafe links non-clickable and images non-fetching", () => {
  const tree = parseFlashcardMarkdown("[bad](javascript:alert(1)) [v](vbscript:msgbox(1)) [d](data:text/plain,x) [safe](https://example.com) ![tracker](https://example.invalid/tracker.png)");
  const links = collect(tree, "link");
  assertEquals(links.length, 4);
  assert(links.slice(0, 3).every((link) => !isSafeExternalUrl(link.url ?? "")));
  assertEquals(isSafeExternalUrl(links[3].url ?? ""), true);
  const images = collect(tree, "image");
  assertEquals(images.length, 1);
  assertEquals(images[0].alt, "tracker");
});

Deno.test("flashcard Markdown code and malformed input remain parseable", () => {
  const tree = parseFlashcardMarkdown("```html\n<script>alert(1)</script>\n```\n\n[broken](");
  assertEquals(collect(tree, "code").length, 1);
  assertEquals(collect(tree, "html").length, 0);
});

Deno.test("flashcard Markdown rejects browser-normalized script links", () => {
  const tree = parseFlashcardMarkdown("[bad](<\u0001javascript:alert(1)>)");
  const url = collect(tree, "link")[0]?.url ?? "";
  assertEquals(new URL(url, "https://example.com/").protocol, "javascript:");
  assertEquals(isSafeExternalUrl(url), false);
  let opened = false;
  assertEquals(openExternalLink(url, () => { opened = true; return null; }), false);
  assertEquals(opened, false);
});
