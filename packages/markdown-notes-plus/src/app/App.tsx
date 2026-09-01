import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, type EditorView as EditorViewType } from "@codemirror/view";
import { CanonicalDocument, type DocumentState } from "../document/CanonicalDocument";
import { EditorKitBridge } from "../standardnotes/EditorKitBridge";
import { createEditorKit } from "../standardnotes/EditorKitRuntime";
import {
  analyzeMarkdown,
  checkAllInSection,
  deleteCompleted,
  deleteCompletedInSection,
  deleteCompletedInHeadingPath,
  deleteTask,
  isMindmapSuitable,
  projectMindmapMarkdown,
  sectionAnchorAt,
  toggleTask,
  uncheckAll,
  uncheckAllInSection,
  uncheckAllInHeadingPath,
} from "../markdown/analysis";
import type { TextChangeSet } from "../document/PositionMap.ts";
import { reconcileSectionAnchor } from "../document/SectionAnchor.ts";
import { normalizeBareUrls } from "../document/normalizeBareUrls.ts";
import { groupTasksByHeading, taskIndex } from "../tasks/TaskIndex";
import { deadlineStatus, formatIsoDate } from "../tasks/RecurringTasks.ts";
import { outlineIndex } from "../outline/OutlineIndex";
import { OutlinePanel } from "../outline/OutlinePanel.tsx";
import { getAllCollapsibleAnchors, reconcileOutlineAnchors } from "../outline/OutlineProjection.ts";
import { computeSectionBreadcrumbs } from "../editor/WritingFolding.ts";
import {
  moveSubtree,
  moveSubtreeBefore,
  moveSubtreeAfter,
  promoteSubtree,
  demoteSubtree,
  duplicateSubtree,
} from "../markdown/structuralEditing.ts";
import { installThemeBridge } from "../theme/theme";
import { SourceEditor, openSourceSearch } from "../editor/SourceEditor";
import { WritingEditor, type WritingCommand, type WritingCommandName } from "../editor/WritingEditor";
import type { WritingRoundTripResult } from "../editor/WritingEditorLifecycle";
import { MindMapView, type MindMapFilter } from "../mindmap/MindMapView";
import { AppDocumentLifecycle } from "./AppDocumentLifecycle";
import {
  armWritingEnableAttempt,
  createWritingEnableAttemptState,
  modeAfterRequest,
  observeWritingCanonical,
  observeWritingCapability,
} from "./AppModeTransition";
import {
  type InsertLibrary,
  type TemplateDefinition,
  type SnippetDefinition,
  createEmptyLibrary,
  expandTemplateVariables,
  extractNoteTitle,
} from "../templates/TemplateEngine.ts";
import { TemplateManagerModal } from "../templates/TemplateManagerModal.tsx";
import {
  analyzeNoteHealth,
  applyDiagnosticAutoFix,
  applyAllSafeAutoFixes,
} from "../review/ReviewDiagnostics.ts";
import { ReviewPanel } from "../review/ReviewPanel.tsx";
import { NavigationPaletteModal } from "../navigation/NavigationPaletteModal.tsx";
import { useVisualViewport } from "./useVisualViewport.ts";

type Mode = "writing" | "split" | "source" | "mindmap";
type MindMapScope = "entire-note" | "current-section";

function SidebarToggleButton({
  sidebarOpen,
  onToggle,
}: {
  sidebarOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`sidebar-toggle-btn ${sidebarOpen ? "active" : ""}`}
      onClick={onToggle}
      title="Toggle sidebar (Ctrl+\)"
      aria-label="Toggle sidebar"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
      <span>Sidebar</span>
    </button>
  );
}

function EditorNavigationControls({
  mode,
  onModeChange,
  historyDisabled,
  onUndo,
  onRedo,
  mindmapSuitable = true,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  historyDisabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  mindmapSuitable?: boolean;
}) {
  const availableModes: Mode[] = mindmapSuitable
    ? ["writing", "source", "mindmap", "split"]
    : ["writing", "source"];

  return <>
    <div className="mode-buttons" role="toolbar" aria-label="Editor mode">
      {availableModes.map((candidate) => <button key={candidate} className={mode === candidate ? "active" : ""} onClick={() => onModeChange(candidate)}>{candidate[0].toUpperCase() + candidate.slice(1)}</button>)}
    </div>
    <button disabled={historyDisabled} onClick={onUndo} title="Undo">Undo</button>
    <button disabled={historyDisabled} onClick={onRedo} title="Redo">Redo</button>
  </>;
}

function StatusInfo({
  currentSection,
  snapshot,
  sourceFallbackText,
  writingCapability,
  writingVisible,
  bridgeState,
}: {
  currentSection?: { path: string[] };
  snapshot: DocumentState;
  sourceFallbackText?: string;
  writingCapability: WritingRoundTripResult;
  writingVisible: boolean;
  bridgeState: { saveRequested: boolean };
}) {
  return (
    <div className="status-and-sidebar">
      <span className="current-section" aria-label="Current section">
        {currentSection?.path.length ? currentSection.path.join(" / ") : ""}
      </span>
      <span className="status" role="status">
        {snapshot.locked
          ? "Locked · read-only"
          : sourceFallbackText !== undefined
          ? "Source fallback · edit to apply"
          : !writingCapability.editable && writingVisible
          ? `Writing read-only · ${writingCapability.reason ?? "use Source mode for exact Markdown"}`
          : snapshot.pendingRemote !== undefined
          ? "Remote update pending"
          : snapshot.dirty
          ? bridgeState.saveRequested
            ? "Edited · save requested; host confirmation unavailable"
            : "Edited · save pending"
          : "Ready"}
      </span>
    </div>
  );
}

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundaryImpl>{children}</ErrorBoundaryImpl>;
}

class ErrorBoundaryImpl extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <div className="error-box" role="alert">Editor pane unavailable: {this.state.error.message}</div> : this.props.children; }
}

export function App() {
  useVisualViewport();
  const canonical = useMemo(() => new CanonicalDocument(), []);
  const appLifecycle = useMemo(() => new AppDocumentLifecycle(canonical), [canonical]);
  const [, rerender] = useState<DocumentState>(canonical.snapshot());
  const writingHistoryResetRef = useRef<() => void>(() => undefined);
  const bridgeStartMode = typeof window === "undefined"
    ? undefined
    : new URLSearchParams(window.location.search).get("sn-bridge-start");
  const bridge = useMemo(() => new EditorKitBridge(
    canonical,
    () => rerender(canonical.snapshot()),
    createEditorKit,
    undefined,
    () => writingHistoryResetRef.current(),
  ), [canonical]);
  // The host sends component-registered from iframe setup and may not retry.
  // Start the relay during render for normal production startup so its message
  // listener exists before the host can deliver that one-shot message. The
  // deterministic harness can still request a deliberately manual start.
  if (bridgeStartMode !== "manual") bridge.start();
  const [mode, setMode] = useState<Mode>("writing");
  const [todayKey, setTodayKey] = useState(() => formatIsoDate(new Date()));
  const [filter, setFilter] = useState<MindMapFilter>("all");
  const [mindMapScope, setMindMapScope] = useState<MindMapScope>("entire-note");
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedOutlineAnchors, setCollapsedOutlineAnchors] = useState<Set<number>>(new Set());
  const [focusedSectionAnchor, setFocusedSectionAnchor] = useState<number>();
  const isNarrowViewport = () => {
    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia === "function") return window.matchMedia("(max-width: 900px)").matches;
    return window.innerWidth < 900;
  };
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowViewport());
  const sidebarManualOverrideRef = useRef(false);
  const [sidebarTab, setSidebarTab] = useState<"outline" | "review" | "tasks">("outline");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeSectionAnchor, setActiveSectionAnchor] = useState<number>();
  const [sourceFallbackText, setSourceFallbackText] = useState<string>();
  const [writingCommand, setWritingCommand] = useState<WritingCommand>();
  const [library, setLibrary] = useState<InsertLibrary>(() => createEmptyLibrary());
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [insertPayload, setInsertPayload] = useState<{ id: number; markdown: string; cursorOffset?: number }>();
  const [writingResetEpoch, setWritingResetEpoch] = useState(0);
  const [writingCapability, setWritingCapability] = useState<WritingRoundTripResult>({ editable: false, reason: "Writing is checking whether this source can be preserved exactly." });
  const writingEnableAttemptRef = useRef(createWritingEnableAttemptState());
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
  const mindmapSuitable = isMindmapSuitable(snapshot.text, analysis);
  const currentSection = activeSectionAnchor === undefined ? undefined : analysis.sectionByAnchor(activeSectionAnchor);
  const focusedSection = focusedSectionAnchor === undefined ? undefined : analysis.sectionByAnchor(focusedSectionAnchor);
  const breadcrumbs = useMemo(() => focusedSection ? computeSectionBreadcrumbs(analysis, focusedSection.anchor) : [], [analysis, focusedSection]);
  const mapMarkdown = projectMindmapMarkdown(
    snapshot.text,
    filter,
    mindMapScope === "current-section" ? currentSection : undefined,
  );
  const tasks = taskIndex(snapshot.text);
  const headings = outlineIndex(snapshot.text);
  const completedGroups = useMemo(() => groupTasksByHeading(tasks.completed), [tasks.completed]);
  const writingReadOnly = snapshot.locked || !appLifecycle.canApplyLocal() || !writingCapability.editable;
  const writingVisible = mode === "writing" || mode === "split";
  const bridgeState = bridge.getState();
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);

  useEffect(() => {
    const now = new Date();
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = globalThis.setTimeout(() => setTodayKey(formatIsoDate(new Date())), nextDay.getTime() - now.getTime() + 10);
    return () => globalThis.clearTimeout(timer);
  }, [todayKey]);
  const toggleSidebar = useCallback(() => {
    sidebarManualOverrideRef.current = true;
    setSidebarOpen((open) => !open);
  }, []);
  const closeSidebar = useCallback(() => {
    sidebarManualOverrideRef.current = true;
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 900px)");
    const applyResponsiveSidebar = () => {
      if (sidebarManualOverrideRef.current) return;
      setSidebarOpen(!media.matches);
    };
    const handleChange = () => applyResponsiveSidebar();
    applyResponsiveSidebar();
    if (typeof media.addEventListener === "function") media.addEventListener("change", handleChange);
    else media.addListener(handleChange);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", handleChange);
      else media.removeListener(handleChange);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    self.addEventListener("keydown", handleGlobalKeyDown);
    return () => self.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const reviewReport = useMemo(() => analyzeNoteHealth(snapshot.text, analysis), [snapshot.text, analysis]);

  const handleSaveLibrary = useCallback((next: InsertLibrary) => {
    setLibrary(next);
  }, []);

  const handleInsertTemplate = useCallback((template: TemplateDefinition) => {
    const noteTitle = extractNoteTitle(canonical.text);
    const expanded = expandTemplateVariables(template.content, {
      date: new Date(),
      noteTitle,
    });
    if (mode === "source") {
      const view = sourceViewRef.current;
      if (view) {
        const sel = view.state.selection.main;
        view.dispatch(view.state.update({
          changes: { from: sel.from, to: sel.to, insert: expanded.text },
          selection: { anchor: sel.from + (expanded.cursorOffset ?? expanded.text.length) },
        }));
        view.focus();
      } else {
        return;
      }
    } else {
      setInsertPayload({ id: Date.now(), markdown: expanded.text, cursorOffset: expanded.cursorOffset });
    }
  }, [canonical, mode]);

  const handleInsertSnippet = useCallback((snippet: SnippetDefinition) => {
    const noteTitle = extractNoteTitle(canonical.text);
    const expanded = expandTemplateVariables(snippet.content, {
      date: new Date(),
      noteTitle,
    });
    if (mode === "source") {
      const view = sourceViewRef.current;
      if (view) {
        const sel = view.state.selection.main;
        view.dispatch(view.state.update({
          changes: { from: sel.from, to: sel.to, insert: expanded.text },
          selection: { anchor: sel.from + (expanded.cursorOffset ?? expanded.text.length) },
        }));
        view.focus();
      } else {
        return;
      }
    } else {
      setInsertPayload({ id: Date.now(), markdown: expanded.text, cursorOffset: expanded.cursorOffset });
    }
  }, [canonical, mode]);

  const requestMode = (nextMode: Mode) => {
    // A rejected Writing serialization is only a Source-visible user input.
    // Keep it outside canonical state until an explicit Source edit resolves it.
    const resolvedMode = modeAfterRequest(nextMode, appLifecycle.hasFallback);
    if (resolvedMode !== nextMode) {
      setMode(resolvedMode);
      return;
    }
    setMode(resolvedMode);
  };

  useEffect(() => {
    if (!mindmapSuitable && (mode === "mindmap" || mode === "split")) {
      requestMode("writing");
    }
  }, [mindmapSuitable, mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (mindMapScope === "current-section" && !currentSection) setMindMapScope("entire-note");
  }, [currentSection, mindMapScope]);

  useEffect(() => {
    const unsubscribeFallback = appLifecycle.subscribeFallback(setSourceFallbackText);
    const unsubscribe = canonical.subscribe((next, transition) => {
      const previous = canonicalTextRef.current;
      writingEnableAttemptRef.current = observeWritingCanonical(writingEnableAttemptRef.current, {
        previousCanonicalText: previous,
        currentCanonicalText: next.text,
        documentGeneration: next.resetGeneration,
        initialized: transition?.kind === "initialize",
      });
      canonicalTextRef.current = next.text;
      appLifecycle.observeCanonicalTransition(previous, next, transition);
      if (previous !== next.text) {
        setActiveSectionAnchor((anchor) => {
          return reconcileSectionAnchor(next.text, transition?.changeSet, anchor);
        });
        setFocusedSectionAnchor((anchor) => {
          return reconcileSectionAnchor(next.text, transition?.changeSet, anchor);
        });
        setCollapsedOutlineAnchors((anchors) => {
          const nextAnalysis = analyzeMarkdown(next.text);
          return reconcileOutlineAnchors(anchors, transition?.changeSet, nextAnalysis);
        });
      }
      rerender(next);
    });
    const mobileProtocolParams = typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search);
    const mobileProtocolTest = mobileProtocolParams?.get("sn-mobile-protocol") === "1";
    const manualBridgeStart = mobileProtocolTest && mobileProtocolParams?.get("sn-bridge-start") === "manual";
    const bridgeReadyDelayMs = Math.max(0, Number(mobileProtocolParams?.get("sn-bridge-ready-delay-ms") ?? "0") || 0);
    let bridgeReadyTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const announceBridgeReady = () => {
      if (mobileProtocolTest) {
        document.documentElement.dataset.snBridgeReady = "true";
      }
    };
    const startBridge = () => {
      bridge.start();
      if (manualBridgeStart) window.parent.postMessage({ type: "sn-bridge-started" }, "*");
      if (bridgeReadyDelayMs === 0) announceBridgeReady();
      else bridgeReadyTimer = globalThis.setTimeout(announceBridgeReady, bridgeReadyDelayMs);
    };
    const startBridgeOnRequest = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== "sn-start-bridge") return;
      globalThis.removeEventListener("message", startBridgeOnRequest);
      startBridge();
    };
    if (manualBridgeStart) {
      globalThis.addEventListener("message", startBridgeOnRequest);
      window.parent.postMessage({ type: "sn-bridge-start-pending" }, "*");
    } else {
      startBridge();
    }
    const uninstallTheme = installThemeBridge(() => rerender(canonical.snapshot()));
    return () => {
      if (bridgeReadyTimer !== undefined) globalThis.clearTimeout(bridgeReadyTimer);
      globalThis.removeEventListener("message", startBridgeOnRequest);
      if (mobileProtocolTest) delete document.documentElement.dataset.snBridgeReady;
      uninstallTheme();
      unsubscribe();
      unsubscribeFallback();
    };
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
  const handleWritingCapabilityChange = useCallback((result: WritingRoundTripResult, proofSource?: string) => {
    setWritingCapability(result);
    const current = canonical.snapshot();
    const outcome = observeWritingCapability(writingEnableAttemptRef.current, {
      editable: result.editable,
      proofSource,
      currentCanonicalText: current.text,
      documentGeneration: current.resetGeneration,
    });
    writingEnableAttemptRef.current = outcome.state;
    if (outcome.enableWriting) {
      setMode((currentMode) => currentMode === "writing" || currentMode === "split" ? currentMode : "writing");
    }
  }, [canonical]);
  const handleNormalizeBareUrls = useCallback(() => {
    if (snapshot.locked || !appLifecycle.canApplyLocal()) return;
    const result = normalizeBareUrls(canonical.text);
    if (!result.changed) return;
    const before = canonical.snapshot();
    writingEnableAttemptRef.current = armWritingEnableAttempt(
      writingEnableAttemptRef.current,
      result.markdown,
      before.resetGeneration,
      true,
    );
    const applied = appLifecycle.applyLocal(result.markdown, result.changeSet);
    if (applied) bridge.notifyLocalChange(canonical.text);
    else writingEnableAttemptRef.current = armWritingEnableAttempt(writingEnableAttemptRef.current, result.markdown, before.resetGeneration, false);
  }, [appLifecycle, canonical, snapshot.locked]);
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
  const handleAutoFix = useCallback((issueId: string) => {
    mutate((text) => applyDiagnosticAutoFix(text, issueId));
  }, []);
  const handleFixAll = useCallback(() => {
    mutate((text) => applyAllSafeAutoFixes(text));
  }, []);
  const toggleWritingTask = (ordinal: number, renderedMarkdown?: string) => {
    if (!appLifecycle.canApplyLocal()) return;
    const source = renderedMarkdown ?? canonical.text;
    const currentAnalysis = analyzeMarkdown(source);
    const task = currentAnalysis.tasks[ordinal];
    if (!task) return;
    const result = toggleTask(source, task);
    edit(result.markdown, result.changeSet);
  };
  const toggleMindmapTask = (ordinal: number) => {
    if (!appLifecycle.canApplyLocal()) return;
    const mapAnalysis = analyzeMarkdown(mapMarkdown);
    const mapTask = mapAnalysis.tasks[ordinal];
    if (!mapTask) return;
    const currentAnalysis = analyzeMarkdown(canonical.text);
    const targetTask = currentAnalysis.tasks.find(
      (t) => t.text === mapTask.text && t.headingPath.join("/") === mapTask.headingPath.join("/") && t.checked === mapTask.checked
    ) ?? currentAnalysis.tasks.find((t) => t.text === mapTask.text) ?? currentAnalysis.tasks[ordinal];
    if (!targetTask) return;
    const result = toggleTask(canonical.text, targetTask);
    edit(result.markdown, result.changeSet);
  };
  const deleteWritingTask = (ordinal: number, renderedMarkdown?: string) => {
    if (!appLifecycle.canApplyLocal()) return;
    const source = renderedMarkdown ?? canonical.text;
    const currentAnalysis = analyzeMarkdown(source);
    const task = currentAnalysis.tasks[ordinal];
    if (!task) return;
    const result = deleteTask(source, task, ordinal);
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
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      closeSidebar();
    }
    requestMode("source");
    const view = sourceViewRef.current;
    if (!view) return;
    jumpToSource(view);
  };

  const handleToggleOutlineFold = (anchor: number) => {
    setCollapsedOutlineAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(anchor)) next.delete(anchor);
      else next.add(anchor);
      return next;
    });
  };
  const handleCollapseAllOutline = () => {
    setCollapsedOutlineAnchors(new Set(getAllCollapsibleAnchors(analysis)));
  };
  const handleExpandAllOutline = () => {
    setCollapsedOutlineAnchors(new Set());
  };
  const handleMoveSubtree = (anchor: number, direction: "up" | "down") => {
    mutate((text) => moveSubtree(text, anchor, direction));
  };
  const handleMoveSubtreeBefore = (sourceAnchor: number, targetAnchor: number) => {
    mutate((text) => moveSubtreeBefore(text, sourceAnchor, targetAnchor));
  };
  const handleMoveSubtreeAfter = (sourceAnchor: number, targetAnchor: number) => {
    mutate((text) => moveSubtreeAfter(text, sourceAnchor, targetAnchor));
  };
  const handlePromoteSubtree = (anchor: number) => {
    mutate((text) => promoteSubtree(text, anchor));
  };
  const handleDemoteSubtree = (anchor: number) => {
    mutate((text) => demoteSubtree(text, anchor));
  };
  const handleDuplicateSubtree = (anchor: number) => {
    mutate((text) => duplicateSubtree(text, anchor));
  };

  useEffect(() => {
    if (mode === "source") jumpToSource(sourceViewRef.current);
  }, [jumpToSource, mode]);

  return <main className={`app-shell mode-${mode}`}>
    {snapshot.pendingRemote !== undefined ? <aside className="conflict" role="alert"><span>Another device changed this note.</span><button onClick={() => bridge.resolveConflict("keep-local")} title="Keep local edits (Standard Notes creates a Conflicted Copy if needed)">Keep local</button><button onClick={() => bridge.resolveConflict("accept-remote")} title="Discard local changes and use remote version">Accept remote</button></aside> : null}
    <div className={`workspace-layout ${sidebarOpen && mode !== "mindmap" ? "with-sidebar" : "sidebar-collapsed"}`}>
      {focusedSection ? (
        <div className="section-focus-banner" role="region" aria-label="Focused section">
          <span className="focus-badge">Focused:</span>
          <span className="focus-breadcrumbs">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.anchor} className="breadcrumb-item">
                {index > 0 ? " › " : ""}
                <button
                  type="button"
                  className={`breadcrumb-btn ${crumb.anchor === focusedSection.anchor ? "current-crumb" : ""}`}
                  onClick={() => setFocusedSectionAnchor(crumb.anchor)}
                >
                  {crumb.text}
                </button>
              </span>
            ))}
          </span>
          <button
            type="button"
            className="exit-focus-btn"
            onClick={() => setFocusedSectionAnchor(undefined)}
            title="Exit section focus"
          >
            ✕ Exit Focus
          </button>
        </div>
      ) : null}
      <section className="editing-grid">
        {/* Keep Milkdown mounted across mode changes so its selection/history stay local. */}
        <section className="writing-pane pane" hidden={!writingVisible}><div className={`pane-toolbar ${writingVisible ? "app-toolbar" : ""}`} role="toolbar" aria-label="Writing tools">
          <SidebarToggleButton sidebarOpen={sidebarOpen} onToggle={toggleSidebar} />
          <EditorNavigationControls mode={mode} onModeChange={requestMode} historyDisabled={snapshot.locked} onUndo={() => localHistoryMutation(() => canonical.undo())} onRedo={() => localHistoryMutation(() => canonical.redo())} mindmapSuitable={mindmapSuitable} />
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("task")} title="Task list">Task</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("heading")} title="Heading 1">H1</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("heading2")} title="Heading 2">H2</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("bullet")} title="Bullet list">Bullet</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("quote")} title="Blockquote">Quote</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("code")} title="Code block">Code</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("table")} title="Table">Table</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("link")} title="Link (Ctrl+K)">Link</button>
          <button disabled={writingReadOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => runWritingCommand("divider")} title="Divider">Divider</button>
          <button disabled={snapshot.locked || !appLifecycle.canApplyLocal()} onMouseDown={(e) => e.preventDefault()} onClick={handleNormalizeBareUrls} title="Convert bare URLs to Markdown links">{writingCapability.editable ? "Convert bare URLs to Markdown links" : "Convert to enable Writing mode"}</button>
          <button disabled={snapshot.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => setTemplateModalOpen(true)} title="Templates & Snippets Manager">Templates</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setPaletteOpen(true)} title="Command & Navigation Palette (Ctrl+P)">Palette</button>
          <span className="slash-hint">Type / for commands</span>
          {writingVisible ? <StatusInfo currentSection={currentSection} snapshot={snapshot} sourceFallbackText={sourceFallbackText} writingCapability={writingCapability} writingVisible={writingVisible} bridgeState={bridgeState} /> : null}
        </div><ErrorBoundary><WritingEditor key={writingResetEpoch} value={snapshot.text} readOnly={writingReadOnly} onChange={edit} onToggleTask={toggleWritingTask} onDeleteTask={deleteWritingTask} command={writingCommand} insertPayload={insertPayload} library={library} deadlineDay={todayKey} onCapabilityChange={handleWritingCapabilityChange} onLosslessFallback={(markdown) => { appLifecycle.preserveWritingFallback(markdown); requestMode("source"); }} /></ErrorBoundary></section>
        {mode === "source" ? <section className="source-pane pane"><div className="pane-toolbar app-toolbar" role="toolbar" aria-label="Source tools"><SidebarToggleButton sidebarOpen={sidebarOpen} onToggle={toggleSidebar} /><EditorNavigationControls mode={mode} onModeChange={requestMode} historyDisabled={snapshot.locked} onUndo={() => localHistoryMutation(() => canonical.undo())} onRedo={() => localHistoryMutation(() => canonical.redo())} mindmapSuitable={mindmapSuitable} /><button onClick={() => openSourceSearch(sourceViewRef.current)}>Search / Replace</button><button disabled={snapshot.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => setTemplateModalOpen(true)} title="Templates & Snippets Manager">Templates</button><button onMouseDown={(e) => e.preventDefault()} onClick={() => setPaletteOpen(true)} title="Command & Navigation Palette (Ctrl+P)">Palette</button><StatusInfo currentSection={currentSection} snapshot={snapshot} sourceFallbackText={sourceFallbackText} writingCapability={writingCapability} writingVisible={writingVisible} bridgeState={bridgeState} /></div><SourceEditor value={sourceFallbackText ?? snapshot.text} resetGeneration={snapshot.resetGeneration} readOnly={snapshot.locked} onChange={editSource} onView={jumpToSource} onSelection={selectSourceSection} /></section> : null}
        {mode === "split" || mode === "mindmap" ? <section className="map-pane pane"><div className={`pane-toolbar ${mode === "mindmap" ? "app-toolbar" : ""}`} role="toolbar" aria-label="Mindmap tools">{mode === "mindmap" ? <><SidebarToggleButton sidebarOpen={sidebarOpen} onToggle={toggleSidebar} /><EditorNavigationControls mode={mode} onModeChange={requestMode} historyDisabled={snapshot.locked} onUndo={() => localHistoryMutation(() => canonical.undo())} onRedo={() => localHistoryMutation(() => canonical.redo())} mindmapSuitable={mindmapSuitable} /><button onMouseDown={(e) => e.preventDefault()} onClick={() => setPaletteOpen(true)} title="Command & Navigation Palette (Ctrl+P)">Palette</button></> : null}<label>Tasks <select value={filter} onChange={(event) => setFilter(event.target.value as MindMapFilter)}><option value="all">All</option><option value="open">Open only</option><option value="hide">Hide tasks</option></select></label><label>Scope <select value={mindMapScope} onChange={(event) => setMindMapScope(event.target.value as MindMapScope)} disabled={!currentSection && mindMapScope === "current-section"}><option value="entire-note">Entire note</option><option value="current-section" disabled={!currentSection}>Current section</option></select></label><span className="map-controls">Pan · Zoom · Fit on refresh</span>{mode === "mindmap" ? <StatusInfo currentSection={currentSection} snapshot={snapshot} sourceFallbackText={sourceFallbackText} writingCapability={writingCapability} writingVisible={writingVisible} bridgeState={bridgeState} /> : null}</div><ErrorBoundary><MindMapView markdown={mapMarkdown} readOnly={snapshot.locked} onToggleTask={toggleMindmapTask} deadlineDay={todayKey} /></ErrorBoundary></section> : null}
      </section>
      {mode !== "mindmap" ? <>
        {sidebarOpen ? <div className="sidebar-backdrop" onClick={closeSidebar} aria-hidden="true" /> : null}
        <aside className={`sidebar-pane pane ${sidebarOpen ? "open" : "collapsed"}`} aria-label="Sidebar inspector">
          <div className="sidebar-header">
            <div className="sidebar-tab-switcher">
              <button
                type="button"
                className={`sidebar-tab-btn ${sidebarTab === "outline" ? "active" : ""}`}
                onClick={() => setSidebarTab("outline")}
              >
                Outline
              </button>
              <button
                type="button"
                className={`sidebar-tab-btn ${sidebarTab === "review" ? "active" : ""}`}
                onClick={() => setSidebarTab("review")}
              >
                Review {reviewReport.issues.length > 0 ? `(${reviewReport.issues.length})` : ""}
              </button>
              <button
                type="button"
                className={`sidebar-tab-btn ${sidebarTab === "tasks" ? "active" : ""}`}
                onClick={() => setSidebarTab("tasks")}
              >
                Tasks {tasks.completed.length > 0 ? `(${tasks.completed.length})` : ""}
              </button>
            </div>
            <button className="sidebar-close-btn" onClick={closeSidebar} aria-label="Close sidebar">✕</button>
          </div>
          {sidebarTab === "outline" ? (
            <OutlinePanel
              analysis={analysis}
              activeSectionAnchor={activeSectionAnchor}
              focusedSectionAnchor={focusedSectionAnchor}
              collapsedAnchors={collapsedOutlineAnchors}
              readOnly={snapshot.locked || !appLifecycle.canApplyLocal()}
              onToggleFold={handleToggleOutlineFold}
              onCollapseAll={handleCollapseAllOutline}
              onExpandAll={handleExpandAllOutline}
              onSelectHeading={focusHeading}
              onMoveSubtree={handleMoveSubtree}
              onMoveSubtreeBefore={handleMoveSubtreeBefore}
              onMoveSubtreeAfter={handleMoveSubtreeAfter}
              onPromoteSubtree={handlePromoteSubtree}
              onDemoteSubtree={handleDemoteSubtree}
              onDuplicateSubtree={handleDuplicateSubtree}
              onFocusSection={(anchor) => setFocusedSectionAnchor((prev) => prev === anchor ? undefined : anchor)}
              onCheckAllTasks={(anchor) => mutate((text) => checkAllInSection(text, anchor))}
              onUncheckAllTasks={(anchor) => mutate((text) => uncheckAllInSection(text, anchor))}
              onDeleteCompletedTasks={(anchor) => mutate((text) => deleteCompletedInSection(text, anchor))}
            />
          ) : null}
          {sidebarTab === "review" ? (
            <ReviewPanel
              report={reviewReport}
              readOnly={snapshot.locked || !appLifecycle.canApplyLocal()}
              onSelectHeading={(anchor) => focusHeading(anchor, anchor + 1)}
              onAutoFix={handleAutoFix}
              onFixAll={handleFixAll}
              onNormalizeBareUrls={handleNormalizeBareUrls}
              normalizeBareUrlsLabel={writingCapability.editable ? "Convert bare URLs to Markdown links" : "Convert to enable Writing mode"}
            />
          ) : null}
          {sidebarTab === "tasks" ? (
            <section className="tasks-panel pane-section" aria-label="Completed tasks">
              <div className="panel-heading">
                <h2>Completed ({tasks.completed.length})</h2>
                {tasks.completed.length ? <button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Show" : "Hide"}</button> : null}
              </div>
              {!collapsed && tasks.completed.length ? (
                <>
                  {completedGroups.map((group) => (
                    <div key={group.title} className="task-group">
                      <div className="task-group-header">
                        <span className="task-group-title">📁 {group.title} ({group.tasks.length})</span>
                        <div className="task-group-actions">
                          <button
                            disabled={snapshot.locked}
                            title="Uncheck all in this group"
                            onClick={() => mutate((text) => uncheckAllInHeadingPath(text, group.headingPath))}
                          >
                            Uncheck
                          </button>
                          <button
                            disabled={snapshot.locked}
                            title="Delete all in this group"
                            onClick={() => mutate((text) => deleteCompletedInHeadingPath(text, group.headingPath))}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <ul className="task-group-list">
                        {group.tasks.map((task) => (
                          <li key={`${task.from}:${task.checkboxOffset}`} data-deadline-status={deadlineStatus(task.text, today)}>
                            <span className="task-item-label">
                              <span className="task-done-badge">✓</span>
                              <span className="task-text-body">{task.text}</span>
                            </span>
                            <div className="task-actions">
                              <button disabled={snapshot.locked} onClick={() => mutate((text) => toggleTask(text, task))}>Uncheck</button>
                              <button disabled={snapshot.locked} onClick={() => mutate((text) => deleteTask(text, task))}>Delete</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="actions">
                    <button disabled={snapshot.locked} onClick={() => mutate(uncheckAll)}>Uncheck all</button>
                    <button disabled={snapshot.locked} onClick={() => mutate(deleteCompleted)}>Delete completed</button>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </aside>
      </> : null}
    </div>
    <footer className="note-meta">{analysis.tasks.length} task{analysis.tasks.length === 1 ? "" : "s"} · {headings.length} section{headings.length === 1 ? "" : "s"} · EditorKit markdown bridge</footer>
    <TemplateManagerModal
      isOpen={templateModalOpen}
      onClose={() => setTemplateModalOpen(false)}
      library={library}
      onSaveLibrary={handleSaveLibrary}
      onInsertTemplate={handleInsertTemplate}
      onInsertSnippet={handleInsertSnippet}
      currentNoteMarkdown={snapshot.text}
      currentSelectionText=""
    />
    <NavigationPaletteModal
      isOpen={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      analysis={analysis}
      onSelectHeading={(anchor) => focusHeading(anchor, anchor + 1)}
      onSetMode={requestMode}
      onToggleSidebar={toggleSidebar}
      onOpenTemplates={() => setTemplateModalOpen(true)}
      onFixAllIssues={handleFixAll}
      library={library}
      onInsertTemplate={handleInsertTemplate}
      onInsertSnippet={handleInsertSnippet}
    />
  </main>;
}
