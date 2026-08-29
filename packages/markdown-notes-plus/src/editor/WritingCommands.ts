import { wrapIn, setBlockType } from "@milkdown/prose/commands";
import type { Mark, Node as ProseNode } from "@milkdown/prose/model";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView as ProseEditorView } from "@milkdown/prose/view";
import { getMarkRange } from "@milkdown/prose";
import { writingCommandPlan } from "./WritingCommandPlan.ts";
import type { WritingCommandName } from "./WritingCommandPlan.ts";
import { structuralProvenanceForCommand, WRITING_STRUCTURAL_CONTEXT_META, WRITING_TRANSACTION_ORIGIN_META } from "./WritingEditorLifecycle.ts";
export { WRITING_COMMANDS, COMMAND_ALIASES, type WritingCommandName } from "./WritingCommandPlan.ts";

export type SlashMatch = { from: number; to: number; query: string };

type WritingView = Pick<ProseEditorView, "state" | "dispatch" | "focus" | "editable">;
type WritingState = WritingView["state"];
type WritingTransaction = ReturnType<WritingState["tr"]["setMeta"]>;

function linkMarkAtSelection(state: WritingState, selection = state.selection, doc = state.doc): { mark: Mark; from: number; to: number; stored: boolean } | undefined {
  const type = state.schema.marks.link;
  if (!type) return undefined;
  if (selection.empty) {
    const range = getMarkRange(selection.$from, type);
    if (range) return { ...range, stored: false };
    const stored = state.storedMarks?.find((mark) => mark.type === type);
    if (stored) return { mark: stored, from: selection.from, to: selection.to, stored: true };
    return undefined;
  }

  let found: { mark: Mark; from: number; to: number } | undefined;
  doc.nodesBetween(selection.from, selection.to, (node, position) => {
    const mark = type.isInSet(node.marks);
    if (mark && !found) found = { mark, from: position, to: position + node.nodeSize };
    return !found;
  });
  return found ? { ...found, stored: false } : undefined;
}

/** Return the current URL for the Writing-local link prompt, if any. */
export function writingLinkHref(view: WritingView): string | undefined {
  return linkMarkAtSelection(view.state)?.mark.attrs.href as string | undefined;
}

function applyLinkTransaction(state: WritingState, transaction: WritingTransaction, href: string, selection = state.selection, doc = state.doc, storedTitle?: string | null): boolean {
  const type = state.schema.marks.link;
  if (!type) return false;
  const existing = linkMarkAtSelection(state, selection, doc);

  if (selection.empty) {
    if (existing) {
      if (existing.stored) {
        const currentMarks = transaction.storedMarks ?? state.storedMarks ?? selection.$from.marks();
        const storedMarks = currentMarks.filter((mark) => mark.type !== type);
        if (href !== "") storedMarks.push(type.create({ href, title: existing.mark.attrs.title }));
        transaction.setStoredMarks(storedMarks);
        return true;
      }
      if (href === "") transaction.removeMark(existing.from, existing.to, type);
      else transaction
        .removeMark(existing.from, existing.to, existing.mark)
        .addMark(existing.from, existing.to, type.create({ href, title: existing.mark.attrs.title }));
      return true;
    }
    if (href === "") return false;
    const currentMarks = transaction.storedMarks ?? state.storedMarks ?? selection.$from.marks();
    const storedMarks = currentMarks.filter((mark) => mark.type !== type);
    storedMarks.push(type.create({ href, title: storedTitle ?? null }));
    transaction.setStoredMarks(storedMarks);
    return true;
  }

  if (href === "") {
    transaction.removeMark(selection.from, selection.to, type);
    if (!transaction.docChanged) return false;
    return true;
  }

  const preserveTitle = existing && existing.from <= selection.from && existing.to >= selection.to
    ? existing.mark.attrs.title
    : null;
  transaction.addMark(selection.from, selection.to, type.create({ href, title: preserveTitle }));
  return true;
}

function applyLink(view: WritingView, href: string): boolean {
  const transaction = view.state.tr;
  if (!applyLinkTransaction(view.state, transaction, href)) return false;
  dispatchCommand(view, transaction, "link", false);
  return true;
}

function currentBlock(view: WritingView): { node: ProseNode; from: number; to: number } | undefined {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isBlock) return { node, from: $from.before(depth), to: $from.after(depth) };
  }
  if (view.state.doc.childCount > 0) {
    let offset = 0;
    for (let i = 0; i < view.state.doc.childCount; i++) {
      const child = view.state.doc.child(i);
      const nextOffset = offset + child.nodeSize;
      if ($from.pos >= offset && $from.pos <= nextOffset && child.isBlock) {
        return { node: child, from: offset, to: nextOffset };
      }
      offset = nextOffset;
    }
    const lastChild = view.state.doc.lastChild;
    if (lastChild && lastChild.isBlock) {
      return { node: lastChild, from: view.state.doc.content.size - lastChild.nodeSize, to: view.state.doc.content.size };
    }
  }
  return undefined;
}

function dispatchCommand(view: WritingView, transaction: ReturnType<WritingView["state"]["tr"]["setMeta"]>, command: WritingCommandName, persistStructuralContext = true): void {
  transaction.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command });
  if (persistStructuralContext) {
    const structural = structuralProvenanceForCommand(command);
    if (structural) transaction.setMeta(WRITING_STRUCTURAL_CONTEXT_META, structural);
  }
  view.dispatch(transaction);
}

function runBlockType(view: WritingView, nodeName: string, attrs: Record<string, unknown> | undefined, command: WritingCommandName): boolean {
  const nodeType = view.state.schema.nodes[nodeName];
  if (!nodeType) return false;
  // Milkdown's npm graph can contain more than one declaration of the
  // ProseMirror state package (the runtime objects remain compatible). Keep
  // the public WritingView type tied to the view while adapting the command
  // callback at this package boundary.
  const commandFn = setBlockType(nodeType, attrs) as unknown as (state: WritingView["state"], dispatch: (transaction: ReturnType<WritingView["state"]["tr"]["setMeta"]>) => void) => boolean;
  return commandFn(view.state, (transaction) => dispatchCommand(view, transaction, command));
}

function runWrap(view: WritingView, nodeName: string, attrs: Record<string, unknown> | undefined, command: WritingCommandName): boolean {
  const nodeType = view.state.schema.nodes[nodeName];
  if (!nodeType) return false;
  const commandFn = wrapIn(nodeType, attrs) as unknown as (state: WritingView["state"], dispatch: (transaction: ReturnType<WritingView["state"]["tr"]["setMeta"]>) => void) => boolean;
  return commandFn(view.state, (transaction) => dispatchCommand(view, transaction, command));
}

function _listItemPositions(view: WritingView): number[] {
  const positions = new Set<number>();
  const { $from, from, to } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "list_item") positions.add($from.before(depth));
  }
  if (!view.state.selection.empty) {
    view.state.doc.nodesBetween(from, to, (node, position) => {
      if (node.type.name === "list_item") positions.add(position);
    });
  }
  return [...positions];
}

function makeTable(view: WritingView): ProseNode | undefined {
  const { schema } = view.state;
  const table = schema.nodes.table;
  const headerRow = schema.nodes.table_header_row;
  const header = schema.nodes.table_header;
  const row = schema.nodes.table_row;
  const cell = schema.nodes.table_cell;
  if (!table || !headerRow || !header || !row || !cell) return undefined;

  const headers = Array.from({ length: 3 }, () => header.createAndFill());
  const bodyCells = Array.from({ length: 3 }, () => cell.createAndFill());
  if (headers.some((node) => !node) || bodyCells.some((node) => !node)) return undefined;
  const headerNode = headerRow.create(null, headers as ProseNode[]);
  const bodyRows = Array.from({ length: 2 }, () => row.create(null, bodyCells as ProseNode[]));
  return table.create(null, [headerNode, ...bodyRows]);
}

function replaceCurrentBlock(view: WritingView, node: ProseNode, command: WritingCommandName): boolean {
  const block = currentBlock(view);
  if (!block) return false;
  dispatchCommand(view, view.state.tr.replaceWith(block.from, block.to, node), command);
  return true;
}

function applyTask(view: WritingView, command: WritingCommandName): boolean {
  const { doc, selection, schema } = view.state;
  const { from, to } = selection;
  const tr = view.state.tr;

  const listItems: Array<{ pos: number; node: ProseNode }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "list_item") {
      listItems.push({ pos, node });
    }
  });

  if (listItems.length > 0) {
    for (const { pos, node } of listItems) {
      const isTask = node.attrs.checked != null;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: isTask ? null : false });
    }
    if (tr.docChanged) dispatchCommand(view, tr, command);
    return true;
  }

  const block = currentBlock(view);
  if (block && schema.nodes.bullet_list && schema.nodes.list_item) {
    const paragraph = schema.nodes.paragraph ? schema.nodes.paragraph.create(null, block.node.content) : block.node;
    const listItem = schema.nodes.list_item.create({ checked: false }, paragraph);
    const list = schema.nodes.bullet_list.create(null, listItem);
    tr.replaceWith(block.from, block.to, list);
    if (tr.docChanged) {
      const targetPos = Math.min(block.from + 2, tr.doc.content.size);
      try {
        const resolved = tr.doc.resolve(targetPos);
        tr.setSelection(TextSelection.near(resolved));
      } catch {
        // Safe fallback
      }
      dispatchCommand(view, tr, command);
    }
    return true;
  }

  if (schema.nodes.bullet_list && schema.nodes.list_item && schema.nodes.paragraph) {
    const paragraph = schema.nodes.paragraph.create();
    const listItem = schema.nodes.list_item.create({ checked: false }, paragraph);
    const list = schema.nodes.bullet_list.create(null, listItem);
    tr.replaceSelectionWith(list);
    if (tr.docChanged) dispatchCommand(view, tr, command);
    return true;
  }

  return false;
}

export function isWritingViewEditable(view: WritingView): boolean {
  if (typeof view.editable === "boolean") return view.editable;
  const propsEditable = (view as unknown as { props?: { editable?: (state: unknown) => boolean } }).props?.editable;
  return typeof propsEditable === "function" ? propsEditable(view.state) : true;
}

/** Apply a toolbar or slash action as a structural ProseMirror transaction. */
export function applyWritingCommand(view: WritingView, command: WritingCommandName, range?: SlashMatch, href?: string): boolean {
  if (!isWritingViewEditable(view)) return false;
  if (command === "link" && href === undefined) return false;

  const plan = writingCommandPlan(command);
  if (range && plan.kind === "link") {
    // An empty slash-link result is a cancelled operation. Do not consume the
    // command text or change the active/stored link marks.
    if (href === "") return false;
    const linkContext = linkMarkAtSelection(view.state);
    const transaction = view.state.tr;
    transaction.delete(range.from, range.to);
    const type = view.state.schema.marks.link;
    if (!type) return false;

    // Resolve the link context before consuming the slash command. The cursor
    // can remain inside a larger pre-existing link after the deletion (for
    // example, `[prefix /link](old "title")`). Re-running linkMarkAtSelection
    // against transaction.doc would then rewrite that unrelated prefix link.
    // Explicit stored marks make only text typed after the command use href.
    const currentMarks = view.state.storedMarks ?? view.state.selection.$from.marks();
    const storedMarks = currentMarks.filter((mark) => mark.type !== type);
    storedMarks.push(type.create({ href, title: linkContext?.mark.attrs.title ?? null }));
    transaction.setStoredMarks(storedMarks);
    dispatchCommand(view, transaction, command, false);
    view.focus();
    return true;
  }

  if (range) dispatchCommand(view, view.state.tr.delete(range.from, range.to), command, false);

  let applied = false;
  switch (plan.kind) {
    case "set-block-type": applied = runBlockType(view, plan.nodeName, plan.attrs, command); break;
    case "wrap": applied = runWrap(view, plan.nodeName, plan.attrs, command); break;
    case "task-list": applied = applyTask(view, command); break;
    case "link": applied = applyLink(view, href!); break;
    case "replace-block": {
      const node = plan.nodeName === "table" ? makeTable(view) : view.state.schema.nodes.hr?.create();
      applied = node ? replaceCurrentBlock(view, node, command) : false;
      break;
    }
    case "replace-selection": {
      const image = view.state.schema.nodes[plan.nodeName]?.create(plan.attrs);
      applied = image ? (dispatchCommand(view, view.state.tr.replaceSelectionWith(image), command), true) : false;
      break;
    }
  }
  if (applied) view.focus();
  return applied;
}
