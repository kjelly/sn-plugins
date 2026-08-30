import { useCallback, useEffect, useRef, useState } from "react";
import type { Ctx, MilkdownPlugin } from "@milkdown/ctx";
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx, SerializerReady } from "@milkdown/core";
import { commonmark, remarkPreserveEmptyLinePlugin } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { EditorState } from "@milkdown/prose/state";
import { Slice, type Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView as ProseEditorView } from "@milkdown/prose/view";
import { SlashProvider } from "@milkdown/plugin-slash";
import { toggleMark } from "@milkdown/prose/commands";
import { taskOrdinalAtDocumentPosition, WritingControlRegistry, writingControlIsDisabled, writingTaskIsHidden, type WritingControlState } from "./WritingTaskControls";
import { applyWritingOriginTransaction, assessWritingMutation, assessWritingRoundTrip, WRITING_TRANSACTION_ORIGIN_META, WritingEditorChangeGate, type WritingMutationOrigin, type WritingOriginState, type WritingRoundTripResult } from "./WritingEditorLifecycle";
import { applyWritingCommand, isWritingViewEditable, writingLinkHref, insertWritingMarkdown, WRITING_COMMANDS, COMMAND_ALIASES, type SlashMatch, type WritingCommandName } from "./WritingCommands";
import { isWritingBoldShortcut, isWritingInlineCodeShortcut, isWritingItalicShortcut, isWritingLinkShortcut, isWritingStrikeShortcut } from "./WritingShortcuts";
import { openExternalLink } from "../utils/linkOpener.ts";
import { REPEAT_TAG_REGEX, DONE_TAG_REGEX, formatIsoDate } from "../tasks/RecurringTasks.ts";
import { createWritingFoldingPlugin } from "./WritingFolding.ts";
import { createWritingShortcutsPlugin } from "./WritingShortcuts.ts";
import { createWritingSmartKeysPlugin } from "./WritingSmartKeys.ts";
import {
  type InsertLibrary,
  type TemplateDefinition,
  type SnippetDefinition,
  resolveAllTemplates,
  resolveAllSnippets,
  expandTemplateVariables,
  extractNoteTitle,
} from "../templates/TemplateEngine.ts";
import { calloutBlockquoteView } from "./WritingCallouts.ts";
import { codeBlockEnhancedView } from "./WritingCodeBlock.ts";
import { LinkDialogModal } from "./LinkDialogModal.tsx";
export type { WritingCommandName } from "./WritingCommands";

export type WritingCommand = { id: number; name: WritingCommandName };
export type InsertPayload = { id: number; markdown: string; cursorOffset?: number };

export type WritingEditorProps = {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onToggleTask?: (ordinal: number, renderedMarkdown?: string) => void;
  onDeleteTask?: (ordinal: number, renderedMarkdown?: string) => void;
  command?: WritingCommand;
  insertPayload?: InsertPayload;
  library?: InsertLibrary;
  onCapabilityChange?: (result: WritingRoundTripResult) => void;
  onLosslessFallback?: (value: string, result: WritingRoundTripResult) => void;
};

/** Writing must not enable CommonMark's synthetic empty-line HTML marker. */
const excludedWritingCommonmark = new Set(remarkPreserveEmptyLinePlugin);
export const writingCommonmark: MilkdownPlugin[] = commonmark.filter(
  (plugin) => !excludedWritingCommonmark.has(plugin),
);

function setTaskListItemAttributes(dom: HTMLElement, node: ProseNode): void {
  dom.dataset.itemType = node.attrs.checked == null ? "list" : "task";
  if (node.attrs.label != null) dom.dataset.label = String(node.attrs.label);
  if (node.attrs.listType != null) dom.dataset.listType = String(node.attrs.listType);
  if (node.attrs.spread != null) dom.dataset.spread = String(node.attrs.spread);
  if (node.attrs.checked != null) {
    dom.dataset.checked = String(Boolean(node.attrs.checked));
    dom.dataset.writingHidden = String(writingTaskIsHidden(Boolean(node.attrs.checked)));
  } else {
    delete dom.dataset.checked;
    delete dom.dataset.writingHidden;
  }
}

function taskListItemView(
  node: ProseNode,
  view: ProseEditorView,
  getPos: () => number | undefined,
  readOnlyRef: { current: boolean },
  controls: WritingControlRegistry,
  onToggleTaskRef: { current?: (ordinal: number, renderedMarkdown?: string) => void },
  onDeleteTaskRef: { current?: (ordinal: number, renderedMarkdown?: string) => void },
  getRenderedMarkdown: () => string | undefined,
) {
  const dom = document.createElement("li");
  setTaskListItemAttributes(dom, node);
  const isReadOnly = () => readOnlyRef.current;
  let input: HTMLInputElement | undefined;
  let deleteButton: HTMLButtonElement | undefined;
  let contentDOM: HTMLElement;

  const refresh = () => {
    const disabled = isReadOnly();
    if (input) {
      input.disabled = disabled;
      input.setAttribute("aria-label", input.checked ? "Mark task incomplete" : "Mark task complete");
    }
    if (deleteButton) deleteButton.disabled = disabled;
  };

  if (node.attrs.checked != null) {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(node.attrs.checked);
    input.className = "task-checkbox";
    input.setAttribute("aria-label", input.checked ? "Mark task incomplete" : "Mark task complete");
    input.disabled = isReadOnly();
    input.addEventListener("click", (event) => {
      if (isReadOnly()) {
        event.preventDefault();
        return;
      }
      const position = getPos();
      if (position === undefined) return;
      const currentNode = view.state.doc.nodeAt(position);
      if (!currentNode || currentNode.type.name !== "list_item") return;
      const nextChecked = input ? input.checked : !currentNode.attrs.checked;
      const tr = view.state.tr.setNodeMarkup(position, undefined, { ...currentNode.attrs, checked: nextChecked });
      tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "task" });

      // If task contains @repeat(...), update @done tag
      const textContent = currentNode.textContent;
      if (REPEAT_TAG_REGEX.test(textContent)) {
        const todayStr = formatIsoDate(new Date());
        if (nextChecked) {
          if (DONE_TAG_REGEX.test(textContent)) {
            currentNode.descendants((childNode, childOffset) => {
              if (childNode.isText && childNode.text && DONE_TAG_REGEX.test(childNode.text)) {
                const match = childNode.text.match(DONE_TAG_REGEX);
                if (match && match.index !== undefined) {
                  const start = position + 1 + childOffset + match.index;
                  const end = start + match[0].length;
                  tr.replaceWith(start, end, view.state.schema.text(`@done(${todayStr})`));
                }
                return false;
              }
              return true;
            });
          } else {
            const firstChild = currentNode.firstChild;
            if (firstChild) {
              const insertPos = position + 1 + firstChild.nodeSize - 1;
              tr.insert(insertPos, view.state.schema.text(` @done(${todayStr})`));
            }
          }
        } else {
          currentNode.descendants((childNode, childOffset) => {
            if (childNode.isText && childNode.text && DONE_TAG_REGEX.test(childNode.text)) {
              const fullMatch = childNode.text.match(/\s*@done\([^)]*\)/i);
              if (fullMatch && fullMatch.index !== undefined) {
                const start = position + 1 + childOffset + fullMatch.index;
                const end = start + fullMatch[0].length;
                tr.delete(start, end);
              }
              return false;
            }
            return true;
          });
        }
      }

      view.dispatch(tr);
    });
    dom.append(input);
    contentDOM = document.createElement("div");
    contentDOM.className = "task-content";
    contentDOM.dataset.taskContent = "true";
    dom.append(contentDOM);
    deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "task-delete";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", "Delete task");
    deleteButton.title = "Delete task";
    deleteButton.disabled = isReadOnly();
    deleteButton.addEventListener("mousedown", (event) => event.preventDefault());
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (isReadOnly()) return;
      const position = getPos();
      if (position === undefined) return;
      const currentNode = view.state.doc.nodeAt(position);
      if (!currentNode || currentNode.type.name !== "list_item") return;
      const tr = view.state.tr.delete(position, position + currentNode.nodeSize);
      tr.setMeta(WRITING_TRANSACTION_ORIGIN_META, { kind: "command", command: "task" });
      view.dispatch(tr);
    });
    dom.append(deleteButton);
  } else {
    contentDOM = dom;
  }

  const controlState: WritingControlState = { get readOnly() { return isReadOnly(); }, refresh };
  const unregister = controls.add(controlState);
  refresh();

  return {
    dom,
    contentDOM,
    update(next: ProseNode) {
      if (next.type !== node.type || (next.attrs.checked == null) !== (node.attrs.checked == null)) return false;
      setTaskListItemAttributes(dom, next);
      if (input) {
        input.checked = Boolean(next.attrs.checked);
        input.setAttribute("aria-label", input.checked ? "Mark task incomplete" : "Mark task complete");
      }
      refresh();
      return true;
    },
    stopEvent(event: Event) { return event.target === input || event.target === deleteButton; },
    destroy() { unregister(); },
  };
}

function slashMatch(view: ProseEditorView): SlashMatch | undefined {
  if (view.composing) return undefined;
  const { selection } = view.state;
  if (!selection.empty) return undefined;
  const beforeCursor = selection.$from.parent.textContent.slice(0, selection.$from.parentOffset);
  const match = beforeCursor.match(/(?:^|\s)\/([\w-]*)$/);
  if (!match) return undefined;
  const from = selection.$from.pos - match[0].length + (match[0][0] === " " ? 1 : 0);
  return { from, to: selection.from, query: match[1].toLowerCase() };
}

type WritingEditability = { readOnlyRef: { current: boolean }; capabilityRef: { current: boolean } };
type LinkRequest = (view: ProseEditorView, range?: SlashMatch) => void;
type WritingSelectionBookmark = ReturnType<EditorState["selection"]["getBookmark"]>;

function canApplyWritingLink(view: ProseEditorView, editability: WritingEditability): boolean {
  return !editability.readOnlyRef.current && editability.capabilityRef.current && isWritingViewEditable(view);
}

type SlashItem =
  | { kind: "command"; name: WritingCommandName; label: string; badge?: string }
  | { kind: "callout"; calloutType: "note" | "tip" | "important" | "warning" | "caution"; label: string; badge: string }
  | { kind: "template"; template: TemplateDefinition; label: string; badge: string }
  | { kind: "snippet"; snippet: SnippetDefinition; label: string; badge: string };

function slashMenuPlugin(
  editability: WritingEditability,
  onRequestLinkRef: { current?: LinkRequest },
  libraryRef?: { current?: InsertLibrary },
  serializerRef?: { current?: (doc: ProseNode) => string },
  parserRef?: { current?: (markdown: string) => ProseNode | undefined },
) {
  return $prose(() => {
    let selectedIndex = 0;
    let currentItems: SlashItem[] = [];
    let isMenuVisible = false;
    let currentView: ProseEditorView | undefined;
    let menuEl: HTMLDivElement | undefined;
    let slashProvider: SlashProvider | undefined;

    const executeItem = (item: SlashItem) => {
      if (!currentView) return;
      const range = slashMatch(currentView);
      if (menuEl) menuEl.hidden = true;
      isMenuVisible = false;
      slashProvider?.hide();

      if (item.kind === "command") {
        if (item.name === "link") {
          if (canApplyWritingLink(currentView, editability)) onRequestLinkRef.current?.(currentView, range);
        }
        else applyWritingCommand(currentView, item.name, range);
      } else if (item.kind === "callout") {
        if (parserRef?.current) {
          const calloutText = `> [!${item.calloutType.toUpperCase()}]\n> `;
          insertWritingMarkdown(currentView, parserRef.current, calloutText, range);
        }
      } else if (item.kind === "template") {
        const selText = currentView.state.doc.textBetween(currentView.state.selection.from, currentView.state.selection.to);
        const noteText = serializerRef?.current ? serializerRef.current(currentView.state.doc) : "";
        const noteTitle = extractNoteTitle(noteText);
        const expanded = expandTemplateVariables(item.template.content, {
          date: new Date(),
          noteTitle,
          selection: selText,
        });
        if (parserRef?.current) {
          insertWritingMarkdown(currentView, parserRef.current, expanded.text, range, expanded.cursorOffset);
        }
      } else if (item.kind === "snippet") {
        const selText = currentView.state.doc.textBetween(currentView.state.selection.from, currentView.state.selection.to);
        const noteText = serializerRef?.current ? serializerRef.current(currentView.state.doc) : "";
        const noteTitle = extractNoteTitle(noteText);
        const expanded = expandTemplateVariables(item.snippet.content, {
          date: new Date(),
          noteTitle,
          selection: selText,
        });
        if (parserRef?.current) {
          insertWritingMarkdown(currentView, parserRef.current, expanded.text, range, expanded.cursorOffset);
        }
      }
    };

    const updateSelectionUI = () => {
      if (!menuEl) return;
      const buttons = menuEl.querySelectorAll<HTMLButtonElement>(".slash-command");
      buttons.forEach((btn, idx) => {
        btn.classList.toggle("selected", idx === selectedIndex);
        if (idx === selectedIndex) {
          btn.scrollIntoView({ block: "nearest" });
        }
      });
    };

    return new Plugin({
      key: new PluginKey("markdown-notes-plus-slash-menu"),
      view: (initialView) => {
        const menu = document.createElement("div");
        menuEl = menu;
        menu.className = "slash-menu";
        menu.setAttribute("role", "menu");
        menu.hidden = true;
        const provider = new SlashProvider({
          content: menu,
          root: initialView.dom.parentElement ?? undefined,
          shouldShow: (view) => slashMatch(view) !== undefined,
        });
        slashProvider = provider;
        currentView = initialView;

        const refresh = (view: ProseEditorView, previous?: EditorState) => {
          currentView = view;
          const match = slashMatch(view);
          if (!match) {
            isMenuVisible = false;
            menu.hidden = true;
            provider.hide();
            return;
          }
          const q = match.query.toLowerCase().trim();

          const commandItems: SlashItem[] = WRITING_COMMANDS.filter((command) => {
            if (!q) return true;
            return command.includes(q) || COMMAND_ALIASES[command]?.some((alias) => alias.includes(q));
          }).map((command) => ({
            kind: "command" as const,
            name: command,
            label: `/${command}`,
          }));

          const calloutCandidates: Array<{ calloutType: "note" | "tip" | "important" | "warning" | "caution"; label: string }> = [
            { calloutType: "note", label: "/note" },
            { calloutType: "tip", label: "/tip" },
            { calloutType: "important", label: "/important" },
            { calloutType: "warning", label: "/warning" },
            { calloutType: "caution", label: "/caution" },
          ];
          const calloutItems: SlashItem[] = calloutCandidates.filter((c) => {
            if (!q) return true;
            return c.calloutType.includes(q) || c.label.includes(q) || "callout".includes(q);
          }).map((c) => ({
            kind: "callout" as const,
            calloutType: c.calloutType,
            label: c.label,
            badge: "Callout",
          }));

          const library = libraryRef?.current;
          const templates = library ? resolveAllTemplates(library) : [];
          const templateItems: SlashItem[] = templates.filter((t) => {
            if (!q) return true;
            return t.name.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q)) || "template".includes(q);
          }).map((t) => ({
            kind: "template" as const,
            template: t,
            label: `/${t.name.toLowerCase().replace(/\s+/g, "-")}`,
            badge: "Template",
          }));

          const snippets = library ? resolveAllSnippets(library) : [];
          const snippetItems: SlashItem[] = snippets.filter((s) => {
            if (!q) return true;
            return s.trigger.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || "snippet".includes(q);
          }).map((s) => ({
            kind: "snippet" as const,
            snippet: s,
            label: `/${s.trigger}`,
            badge: "Snippet",
          }));

          currentItems = [...commandItems, ...calloutItems, ...snippetItems, ...templateItems];

          if (currentItems.length === 0) {
            isMenuVisible = false;
            menu.hidden = true;
            provider.hide();
            return;
          }
          if (selectedIndex >= currentItems.length) selectedIndex = 0;
          isMenuVisible = true;

          menu.replaceChildren(...currentItems.map((item, idx) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `slash-command ${idx === selectedIndex ? "selected" : ""}`;
            button.setAttribute("role", "menuitem");

            const labelSpan = document.createElement("span");
            labelSpan.textContent = item.label;
            button.appendChild(labelSpan);

            if (item.badge) {
              const badgeSpan = document.createElement("span");
              badgeSpan.className = "slash-item-badge";
              badgeSpan.textContent = item.badge;
              button.appendChild(badgeSpan);
            }

            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              executeItem(item);
            });
            return button;
          }));
          menu.hidden = false;
          provider.update(view, previous);
        };

        initialView.dom.parentElement?.append(menu);
        refresh(initialView);
        return {
          update(view: ProseEditorView, previous: EditorState) { refresh(view, previous); },
          destroy() { provider.destroy(); menu.remove(); menuEl = undefined; slashProvider = undefined; },
        };
      },
      props: {
        handleKeyDown(view, event) {
          if (!isMenuVisible || currentItems.length === 0) return false;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            selectedIndex = (selectedIndex + 1) % currentItems.length;
            updateSelectionUI();
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
            updateSelectionUI();
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const item = currentItems[selectedIndex] ?? currentItems[0];
            if (item) {
              executeItem(item);
              return true;
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            isMenuVisible = false;
            if (menuEl) menuEl.hidden = true;
            slashProvider?.hide();
            return true;
          }
          return false;
        },
      },
    });
  });
}

function writingKeyboardShortcutsPlugin(editability: WritingEditability, onRequestLinkRef: { current?: LinkRequest }) {
  return $prose(() => new Plugin({
    key: new PluginKey("markdown-notes-plus-writing-shortcuts"),
    props: {
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || !isWritingViewEditable(view) || editability.readOnlyRef.current) return false;
        if (isWritingLinkShortcut(event)) {
          if (!canApplyWritingLink(view, editability)) return false;
          event.preventDefault();
          onRequestLinkRef.current?.(view);
          return true;
        }
        if (isWritingBoldShortcut(event)) {
          const type = view.state.schema.marks.strong;
          if (type) {
            event.preventDefault();
            toggleMark(type)(view.state, view.dispatch);
            return true;
          }
        }
        if (isWritingItalicShortcut(event)) {
          const type = view.state.schema.marks.em;
          if (type) {
            event.preventDefault();
            toggleMark(type)(view.state, view.dispatch);
            return true;
          }
        }
        if (isWritingStrikeShortcut(event)) {
          const type = view.state.schema.marks.strike_through;
          if (type) {
            event.preventDefault();
            toggleMark(type)(view.state, view.dispatch);
            return true;
          }
        }
        if (isWritingInlineCodeShortcut(event)) {
          const type = view.state.schema.marks.inline_code;
          if (type) {
            event.preventDefault();
            toggleMark(type)(view.state, view.dispatch);
            return true;
          }
        }
        return false;
      },
    },
  }));
}

function writingLinkClickHandlerPlugin() {
  return $prose(() => new Plugin({
    key: new PluginKey("markdown-notes-plus-link-click"),
    props: {
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest("a");
        if (anchor) {
          event.preventDefault();
          event.stopPropagation();
          const href = anchor.getAttribute("href");
          if (href) {
            openExternalLink(href);
          }
          return true;
        }
        return false;
      },
    },
  }));
}

const writingOriginPluginKey = new PluginKey<WritingOriginState>("markdown-notes-plus-writing-origin");
const writingOriginPlugin = new Plugin({
  key: writingOriginPluginKey,
  state: {
    init: () => ({ origin: "user" } satisfies WritingOriginState),
    apply: applyWritingOriginTransaction,
  },
});

export function replaceAllWithOrigin(ctx: Ctx, markdown: string, origin: WritingMutationOrigin): void {
  const view = ctx.get(editorViewCtx);
  const doc = ctx.get(parserCtx)(markdown);
  if (!doc) return;
  view.dispatch(view.state.tr
    .replaceWith(0, view.state.doc.content.size, doc.content)
    .setMeta("addToHistory", false)
    .setMeta(WRITING_TRANSACTION_ORIGIN_META, origin));
}

type WritingEditorValueSync = {
  gate: WritingEditorChangeGate;
  generation: number;
  value: string;
  replace: (value: string, origin: WritingMutationOrigin) => void;
  serialize: () => string;
  report: (result: WritingRoundTripResult) => void;
};

type WritingEditorConfiguration = {
  host: HTMLDivElement;
  value: string;
  readOnlyRef: { current: boolean };
  controls: WritingControlRegistry;
  onToggleTaskRef: { current?: (ordinal: number, renderedMarkdown?: string) => void };
  onDeleteTaskRef: { current?: (ordinal: number, renderedMarkdown?: string) => void };
  serializerRef?: { current?: (doc: ProseNode) => string };
  parserRef?: { current?: (markdown: string) => ProseNode | undefined };
  libraryRef?: { current?: InsertLibrary };
  editability: WritingEditability;
  onRequestLinkRef: { current?: LinkRequest };
  onMarkdownUpdated: (ctx: Ctx, markdown: string) => void;
};

type PendingLinkDialog = {
  initialValue: string;
  bookmark: WritingSelectionBookmark;
  range?: SlashMatch;
  generation: number;
  documentGeneration: number;
};

/** Own the complete pre-create Writing editor composition. */
export function configureWritingEditor(editor: Editor, {
  host,
  value,
  readOnlyRef,
  controls,
  onToggleTaskRef,
  onDeleteTaskRef,
  serializerRef,
  parserRef,
  libraryRef,
  editability,
  onRequestLinkRef,
  onMarkdownUpdated,
}: WritingEditorConfiguration): Editor {
  return editor
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, value);
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: "-" as const,
        bulletOther: "*" as const,
        listItemIndent: "one" as const,
      }));
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        nodeViews: {
          ...options.nodeViews,
          list_item: (node, view, getPos) => taskListItemView(
            node,
            view,
            getPos,
            readOnlyRef,
            controls,
            onToggleTaskRef,
            onDeleteTaskRef,
            () => {
              try {
                const serialize = ctx.get(serializerCtx);
                return serialize(view.state.doc);
              } catch {
                return undefined;
              }
            },
          ),
          blockquote: (node, view, getPos) => calloutBlockquoteView(node, view, getPos),
          code_block: (node, view, getPos) => codeBlockEnhancedView(node, view, getPos),
          fence: (node, view, getPos) => codeBlockEnhancedView(node, view, getPos),
        },
      }));
    })
    .use(writingCommonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .config((ctx) => {
      ctx.get(listenerCtx).markdownUpdated((listenerContext, markdown) => onMarkdownUpdated(listenerContext, markdown));
      if (parserRef) parserRef.current = (markdown: string) => ctx.get(parserCtx)(markdown);
    })
    .use((ctx) => async () => {
      await ctx.wait(SerializerReady);
      if (serializerRef) serializerRef.current = (doc: ProseNode) => ctx.get(serializerCtx)(doc);
      if (parserRef) parserRef.current = (markdown: string) => ctx.get(parserCtx)(markdown);
    })
    .use($prose(() => writingOriginPlugin))
    .use($prose(() => createWritingFoldingPlugin()))
    .use($prose(() => createWritingShortcutsPlugin()))
    .use($prose(() => createWritingSmartKeysPlugin()))
    .use(writingLinkClickHandlerPlugin())
    .use(slashMenuPlugin(editability, onRequestLinkRef, libraryRef, serializerRef, parserRef))
    .use(writingKeyboardShortcutsPlugin(editability, onRequestLinkRef));
}

/** Keep the Milkdown document and capability proof aligned with canonical text. */
export function synchronizeWritingEditorValue({ gate, generation, value, replace, serialize, report }: WritingEditorValueSync): WritingRoundTripResult {
  if (gate.renderedMarkdown !== value) {
    const origin = gate.suppressExternalUpdate(generation, value);
    if (origin) replace(value, origin);
  }
  const proof = assessWritingRoundTrip(value, serialize());
  report(proof);
  return proof;
}

/** Milkdown CommonMark + GFM writing mode. Source remains the canonical owner. */
export function WritingEditor({
  value,
  readOnly,
  onChange,
  onToggleTask,
  onDeleteTask,
  command,
  insertPayload,
  library,
  onCapabilityChange,
  onLosslessFallback,
}: WritingEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor>();
  const gate = useRef(new WritingEditorChangeGate());
  const generationRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const readOnlyRef = useRef(readOnly);
  const controlsRef = useRef(new WritingControlRegistry());
  const onToggleTaskRef = useRef(onToggleTask);
  const onDeleteTaskRef = useRef(onDeleteTask);
  const serializerRef = useRef<(doc: ProseNode) => string>();
  const parserRef = useRef<(markdown: string) => ProseNode | undefined>();
  const libraryRef = useRef<InsertLibrary | undefined>(library);
  libraryRef.current = library;
  const commandRef = useRef(command);
  const insertPayloadRef = useRef(insertPayload);
  insertPayloadRef.current = insertPayload;
  const capabilityRef = useRef(false);
  const documentGenerationRef = useRef(0);
  const onRequestLinkRef = useRef<LinkRequest>();
  const [linkDialog, setLinkDialog] = useState<PendingLinkDialog>();
  const appliedCommand = useRef<number>();
  const appliedInsert = useRef<number>();
  onChangeRef.current = onChange;
  valueRef.current = value;
  readOnlyRef.current = readOnly;
  onToggleTaskRef.current = onToggleTask;
  onDeleteTaskRef.current = onDeleteTask;
  commandRef.current = command;
  const onCapabilityChangeRef = useRef(onCapabilityChange);
  onCapabilityChangeRef.current = onCapabilityChange;
  const onLosslessFallbackRef = useRef(onLosslessFallback);
  onLosslessFallbackRef.current = onLosslessFallback;

  const cancelLinkDialog = useCallback(() => setLinkDialog(undefined), []);
  const requestLink = useCallback((view: ProseEditorView, range?: SlashMatch) => {
    if (!canApplyWritingLink(view, { readOnlyRef, capabilityRef })) return;
    if (range && (range.from < 0 || range.to < range.from || range.to > view.state.doc.content.size)) return;
    setLinkDialog({
      initialValue: writingLinkHref(view) ?? "",
      bookmark: view.state.selection.getBookmark(),
      range,
      generation: generationRef.current,
      documentGeneration: documentGenerationRef.current,
    });
  }, []);
  onRequestLinkRef.current = requestLink;

  const reportCapability = (result: WritingRoundTripResult, force = false) => {
    const next = result.editable;
    if (!force && capabilityRef.current === next) return;
    capabilityRef.current = next;
    onCapabilityChangeRef.current?.(result);
  };

  const synchronizeEditorValue = (target: string, forceReport = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (gate.current.renderedMarkdown !== target) documentGenerationRef.current += 1;
    synchronizeWritingEditorValue({
      gate: gate.current,
      generation: generationRef.current,
      value: target,
      replace: (next, origin) => editor.action((ctx) => replaceAllWithOrigin(ctx, next, origin)),
      serialize: () => editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
      report: (result) => reportCapability(result, forceReport),
    });
  };

  const applyPendingCommand = () => {
    const editor = editorRef.current;
    const pending = commandRef.current;
    if (!editor || !pending || appliedCommand.current === pending.id) return;
    appliedCommand.current = pending.id;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (pending.name === "link") onRequestLinkRef.current?.(view);
      else applyWritingCommand(view, pending.name);
    });
  };

  const applyPendingInsert = () => {
    const editor = editorRef.current;
    const pending = insertPayloadRef.current;
    if (!editor || !pending || appliedInsert.current === pending.id) return;
    appliedInsert.current = pending.id;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = (md: string) => ctx.get(parserCtx)(md);
      insertWritingMarkdown(view, parser, pending.markdown, undefined, pending.cursorOffset);
    });
  };

  useEffect(() => {
    if (!host.current) return undefined;
    const hostElement = host.current;
    let cancelled = false;
    const generation = gate.current.begin(value);
    generationRef.current = generation;
    const editor = configureWritingEditor(Editor.make(), {
      host: hostElement,
      value,
      readOnlyRef,
      controls: controlsRef.current,
      onToggleTaskRef,
      onDeleteTaskRef,
      serializerRef,
      parserRef,
      libraryRef,
      editability: { readOnlyRef, capabilityRef },
      onRequestLinkRef,
      onMarkdownUpdated: (ctx, markdown) => {
        if (serializerRef) serializerRef.current = (doc: ProseNode) => ctx.get(serializerCtx)(doc);
        if (parserRef) parserRef.current = (docText: string) => ctx.get(parserCtx)(docText);
        const view = ctx.get(editorViewCtx);
        if (view.composing) return;
        if (gate.current.renderedMarkdown !== markdown) documentGenerationRef.current += 1;
        const originState = writingOriginPluginKey.getState(view.state) ?? { origin: "user" as const };
        const origin = originState.origin;
        if (!gate.current.markdownUpdated(generation, markdown, origin)) return;
        if (markdown === valueRef.current) return;
        onChangeRef.current(markdown);
      },
    });
    editor.create().then(() => {
      if (cancelled) {
        void editor.destroy();
        return;
      }
      editorRef.current = editor;
      gate.current.finish(generation, value);
      editor.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !readOnlyRef.current }));
      synchronizeEditorValue(valueRef.current, true);
      applyPendingCommand();
      applyPendingInsert();
    }).catch(() => { /* isolate editor initialization failure in its ErrorBoundary */ });
    return () => { cancelled = true; editorRef.current = undefined; void editor.destroy(); };
    // The editor owns its lifecycle. Content updates are handled below so a
    // canonical update cannot recreate Milkdown and lose selection/history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || gate.current.renderedMarkdown === value) return;
    synchronizeEditorValue(value);
  }, [value]);

  useEffect(() => { applyPendingCommand(); }, [command?.id]);
  useEffect(() => { applyPendingInsert(); }, [insertPayload?.id]);

  useEffect(() => {
    editorRef.current?.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !readOnlyRef.current }));
    controlsRef.current.refresh();
  }, [readOnly]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnlyRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, select, textarea")) return;
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view.hasFocus()) {
        view.focus();
      }
    });
  };

  return <>
    <div className={`milkdown-writing${readOnly ? " is-readonly" : ""}`} ref={host} onClick={handleClick} aria-label="Writing editor" />
    <LinkDialogModal
      isOpen={linkDialog !== undefined}
      initialValue={linkDialog?.initialValue ?? ""}
      onConfirm={(href) => {
        const pending = linkDialog;
        setLinkDialog(undefined);
        if (!pending || pending.generation !== generationRef.current || pending.documentGeneration !== documentGenerationRef.current) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!canApplyWritingLink(view, { readOnlyRef, capabilityRef })) return;
          let selection;
          try {
            selection = pending.bookmark.resolve(view.state.doc);
          } catch {
            return;
          }
          if (pending.range && (pending.range.from < 0 || pending.range.to < pending.range.from || pending.range.to > view.state.doc.content.size)) return;
          if (view.state.selection.from !== selection.from || view.state.selection.to !== selection.to) {
            view.dispatch(view.state.tr.setSelection(selection));
          }
          applyWritingCommand(view, "link", pending.range, href);
        });
      }}
      onCancel={cancelLinkDialog}
    />
  </>;
}
