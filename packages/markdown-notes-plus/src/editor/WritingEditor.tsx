import { useEffect, useRef } from "react";
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
import { applyWritingCommand, isWritingViewEditable, writingLinkHref, WRITING_COMMANDS, COMMAND_ALIASES, type SlashMatch, type WritingCommandName } from "./WritingCommands";
import { isWritingBoldShortcut, isWritingInlineCodeShortcut, isWritingItalicShortcut, isWritingLinkShortcut, isWritingStrikeShortcut } from "./WritingShortcuts";
import { openExternalLink } from "../utils/linkOpener.ts";
import { REPEAT_TAG_REGEX, DONE_TAG_REGEX, formatIsoDate } from "../tasks/RecurringTasks.ts";
import { createWritingFoldingPlugin } from "./WritingFolding.ts";
import { createWritingShortcutsPlugin } from "./WritingShortcuts.ts";
import { createWritingSmartKeysPlugin } from "./WritingSmartKeys.ts";
export type { WritingCommandName } from "./WritingCommands";

export type WritingCommand = { id: number; name: WritingCommandName };

export type WritingEditorProps = {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onToggleTask?: (ordinal: number, renderedMarkdown?: string) => void;
  onDeleteTask?: (ordinal: number, renderedMarkdown?: string) => void;
  command?: WritingCommand;
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

function canApplyWritingLink(view: ProseEditorView, editability: WritingEditability): boolean {
  return !editability.readOnlyRef.current && editability.capabilityRef.current && isWritingViewEditable(view);
}

function promptAndApplyLink(view: ProseEditorView, editability: WritingEditability, range?: SlashMatch): boolean {
  if (!canApplyWritingLink(view, editability)) return false;
  const href = window.prompt("Link URL", writingLinkHref(view) ?? "");
  if (href === null) return false;
  return applyWritingCommand(view, "link", range, href);
}

function slashMenuPlugin(editability: WritingEditability) {
  return $prose(() => {
    let selectedIndex = 0;
    let currentCommands: WritingCommandName[] = [];
    let isMenuVisible = false;
    let currentView: ProseEditorView | undefined;
    let menuEl: HTMLDivElement | undefined;
    let slashProvider: SlashProvider | undefined;

    const executeCommand = (command: WritingCommandName) => {
      if (!currentView) return;
      const range = slashMatch(currentView);
      if (menuEl) menuEl.hidden = true;
      isMenuVisible = false;
      slashProvider?.hide();
      if (command === "link") promptAndApplyLink(currentView, editability, range);
      else applyWritingCommand(currentView, command, range);
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
          const q = match.query;
          currentCommands = WRITING_COMMANDS.filter((command) => {
            if (!q) return true;
            return command.includes(q) || COMMAND_ALIASES[command]?.some((alias) => alias.includes(q));
          });
          if (currentCommands.length === 0) {
            isMenuVisible = false;
            menu.hidden = true;
            provider.hide();
            return;
          }
          if (selectedIndex >= currentCommands.length) selectedIndex = 0;
          isMenuVisible = true;

          menu.replaceChildren(...currentCommands.map((command, idx) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `slash-command ${idx === selectedIndex ? "selected" : ""}`;
            button.setAttribute("role", "menuitem");
            button.textContent = `/${command}`;
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              executeCommand(command);
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
          if (!isMenuVisible || currentCommands.length === 0) return false;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            selectedIndex = (selectedIndex + 1) % currentCommands.length;
            updateSelectionUI();
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            selectedIndex = (selectedIndex - 1 + currentCommands.length) % currentCommands.length;
            updateSelectionUI();
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const command = currentCommands[selectedIndex] ?? currentCommands[0];
            if (command) {
              executeCommand(command);
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

function writingKeyboardShortcutsPlugin(editability: WritingEditability) {
  return $prose(() => new Plugin({
    key: new PluginKey("markdown-notes-plus-writing-shortcuts"),
    props: {
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || !isWritingViewEditable(view) || editability.readOnlyRef.current) return false;
        if (isWritingLinkShortcut(event)) {
          if (!canApplyWritingLink(view, editability)) return false;
          event.preventDefault();
          promptAndApplyLink(view, editability);
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
  editability: WritingEditability;
  onMarkdownUpdated: (ctx: Ctx, markdown: string) => void;
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
  editability,
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
        },
      }));
    })
    .use(writingCommonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .config((ctx) => {
      ctx.get(listenerCtx).markdownUpdated((listenerContext, markdown) => onMarkdownUpdated(listenerContext, markdown));
    })
    .use((ctx) => async () => {
      await ctx.wait(SerializerReady);
      if (serializerRef) serializerRef.current = (doc: ProseNode) => ctx.get(serializerCtx)(doc);
    })
    .use($prose(() => writingOriginPlugin))
    .use($prose(() => createWritingFoldingPlugin()))
    .use($prose(() => createWritingShortcutsPlugin()))
    .use($prose(() => createWritingSmartKeysPlugin()))
    .use(writingLinkClickHandlerPlugin())
    .use(slashMenuPlugin(editability))
    .use(writingKeyboardShortcutsPlugin(editability));
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
export function WritingEditor({ value, readOnly, onChange, onToggleTask, onDeleteTask, command, onCapabilityChange, onLosslessFallback }: WritingEditorProps) {
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
  const commandRef = useRef(command);
  const capabilityRef = useRef(false);
  const appliedCommand = useRef<number>();
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

  const reportCapability = (result: WritingRoundTripResult, force = false) => {
    const next = result.editable;
    if (!force && capabilityRef.current === next) return;
    capabilityRef.current = next;
    onCapabilityChangeRef.current?.(result);
  };

  const synchronizeEditorValue = (target: string, forceReport = false) => {
    const editor = editorRef.current;
    if (!editor) return;
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
      if (pending.name === "link") promptAndApplyLink(view, { readOnlyRef, capabilityRef });
      else applyWritingCommand(view, pending.name);
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
      editability: { readOnlyRef, capabilityRef },
      onMarkdownUpdated: (ctx, markdown) => {
        if (serializerRef) serializerRef.current = (doc: ProseNode) => ctx.get(serializerCtx)(doc);
        const view = ctx.get(editorViewCtx);
        if (view.composing) return;
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

  return <div className={`milkdown-writing${readOnly ? " is-readonly" : ""}`} ref={host} onClick={handleClick} aria-label="Writing editor" />;
}
