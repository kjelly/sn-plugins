import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, type EditorView as EditorViewType } from "@codemirror/view";
import { CanonicalDocument, type DocumentState } from "../document/CanonicalDocument";
import { EditorKitBridge } from "../standardnotes/EditorKitBridge";
import { createEditorKit } from "../standardnotes/EditorKitRuntime";
import { analyzeMarkdown, deleteCompleted, deleteTask, projectMindmapMarkdown, sectionAnchorAt, toggleTask, uncheckAll } from "../markdown/analysis";
import type { TextChangeSet } from "../document/PositionMap.ts";
import { reconcileSectionAnchor } from "../document/SectionAnchor.ts";
import { taskIndex } from "../tasks/TaskIndex";
import { outlineIndex } from "../outline/OutlineIndex";
import { installThemeBridge } from "../theme/theme";
import { SourceEditor, openSourceSearch } from "../editor/SourceEditor";
import { WritingEditor, type WritingCommand, type WritingCommandName } from "../editor/WritingEditor";
import type { WritingRoundTripResult } from "../editor/WritingEditorLifecycle";
import { MindMapView, type MindMapFilter } from "../mindmap/MindMapView";
import { AppDocumentLifecycle } from "./AppDocumentLifecycle";

type Mode = "writing" | "split" | "source" | "mindmap";
type MindMapScope = "entire-note" | "current-section";

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundaryImpl>{children}</ErrorBoundaryImpl>;
}

class ErrorBoundaryImpl extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <div className="error-box" role="alert">Editor pane unavailable: {this.state.error.message}</div> : this.props.children; }
}

export function App() {
  const canonical = useMemo(() => new CanonicalDocument(), []);
  const appLifecycle = useMemo(() => new AppDocumentLifecycle(canonical), [canonical]);
  const [, rerender] = useState<DocumentState>(canonical.snapshot());
  const writingHistoryResetRef = useRef<() => void>(() => undefined);
  const bridge = useMemo(() => new EditorKitBridge(
    canonical,
    () => rerender(canonical.snapshot()),
    createEditorKit,
    undefined,
    () => writingHistoryResetRef.current(),
  ), [canonical]);
  const [mode, setMode] = useState<Mode>("writing");
  const [filter, setFilter] = useState<MindMapFilter>("all");
  const [mindMapScope, setMindMapScope] = useState<MindMapScope>("entire-note");
  const [collapsed, setCollapsed] = useState(false);
  const [activeSectionAnchor, setActiveSectionAnchor] = useState<number>();
  const [sourceFallbackText, setSourceFallbackText] = useState<string>();
  const [writingCommand, setWritingCommand] = useState<WritingCommand>();
  const [writingResetEpoch, setWritingResetEpoch] = useState(0);
  const [writingCapability, setWritingCapability] = useState<WritingRoundTripResult>({ editable: false, reason: "Writing is checking whether this source can be preserved exactly." });
  const nextCommandId = useRef(1);
  const sourceViewRef = useRef<EditorViewType>();
  const canonicalTextRef = useRef(canonical.text);
  const pendingJump = useRef<{ from: number; to: number }>();
  const bridgeLifecycleGeneration = useRef(0);
  writingHistoryResetRef.current = () => {
    setWritingResetEpoch((epoch) => epoch + 1);
    setWritingCommand(undefined);
  };
  const snapshot = canonical.snapshot();
  const analysis = analyzeMarkdown(snapshot.text);
  const currentSection = activeSectionAnchor === undefined ? undefined : analysis.sectionByAnchor(activeSectionAnchor);
  const mapMarkdown = projectMindmapMarkdown(
    snapshot.text,
    filter,
    mindMapScope === "current-section" ? currentSection : undefined,
  );
  const tasks = taskIndex(snapshot.text);
  const headings = outlineIndex(snapshot.text);
  const writingReadOnly = snapshot.locked || !appLifecycle.canApplyLocal() || !writingCapability.editable;
  const writingVisible = mode === "writing" || mode === "split";
  const bridgeState = bridge.getState();

  useEffect(() => {
    if (mindMapScope === "current-section" && !currentSection) setMindMapScope("entire-note");
  }, [currentSection, mindMapScope]);

  useEffect(() => {
    const unsubscribeFallback = appLifecycle.subscribeFallback(setSourceFallbackText);
    const unsubscribe = canonical.subscribe((next, transition) => {
      const previous = canonicalTextRef.current;
      canonicalTextRef.current = next.text;
      appLifecycle.observeCanonicalTransition(previous, next, transition);
      if (previous !== next.text) {
        setActiveSectionAnchor((anchor) => {
          return reconcileSectionAnchor(next.text, transition?.changeSet, anchor);
        });
      }
      rerender(next);
    });
    bridge.start();
    const uninstallTheme = installThemeBridge(() => rerender(canonical.snapshot()));
    return () => { uninstallTheme(); unsubscribe(); unsubscribeFallback(); };
  }, [appLifecycle, bridge, canonical]);

  useEffect(() => {
    const lifecycleGeneration = bridgeLifecycleGeneration.current + 1;
    bridgeLifecycleGeneration.current = lifecycleGeneration;
    const flush = () => bridge.flush();
    const flushWhenHidden = () => { if (document.visibilityState === "hidden") bridge.flush(); };
    const dispose = () => { bridge.dispose(); };
    globalThis.addEventListener("beforeunload", flush);
    globalThis.addEventListener("blur", flush);
    globalThis.addEventListener("pagehide", dispose);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      globalThis.removeEventListener("beforeunload", flush);
      globalThis.removeEventListener("blur", flush);
      globalThis.removeEventListener("pagehide", dispose);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      bridge.flush();
      queueMicrotask(() => {
        if (bridgeLifecycleGeneration.current !== lifecycleGeneration) return;
        bridge.dispose();
      });
    };
  }, [bridge]);

  const edit = (next: string, changeSet?: TextChangeSet) => {
    if (appLifecycle.applyLocal(next, changeSet)) bridge.notifyLocalChange(canonical.text);
  };
  const editSource = (next: string, changeSet?: TextChangeSet) => {
    // CodeMirror's change set is relative to the temporary fallback text, not
    // to canonical.text. The first explicit Source edit therefore crosses the
    // existing canonical boundary as an opaque full-text replacement; all
    // subsequent edits use the normal exact CodeMirror map path.
    if (appLifecycle.applySourceEdit(next, changeSet)) bridge.notifyLocalChange(canonical.text);
  };
  const mutate = (command: (text: string) => { markdown: string; changeSet?: TextChangeSet }) => {
    const result = command(canonical.text);
    edit(result.markdown, result.changeSet);
  };
  const deleteWritingTask = (ordinal: number, renderedMarkdown: string) => {
    if (!appLifecycle.canApplyLocal()) return;
    if (renderedMarkdown !== canonical.text) return;
    const currentAnalysis = analyzeMarkdown(canonical.text);
    const task = currentAnalysis.tasks[ordinal];
    if (!task) return;
    const result = deleteTask(canonical.text, task, ordinal);
    edit(result.markdown, result.changeSet);
  };
  const runWritingCommand = (name: WritingCommandName) => {
    if (!appLifecycle.canApplyLocal()) return;
    setWritingCommand({ id: nextCommandId.current, name });
    nextCommandId.current += 1;
  };
  const jumpToSource = useCallback((view: EditorViewType | undefined) => {
    sourceViewRef.current = view;
    const jump = pendingJump.current;
    if (!view || !jump) return;
    pendingJump.current = undefined;
    view.dispatch({ selection: { anchor: jump.from, head: jump.to }, effects: EditorView.scrollIntoView(jump.from, { y: "center" }) });
    view.focus();
  }, []);
  const selectSourceSection = useCallback((offset: number) => {
    setActiveSectionAnchor(sectionAnchorAt(canonical.text, offset));
  }, [canonical]);
  const localHistoryMutation = (mutation: () => boolean) => {
    if (appLifecycle.applyHistory(mutation)) bridge.notifyLocalChange(canonical.text);
  };
  const focusHeading = (from: number, to: number) => {
    setActiveSectionAnchor(from);
    pendingJump.current = { from, to };
    setMode("source");
    const view = sourceViewRef.current;
    if (!view) return;
    jumpToSource(view);
  };

  useEffect(() => {
    if (mode === "source") jumpToSource(sourceViewRef.current);
  }, [jumpToSource, mode]);

  return <main className={`app-shell mode-${mode}`}>
    <header className="app-toolbar">
      <h1>Markdown Notes+</h1>
      <div className="mode-buttons" role="toolbar" aria-label="Editor mode">
        {(["writing", "split", "source", "mindmap"] as Mode[]).map((candidate) => <button key={candidate} className={mode === candidate ? "active" : ""} onClick={() => setMode(candidate)}>{candidate[0].toUpperCase() + candidate.slice(1)}</button>)}
      </div>
      <button disabled={snapshot.locked || appLifecycle.hasFallback} onClick={() => localHistoryMutation(() => canonical.undo())} title="Undo">Undo</button>
      <button disabled={snapshot.locked || appLifecycle.hasFallback} onClick={() => localHistoryMutation(() => canonical.redo())} title="Redo">Redo</button>
      <span className="current-section" aria-label="Current section">{currentSection?.path.length ? currentSection.path.join(" / ") : "Document"}</span>
      <span className="status" role="status">{snapshot.locked ? "Locked · read-only" : sourceFallbackText !== undefined ? "Source fallback · edit to apply" : !writingCapability.editable && writingVisible ? `Writing read-only · ${writingCapability.reason ?? "use Source mode for exact Markdown"}` : snapshot.pendingRemote !== undefined ? "Remote update pending" : snapshot.dirty ? (bridgeState.saveRequested ? "Edited · save requested; host confirmation unavailable" : "Edited · save pending") : "Ready"}</span>
    </header>
    {snapshot.pendingRemote !== undefined ? <aside className="conflict" role="alert"><span>Another device changed this note.</span><button onClick={() => bridge.resolveConflict("keep-local")}>Keep local</button><button onClick={() => bridge.resolveConflict("accept-remote")}>Accept remote</button></aside> : null}
    <section className="editing-grid">
      {/* Keep Milkdown mounted across mode changes so its selection/history stay local. */}
      <section className="writing-pane pane" hidden={!writingVisible}><div className="pane-toolbar" role="toolbar" aria-label="Writing tools">
        <button disabled={writingReadOnly} onClick={() => runWritingCommand("heading")}>H1</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("heading2")}>H2</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("bullet")}>Bullet</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("task")}>Task</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("quote")}>Quote</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("code")}>Code</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("table")}>Table</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("link")}>Link</button><button disabled={writingReadOnly} onClick={() => runWritingCommand("divider")}>Divider</button><span className="slash-hint">Type / for commands</span><span className="section-anchor-hint">Current section follows the last Source/Outline anchor; Writing has no live source cursor.</span>
      </div><ErrorBoundary><WritingEditor key={writingResetEpoch} value={snapshot.text} readOnly={writingReadOnly} onChange={edit} onDeleteTask={deleteWritingTask} command={writingCommand} onCapabilityChange={setWritingCapability} onLosslessFallback={(markdown) => { appLifecycle.preserveWritingFallback(markdown); setMode("source"); }} /></ErrorBoundary></section>
      {mode === "source" ? <section className="source-pane pane"><div className="pane-toolbar"><button onClick={() => openSourceSearch(sourceViewRef.current)}>Search / Replace</button><span>Raw Markdown · whitespace preserved</span></div><SourceEditor value={sourceFallbackText ?? snapshot.text} resetGeneration={snapshot.resetGeneration} readOnly={snapshot.locked} onChange={editSource} onView={jumpToSource} onSelection={selectSourceSection} /></section> : null}
      {mode === "split" || mode === "mindmap" ? <section className="map-pane pane"><div className="pane-toolbar"><label>Tasks <select value={filter} onChange={(event) => setFilter(event.target.value as MindMapFilter)}><option value="all">All</option><option value="open">Open only</option><option value="hide">Hide tasks</option></select></label><label>Scope <select value={mindMapScope} onChange={(event) => setMindMapScope(event.target.value as MindMapScope)} disabled={!currentSection && mindMapScope === "current-section"}><option value="entire-note">Entire note</option><option value="current-section" disabled={!currentSection}>Current section</option></select></label><span className="map-controls">Pan · Zoom · Fit on refresh</span></div><ErrorBoundary><MindMapView markdown={mapMarkdown} /></ErrorBoundary></section> : null}
    </section>
      {mode !== "mindmap" ? <section className="lower-grid"><section className="tasks-panel pane" aria-label="Completed tasks"><div className="panel-heading"><h2>Completed ({tasks.completed.length})</h2>{tasks.completed.length ? <button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Show" : "Hide"}</button> : null}</div>{!collapsed && tasks.completed.length ? <><ul>{tasks.completed.map((task) => <li key={`${task.from}:${task.checkboxOffset}`}><span>☑ {task.text}{task.headingPath.length ? <small className="task-breadcrumb"> · {task.headingPath.join(" / ")}</small> : null}</span><button disabled={snapshot.locked || appLifecycle.hasFallback} onClick={() => mutate((text) => toggleTask(text, task))}>Uncheck</button><button disabled={snapshot.locked || appLifecycle.hasFallback} onClick={() => mutate((text) => deleteTask(text, task))}>Delete</button></li>)}</ul><div className="actions"><button disabled={snapshot.locked || appLifecycle.hasFallback} onClick={() => mutate(uncheckAll)}>Uncheck all</button><button disabled={snapshot.locked || appLifecycle.hasFallback} onClick={() => mutate(deleteCompleted)}>Delete completed</button></div></> : null}</section><section className="outline-panel pane"><h2>Outline</h2>{headings.length ? <ol>{headings.map((heading) => <li key={heading.from}><button onClick={() => focusHeading(heading.from, heading.to)}>{heading.text}</button></li>)}</ol> : <p>No headings yet.</p>}</section></section> : null}
    <footer className="note-meta">{analysis.tasks.length} task{analysis.tasks.length === 1 ? "" : "s"} · {headings.length} section{headings.length === 1 ? "" : "s"} · EditorKit markdown bridge</footer>
  </main>;
}
