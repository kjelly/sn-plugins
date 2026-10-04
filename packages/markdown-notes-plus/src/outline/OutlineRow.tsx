import React from "react";
import type { HeadingInfo } from "../markdown/analysis.ts";
import type { OutlineSectionFacts } from "./OutlineProjection.ts";

export type OutlineRowProps = {
  heading: HeadingInfo;
  facts: OutlineSectionFacts;
  isCollapsed: boolean;
  hasChildren: boolean;
  isActive: boolean;
  isFocused?: boolean;
  readOnly: boolean;
  dropPlacement?: "before" | "after";
  onToggleFold: (anchor: number) => void;
  onSelectHeading: (from: number, to: number) => void;
  onMoveUp: (anchor: number) => void;
  onMoveDown: (anchor: number) => void;
  onPromote: (anchor: number) => void;
  onDemote: (anchor: number) => void;
  onDuplicate: (anchor: number) => void;
  onFocus?: (anchor: number) => void;
  onCheckAllTasks: (anchor: number) => void;
  onUncheckAllTasks: (anchor: number) => void;
  onDeleteCompletedTasks: (anchor: number) => void;
  onHandlePointerDown: (anchor: number, e: React.PointerEvent) => void;
  isDragging?: boolean;
};

export const OutlineRow: React.FC<OutlineRowProps> = ({
  heading,
  facts,
  isCollapsed,
  hasChildren,
  isActive,
  isFocused,
  readOnly,
  dropPlacement,
  onToggleFold,
  onSelectHeading,
  onMoveUp,
  onMoveDown,
  onPromote,
  onDemote,
  onDuplicate,
  onFocus,
  onCheckAllTasks,
  onUncheckAllTasks,
  onDeleteCompletedTasks,
  onHandlePointerDown,
  isDragging,
}) => {
  const canMoveUp = !readOnly && facts.hasPreviousSibling;
  const canMoveDown = !readOnly && facts.hasNextSibling;
  const canPromote = !readOnly && heading.level > 1 && !facts.hasSetext && heading.syntax === "atx";
  const canDemote = !readOnly && !facts.hasSetext && !facts.hasLevelSix && heading.syntax === "atx";
  const canDuplicate = !readOnly;

  return (
    <li
      data-anchor={heading.from}
      className={`level-${heading.level} outline-row ${dropPlacement ? `drop-${dropPlacement}` : ""} ${isActive ? "active-row" : ""} ${isFocused ? "focused-row" : ""} ${isDragging ? "dragging" : ""}`}
    >
      <div className="outline-row-content">
        <span
          className="outline-drag-handle"
          onPointerDown={(e) => onHandlePointerDown(heading.from, e)}
          title={readOnly ? undefined : "Hold, then drag to reorder sibling section"}
        >
          ⠿
        </span>

        {hasChildren ? (
          <button
            type="button"
            className="outline-fold-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFold(heading.from);
            }}
            title={isCollapsed ? "Expand section" : "Collapse section"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? "▸" : "▾"}
          </button>
        ) : (
          <span className="outline-fold-placeholder" />
        )}

        <button
          type="button"
          className={`outline-heading-btn ${isActive ? "active-heading" : ""}`}
          onClick={() => onSelectHeading(heading.from, heading.to)}
          title={`Level ${heading.level}: ${heading.text}`}
        >
          <span className="outline-heading-text">{heading.text}</span>
          {facts.taskCount ? (
            <span className="section-task-badge" title={`${facts.completedCount} of ${facts.taskCount} tasks completed`}>
              {facts.completedCount}/{facts.taskCount}
            </span>
          ) : null}
        </button>

        <div className="outline-structural-actions" role="group" aria-label={`Structural actions for ${heading.text}`}>
          <button
            type="button"
            className="outline-action-btn"
            title="Move section up (Alt+Up)"
            disabled={!canMoveUp}
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp(heading.from);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="outline-action-btn"
            title="Move section down (Alt+Down)"
            disabled={!canMoveDown}
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown(heading.from);
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="outline-action-btn"
            title="Promote subtree (Alt+Left)"
            disabled={!canPromote}
            onClick={(e) => {
              e.stopPropagation();
              onPromote(heading.from);
            }}
          >
            ←
          </button>
          <button
            type="button"
            className="outline-action-btn"
            title="Demote subtree (Alt+Right)"
            disabled={!canDemote}
            onClick={(e) => {
              e.stopPropagation();
              onDemote(heading.from);
            }}
          >
            →
          </button>
          <button
            type="button"
            className="outline-action-btn"
            title="Duplicate subtree"
            disabled={!canDuplicate}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(heading.from);
            }}
          >
            ⧉
          </button>
          {onFocus ? (
            <button
              type="button"
              className="outline-action-btn"
              title={isFocused ? "Exit section focus" : "Focus this section"}
              onClick={(e) => {
                e.stopPropagation();
                onFocus(heading.from);
              }}
            >
              🎯
            </button>
          ) : null}
        </div>

        {facts.taskCount ? (
          <div className="section-task-actions" role="group" aria-label={`Tasks in ${heading.text}`}>
            {facts.openCount ? (
              <button
                type="button"
                title="Check all in this section"
                disabled={readOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckAllTasks(heading.from);
                }}
              >
                ☑
              </button>
            ) : null}
            {facts.completedCount ? (
              <>
                <button
                  type="button"
                  title="Uncheck all in this section"
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUncheckAllTasks(heading.from);
                  }}
                >
                  ☐
                </button>
                <button
                  type="button"
                  className="delete-btn"
                  title="Delete completed in this section"
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCompletedTasks(heading.from);
                  }}
                >
                  🗑
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
};
