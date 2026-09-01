import { analyzeMarkdown, type CommandResult, type MarkdownAnalysis } from "../markdown/analysis.ts";
import { createTextChangeSet, type TextChange } from "../document/PositionMap.ts";
import { analyzeKanban, type KanbanCardRef, type KanbanDropTarget, type KanbanModel } from "./KanbanModel.ts";

export type KanbanMoveSnapshot = {
  markdown: string;
  analysis?: MarkdownAnalysis;
  locked?: boolean;
  fallback?: boolean;
  conflicted?: boolean;
};

type SnapshotLike = KanbanMoveSnapshot | KanbanModel | string;

function snapshotParts(snapshot: SnapshotLike): { markdown: string; analysis?: MarkdownAnalysis; blocked: boolean } {
  if (typeof snapshot === "string") return { markdown: snapshot, blocked: false };
  const flags = snapshot as Partial<KanbanMoveSnapshot>;
  return {
    markdown: snapshot.markdown,
    analysis: "analysis" in snapshot ? snapshot.analysis : undefined,
    blocked: Boolean(flags.locked || flags.fallback || flags.conflicted),
  };
}

function afterRemoval(offset: number, from: number, to: number): number | undefined {
  if (offset < from) return offset;
  if (offset >= to) return offset - (to - from);
  return undefined;
}

function headingEnd(analysis: MarkdownAnalysis, anchor: number): number | undefined {
  const heading = analysis.headings.find((candidate) => candidate.from === anchor);
  if (!heading) return undefined;
  const headingEndLine = analysis.physicalLines.find((line) => line.eolTo === heading.headingTo);
  return headingEndLine?.eolKind === "none" ? undefined : headingEndLine ? heading.headingTo : undefined;
}

function eofHeadingSeparator(analysis: MarkdownAnalysis, anchor: number): string | undefined {
  const heading = analysis.headings.find((candidate) => candidate.from === anchor);
  if (!heading) return undefined;
  const terminalLineIndex = analysis.physicalLines.findIndex((line) => line.eolTo === heading.headingTo);
  const terminalLine = terminalLineIndex < 0 ? undefined : analysis.physicalLines[terminalLineIndex];
  if (!terminalLine || terminalLine.eolKind !== "none" || terminalLine.eolTo !== analysis.physicalLines.at(-1)?.eolTo) return undefined;
  for (const line of [analysis.physicalLines[terminalLineIndex - 1], analysis.physicalLines[terminalLineIndex + 1]]) {
    if (line?.eolKind === "CRLF") return "\r\n";
    if (line?.eolKind === "LF") return "\n";
  }
  return "\n";
}

function cardByAnchor(model: KanbanModel, boardAnchor: number, cardAnchor: number) {
  const board = model.boards.find((candidate) => candidate.anchor === boardAnchor && candidate.valid);
  return board ? { board, card: board.columns.flatMap((column) => column.cards).find((candidate) => candidate.cardAnchor === cardAnchor) } : undefined;
}

/** Move one canonical Markdown task subtree while recomputing destination coordinates after deletion. */
export function moveKanbanCard(snapshot: SnapshotLike, source: KanbanCardRef, target: KanbanDropTarget): CommandResult {
  const { markdown, analysis: suppliedAnalysis, blocked } = snapshotParts(snapshot);
  if (blocked) return { markdown, changed: false };
  const model = analyzeKanban(markdown, suppliedAnalysis);
  if (source.boardAnchor !== target.boardAnchor) return { markdown, changed: false };
  const sourceEntry = cardByAnchor(model, source.boardAnchor, source.cardAnchor);
  const board = model.boards.find((candidate) => candidate.anchor === source.boardAnchor && candidate.valid);
  const sourceCard = sourceEntry?.card;
  if (!board || !sourceCard?.movable || !sourceCard.payload) return { markdown, changed: false };
  const sourceColumn = board.columns.find((column) => column.anchor === sourceCard.columnAnchor);
  const targetColumnBefore = board.columns.find((column) => column.anchor === target.columnAnchor);
  if (!sourceColumn || !targetColumnBefore || !targetColumnBefore.dropAllowed) return { markdown, changed: false };
  if (target.beforeCardAnchor === source.cardAnchor) return { markdown, changed: false };

  const sourceIndex = sourceColumn.cards.findIndex((card) => card.cardAnchor === source.cardAnchor);
  if (sourceIndex < 0) return { markdown, changed: false };
  const targetCardBefore = target.beforeCardAnchor === undefined
    ? undefined
    : targetColumnBefore.cards.find((card) => card.cardAnchor === target.beforeCardAnchor);
  if (target.beforeCardAnchor !== undefined && !targetCardBefore) return { markdown, changed: false };
  const requestedIndex = targetCardBefore
    ? targetColumnBefore.cards.findIndex((card) => card.cardAnchor === targetCardBefore.cardAnchor)
    : Math.max(0, Math.min(target.index ?? targetColumnBefore.cards.length, targetColumnBefore.cards.length));
  if (requestedIndex < 0) return { markdown, changed: false };
  if (sourceColumn.anchor === targetColumnBefore.anchor) {
    const destinationIndex = requestedIndex - (sourceIndex < requestedIndex ? 1 : 0);
    if (destinationIndex === sourceIndex) return { markdown, changed: false };
  }

  const payload = markdown.slice(sourceCard.payload.from, sourceCard.payload.to);
  const reduced = markdown.slice(0, sourceCard.payload.from) + markdown.slice(sourceCard.payload.to);
  const reducedAnalysis = analyzeMarkdown(reduced);
  const reducedModel = analyzeKanban(reduced, reducedAnalysis);
  const reducedBoardAnchor = afterRemoval(board.anchor, sourceCard.payload.from, sourceCard.payload.to);
  const reducedColumnAnchor = afterRemoval(targetColumnBefore.anchor, sourceCard.payload.from, sourceCard.payload.to);
  if (reducedBoardAnchor === undefined || reducedColumnAnchor === undefined) return { markdown, changed: false };
  const reducedBoard = reducedModel.boards.find((candidate) => candidate.anchor === reducedBoardAnchor && candidate.valid);
  const reducedColumn = reducedBoard?.columns.find((column) => column.anchor === reducedColumnAnchor);
  if (!reducedBoard || !reducedColumn || !reducedColumn.dropAllowed) return { markdown, changed: false };

  let insertion: number | undefined;
  let insertionSeparator = "";
  if (targetCardBefore) {
    const reducedTargetAnchor = afterRemoval(targetCardBefore.cardAnchor, sourceCard.payload.from, sourceCard.payload.to);
    if (reducedTargetAnchor === undefined) return { markdown, changed: false };
    const reducedTarget = reducedColumn.cards.find((card) => card.cardAnchor === reducedTargetAnchor);
    insertion = reducedTarget?.cardAnchor;
  } else {
    const reducedCards = reducedColumn.cards;
    const reducedIndex = sourceColumn.anchor === targetColumnBefore.anchor
      ? Math.max(0, Math.min(requestedIndex - (sourceIndex < requestedIndex ? 1 : 0), reducedCards.length))
      : Math.max(0, Math.min(requestedIndex, reducedCards.length));
    if (reducedCards[reducedIndex]) insertion = reducedCards[reducedIndex].cardAnchor;
    else if (reducedCards.length > 0) {
      const last = reducedCards[reducedCards.length - 1];
      if (!last.payload) return { markdown, changed: false };
      insertion = last.payload.to;
    } else {
      insertion = headingEnd(reducedAnalysis, reducedColumn.anchor);
      if (insertion === undefined) {
        insertion = reducedAnalysis.headings.find((heading) => heading.from === reducedColumn.anchor)?.headingTo;
        insertionSeparator = insertion === undefined ? "" : eofHeadingSeparator(reducedAnalysis, reducedColumn.anchor) ?? "";
      }
    }
  }
  if (insertion === undefined || insertion < 0 || insertion > reduced.length) return { markdown, changed: false };
  if (insertion > 0 && insertion < reduced.length && reduced[insertion - 1] !== "\n" && reduced[insertion - 1] !== "\r") return { markdown, changed: false };
  const inserted = insertionSeparator + payload;
  const nextMarkdown = reduced.slice(0, insertion) + inserted + reduced.slice(insertion);
  if (nextMarkdown === markdown) return { markdown, changed: false };

  const oldInsertion = insertion < sourceCard.payload.from ? insertion : insertion + (sourceCard.payload.to - sourceCard.payload.from);
  if (oldInsertion === sourceCard.payload.from || oldInsertion === sourceCard.payload.to) return { markdown, changed: false };
  const changes: TextChange[] = [
    { from: sourceCard.payload.from, to: sourceCard.payload.to, insertedLength: 0 },
    { from: oldInsertion, to: oldInsertion, insertedLength: inserted.length },
  ].sort((left, right) => left.from - right.from || left.to - right.to);
  if (changes[1].from < changes[0].to) return { markdown, changed: false };
  const changeSet = createTextChangeSet(markdown.length, nextMarkdown.length, changes);
  if (!changeSet) return { markdown, changed: false };
  return { markdown: nextMarkdown, changed: true, changeSet };
}
