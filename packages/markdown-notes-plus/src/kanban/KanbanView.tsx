import React, { useEffect, useMemo, useState } from "react";
import { analyzeKanban, type KanbanBoard, type KanbanCardRef, type KanbanDropTarget } from "./KanbanModel.ts";
import type { DocumentToken } from "../document/CanonicalDocument.ts";
import type { MarkdownAnalysis } from "../markdown/analysis.ts";

export type KanbanDragPayload = {
  source: KanbanCardRef;
  token: DocumentToken;
};

export type KanbanMoveCommand = KanbanDragPayload & {
  target: KanbanDropTarget;
};

export type KanbanViewProps = {
  markdown: string;
  analysis?: MarkdownAnalysis;
  token: DocumentToken;
  locked?: boolean;
  fallback?: boolean;
  conflicted?: boolean;
  onMove: (command: KanbanMoveCommand) => void;
};

type DragPayload = KanbanDragPayload;

function readDragPayload(event: React.DragEvent): DragPayload | undefined {
  try {
    const value = JSON.parse(event.dataTransfer.getData("application/x-kanban-card")) as Partial<DragPayload> & {
      source?: Partial<KanbanCardRef>;
      token?: Partial<DocumentToken>;
    };
    const source = value.source;
    const token = value.token;
    if (
      source !== undefined &&
      token !== undefined &&
      Number.isInteger(source.boardAnchor) &&
      Number.isInteger(source.cardAnchor) &&
      typeof token.instanceId === "string" &&
      Number.isInteger(token.revision)
    ) {
      return {
        source: { boardAnchor: source.boardAnchor!, cardAnchor: source.cardAnchor! },
        token: { instanceId: token.instanceId, revision: token.revision! },
      };
    }
  } catch {
    // Ignore malformed external drops.
  }
  return undefined;
}

function boardReason(board: KanbanBoard): string {
  return board.reason ?? "This board is source-only.";
}

export function KanbanView({ markdown, analysis, token, locked = false, fallback = false, conflicted = false, onMove }: KanbanViewProps) {
  const model = useMemo(() => analyzeKanban(markdown, analysis), [analysis, markdown]);
  const candidates = model.candidates;
  const [boardAnchor, setBoardAnchor] = useState<number>();
  const board = candidates.find((candidate) => candidate.anchor === boardAnchor) ?? candidates[0];
  const blockedReason = locked ? "Locked note: Kanban is read-only." : fallback ? "Source fallback is active: edit Source to resolve it first." : conflicted ? "Remote conflict is pending: resolve it before moving cards." : undefined;

  useEffect(() => {
    if (board && board.anchor !== boardAnchor) setBoardAnchor(board.anchor);
    else if (!board) setBoardAnchor(undefined);
  }, [board, boardAnchor]);

  if (candidates.length === 0) {
    const sourceOnly = model.boards.find((candidate) => candidate.sourceOnly);
    return <section className="kanban-view" aria-label="Kanban">
      <div className="kanban-empty">
        <h2>Kanban</h2>
        <p>{sourceOnly ? boardReason(sourceOnly) : "Add one heading with direct Backlog, Doing, Review, and Done child headings to use Kanban."}</p>
      </div>
    </section>;
  }

  const canDrop = !blockedReason;
  const beginDrag = (event: React.DragEvent, card: KanbanCardRef) => {
    if (!canDrop) return;
    const payload: DragPayload = {
      source: { boardAnchor: card.boardAnchor, cardAnchor: card.cardAnchor },
      token,
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-kanban-card", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", String(card.cardAnchor));
  };
  const handleDrop = (event: React.DragEvent, target: KanbanDropTarget) => {
    event.preventDefault();
    if (!canDrop) return;
    const payload = readDragPayload(event);
    if (payload) onMove({ ...payload, target });
  };

  return <section className="kanban-view" aria-label="Kanban">
    <div className="kanban-toolbar">
      <h2>Kanban</h2>
      {candidates.length > 1 ? <label>Board <select aria-label="Kanban board" value={board?.anchor ?? ""} onChange={(event) => setBoardAnchor(Number(event.target.value))}>{candidates.map((candidate) => <option key={candidate.anchor} value={candidate.anchor}>{candidate.title || "Untitled board"}</option>)}</select></label> : <span className="kanban-board-title">{board?.title || "Untitled board"}</span>}
      {blockedReason ? <span className="kanban-blocked" role="status">{blockedReason}</span> : <span className="kanban-hint">Drag cards between columns</span>}
    </div>
    <div className="kanban-columns" data-kanban-board={board?.anchor}>
      {board?.columns.map((column) => <section className="kanban-column" key={column.anchor} data-kanban-column={column.anchor} aria-label={column.name}>
        <header className="kanban-column-header"><h3>{column.name}</h3><span>{column.cards.length}</span></header>
        <div
          className={`kanban-drop-zone ${canDrop && column.dropAllowed ? "enabled" : "disabled"}`}
          onDragOver={(event) => { if (canDrop && column.dropAllowed) event.preventDefault(); }}
          onDrop={(event) => handleDrop(event, { boardAnchor: board.anchor, columnAnchor: column.anchor })}
        >
          {column.cards.map((card) => <article
            className={`kanban-card ${card.movable && canDrop ? "movable" : "source-only"}`}
            key={card.cardAnchor}
            draggable={card.movable && canDrop}
            aria-disabled={card.movable && canDrop ? undefined : "true"}
            data-kanban-source-only-reason={card.movable ? undefined : card.reason ?? "Source-only card"}
            data-kanban-card={card.cardAnchor}
            onDragStart={(event) => beginDrag(event, card)}
            title={card.reason ?? "Drag to move"}
          >
            <div
              className="kanban-card-drop-before"
              aria-hidden="true"
              onDragOver={(event) => { event.stopPropagation(); if (canDrop && column.dropAllowed) event.preventDefault(); }}
              onDrop={(event) => { event.stopPropagation(); handleDrop(event, { boardAnchor: board.anchor, columnAnchor: column.anchor, beforeCardAnchor: card.cardAnchor }); }}
            />
            <label><input type="checkbox" checked={card.checked} readOnly /> <span>{card.text || "Untitled task"}</span></label>
            {!card.movable ? <span className="kanban-card-reason" role="note">{card.reason ?? "Source-only card; edit this task in Source mode."}</span> : null}
          </article>)}
        </div>
      </section>)}
    </div>
  </section>;
}
