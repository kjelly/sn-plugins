import { setBlockType, wrapIn } from "@milkdown/prose/commands";
import { liftListItem } from "@milkdown/prose/schema-list";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { WRITING_TRANSACTION_ORIGIN_META } from "./WritingEditorLifecycle.ts";
import type { WritingView, WritingState } from "./WritingListCommands.ts";

export type BlockTargetType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "bullet_list"
  | "ordered_list"
  | "task_list"
  | "blockquote"
  | "code_block";

function findCurrentBlock(state: WritingState): { from: number; to: number; node: ProseNode; depth: number } | undefined {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.isBlock && node.type.name !== "doc") {
      return { from: $from.before(d), to: $from.after(d), node, depth: d };
    }
  }
  return undefined;
}

/**
 * Convert the current block type to target type.
 */
export function convertCurrentBlock(
  view: WritingView,
  target: BlockTargetType,
  attrs?: Record<string, unknown>,
): boolean {
  const { state, dispatch } = view;
  const block = findCurrentBlock(state);
  if (!block) return false;

  // 1. If inside list item and target is paragraph or heading or code_block, lift list item first
  if (block.node.type.name === "list_item" || state.selection.$from.node(block.depth - 1)?.type.name === "list_item") {
    if (target === "paragraph" || target.startsWith("heading") || target === "code_block" || target === "blockquote") {
      const itemType = state.schema.nodes.list_item;
      if (itemType) {
        // deno-lint-ignore no-explicit-any
        (liftListItem(itemType) as any)(state, (tr: any) => {
          dispatch(tr);
        });
      }
    }
  }

  const schema = view.state.schema;
  const currentView = view;

  switch (target) {
    case "paragraph": {
      const type = schema.nodes.paragraph;
      if (!type) return false;
      return setBlockType(type)(currentView.state, (tr) => {
        tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "heading" });
        dispatch(tr);
      });
    }
    case "heading1":
    case "heading2":
    case "heading3":
    case "heading4":
    case "heading5":
    case "heading6": {
      const level = parseInt(target.replace("heading", ""), 10);
      const type = schema.nodes.heading;
      if (!type) return false;
      return setBlockType(type, { level, ...attrs })(currentView.state, (tr) => {
        tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "heading" });
        dispatch(tr);
      });
    }
    case "bullet_list": {
      const type = schema.nodes.bullet_list;
      if (!type) return false;
      return wrapIn(type)(currentView.state, (tr) => {
        tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "bullet" });
        dispatch(tr);
      });
    }
    case "ordered_list": {
      const type = schema.nodes.ordered_list;
      if (!type) return false;
      return wrapIn(type, { order: 1, ...attrs })(currentView.state, (tr) => {
        tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "numbered" });
        dispatch(tr);
      });
    }
    case "task_list": {
      const listType = schema.nodes.bullet_list;
      const itemType = schema.nodes.list_item;
      const pType = schema.nodes.paragraph;
      if (!listType || !itemType) return false;

      const p = pType ? pType.create(null, block.node.content) : block.node;
      const item = itemType.create({ checked: false }, p);
      const list = listType.create(null, item);
      const tr = currentView.state.tr.replaceWith(block.from, block.to, list);
      tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "task" });
      dispatch(tr.scrollIntoView());
      return true;
    }
    case "blockquote": {
      const type = schema.nodes.blockquote;
      if (!type) return false;
      return wrapIn(type)(currentView.state, (tr) => {
        tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "quote" });
        dispatch(tr);
      });
    }
    case "code_block": {
      const type = schema.nodes.code_block;
      if (!type) return false;
      return setBlockType(type, { language: "", ...attrs })(currentView.state, (tr) => {
        tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "code" });
        dispatch(tr);
      });
    }
  }
}
