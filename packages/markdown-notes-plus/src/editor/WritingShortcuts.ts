import { Plugin, PluginKey } from "@milkdown/prose/state";
import { setBlockType } from "@milkdown/prose/commands";
import { moveListItemDown, moveListItemUp, indentListItem, outdentListItem } from "./WritingListCommands.ts";
import {
  findTableLocation,
  handleTableTabNavigation,
  moveTableRowDown,
  moveTableRowUp,
} from "./WritingTableCommands.ts";
import { WRITING_TRANSACTION_ORIGIN_META } from "./WritingEditorLifecycle.ts";

export type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey"> & { isComposing?: boolean; shiftKey?: boolean };

export function isWritingLinkShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}

export function isWritingBoldShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "b";
}

export function isWritingItalicShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "i";
}

export function isWritingStrikeShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && Boolean(event.shiftKey) && event.key.toLowerCase() === "x";
}

export function isWritingInlineCodeShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "e";
}

export const writingShortcutsPluginKey = new PluginKey("writingShortcuts");

// deno-lint-ignore no-explicit-any
function promoteHeadingInView(view: any): boolean {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name === "heading") {
      const level = node.attrs.level ?? 1;
      if (level > 1) {
        // deno-lint-ignore no-explicit-any
        return (setBlockType(node.type, { level: level - 1 }) as any)(state, (tr: any) => {
          tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "heading" });
          dispatch(tr);
        });
      }
      return false;
    }
  }
  return false;
}

// deno-lint-ignore no-explicit-any
function demoteHeadingInView(view: any): boolean {
  const { state, dispatch } = view;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name === "heading") {
      const level = node.attrs.level ?? 1;
      if (level < 6) {
        // deno-lint-ignore no-explicit-any
        return (setBlockType(node.type, { level: level + 1 }) as any)(state, (tr: any) => {
          tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "heading" });
          dispatch(tr);
        });
      }
      return false;
    }
  }
  return false;
}

/**
 * ProseMirror plugin handling structural keyboard shortcuts:
 * - Alt+Up / Alt+Down: reorder list item or table row
 * - Alt+Left / Alt+Right: promote / demote heading
 * - Tab / Shift+Tab: indent / outdent list item, or navigate table cells
 */
export function createWritingShortcutsPlugin(): Plugin {
  return new Plugin({
    key: writingShortcutsPluginKey,
    props: {
      // deno-lint-ignore no-explicit-any
      handleKeyDown(view: any, event: KeyboardEvent) {
        const isAlt = event.altKey && !event.metaKey && !event.ctrlKey;

        // 1. Alt+ArrowUp: move item / row up
        if (isAlt && event.key === "ArrowUp") {
          if (findTableLocation(view.state)) {
            if (moveTableRowUp(view)) {
              event.preventDefault();
              return true;
            }
          }
          if (moveListItemUp(view)) {
            event.preventDefault();
            return true;
          }
        }

        // 2. Alt+ArrowDown: move item / row down
        if (isAlt && event.key === "ArrowDown") {
          if (findTableLocation(view.state)) {
            if (moveTableRowDown(view)) {
              event.preventDefault();
              return true;
            }
          }
          if (moveListItemDown(view)) {
            event.preventDefault();
            return true;
          }
        }

        // 3. Alt+ArrowLeft: promote heading
        if (isAlt && event.key === "ArrowLeft") {
          if (promoteHeadingInView(view)) {
            event.preventDefault();
            return true;
          }
        }

        // 4. Alt+ArrowRight: demote heading
        if (isAlt && event.key === "ArrowRight") {
          if (demoteHeadingInView(view)) {
            event.preventDefault();
            return true;
          }
        }

        // 5. Tab / Shift+Tab in tables and lists
        if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (findTableLocation(view.state)) {
            if (handleTableTabNavigation(view, event.shiftKey)) {
              event.preventDefault();
              return true;
            }
          }

          if (event.shiftKey) {
            if (outdentListItem(view)) {
              event.preventDefault();
              return true;
            }
          } else {
            if (indentListItem(view)) {
              event.preventDefault();
              return true;
            }
          }
        }

        return false;
      },
    },
  });
}
