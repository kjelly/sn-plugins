import { useEffect, useRef } from "react";
import { history, historyKeymap, indentWithTab, defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { openSearchPanel } from "@codemirror/search";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { sourceChangeSetFromCodeMirror } from "./SourceChanges.ts";
import { shouldReportSourceSelection } from "./SourceSelection.ts";
import { synchronizeSourceEditor } from "./SourceEditorSync.ts";
import { findMarkdownLinkAtOffset } from "./SourceLinks.ts";
import { openExternalLink } from "../utils/linkOpener.ts";
import type { TextChangeSet } from "../document/PositionMap.ts";

export type SourceEditorProps = {
  value: string;
  resetGeneration: number;
  readOnly: boolean;
  onChange: (value: string, changeSet?: TextChangeSet) => void;
  onView: (view: EditorView | undefined) => void;
  onSelection?: (offset: number) => void;
};

/** CodeMirror 6 source mode. Its document is always the canonical Markdown string. */
export function SourceEditor({ value, resetGeneration, readOnly, onChange, onView, onSelection }: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const applyingExternal = useRef(false);
  const readOnlyCompartment = useRef(new Compartment());
  const historyCompartment = useRef(new Compartment());
  const resetGenerationRef = useRef(resetGeneration);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelection);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelection;

  useEffect(() => {
    if (!host.current) return undefined;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        markdown({ base: markdownLanguage }),
        historyCompartment.current.of(history()),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.cspNonce.of("sn-editor-csp-nonce"),
        readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal.current) {
            onChangeRef.current(update.state.doc.toString(), sourceChangeSetFromCodeMirror(
              update.startState.doc.length,
              update.state.doc.length,
              update.changes,
            ));
          }
          if (shouldReportSourceSelection(update, applyingExternal.current)) {
            onSelectionRef.current?.(update.state.selection.main.head);
          }
        }),
        EditorView.domEventHandlers({
          click(event, editorView) {
            if (!event.ctrlKey && !event.metaKey) return false;
            const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const line = editorView.state.doc.lineAt(pos);
            const offsetInLine = pos - line.from;
            const url = findMarkdownLinkAtOffset(line.text, offsetInLine);
            if (url) {
              event.preventDefault();
              event.stopPropagation();
              openExternalLink(url);
              return true;
            }
            return false;
          },
        }),
      ],
    });
    const next = new EditorView({ state, parent: host.current });
    view.current = next;
    resetGenerationRef.current = resetGeneration;
    onView(next);
    return () => { onView(undefined); next.destroy(); view.current = undefined; };
  }, [onView]);

  useEffect(() => {
    const current = view.current;
    if (!current || (current.state.doc.toString() === value && resetGenerationRef.current === resetGeneration)) return;
    applyingExternal.current = true;
    try {
      synchronizeSourceEditor(current, value, historyCompartment.current, resetGenerationRef.current, resetGeneration);
      resetGenerationRef.current = resetGeneration;
    } finally {
      applyingExternal.current = false;
    }
  }, [value, resetGeneration]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, select, textarea")) return;
    if (!view.current?.hasFocus) {
      view.current?.focus();
    }
  };

  return <div className="cm-source" ref={host} onClick={handleClick} aria-label="Markdown source" />;
}

export function openSourceSearch(view: EditorView | undefined): void { if (view) openSearchPanel(view); }
