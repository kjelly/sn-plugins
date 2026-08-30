import React from "react";
import type { EditorView } from "@milkdown/prose/view";
import {
  deleteTableColumn,
  deleteTableRow,
  findTableLocation,
  insertTableColumnLeft,
  insertTableColumnRight,
  insertTableRowAbove,
  insertTableRowBelow,
  moveTableColumnLeft,
  moveTableColumnRight,
  moveTableRowDown,
  moveTableRowUp,
  setTableColumnAlign,
} from "./WritingTableCommands.ts";

export type WritingTableControlsProps = {
  view?: EditorView;
  readOnly: boolean;
};

export const WritingTableControls: React.FC<WritingTableControlsProps> = ({
  view,
  readOnly,
}) => {
  if (!view || readOnly) return null;
  const loc = findTableLocation(view.state);
  if (!loc) return null;

  return (
    <div className="writing-table-controls" role="toolbar" aria-label="Table editing tools">
      <div className="table-controls-group">
        <span className="table-controls-label">Row:</span>
        <button
          type="button"
          title="Insert row above"
          onClick={() => insertTableRowAbove(view)}
        >
          +↑
        </button>
        <button
          type="button"
          title="Insert row below"
          onClick={() => insertTableRowBelow(view)}
        >
          +↓
        </button>
        <button
          type="button"
          title="Move row up"
          disabled={loc.rowIndex <= 0}
          onClick={() => moveTableRowUp(view)}
        >
          ↑
        </button>
        <button
          type="button"
          title="Move row down"
          disabled={loc.rowIndex >= loc.rowCount - 1}
          onClick={() => moveTableRowDown(view)}
        >
          ↓
        </button>
        <button
          type="button"
          className="delete-btn"
          title="Delete row"
          disabled={loc.rowCount <= 1}
          onClick={() => deleteTableRow(view)}
        >
          🗑
        </button>
      </div>

      <div className="table-controls-group">
        <span className="table-controls-label">Col:</span>
        <button
          type="button"
          title="Insert column left"
          onClick={() => insertTableColumnLeft(view)}
        >
          +←
        </button>
        <button
          type="button"
          title="Insert column right"
          onClick={() => insertTableColumnRight(view)}
        >
          +→
        </button>
        <button
          type="button"
          title="Move column left"
          disabled={loc.colIndex <= 0}
          onClick={() => moveTableColumnLeft(view)}
        >
          ←
        </button>
        <button
          type="button"
          title="Move column right"
          disabled={loc.colIndex >= loc.colCount - 1}
          onClick={() => moveTableColumnRight(view)}
        >
          →
        </button>
        <button
          type="button"
          className="delete-btn"
          title="Delete column"
          disabled={loc.colCount <= 1}
          onClick={() => deleteTableColumn(view)}
        >
          🗑
        </button>
      </div>

      <div className="table-controls-group">
        <span className="table-controls-label">Align:</span>
        <button
          type="button"
          title="Align column left"
          onClick={() => setTableColumnAlign(view, "left")}
        >
          ⇤
        </button>
        <button
          type="button"
          title="Align column center"
          onClick={() => setTableColumnAlign(view, "center")}
        >
          ↔
        </button>
        <button
          type="button"
          title="Align column right"
          onClick={() => setTableColumnAlign(view, "right")}
        >
          ⇥
        </button>
      </div>
    </div>
  );
};
