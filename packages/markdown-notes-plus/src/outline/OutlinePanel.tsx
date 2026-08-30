import React, { useState } from "react";
import type { MarkdownAnalysis } from "../markdown/analysis.ts";
import {
  getAllCollapsibleAnchors,
  getVisibleOutlineHeadings,
  hasDescendantHeadings,
} from "./OutlineProjection.ts";
import { OutlineRow } from "./OutlineRow.tsx";
import type { OutlineDragState } from "./OutlineDragState.ts";
import { siblingSections } from "../markdown/analysis.ts";

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

  const visibleHeadings = getVisibleOutlineHeadings(analysis, collapsedAnchors);
  const collapsibleAnchors = getAllCollapsibleAnchors(analysis);
  const hasCollapsible = collapsibleAnchors.length > 0;

  const handleDragStart = (anchor: number, e: React.DragEvent) => {
    if (readOnly) return;
    e.dataTransfer.setData("text/plain", String(anchor));
    e.dataTransfer.effectAllowed = "move";
    setDragState({ draggedAnchor: anchor });
  };

  const handleDragOver = (targetAnchor: number, e: React.DragEvent) => {
    if (!dragState || dragState.draggedAnchor === targetAnchor || readOnly) return;

    // Check if target is a sibling of dragged anchor
    const siblings = siblingSections(analysis, dragState.draggedAnchor);
    const isSibling = siblings.some((s) => s.anchor === targetAnchor);
    if (!isSibling) {
      if (dragState.targetAnchor !== undefined) {
        setDragState({ draggedAnchor: dragState.draggedAnchor });
      }
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const placement: "before" | "after" = e.clientY < midY ? "before" : "after";

    if (dragState.targetAnchor !== targetAnchor || dragState.placement !== placement) {
      setDragState({
        draggedAnchor: dragState.draggedAnchor,
        targetAnchor,
        placement,
      });
    }
  };

  const handleDragLeave = (targetAnchor: number, e: React.DragEvent) => {
    if (dragState?.targetAnchor === targetAnchor) {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || !e.currentTarget.contains(related)) {
        setDragState({ draggedAnchor: dragState.draggedAnchor });
      }
    }
  };

  const handleDrop = (targetAnchor: number, e: React.DragEvent) => {
    e.preventDefault();
    if (!dragState || dragState.draggedAnchor === targetAnchor || readOnly) {
      setDragState(undefined);
      return;
    }

    const siblings = siblingSections(analysis, dragState.draggedAnchor);
    const isSibling = siblings.some((s) => s.anchor === targetAnchor);
    if (isSibling) {
      const placement = dragState.placement ?? "before";
      if (placement === "before") {
        onMoveSubtreeBefore(dragState.draggedAnchor, targetAnchor);
      } else {
        onMoveSubtreeAfter(dragState.draggedAnchor, targetAnchor);
      }
    }
    setDragState(undefined);
  };

  const handleDragEnd = () => {
    setDragState(undefined);
  };

  return (
    <section className="outline-panel pane-section" onDragEnd={handleDragEnd}>
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
        <ol className="outline-list">
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
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
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
