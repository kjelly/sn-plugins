function assert(condition: unknown, message = "assertion failed"): asserts condition { if (!condition) throw new Error(message); }
function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import { analyzeFlashcards } from "../src/flashcards/FlashcardModel.ts";

const fixture = `# Notes

## Q&A

### Kubernetes

Q: What is a Pod?
A: A **small** unit.

- one
- two

Q: Show code
A:

\`\`\`ts
Q: not a card
A: still code
\`\`\`

| A | B |
|---|---|
| 1 | 2 |

## Other
Q: outside
A: outside

### Questions ＆ Answers
q： duplicate
a： lower case
`;

Deno.test("flashcard model parses sections, categories, Markdown answers, and exact ranges", () => {
  const analysis = analyzeMarkdown(fixture);
  const model = analyzeFlashcards(fixture, analysis);
  assertEquals(model.markdown, fixture);
  assertEquals(model.sections.length, 2);
  assertEquals(model.cards.length, 3);
  assertEquals(model.cards[0].question, "What is a Pod?");
  assertEquals(model.cards[0].headingPath, ["Kubernetes"]);
  assert(model.cards[0].answerMarkdown.includes("- one\n- two"));
  assert(model.cards[1].answerMarkdown.includes("Q: not a card"));
  assert(model.cards[1].answerMarkdown.includes("| A | B |"));
  assertEquals(model.cards[2].question, "duplicate");
  for (const card of model.cards) {
    assertEquals(fixture.slice(card.questionRange.from, card.questionRange.to), card.question);
    assertEquals(fixture.slice(card.answerRange.from, card.answerRange.to), card.answerMarkdown);
    assert(fixture.slice(card.sourceRange.from, card.sourceRange.to).startsWith(fixture.slice(card.sourceRange.from).match(/^ {0,3}[Qq]\s*[:：]/u)?.[0] ?? "Q:"));
  }
});

Deno.test("flashcard model supports CRLF, duplicate questions, and heading levels", () => {
  const source = "# Q&A\r\nQ: Same\r\nA: One\r\nQ: Same\r\nA: Two\r\n## QA\r\nQ： Three\r\nA： Answer\r\n### Q & A\r\nQ: Four\r\nA: Last";
  const model = analyzeFlashcards(source);
  assertEquals(model.markdown, source);
  assertEquals(model.sections.map((section) => section.headingLevel), [1, 2, 3]);
  assertEquals(model.cards.map((card) => card.question), ["Same", "Same", "Three", "Four"]);
  assertEquals(new Set(model.cards.map((card) => card.id)).size, 4);
});

Deno.test("flashcard model ignores malformed pairs and protected markers", () => {
  const source = `## Q&A
A: orphan
Q: unanswered
Q: newest
A:
Q: valid
A: answer

<!--
Q: comment
A: hidden
-->

<div>
Q: html
A: hidden
</div>

\`Q: inline marker\`
`;
  const model = analyzeFlashcards(source);
  assertEquals(model.markdown, source);
  assertEquals(model.cards.map((card) => card.question), ["valid"]);
});

Deno.test("flashcard model returns sections with zero cards without changing source", () => {
  const source = "### Questions & Answers\n\nQ: incomplete\n";
  const model = analyzeFlashcards(source);
  assertEquals(model.markdown, source);
  assertEquals(model.sections.length, 1);
  assertEquals(model.cards, []);
});

Deno.test("nested Q&A sections end parent answers and do not pair across the child", () => {
  const source = "# Q&A\nQ: parent\nA: parent answer\n## Q&A\nQ: child\nA: child answer\n## Other\nQ: after child\nA: later answer\n";
  const model = analyzeFlashcards(source);
  assertEquals(model.markdown, source);
  assertEquals(model.cards.map((card) => card.question), ["parent", "after child", "child"]);
  assertEquals(model.cards[0].answerMarkdown, "parent answer\n");
  assertEquals(model.cards[1].answerMarkdown, "later answer\n");
  assertEquals(model.cards[2].answerMarkdown, "child answer\n");

  const incomplete = analyzeFlashcards("# Q&A\nQ: parent\n## Q&A\nA: child orphan\n");
  assertEquals(incomplete.cards, []);
});

Deno.test("repeated category headings retain distinct source identities", () => {
  const source = "## Q&A\n### Basics\nQ: first\nA: one\n### Basics\nQ: second\nA: two\n";
  const model = analyzeFlashcards(source);
  assertEquals(model.cards.map((card) => card.headingPath), [["Basics"], ["Basics"]]);
  assert(model.cards[0].categoryAnchor !== undefined);
  assert(model.cards[1].categoryAnchor !== undefined);
  assert(model.cards[0].categoryAnchor !== model.cards[1].categoryAnchor);
  assertEquals(source.slice(model.cards[0].categoryAnchor, model.cards[0].categoryAnchor + 10), "### Basics");
  assertEquals(source.slice(model.cards[1].categoryAnchor, model.cards[1].categoryAnchor + 10), "### Basics");
});
