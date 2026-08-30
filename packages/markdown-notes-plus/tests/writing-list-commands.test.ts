function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { EditorState, Selection, type Transaction } from "@milkdown/prose/state";
import { Schema, type Node as ProseNode } from "@milkdown/prose/model";
import {
  moveListItemUp,
  moveListItemDown,
  type WritingView,
} from "../src/editor/WritingListCommands.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    bullet_list: { group: "block", content: "list_item+", toDOM: () => ["ul", 0] },
    list_item: { content: "paragraph block*", toDOM: () => ["li", 0] },
    text: { inline: true },
  },
});

Deno.test("WritingListCommands - detects first item move up is false", () => {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.bullet_list.create(null, [
      schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("Item 1"))),
      schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("Item 2"))),
    ]),
  ]);

  const state = EditorState.create({ doc, schema });
  let dispatched = false;
  const view: WritingView = {
    state,
    dispatch: (_tr: Transaction) => { dispatched = true; },
  };

  const result = moveListItemUp(view);
  assertEquals(result, false);
  assertEquals(dispatched, false);
});

Deno.test("WritingListCommands - moves middle item up and down", () => {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.bullet_list.create(null, [
      schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("Item 1"))),
      schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("Item 2"))),
      schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("Item 3"))),
    ]),
  ]);

  let currentState = EditorState.create({ doc, schema });
  currentState = currentState.apply(currentState.tr.setSelection(Selection.near(currentState.doc.resolve(14))));

  let dispatchedDoc: ProseNode | undefined = undefined;
  const view: WritingView = {
    get state() { return currentState; },
    dispatch: (tr: Transaction) => {
      currentState = currentState.apply(tr);
      dispatchedDoc = currentState.doc;
    },
  };

  // Move Item 2 up -> [Item 2, Item 1, Item 3]
  const upResult = moveListItemUp(view);
  assertEquals(upResult, true);
  assertEquals(dispatchedDoc !== undefined, true);

  if (dispatchedDoc) {
    const listNode = (dispatchedDoc as ProseNode).firstChild!;
    assertEquals(listNode.child(0).textContent, "Item 2");
    assertEquals(listNode.child(1).textContent, "Item 1");
    assertEquals(listNode.child(2).textContent, "Item 3");
  }

  // Move Item 2 down -> [Item 1, Item 2, Item 3]
  const downResult = moveListItemDown(view);
  assertEquals(downResult, true);
  const listNodeAfter = currentState.doc.firstChild!;
  assertEquals(listNodeAfter.child(0).textContent, "Item 1");
  assertEquals(listNodeAfter.child(1).textContent, "Item 2");
  assertEquals(listNodeAfter.child(2).textContent, "Item 3");
});
