import type { Flashcard } from "./FlashcardTypes.ts";

export type FlashcardSessionState = {
  cardIds: string[];
  currentIndex: number;
  revealed: boolean;
  knownCardIds: Set<string>;
  againCountByCardId: Map<string, number>;
};

export function createFlashcardSession(cards: readonly Flashcard[]): FlashcardSessionState {
  return {
    cardIds: cards.map((card) => card.id),
    currentIndex: 0,
    revealed: false,
    knownCardIds: new Set(),
    againCountByCardId: new Map(),
  };
}

export const resetSession = createFlashcardSession;

export function revealCurrentCard(state: FlashcardSessionState): FlashcardSessionState {
  return state.cardIds.length === 0 || state.revealed ? state : { ...state, revealed: true };
}

export function hideCurrentCard(state: FlashcardSessionState): FlashcardSessionState {
  return !state.revealed ? state : { ...state, revealed: false };
}

export function nextCard(state: FlashcardSessionState): FlashcardSessionState {
  if (state.cardIds.length === 0) return hideCurrentCard(state);
  return { ...state, currentIndex: (state.currentIndex + 1) % state.cardIds.length, revealed: false };
}

export function previousCard(state: FlashcardSessionState): FlashcardSessionState {
  if (state.cardIds.length === 0) return hideCurrentCard(state);
  return { ...state, currentIndex: (state.currentIndex - 1 + state.cardIds.length) % state.cardIds.length, revealed: false };
}

export function markKnown(state: FlashcardSessionState): FlashcardSessionState {
  const current = state.cardIds[state.currentIndex];
  if (!current) return state;
  const cardIds = state.cardIds.filter((_, index) => index !== state.currentIndex);
  const knownCardIds = new Set(state.knownCardIds);
  knownCardIds.add(current);
  return {
    ...state,
    cardIds,
    currentIndex: cardIds.length === 0 ? 0 : state.currentIndex % cardIds.length,
    revealed: false,
    knownCardIds,
  };
}

export function markAgain(state: FlashcardSessionState): FlashcardSessionState {
  const current = state.cardIds[state.currentIndex];
  if (!current) return state;
  const cardIds = state.cardIds.slice();
  cardIds.splice(state.currentIndex, 1);
  cardIds.push(current);
  const againCountByCardId = new Map(state.againCountByCardId);
  againCountByCardId.set(current, (againCountByCardId.get(current) ?? 0) + 1);
  return {
    ...state,
    cardIds,
    currentIndex: cardIds.length <= 1 ? 0 : state.currentIndex % cardIds.length,
    revealed: false,
    againCountByCardId,
  };
}

export function shuffleSession(state: FlashcardSessionState, rng: () => number = Math.random): FlashcardSessionState {
  const cardIds = state.cardIds.slice();
  for (let index = cardIds.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.max(0, Math.floor(rng() * (index + 1))));
    [cardIds[index], cardIds[swap]] = [cardIds[swap], cardIds[index]];
  }
  return { ...state, cardIds, currentIndex: 0, revealed: false };
}
