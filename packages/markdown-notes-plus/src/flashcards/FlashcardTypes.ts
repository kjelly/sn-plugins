export type FlashcardSourceRange = {
  from: number;
  to: number;
};

export type FlashcardSection = {
  id: string;
  title: string;
  headingPath: string[];
  headingLevel: number;
  sourceRange: FlashcardSourceRange;
};

export type Flashcard = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  headingPath: string[];
  categoryAnchor?: number;
  question: string;
  answerMarkdown: string;
  questionRange: FlashcardSourceRange;
  answerRange: FlashcardSourceRange;
  sourceRange: FlashcardSourceRange;
};

export type FlashcardModel = {
  markdown: string;
  sections: FlashcardSection[];
  cards: Flashcard[];
};
