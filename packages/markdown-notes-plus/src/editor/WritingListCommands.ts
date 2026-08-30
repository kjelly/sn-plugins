import type { Node as ProseNode } from "@milkdown/prose/model";
import { liftListItem as pmLiftListItem, sinkListItem as pmSinkListItem } from "@milkdown/prose/schema-list";
import { WRITING_TRANSACTION_ORIGIN_META } from "./WritingEditorLifecycle.ts";

// deno-lint-ignore no-explicit-any
export type WritingView = { state: any; dispatch: (tr: any) => void; [key: string]: any };
// deno-lint-ignore no-explicit-any
export type WritingState = any;
// deno-lint-ignore no-explicit-any
export type WritingTransaction = any;

function findParentListItem(state: WritingState): {
  itemPos: number;
  itemNode: ProseNode;
  listPos: number;
  listNode: ProseNode;
  indexInList: number;
} | undefined {
  const { $from } = state.selection;
  let itemDepth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name === "list_item") {
      itemDepth = d;
      break;
    }
  }
  if (itemDepth <= 0) return undefined;

  const itemNode = $from.node(itemDepth);
  const itemPos = $from.before(itemDepth);
  const listDepth = itemDepth - 1;
  const listNode = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const indexInList = $from.index(listDepth);

  return { itemPos, itemNode, listPos, listNode, indexInList };
}

/**
 * Move the current list item up before its previous sibling list item.
 */
export function moveListItemUp(view: WritingView): boolean {
  const { state, dispatch } = view;
  const found = findParentListItem(state);
  if (!found || found.indexInList <= 0) return false;

  const items: ProseNode[] = [];
  found.listNode.forEach((child: ProseNode) => items.push(child));

  const curr = items[found.indexInList];
  const prev = items[found.indexInList - 1];
  items[found.indexInList - 1] = curr;
  items[found.indexInList] = prev;

  const newListNode = found.listNode.type.create(found.listNode.attrs, items);
  const tr = state.tr;
  tr.replaceWith(found.listPos, found.listPos + found.listNode.nodeSize, newListNode);

  // Position cursor inside the moved item
  let targetPos = found.listPos + 1;
  for (let i = 0; i < found.indexInList - 1; i += 1) {
    targetPos += items[i].nodeSize;
  }
  // deno-lint-ignore no-explicit-any
  tr.setSelection((state.selection.constructor as any).near(tr.doc.resolve(targetPos + 2)));
  tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "bullet" });
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Move the current list item down after its next sibling list item.
 */
export function moveListItemDown(view: WritingView): boolean {
  const { state, dispatch } = view;
  const found = findParentListItem(state);
  if (!found || found.indexInList >= found.listNode.childCount - 1) return false;

  const items: ProseNode[] = [];
  found.listNode.forEach((child: ProseNode) => items.push(child));

  const curr = items[found.indexInList];
  const next = items[found.indexInList + 1];
  items[found.indexInList] = next;
  items[found.indexInList + 1] = curr;

  const newListNode = found.listNode.type.create(found.listNode.attrs, items);
  const tr = state.tr;
  tr.replaceWith(found.listPos, found.listPos + found.listNode.nodeSize, newListNode);

  // Position cursor inside the moved item
  let targetPos = found.listPos + 1;
  for (let i = 0; i <= found.indexInList; i += 1) {
    targetPos += items[i].nodeSize;
  }
  // deno-lint-ignore no-explicit-any
  tr.setSelection((state.selection.constructor as any).near(tr.doc.resolve(targetPos + 2)));
  tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "bullet" });
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Indent (sink) current list item into preceding sibling list item.
 */
export function indentListItem(view: WritingView): boolean {
  const { state, dispatch } = view;
  const itemType = state.schema.nodes.list_item;
  if (!itemType) return false;

  // deno-lint-ignore no-explicit-any
  return (pmSinkListItem(itemType) as any)(state, (tr: any) => {
    tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "bullet" });
    dispatch(tr);
  });
}

/**
 * Outdent (lift) current list item out to parent list or paragraph.
 */
export function outdentListItem(view: WritingView): boolean {
  const { state, dispatch } = view;
  const itemType = state.schema.nodes.list_item;
  if (!itemType) return false;

  // deno-lint-ignore no-explicit-any
  return (pmLiftListItem(itemType) as any)(state, (tr: any) => {
    tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "bullet" });
    dispatch(tr);
  });
}
