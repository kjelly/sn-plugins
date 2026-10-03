function assertEquals<T>(actual: T, expected: T): void {
  const normalize = (value: unknown): unknown => value instanceof Set ? [...value] : value instanceof Map ? [...value] : value;
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) throw new Error(`${JSON.stringify(normalize(actual))} !== ${JSON.stringify(normalize(expected))}`);
}
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import type { Flashcard } from "../src/flashcards/FlashcardTypes.ts";
import {
  createFlashcardSession,
  markAgain,
  markKnown,
  nextCard,
  previousCard,
  revealCurrentCard,
  shuffleSession,
} from "../src/flashcards/FlashcardSession.ts";

const cards = ["a", "b", "c"].map((id): Flashcard => ({
  id,
  sectionId: "s",
  sectionTitle: "Q&A",
  headingPath: [],
  question: id,
  answerMarkdown: id,
  questionRange: { from: 0, to: 1 },
  answerRange: { from: 2, to: 3 },
  sourceRange: { from: 0, to: 3 },
}));

Deno.test("flashcard session navigates and hides revealed answers", () => {
  let state = revealCurrentCard(createFlashcardSession(cards));
  assertEquals(state.revealed, true);
  state = nextCard(state);
  assertEquals([state.cardIds[state.currentIndex], state.revealed], ["b", false]);
  state = previousCard(state);
  assertEquals(state.cardIds[state.currentIndex], "a");
});

Deno.test("flashcard Known removes cards and completes the session", () => {
  let state = createFlashcardSession(cards.slice(0, 2));
  state = markKnown(state);
  assertEquals(state.cardIds, ["b"]);
  assertEquals([...state.knownCardIds], ["a"]);
  state = markKnown(state);
  assertEquals(state.cardIds, []);
  assertEquals([...state.knownCardIds], ["a", "b"]);
});

Deno.test("flashcard Again moves the current card to the tail and counts it", () => {
  const state = markAgain(createFlashcardSession(cards));
  assertEquals(state.cardIds, ["b", "c", "a"]);
  assertEquals(state.againCountByCardId.get("a"), 1);
  assertEquals(state.revealed, false);
});

Deno.test("flashcard shuffle accepts deterministic RNG and empty sessions", () => {
  const values = [0, 0];
  const shuffled = shuffleSession(createFlashcardSession(cards), () => values.shift() ?? 0);
  assertEquals(shuffled.cardIds, ["b", "c", "a"]);
  assertEquals(createFlashcardSession([]).cardIds, []);
  assertEquals(createFlashcardSession(cards.slice(1)).cardIds, ["b", "c"]);
});
