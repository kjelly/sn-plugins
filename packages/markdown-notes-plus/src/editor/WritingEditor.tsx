import { useEffect, useRef } from "react";
import type { Ctx, MilkdownPlugin } from "@milkdown/ctx";
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, serializerCtx } from "@milkdown/core";
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
import { taskOrdinalAtDocumentPosition, WritingControlRegistry, writingControlIsDisabled, writingTaskIsHidden, type WritingControlState } from "./WritingTaskControls";
import { applyWritingOriginTransaction, assessWritingMutation, assessWritingRoundTrip, WRITING_TRANSACTION_ORIGIN_META, WritingEditorChangeGate, type WritingMutationOrigin, type WritingOriginState, type WritingRoundTripResult } from "./WritingEditorLifecycle";
import { applyWritingCommand, writingLinkHref, WRITING_COMMANDS, type SlashMatch, type WritingCommandName } from "./WritingCommands";
import { isWritingLinkShortcut } from "./WritingShortcuts";
export type { WritingCommandName } from "./WritingCommands";

export type WritingCommand = { id: number; name: WritingCommandName };

export type WritingEditorProps = {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onDeleteTask: (ordinal: number, renderedMarkdown: string) => void;
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
  onDeleteTask: (ordinal: number, renderedMarkdown: string) => void,
  renderedMarkdown: () => string | undefined,
) {
  const dom = document.createElement("li");
  setTaskListItemAttributes(dom, node);
  let input: HTMLInputElement | undefined;
  let deleteButton: HTMLButtonElement | undefined;
  let contentDOM: HTMLElement;

  const isReadOnly = () => writingControlIsDisabled(readOnlyRef.current, view.editable);
  const refresh = () => {
    const disabled = isReadOnly();
    if (input) input.disabled = disabled;
    if (deleteButton) deleteButton.disabled = disabled;
  };

  if (node.attrs.checked != null) {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(node.attrs.checked);
    input.className = "task-checkbox";
    input.setAttribute("aria-label", input.checked ? "Mark task incomplete" : "Mark task complete");
    input.disabled = isReadOnly();
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      const position = getPos();
      if (position === undefined || isReadOnly()) return;
      const current = view.state.doc.nodeAt(position);
      if (!current || current.type.name !== "list_item" || current.attrs.checked == null) return;
      view.dispatch(view.state.tr.setNodeMarkup(position, undefined, {
        ...current.attrs,
        checked: !current.attrs.checked,
      }));
      view.focus();
    });
    dom.append(input);
    deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "task-delete";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", "Delete task");
    deleteButton.title = "Delete task";
    deleteButton.disabled = isReadOnly();
    deleteButton.addEventListener("mousedown", (event) => event.preventDefault());
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      const position = getPos();
      if (position === undefined || isReadOnly()) return;
      const current = view.state.doc.nodeAt(position);
      if (!current || current.type.name !== "list_item" || current.attrs.checked == null) return;
      const ordinal = taskOrdinalAtDocumentPosition(view.state.doc, position);
      const currentMarkdown = renderedMarkdown();
      if (ordinal === undefined || currentMarkdown === undefined) return;
      onDeleteTask(ordinal, currentMarkdown);
    });
    dom.append(deleteButton);
    contentDOM = document.createElement("div");
    contentDOM.className = "task-content";
    contentDOM.dataset.taskContent = "true";
    dom.append(contentDOM);
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
  const { selection } = view.state;
  if (!selection.empty) return undefined;
  const beforeCursor = selection.$from.parent.textContent.slice(0, selection.$from.parentOffset);
  const match = beforeCursor.match(/(?:^|\s)\/([\w-]*)$/);
  if (!match) return undefined;
  const from = selection.$from.pos - match[0].length + (match[0][0] === " " ? 1 : 0);
  return { from, to: selection.from, query: match[1].toLowerCase() };
}

type WritingEditability = { readOnlyRef: { current: boolean }; capabilityRef: { current: boolean } };

function canApplyWritingLink(view: Pick<ProseEditorView, "editable">, editability: WritingEditability): boolean {
  return !editability.readOnlyRef.current && editability.capabilityRef.current && view.editable;
}

function promptAndApplyLink(view: ProseEditorView, editability: WritingEditability, range?: SlashMatch): boolean {
  if (!canApplyWritingLink(view, editability)) return false;
  const href = window.prompt("Link URL", writingLinkHref(view) ?? "");
  if (href === null) return false;
  return applyWritingCommand(view, "link", range, href);
}

function slashMenuPlugin(editability: WritingEditability) {
  return $prose(() => new Plugin({
    key: new PluginKey("markdown-notes-plus-slash-menu"),
    view: (initialView) => {
      const menu = document.createElement("div");
      menu.className = "slash-menu";
      menu.setAttribute("role", "menu");
      menu.hidden = true;
      const provider = new SlashProvider({
        content: menu,
        root: initialView.dom.parentElement ?? undefined,
        shouldShow: (view) => slashMatch(view) !== undefined,
      });
      let currentView = initialView;

      const refresh = (view: ProseEditorView, previous?: EditorState) => {
        currentView = view;
        const match = slashMatch(view);
        if (!match) {
          menu.hidden = true;
          provider.hide();
          return;
        }
        const commands = WRITING_COMMANDS.filter((command) => command.includes(match.query));
        menu.replaceChildren(...commands.map((command) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "slash-command";
          button.setAttribute("role", "menuitem");
          button.textContent = `/${command}`;
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            const range = slashMatch(currentView);
            if (command === "link") promptAndApplyLink(currentView, editability, range);
            else applyWritingCommand(currentView, command, range);
          });
          return button;
        }));
        menu.hidden = commands.length === 0;
        if (!menu.hidden) provider.update(view, previous);
      };

      initialView.dom.parentElement?.append(menu);
      refresh(initialView);
      return {
        update(view: ProseEditorView, previous: EditorState) { refresh(view, previous); },
        destroy() { provider.destroy(); menu.remove(); },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Escape") {
          const menu = view.dom.parentElement?.querySelector<HTMLElement>(".slash-menu");
          if (menu) menu.hidden = true;
        }
        return false;
      },
    },
  }));
}

function writingLinkShortcutPlugin(editability: WritingEditability) {
  return $prose(() => new Plugin({
    key: new PluginKey("markdown-notes-plus-writing-link-shortcut"),
    props: {
      handleKeyDown(view, event) {
        if (!isWritingLinkShortcut(event) || !canApplyWritingLink(view, editability)) return false;
        event.preventDefault();
        promptAndApplyLink(view, editability);
        return true;
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
    .replace(0, view.state.doc.content.size, new Slice(doc.content, 0, 0))
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
  onDeleteTaskRef: { current: (ordinal: number, renderedMarkdown: string) => void };
  editability: WritingEditability;
  onMarkdownUpdated: (ctx: Ctx, markdown: string) => void;
};

/** Own the complete pre-create Writing editor composition. */
export function configureWritingEditor(editor: Editor, {
  host,
  value,
  readOnlyRef,
  controls,
  onDeleteTaskRef,
  editability,
  onMarkdownUpdated,
}: WritingEditorConfiguration): Editor {
  return editor
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, value);
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
            (ordinal, renderedMarkdown) => onDeleteTaskRef.current?.(ordinal, renderedMarkdown),
            () => {
              try { return ctx.get(serializerCtx)(view.state.doc); } catch { return undefined; }
            },
          ),
        },
      }));
      ctx.get(listenerCtx).markdownUpdated((listenerContext, markdown) => onMarkdownUpdated(listenerContext, markdown));
    })
    .use(writingCommonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use($prose(() => writingOriginPlugin))
    .use(slashMenuPlugin(editability))
    .use(writingLinkShortcutPlugin(editability));
}

/** Keep the Milkdown document and capability proof aligned with canonical text. */
export function synchronizeWritingEditorValue({ gate, generation, value, replace, serialize, report }: WritingEditorValueSync): WritingRoundTripResult {
  if (gate.renderedMarkdown !== value) {
    const origin = gate.suppressExternalUpdate(generation);
    if (origin) replace(value, origin);
  }
  const proof = assessWritingRoundTrip(value, serialize());
  report(proof);
  return proof;
}

/** Milkdown CommonMark + GFM writing mode. Source remains the canonical owner. */
export function WritingEditor({ value, readOnly, onChange, onDeleteTask, command, onCapabilityChange, onLosslessFallback }: WritingEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor>();
  const gate = useRef(new WritingEditorChangeGate());
  const generationRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const readOnlyRef = useRef(readOnly);
  const controlsRef = useRef(new WritingControlRegistry());
  const onDeleteTaskRef = useRef(onDeleteTask);
  const commandRef = useRef(command);
  const capabilityRef = useRef(false);
  const appliedCommand = useRef<number>();
  onChangeRef.current = onChange;
  valueRef.current = value;
  readOnlyRef.current = readOnly;
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
      onDeleteTaskRef,
      editability: { readOnlyRef, capabilityRef },
      onMarkdownUpdated: (ctx, markdown) => {
        const originState = writingOriginPluginKey.getState(ctx.get(editorViewCtx).state) ?? { origin: "user" as const };
        const origin = originState.origin;
        if (!gate.current.markdownUpdated(generation, markdown, origin)) return;
        const proof = assessWritingMutation(valueRef.current, markdown, origin, originState.structural?.context);
        if (!proof.editable) {
          reportCapability(proof);
          // The serializer has already rendered the user's transaction.
          // Keep that exact rendered value visible in Source mode instead of
          // rolling it back and silently discarding the user's input. The
          // App owns the temporary fallback buffer and decides when an
          // explicit Source edit crosses the canonical/save boundary.
          onLosslessFallbackRef.current?.(markdown, proof);
          return;
        }
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
      editor.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !readOnly }));
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
    editorRef.current?.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !readOnly }));
    controlsRef.current.refresh();
  }, [readOnly]);

  return <div className={`milkdown-writing${readOnly ? " is-readonly" : ""}`} ref={host} aria-label="Writing editor" />;
}
