function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import { isFlashcardSuitable, isQaHeading, normalizeQaHeading } from "../src/flashcards/FlashcardSuitability.ts";

Deno.test("flashcard suitability normalizes exact Q&A heading aliases", () => {
  assertEquals(normalizeQaHeading("  Ｑ ＆ Ａ  "), "q & a");
  for (const heading of ["Q&A", "q & a", "Q＆A", "QA", "Questions & Answers", "QUESTIONS   ＆   ANSWERS"]) {
    assertEquals(isQaHeading(heading), true);
  }
  for (const heading of ["QA Environment", "Q&A Notes Archive", "Frequently Asked QA Metrics", "Questions and Answers", "Q：A："]) {
    assertEquals(isQaHeading(heading), false);
  }
});

Deno.test("flashcard suitability consumes headings at any level", () => {
  assertEquals(isFlashcardSuitable(analyzeMarkdown("# Ordinary\n\nText\n")), false);
  for (const marker of ["#", "##", "###"]) {
    assertEquals(isFlashcardSuitable(analyzeMarkdown(`${marker} Q&A\n`)), true);
  }
});
