function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { EditorState, Selection, type Transaction } from "@milkdown/prose/state";
import { Schema } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { createWritingShortcutsPlugin } from "../src/editor/WritingShortcuts.ts";
import { createWritingSmartKeysPlugin } from "../src/editor/WritingSmartKeys.ts";

const fullSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    bullet_list: { group: "block", content: "list_item+", toDOM: () => ["ul", 0] },
    list_item: { content: "paragraph block*", toDOM: () => ["li", 0] },
    code_block: { group: "block", content: "text*", toDOM: () => ["pre", ["code", 0]] },
    text: { inline: true },
  },
});

Deno.test("WritingShortcuts - Alt+Left / Alt+Right promotes and demotes headings", () => {
  const doc = fullSchema.nodes.doc.create(null, [
    fullSchema.nodes.heading.create({ level: 2 }, fullSchema.text("My Heading")),
  ]);

  let state = EditorState.create({ doc, schema: fullSchema });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(4))));

  const plugin = createWritingShortcutsPlugin();
  let dispatched = false;
  const view = {
    get state() { return state; },
    dispatch: (tr: Transaction) => {
      state = state.apply(tr);
      dispatched = true;
    },
  } as unknown as EditorView;

  // Alt+Left promotes H2 to H1
  let prevented = false;
  const eventPromote = {
    key: "ArrowLeft",
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;

  // deno-lint-ignore no-explicit-any
  const handler = plugin.props.handleKeyDown as any;
  const handledPromote = handler ? handler.call(plugin, view, eventPromote) : false;
  assertEquals(handledPromote, true);
  assertEquals(prevented, true);
  assertEquals(dispatched, true);
  assertEquals(state.doc.firstChild!.attrs.level, 1);

  // Alt+Right demotes H1 to H2
  const eventDemote = {
    key: "ArrowRight",
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => {},
  } as unknown as KeyboardEvent;

  const handledDemote = handler ? handler.call(plugin, view, eventDemote) : false;
  assertEquals(handledDemote, true);
  assertEquals(state.doc.firstChild!.attrs.level, 2);
});

Deno.test("WritingSmartKeys - Smart Enter on empty list item lifts out to paragraph", () => {
  const doc = fullSchema.nodes.doc.create(null, [
    fullSchema.nodes.bullet_list.create(null, [
      fullSchema.nodes.list_item.create(null, fullSchema.nodes.paragraph.create(null, fullSchema.text("First"))),
      fullSchema.nodes.list_item.create(null, fullSchema.nodes.paragraph.create()),
    ]),
  ]);

  // Position inside empty paragraph in 2nd list_item
  let state = EditorState.create({ doc, schema: fullSchema });
  state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(10))));

  const plugin = createWritingSmartKeysPlugin();
  let prevented = false;
  const view = {
    get state() { return state; },
    dispatch: (tr: Transaction) => {
      state = state.apply(tr);
    },
  } as unknown as EditorView;

  const eventEnter = {
    key: "Enter",
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;

  // deno-lint-ignore no-explicit-any
  const handler = plugin.props.handleKeyDown as any;
  const handled = handler ? handler.call(plugin, view, eventEnter) : false;
  assertEquals(handled, true);
  assertEquals(prevented, true);
  // 2nd item should now be lifted out of list
  assertEquals(state.doc.childCount, 2);
  assertEquals(state.doc.child(1).type.name, "paragraph");
});
