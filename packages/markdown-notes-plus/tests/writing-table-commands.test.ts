function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { EditorState, Selection, type Transaction } from "@milkdown/prose/state";
import { Schema, type Node as ProseNode } from "@milkdown/prose/model";
import {
  findTableLocation,
  insertTableRowAbove,
  insertTableRowBelow,
  deleteTableRow,
  insertTableColumnLeft,
  insertTableColumnRight,
  deleteTableColumn,
  moveTableRowUp,
  moveTableRowDown,
  moveTableColumnLeft,
  moveTableColumnRight,
  setTableColumnAlign,
  handleTableTabNavigation,
  type WritingView,
} from "../src/editor/WritingTableCommands.ts";

const tableSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    table: { group: "block", content: "table_row+", toDOM: () => ["table", ["tbody", 0]] },
    table_row: { content: "table_cell+", toDOM: () => ["tr", 0] },
    table_cell: {
      content: "paragraph+",
      attrs: { align: { default: null } },
      toDOM: () => ["td", 0],
    },
    text: { inline: true },
  },
});

function makeTableDoc() {
  const p = (text: string) => tableSchema.nodes.paragraph.create(null, text ? tableSchema.text(text) : undefined);
  const cell = (text: string) => tableSchema.nodes.table_cell.create(null, p(text));
  const row = (...cells: string[]) => tableSchema.nodes.table_row.create(null, cells.map(cell));

  return tableSchema.nodes.doc.create(null, [
    tableSchema.nodes.table.create(null, [
      row("R1C1", "R1C2"),
      row("R2C1", "R2C2"),
    ]),
  ]);
}

Deno.test("WritingTableCommands - findTableLocation resolves row/col indices and dimensions", () => {
  const doc = makeTableDoc();
  let state = EditorState.create({ doc, schema: tableSchema });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));

  const loc = findTableLocation(state);
  assertEquals(loc !== undefined, true);
  if (loc) {
    assertEquals(loc.rowIndex, 0);
    assertEquals(loc.colIndex, 0);
    assertEquals(loc.rowCount, 2);
    assertEquals(loc.colCount, 2);
  }
});

Deno.test("WritingTableCommands - insert and delete rows", () => {
  const doc = makeTableDoc();
  let state = EditorState.create({ doc, schema: tableSchema });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));

  const view: WritingView = {
    get state() { return state; },
    dispatch: (tr: Transaction) => { state = state.apply(tr); },
  };

  // Insert row below -> table now has 3 rows
  const insertRes = insertTableRowBelow(view);
  assertEquals(insertRes, true);
  const tableNode = state.doc.firstChild!;
  assertEquals(tableNode.childCount, 3);

  // Insert row above -> table now has 4 rows
  const insertAboveRes = insertTableRowAbove(view);
  assertEquals(insertAboveRes, true);
  assertEquals(state.doc.firstChild!.childCount, 4);

  // Delete row -> back to 3 rows
  const delRes = deleteTableRow(view);
  assertEquals(delRes, true);
  assertEquals(state.doc.firstChild!.childCount, 3);
});

Deno.test("WritingTableCommands - insert and delete columns", () => {
  const doc = makeTableDoc();
  let state = EditorState.create({ doc, schema: tableSchema });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));

  const view: WritingView = {
    get state() { return state; },
    dispatch: (tr: Transaction) => { state = state.apply(tr); },
  };

  // Insert column right -> table rows have 3 cells
  const insertColRes = insertTableColumnRight(view);
  assertEquals(insertColRes, true);
  assertEquals(state.doc.firstChild!.child(0).childCount, 3);

  // Insert column left -> table rows have 4 cells
  const insertColLeftRes = insertTableColumnLeft(view);
  assertEquals(insertColLeftRes, true);
  assertEquals(state.doc.firstChild!.child(0).childCount, 4);

  // Delete column -> back to 3 cells
  const delColRes = deleteTableColumn(view);
  assertEquals(delColRes, true);
  assertEquals(state.doc.firstChild!.child(0).childCount, 3);
});

Deno.test("WritingTableCommands - move rows and columns", () => {
  const doc = makeTableDoc();
  let state = EditorState.create({ doc, schema: tableSchema });
  // Focus R1C1
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));

  const view: WritingView = {
    get state() { return state; },
    dispatch: (tr: Transaction) => { state = state.apply(tr); },
  };

  // Move row down
  const moveDownRes = moveTableRowDown(view);
  assertEquals(moveDownRes, true);
  const tableNode = state.doc.firstChild!;
  assertEquals(tableNode.child(0).child(0).textContent, "R2C1");
  assertEquals(tableNode.child(1).child(0).textContent, "R1C1");

  // Move row up (focus row 1)
  let row1Pos = 0;
  state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
    if (node.type.name === "table_cell" && node.textContent === "R1C1") {
      row1Pos = pos + 2;
    }
  });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(row1Pos))));
  const moveUpRes = moveTableRowUp(view);
  assertEquals(moveUpRes, true);
  assertEquals(state.doc.firstChild!.child(0).child(0).textContent, "R1C1");

  // Move col right (focus col 0)
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));
  const moveColRightRes = moveTableColumnRight(view);
  assertEquals(moveColRightRes, true);
  assertEquals(state.doc.firstChild!.child(0).child(0).textContent, "R1C2");
  assertEquals(state.doc.firstChild!.child(0).child(1).textContent, "R1C1");

  // Move col left (focus col 1 where R1C1 now is)
  let col1Pos = 0;
  state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
    if (node.type.name === "table_cell" && node.textContent === "R1C1") {
      col1Pos = pos + 2;
    }
  });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(col1Pos))));
  const moveColLeftRes = moveTableColumnLeft(view);
  assertEquals(moveColLeftRes, true);
  assertEquals(state.doc.firstChild!.child(0).child(0).textContent, "R1C1");
});

Deno.test("WritingTableCommands - setTableColumnAlign modifies column alignment", () => {
  const doc = makeTableDoc();
  let state = EditorState.create({ doc, schema: tableSchema });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));

  const view: WritingView = {
    get state() { return state; },
    dispatch: (tr: Transaction) => { state = state.apply(tr); },
  };

  const alignRes = setTableColumnAlign(view, "center");
  assertEquals(alignRes, true);
  const cell0 = state.doc.firstChild!.child(0).child(0) as ProseNode;
  const cell1 = state.doc.firstChild!.child(1).child(0) as ProseNode;
  assertEquals(cell0.attrs.align, "center");
  assertEquals(cell1.attrs.align, "center");
});

Deno.test("WritingTableCommands - handleTableTabNavigation advances and creates rows at end", () => {
  const doc = makeTableDoc();
  let state = EditorState.create({ doc, schema: tableSchema });

  const view: WritingView = {
    get state() { return state; },
    dispatch: (tr: Transaction) => { state = state.apply(tr); },
  };

  // At R1C1 -> Tab advances to R1C2
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));
  assertEquals(handleTableTabNavigation(view, false), true);

  // Shift+Tab moves back to R1C1
  assertEquals(handleTableTabNavigation(view, true), true);
});
