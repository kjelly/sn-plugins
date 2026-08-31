import React, { useEffect, useRef, useState } from "react";
import type { MarkdownAnalysis } from "../markdown/analysis.ts";
import {
  getAllCollapsibleAnchors,
  getVisibleOutlineHeadings,
  hasDescendantHeadings,
} from "./OutlineProjection.ts";
import { OutlineRow } from "./OutlineRow.tsx";
import type { OutlineDragState } from "./OutlineDragState.ts";
import { siblingSections } from "../markdown/analysis.ts";
import { captureOutlinePointer, createOutlineDragActivationGate, isOutlineDragPointer, outlineDropPlacement, outlineRowAnchorAtPoint } from "./OutlinePointerDrag.ts";

export type OutlinePanelProps = {
  analysis: MarkdownAnalysis;
  activeSectionAnchor?: number;
  focusedSectionAnchor?: number;
  collapsedAnchors: Set<number>;
  readOnly: boolean;
  onToggleFold: (anchor: number) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onSelectHeading: (from: number, to: number) => void;
  onMoveSubtree: (anchor: number, direction: "up" | "down") => void;
  onMoveSubtreeBefore: (sourceAnchor: number, targetAnchor: number) => void;
  onMoveSubtreeAfter: (sourceAnchor: number, targetAnchor: number) => void;
  onPromoteSubtree: (anchor: number) => void;
  onDemoteSubtree: (anchor: number) => void;
  onDuplicateSubtree: (anchor: number) => void;
  onFocusSection?: (anchor: number) => void;
  onCheckAllTasks: (anchor: number) => void;
  onUncheckAllTasks: (anchor: number) => void;
  onDeleteCompletedTasks: (anchor: number) => void;
};

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  analysis,
  activeSectionAnchor,
  focusedSectionAnchor,
  collapsedAnchors,
  readOnly,
  onToggleFold,
  onCollapseAll,
  onExpandAll,
  onSelectHeading,
  onMoveSubtree,
  onMoveSubtreeBefore,
  onMoveSubtreeAfter,
  onPromoteSubtree,
  onDemoteSubtree,
  onDuplicateSubtree,
  onFocusSection,
  onCheckAllTasks,
  onUncheckAllTasks,
  onDeleteCompletedTasks,
}) => {
  const [dragState, setDragState] = useState<OutlineDragState | undefined>();
  const [draggingAnchor, setDraggingAnchor] = useState<number>();
  const dragStateRef = useRef<OutlineDragState | undefined>(dragState);
  const dragSessionRef = useRef<{
    anchor: number;
    pointerId: number;
    gate: ReturnType<typeof createOutlineDragActivationGate>;
    handle: HTMLElement;
    activated: boolean;
  }>();
  const listRef = useRef<HTMLOListElement>(null);
  const analysisRef = useRef(analysis);
  const readOnlyRef = useRef(readOnly);
  const moveBeforeRef = useRef(onMoveSubtreeBefore);
  const moveAfterRef = useRef(onMoveSubtreeAfter);
  const setCurrentDragState = (next: OutlineDragState | undefined) => {
    dragStateRef.current = next;
    setDragState(next);
  };
  analysisRef.current = analysis;
  readOnlyRef.current = readOnly;
  moveBeforeRef.current = onMoveSubtreeBefore;
  moveAfterRef.current = onMoveSubtreeAfter;

  const visibleHeadings = getVisibleOutlineHeadings(analysis, collapsedAnchors);
  const collapsibleAnchors = getAllCollapsibleAnchors(analysis);
  const hasCollapsible = collapsibleAnchors.length > 0;

  const clearDrag = () => {
    const session = dragSessionRef.current;
    if (session) session.gate.up();
    if (session?.handle) session.handle.classList.remove("outline-drag-handle-active");
    dragSessionRef.current = undefined;
    setDraggingAnchor(undefined);
    setCurrentDragState(undefined);
    document.body.classList.remove("outline-pointer-dragging");
  };

  const handleHandlePointerDown = (anchor: number, event: React.PointerEvent) => {
    if (dragSessionRef.current) return;
    if (readOnlyRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const list = listRef.current;
    if (!list) return;
    clearDrag();
    const gate = createOutlineDragActivationGate(globalThis.setTimeout.bind(globalThis), globalThis.clearTimeout.bind(globalThis));
    const session = { anchor, pointerId: event.pointerId, gate, handle, activated: false };
    const activateSession = () => {
      if (dragSessionRef.current !== session || readOnlyRef.current) return;
      session.activated = true;
      event.preventDefault();
      void captureOutlinePointer(handle, event.pointerId);
      handle.classList.add("outline-drag-handle-active");
      document.body.classList.add("outline-pointer-dragging");
      setDraggingAnchor(anchor);
      setCurrentDragState({ draggedAnchor: anchor });
    };
    gate.onActivate(activateSession);
    gate.onCancel(() => {
      if (dragSessionRef.current !== session) return;
      dragSessionRef.current = undefined;
      setDraggingAnchor(undefined);
      setCurrentDragState(undefined);
    });
    dragSessionRef.current = session;
    if (event.pointerType === "mouse") activateSession();
    else gate.start(event.clientX, event.clientY);
  };

  const commitDrop = (session: NonNullable<typeof dragSessionRef.current>, targetAnchor: number, state = dragStateRef.current) => {
    if (!session.activated || readOnlyRef.current || session.anchor === targetAnchor) return;
    const currentAnalysis = analysisRef.current;
    const siblings = siblingSections(currentAnalysis, session.anchor);
    if (!siblings.some((s) => s.anchor === targetAnchor)) return;
    if (state?.draggedAnchor !== session.anchor || state.targetAnchor !== targetAnchor || !state.placement) return;
    if (state.placement === "before") moveBeforeRef.current(session.anchor, targetAnchor);
    else moveAfterRef.current(session.anchor, targetAnchor);
  };

  const updateDropTarget = (session: NonNullable<typeof dragSessionRef.current>, clientX: number, clientY: number): OutlineDragState | undefined => {
    const list = listRef.current;
    if (!list) {
      setCurrentDragState({ draggedAnchor: session.anchor });
      return undefined;
    }
    const targetAnchor = outlineRowAnchorAtPoint(clientX, clientY, list);
    if (targetAnchor === undefined || targetAnchor === session.anchor) {
      setCurrentDragState({ draggedAnchor: session.anchor });
      return undefined;
    }
    const siblings = siblingSections(analysisRef.current, session.anchor);
    if (!siblings.some((s) => s.anchor === targetAnchor)) {
      setCurrentDragState({ draggedAnchor: session.anchor });
      return undefined;
    }
    const row = list.querySelector<HTMLElement>(`.outline-row[data-anchor="${targetAnchor}"]`);
    if (!row) {
      setCurrentDragState({ draggedAnchor: session.anchor });
      return undefined;
    }
    const state: OutlineDragState = {
      draggedAnchor: session.anchor,
      targetAnchor,
      placement: outlineDropPlacement(clientY, row.getBoundingClientRect()),
    };
    setCurrentDragState(state);
    return state;
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || !isOutlineDragPointer(session.pointerId, event.pointerId)) return;
      if (!session.activated) {
        session.gate.move(event.clientX, event.clientY);
        return;
      }
      event.preventDefault();
      updateDropTarget(session, event.clientX, event.clientY);
    };
    const handleUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || !isOutlineDragPointer(session.pointerId, event.pointerId)) return;
      if (session.activated) {
        event.preventDefault();
        const finalState = updateDropTarget(session, event.clientX, event.clientY);
        if (finalState?.targetAnchor !== undefined) commitDrop(session, finalState.targetAnchor, finalState);
      }
      clearDrag();
    };
    const handleCancel = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || !isOutlineDragPointer(session.pointerId, event.pointerId)) return;
      clearDrag();
    };
    globalThis.addEventListener("pointermove", handleMove, { passive: false });
    globalThis.addEventListener("pointerup", handleUp, { passive: false });
    globalThis.addEventListener("pointercancel", handleCancel);
    return () => {
      globalThis.removeEventListener("pointermove", handleMove);
      globalThis.removeEventListener("pointerup", handleUp);
      globalThis.removeEventListener("pointercancel", handleCancel);
      clearDrag();
    };
  }, []);

  return (
    <section className="outline-panel pane-section">
      <div className="panel-heading">
        <h2>Outline ({analysis.headings.length})</h2>
        {hasCollapsible ? (
          <div className="outline-panel-controls">
            <button
              type="button"
              className="outline-control-btn"
              onClick={onCollapseAll}
              title="Collapse all sections"
            >
              Collapse all
            </button>
            <button
              type="button"
              className="outline-control-btn"
              onClick={onExpandAll}
              title="Expand all sections"
            >
              Expand all
            </button>
          </div>
        ) : null}
      </div>

      {visibleHeadings.length ? (
        <ol className="outline-list" ref={listRef}>
          {visibleHeadings.map((heading) => {
            const isCollapsed = collapsedAnchors.has(heading.from);
            const hasChildren = hasDescendantHeadings(analysis, heading.from);
            const isActive = activeSectionAnchor === heading.from;
            const isFocused = focusedSectionAnchor === heading.from;
            const dropPlacement = dragState?.targetAnchor === heading.from ? dragState.placement : undefined;

            return (
              <OutlineRow
                key={heading.from}
                heading={heading}
                analysis={analysis}
                isCollapsed={isCollapsed}
                hasChildren={hasChildren}
                isActive={isActive}
                isFocused={isFocused}
                isDragging={draggingAnchor === heading.from}
                readOnly={readOnly}
                dropPlacement={dropPlacement}
                onToggleFold={onToggleFold}
                onSelectHeading={onSelectHeading}
                onMoveUp={(anchor) => onMoveSubtree(anchor, "up")}
                onMoveDown={(anchor) => onMoveSubtree(anchor, "down")}
                onPromote={onPromoteSubtree}
                onDemote={onDemoteSubtree}
                onDuplicate={onDuplicateSubtree}
                onFocus={onFocusSection}
                onCheckAllTasks={onCheckAllTasks}
                onUncheckAllTasks={onUncheckAllTasks}
                onDeleteCompletedTasks={onDeleteCompletedTasks}
                onHandlePointerDown={handleHandlePointerDown}
              />
            );
          })}
        </ol>
      ) : (
        <p className="empty-hint">No headings yet.</p>
      )}
    </section>
  );
};
