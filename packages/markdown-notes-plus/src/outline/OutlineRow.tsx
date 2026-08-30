import React from "react";
import type { HeadingInfo, MarkdownAnalysis } from "../markdown/analysis.ts";
import {
  headingsInSection,
  nextSiblingSection,
  previousSiblingSection,
} from "../markdown/analysis.ts";

export type OutlineRowProps = {
  heading: HeadingInfo;
  analysis: MarkdownAnalysis;
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
  onDragStart: (anchor: number, e: React.DragEvent) => void;
  onDragOver: (anchor: number, e: React.DragEvent) => void;
  onDragLeave: (anchor: number, e: React.DragEvent) => void;
  onDrop: (anchor: number, e: React.DragEvent) => void;
};

export const OutlineRow: React.FC<OutlineRowProps> = ({
  heading,
  analysis,
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
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const section = analysis.sections.find((s) => s.anchor === heading.from);
  const secFrom = section ? section.from : heading.from;
  const secTo = section ? section.to : heading.to;

  const secTasks = analysis.tasks.filter((t) => t.itemStart >= secFrom && t.itemEnd <= secTo);
  const secCompleted = secTasks.filter((t) => t.checked);
  const secOpen = secTasks.filter((t) => !t.checked);

  const subHeadings = headingsInSection(analysis, heading.from);
  const hasSetext = subHeadings.some((h) => h.syntax === "setext");

  const canMoveUp = !readOnly && previousSiblingSection(analysis, heading.from) !== undefined;
  const canMoveDown = !readOnly && nextSiblingSection(analysis, heading.from) !== undefined;
  const canPromote = !readOnly && heading.level > 1 && !hasSetext && heading.syntax === "atx";
  const canDemote = !readOnly && !hasSetext && !subHeadings.some((h) => h.level >= 6) && heading.syntax === "atx";
  const canDuplicate = !readOnly;

  return (
    <li
      className={`level-${heading.level} outline-row ${dropPlacement ? `drop-${dropPlacement}` : ""} ${isActive ? "active-row" : ""} ${isFocused ? "focused-row" : ""}`}
      onDragOver={(e) => onDragOver(heading.from, e)}
      onDragLeave={(e) => onDragLeave(heading.from, e)}
      onDrop={(e) => onDrop(heading.from, e)}
    >
      <div className="outline-row-content">
        <span
          className="outline-drag-handle"
          draggable={!readOnly}
          onDragStart={(e) => onDragStart(heading.from, e)}
          title={readOnly ? undefined : "Drag to reorder sibling section"}
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
          {secTasks.length ? (
            <span className="section-task-badge" title={`${secCompleted.length} of ${secTasks.length} tasks completed`}>
              {secCompleted.length}/{secTasks.length}
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

        {secTasks.length ? (
          <div className="section-task-actions" role="group" aria-label={`Tasks in ${heading.text}`}>
            {secOpen.length ? (
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
            {secCompleted.length ? (
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
