import type { Node as ProseNode } from "@milkdown/prose/model";
import { WRITING_STRUCTURAL_CONTEXT_META, WRITING_TRANSACTION_ORIGIN_META } from "./WritingEditorLifecycle.ts";

// deno-lint-ignore no-explicit-any
export type WritingView = { state: any; dispatch: (tr: any) => void; [key: string]: any };
// deno-lint-ignore no-explicit-any
export type WritingState = any;
// deno-lint-ignore no-explicit-any
export type WritingTransaction = any;

export type TableLocation = {
  tablePos: number;
  tableNode: ProseNode;
  rowPos: number;
  rowNode: ProseNode;
  rowIndex: number;
  cellPos: number;
  cellNode: ProseNode;
  colIndex: number;
  rowCount: number;
  colCount: number;
};

export function findTableLocation(state: WritingState): TableLocation | undefined {
  const { $from } = state.selection;
  let cellDepth = -1;
  let rowDepth = -1;
  let tableDepth = -1;

  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
      cellDepth = d;
    } else if (node.type.name === "table_row") {
      rowDepth = d;
    } else if (node.type.name === "table") {
      tableDepth = d;
      break;
    }
  }

  if (cellDepth < 0 || rowDepth < 0 || tableDepth < 0) return undefined;

  const tableNode = $from.node(tableDepth);
  const rowNode = $from.node(rowDepth);
  const cellNode = $from.node(cellDepth);

  const tablePos = $from.before(tableDepth);
  const rowPos = $from.before(rowDepth);
  const cellPos = $from.before(cellDepth);

  const rowIndex = $from.index(tableDepth);
  const colIndex = $from.index(rowDepth);
  const rowCount = tableNode.childCount;
  const colCount = rowNode.childCount;

  return {
    tablePos,
    tableNode,
    rowPos,
    rowNode,
    rowIndex,
    cellPos,
    cellNode,
    colIndex,
    rowCount,
    colCount,
  };
}

function createEmptyCell(state: WritingState, isHeader = false): ProseNode {
  const cellType = isHeader ? (state.schema.nodes.table_header ?? state.schema.nodes.table_cell) : state.schema.nodes.table_cell;
  const pType = state.schema.nodes.paragraph;
  return cellType.create(null, pType ? pType.create() : undefined);
}

function createEmptyRow(state: WritingState, colCount: number, isHeader = false): ProseNode {
  const rowType = state.schema.nodes.table_row;
  const cells: ProseNode[] = [];
  for (let i = 0; i < colCount; i += 1) {
    cells.push(createEmptyCell(state, isHeader && i === 0));
  }
  return rowType.create(null, cells);
}

function markTableTransaction(tr: WritingTransaction) {
  tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "table" });
  tr.setMeta(WRITING_STRUCTURAL_CONTEXT_META, { context: "table", version: 1 });
}

export function insertTableRowAbove(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc) return false;

  const newRow = createEmptyRow(state, loc.colCount, false);
  const tr = state.tr;
  tr.insert(loc.rowPos, newRow);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function insertTableRowBelow(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc) return false;

  const insertPos = loc.rowPos + loc.rowNode.nodeSize;
  const newRow = createEmptyRow(state, loc.colCount, false);
  const tr = state.tr;
  tr.insert(insertPos, newRow);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function deleteTableRow(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc || loc.rowCount <= 1) return false;

  const tr = state.tr;
  tr.delete(loc.rowPos, loc.rowPos + loc.rowNode.nodeSize);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function insertTableColumnLeft(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc) return false;

  const newRows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode, _rPos: number, rIndex: number) => {
    const cells: ProseNode[] = [];
    row.forEach((cell: ProseNode) => cells.push(cell));
    const isHeader = rIndex === 0 && row.type.name === "table_row";
    cells.splice(loc.colIndex, 0, createEmptyCell(state, isHeader));
    newRows.push(row.type.create(row.attrs, cells));
  });

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, newRows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function insertTableColumnRight(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc) return false;

  const newRows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode, _rPos: number, rIndex: number) => {
    const cells: ProseNode[] = [];
    row.forEach((cell: ProseNode) => cells.push(cell));
    const isHeader = rIndex === 0;
    cells.splice(loc.colIndex + 1, 0, createEmptyCell(state, isHeader));
    newRows.push(row.type.create(row.attrs, cells));
  });

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, newRows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function deleteTableColumn(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc || loc.colCount <= 1) return false;

  const newRows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode) => {
    const cells: ProseNode[] = [];
    row.forEach((cell: ProseNode) => cells.push(cell));
    cells.splice(loc.colIndex, 1);
    newRows.push(row.type.create(row.attrs, cells));
  });

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, newRows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function moveTableRowUp(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc || loc.rowIndex <= 0) return false;

  const rows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode) => rows.push(row));
  const curr = rows[loc.rowIndex];
  rows[loc.rowIndex] = rows[loc.rowIndex - 1];
  rows[loc.rowIndex - 1] = curr;

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, rows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function moveTableRowDown(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc || loc.rowIndex >= loc.rowCount - 1) return false;

  const rows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode) => rows.push(row));
  const curr = rows[loc.rowIndex];
  rows[loc.rowIndex] = rows[loc.rowIndex + 1];
  rows[loc.rowIndex + 1] = curr;

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, rows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function moveTableColumnLeft(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc || loc.colIndex <= 0) return false;

  const newRows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode) => {
    const cells: ProseNode[] = [];
    row.forEach((cell: ProseNode) => cells.push(cell));
    const curr = cells[loc.colIndex];
    cells[loc.colIndex] = cells[loc.colIndex - 1];
    cells[loc.colIndex - 1] = curr;
    newRows.push(row.type.create(row.attrs, cells));
  });

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, newRows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function moveTableColumnRight(view: WritingView): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc || loc.colIndex >= loc.colCount - 1) return false;

  const newRows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode) => {
    const cells: ProseNode[] = [];
    row.forEach((cell: ProseNode) => cells.push(cell));
    const curr = cells[loc.colIndex];
    cells[loc.colIndex] = cells[loc.colIndex + 1];
    cells[loc.colIndex + 1] = curr;
    newRows.push(row.type.create(row.attrs, cells));
  });

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, newRows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr.scrollIntoView());
  return true;
}

export function setTableColumnAlign(
  view: WritingView,
  align: "left" | "center" | "right" | "none",
): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc) return false;

  const newRows: ProseNode[] = [];
  loc.tableNode.forEach((row: ProseNode) => {
    const cells: ProseNode[] = [];
    row.forEach((cell: ProseNode, _cPos: number, cIndex: number) => {
      if (cIndex === loc.colIndex) {
        cells.push(cell.type.create({
          ...cell.attrs,
          align: align === "none" ? undefined : align,
        }, cell.content));
      } else {
        cells.push(cell);
      }
    });
    newRows.push(row.type.create(row.attrs, cells));
  });

  const newTable = loc.tableNode.type.create(loc.tableNode.attrs, newRows);
  const tr = state.tr;
  tr.replaceWith(loc.tablePos, loc.tablePos + loc.tableNode.nodeSize, newTable);
  markTableTransaction(tr);
  dispatch(tr);
  return true;
}

export function handleTableTabNavigation(view: WritingView, reverse: boolean): boolean {
  const { state, dispatch } = view;
  const loc = findTableLocation(state);
  if (!loc) return false;

  if (reverse) {
    // Shift+Tab: move to previous cell
    if (loc.colIndex > 0) {
      // Previous cell in same row
      let targetPos = loc.rowPos + 1;
      for (let i = 0; i < loc.colIndex - 1; i += 1) {
        targetPos += loc.rowNode.child(i).nodeSize;
      }
      // deno-lint-ignore no-explicit-any
      const tr = state.tr.setSelection((state.selection.constructor as any).near(state.doc.resolve(targetPos + 1)));
      dispatch(tr);
      return true;
    } else if (loc.rowIndex > 0) {
      // Last cell in previous row
      const prevRow = loc.tableNode.child(loc.rowIndex - 1);
      let targetPos = loc.tablePos + 1;
      for (let r = 0; r < loc.rowIndex - 1; r += 1) {
        targetPos += loc.tableNode.child(r).nodeSize;
      }
      targetPos += 1;
      for (let c = 0; c < prevRow.childCount - 1; c += 1) {
        targetPos += prevRow.child(c).nodeSize;
      }
      // deno-lint-ignore no-explicit-any
      const tr = state.tr.setSelection((state.selection.constructor as any).near(state.doc.resolve(targetPos + 1)));
      dispatch(tr);
      return true;
    }
    return false;
  } else {
    // Tab: move to next cell or create new row at end
    if (loc.colIndex < loc.colCount - 1) {
      // Next cell in same row
      let targetPos = loc.rowPos + 1;
      for (let i = 0; i <= loc.colIndex; i += 1) {
        targetPos += loc.rowNode.child(i).nodeSize;
      }
      // deno-lint-ignore no-explicit-any
      const tr = state.tr.setSelection((state.selection.constructor as any).near(state.doc.resolve(targetPos + 1)));
      dispatch(tr);
      return true;
    } else if (loc.rowIndex < loc.rowCount - 1) {
      // First cell in next row
      const nextRowPos = loc.rowPos + loc.rowNode.nodeSize;
      // deno-lint-ignore no-explicit-any
      const tr = state.tr.setSelection((state.selection.constructor as any).near(state.doc.resolve(nextRowPos + 2)));
      dispatch(tr);
      return true;
    } else {
      // Last cell of last row -> Append row and focus first cell
      const insertPos = loc.rowPos + loc.rowNode.nodeSize;
      const newRow = createEmptyRow(state, loc.colCount, false);
      const tr = state.tr;
      tr.insert(insertPos, newRow);
      markTableTransaction(tr);
      // deno-lint-ignore no-explicit-any
      tr.setSelection((state.selection.constructor as any).near(tr.doc.resolve(insertPos + 2)));
      dispatch(tr.scrollIntoView());
      return true;
    }
  }
}
