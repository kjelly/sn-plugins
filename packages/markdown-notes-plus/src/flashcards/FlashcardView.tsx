import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { MarkdownAnalysis } from "../markdown/analysis.ts";
import { analyzeFlashcards } from "./FlashcardModel.ts";
import { FlashcardMarkdown } from "./FlashcardMarkdown.tsx";
import {
  createFlashcardSession,
  hideCurrentCard,
  markAgain,
  markKnown,
  nextCard,
  previousCard,
  resetSession,
  revealCurrentCard,
  shuffleSession,
  type FlashcardSessionState,
} from "./FlashcardSession.ts";

export type FlashcardViewProps = {
  markdown: string;
  analysis: MarkdownAnalysis;
  documentIdentity: {
    instanceId: string;
    revision: number;
    generation: number;
  };
};

function shortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLocaleLowerCase();
  return tag === "select" || tag === "input" || tag === "textarea" || tag === "button" || target.isContentEditable;
}

function FlashcardSessionView({ markdown, analysis }: Pick<FlashcardViewProps, "markdown" | "analysis">) {
  const model = useMemo(() => analyzeFlashcards(markdown, analysis), [analysis, markdown]);
  const [scope, setScope] = useState("all");
  const scopeOptions = useMemo(() => {
    const options = model.sections.map((section) => ({
      value: `section:${section.id}`,
      label: section.headingPath.join(" / ") || section.title,
    }));
    const seen = new Set<string>();
    for (const card of model.cards) {
      if (card.headingPath.length === 0) continue;
      const value = `category:${card.sectionId}:${card.categoryAnchor}`;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: `${card.sectionTitle} / ${card.headingPath.join(" / ")}` });
    }
    return options;
  }, [model.cards, model.sections]);
  const cards = useMemo(() => {
    if (scope === "all") return model.cards;
    if (scope.startsWith("section:")) {
      const sectionId = scope.slice("section:".length);
      return model.cards.filter((card) => card.sectionId === sectionId);
    }
    const category = scope.slice("category:".length);
    return model.cards.filter((card) => `${card.sectionId}:${card.categoryAnchor}` === category);
  }, [model.cards, scope]);
  const [session, setSession] = useState<FlashcardSessionState>(() => createFlashcardSession(cards));
  const reset = useCallback(() => setSession(resetSession(cards)), [cards]);

  useEffect(() => {
    if (scope !== "all" && !scopeOptions.some((option) => option.value === scope)) {
      setScope("all");
      return;
    }
    setSession(resetSession(cards));
  }, [cards, scope, scopeOptions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (shortcutTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (event.key === " ") setSession((state) => state.revealed ? hideCurrentCard(state) : revealCurrentCard(state));
      else if (event.key === "ArrowRight") setSession(nextCard);
      else if (event.key === "ArrowLeft") setSession(previousCard);
      else if (key === "k") setSession(markKnown);
      else if (key === "a") setSession(markAgain);
      else if (key === "s") setSession((state) => shuffleSession(state));
      else if (key === "r") reset();
      else return;
      event.preventDefault();
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [reset]);

  const cardsById = useMemo(() => new Map(model.cards.map((card) => [card.id, card])), [model.cards]);
  const current = cardsById.get(session.cardIds[session.currentIndex] ?? "");
  const againCount = [...session.againCountByCardId.values()].reduce((sum, count) => sum + count, 0);

  return <section className="flashcard-view" aria-label="Flashcards study view">
    <div className="flashcard-study-toolbar">
      <h2>Flashcards</h2>
      <label>Section: <select
        aria-label="Flashcard section"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
      >
        <option value="all">All</option>
        {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <button type="button" onClick={() => setSession((state) => shuffleSession(state))} title="Shuffle cards (S)" disabled={session.cardIds.length < 2}>Shuffle</button>
      <button type="button" onClick={reset} title="Reset session (R)" disabled={cards.length === 0}>Reset</button>
    </div>

    {model.cards.length === 0 ? <div className="flashcard-empty">
      <h3>No complete flashcards</h3>
      <p>Add a complete Q: and A: pair below a Q&amp;A heading.</p>
    </div> : cards.length === 0 || !current ? <div className="flashcard-complete" role="status">
      <h3>Session complete</h3>
      <p>All {session.knownCardIds.size} card{session.knownCardIds.size === 1 ? "" : "s"} marked Known.</p>
      <button type="button" onClick={reset}>Reset session</button>
    </div> : <>
      <div className="flashcard-progress" role="status" aria-live="polite">
        <span>{session.currentIndex + 1} / {session.cardIds.length}</span>
        <span>Known: {session.knownCardIds.size}</span>
        <span>Again: {againCount}</span>
      </div>
      <article className="flashcard-card" aria-label="Current flashcard">
        <div className="flashcard-card-meta">{[current.sectionTitle, ...current.headingPath].filter(Boolean).join(" / ")}</div>
        <section className="flashcard-question" aria-label="Flashcard question">
          <h3>Question</h3>
          <div className="flashcard-question-text">{current.question}</div>
        </section>
        <button
          type="button"
          className="flashcard-reveal"
          aria-expanded={session.revealed}
          onClick={() => setSession((state) => state.revealed ? hideCurrentCard(state) : revealCurrentCard(state))}
          title="Show or hide answer (Space)"
        >{session.revealed ? "Hide answer" : "Show answer"}</button>
        {session.revealed ? <section className="flashcard-answer" aria-label="Flashcard answer">
          <h3>Answer</h3>
          <FlashcardMarkdown markdown={current.answerMarkdown} />
        </section> : null}
      </article>
      <div className="flashcard-actions" aria-label="Flashcard study actions">
        <button type="button" onClick={() => setSession(previousCard)} title="Previous card (Left arrow)">Previous</button>
        <button type="button" onClick={() => setSession(markAgain)} title="Study this card again (A)">Again</button>
        <button type="button" onClick={() => setSession(markKnown)} title="Mark this card known (K)">Known</button>
        <button type="button" onClick={() => setSession(nextCard)} title="Next card (Right arrow)">Next</button>
      </div>
    </>}
  </section>;
}

export function FlashcardView(props: FlashcardViewProps) {
  const identity = props.documentIdentity;
  const key = `${identity.instanceId}:${identity.revision}:${identity.generation}`;
  return <FlashcardSessionView key={key} markdown={props.markdown} analysis={props.analysis} />;
}
