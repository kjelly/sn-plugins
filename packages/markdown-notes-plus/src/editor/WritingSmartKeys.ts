import { Plugin, PluginKey } from "@milkdown/prose/state";
import { setBlockType } from "@milkdown/prose/commands";
import { outdentListItem } from "./WritingListCommands.ts";
import { WRITING_TRANSACTION_ORIGIN_META } from "./WritingEditorLifecycle.ts";

export const writingSmartKeysPluginKey = new PluginKey("writingSmartKeys");

export function createWritingSmartKeysPlugin(): Plugin {
  return new Plugin({
    key: writingSmartKeysPluginKey,
    props: {
      // deno-lint-ignore no-explicit-any
      handleKeyDown(view: any, event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
          const { state } = view;
          const { selection } = state;
          if (selection.empty) {
            const { $from } = selection;
            const parent = $from.parent;
            // Check if inside empty list item paragraph
            if (parent.type.name === "paragraph" && parent.content.size === 0) {
              const grandParent = $from.node($from.depth - 1);
              if (grandParent && grandParent.type.name === "list_item") {
                if (outdentListItem(view)) {
                  event.preventDefault();
                  return true;
                }
              }
            }
          }
        }

        if (event.key === "Backspace" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
          const { state, dispatch } = view;
          const { selection } = state;
          if (selection.empty) {
            const { $from } = selection;
            if ($from.parentOffset === 0) {
              const parent = $from.parent;
              const grandParent = $from.depth > 1 ? $from.node($from.depth - 1) : undefined;

              // At start of list item -> outdent
              if (grandParent && grandParent.type.name === "list_item") {
                if (outdentListItem(view)) {
                  event.preventDefault();
                  return true;
                }
              }

              // At start of blockquote or code_block -> convert to paragraph
              if (parent.type.name === "code_block" && parent.content.size === 0) {
                const pType = state.schema.nodes.paragraph;
                if (pType) {
                  // deno-lint-ignore no-explicit-any
                  (setBlockType(pType) as any)(state, (tr: any) => {
                    tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "heading" });
                    dispatch(tr);
                  });
                  event.preventDefault();
                  return true;
                }
              }
            }
          }
        }

        return false;
      },
    },
  });
}
