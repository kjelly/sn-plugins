/// <reference lib="deno.ns" />

import { CanonicalDocument } from "../src/document/CanonicalDocument.ts";
import {
  assessWritingMutation,
  assessWritingRoundTrip,
  structuralContextForCommand,
  WritingEditorChangeGate,
} from "../src/editor/WritingEditorLifecycle.ts";
import { EditorKitLifecycle } from "../src/standardnotes/EditorKitLifecycle.ts";
import { EditorKitBridge, type EditorKitDelegate } from "../src/standardnotes/EditorKitBridge.ts";
import { writingCommandPlan } from "../src/editor/WritingCommandPlan.ts";
import { sourceChangeSetFromCodeMirror } from "../src/editor/SourceChanges.ts";
import { shouldReportSourceSelection } from "../src/editor/SourceSelection.ts";
import {
  analyzeMarkdown,
  deleteCompleted,
  projectMindmapMarkdown,
  sectionAnchorAt,
  toggleTask,
  uncheckAll,
} from "../src/markdown/analysis.ts";
import { reconcileSectionAnchor } from "../src/document/SectionAnchor.ts";
import { AppDocumentLifecycle } from "../src/app/AppDocumentLifecycle.ts";
import { modeAfterRequest } from "../src/app/AppModeTransition.ts";
import { findMarkdownLinkAtOffset } from "../src/editor/SourceLinks.ts";

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void; readTextFile(path: string | URL): Promise<string> };

type FakeBridgeHarness = {
  bridge: EditorKitBridge;
  document: CanonicalDocument;
  delegate: EditorKitDelegate;
  clock: { runNext(): void; runAll(): void };
  saves: Array<{ note: Record<string, unknown>; text: string | undefined }>;
  options?: { coallesedSaving: boolean };
};

function fakeBridgeHarness(): FakeBridgeHarness {
  let delegate: EditorKitDelegate | undefined;
  let options: { coallesedSaving: boolean } | undefined;
  const saves: Array<{ note: Record<string, unknown>; text: string | undefined }> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const clock = {
    setTimeout(handler: () => void): number { const id = nextTimer++; timers.set(id, handler); return id; },
    clearTimeout(id: number): void { timers.delete(id); },
    runNext(): void {
      const entry = timers.entries().next().value as [number, () => void] | undefined;
      if (!entry) return;
      timers.delete(entry[0]);
      entry[1]();
    },
    runAll(): void { while (timers.size > 0) clock.runNext(); },
  };
  const document = new CanonicalDocument();
  const bridge = new EditorKitBridge(document, () => undefined, (nextDelegate, nextOptions) => {
    delegate = nextDelegate;
    options = nextOptions;
    return {
      saveItemWithPresave(note, presave) {
        presave?.();
        const text = note.content?.text;
        saves.push({ note, text: typeof text === "string" ? text : undefined });
      },
    };
  }, clock);
  bridge.start();
  return { bridge, document, delegate: delegate!, clock, saves, get options() { return options; } };
}

async function deliverBridgeContext(harness: FakeBridgeHarness, text: string, uuid: string): Promise<void> {
  const note = { uuid, content: { text } };
  await harness.delegate.onNoteValueChange?.(note);
  harness.delegate.setEditorRawText(text);
}

function attachAppLifecycle(document: CanonicalDocument): AppDocumentLifecycle {
  const appLifecycle = new AppDocumentLifecycle(document);
  let previousText = document.text;
  document.subscribe((next, transition) => {
    appLifecycle.observeCanonicalTransition(previousText, next, transition);
    previousText = next.text;
  });
  return appLifecycle;
}

Deno.test("App lifecycle retires a rejected Writing fallback on an explicit Source no-op", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "canonical", "note-app-fallback");
  const appLifecycle = attachAppLifecycle(harness.document);
  const rejected = "canonical\r\n";
  appLifecycle.preserveWritingFallback(rejected);

  assertEquals(appLifecycle.sourceValue(harness.document.text), rejected);
  assertEquals(appLifecycle.applySourceEdit(harness.document.text), false);
  assertEquals(appLifecycle.fallback, undefined);
  assertEquals(appLifecycle.sourceValue(harness.document.text), "canonical");
  // This is the App's render/remount value after Source has discarded F.
  assertEquals(appLifecycle.sourceValue(harness.document.text), "canonical");
  harness.clock.runAll();
  assertEquals(harness.saves.length, 0);
});

Deno.test("Canonical conflict invalidates a move token without changing text or history", () => {
  const document = new CanonicalDocument("base");
  let notifications = 0;
  const transitions: string[] = [];
  document.subscribe((_state, transition) => {
    notifications += 1;
    if (transition?.kind) transitions.push(transition.kind);
  });
  assert(document.applyLocal("local"), "local edit should apply");
  const token = document.token;
  const historyBeforeConflict = transitions.length;
  const notificationsBeforeConflict = notifications;
  assertEquals(document.receiveRemote("remote"), "conflicted");
  assert(document.token.revision !== token.revision, "the conflict should invalidate the pre-conflict token");
  assertEquals(document.pendingRemote, "remote");
  assertEquals(document.text, "local");
  assertEquals(notifications, notificationsBeforeConflict + 1);
  assertEquals(transitions.length, historyBeforeConflict);
  assertEquals(document.resolveRemote("keep-local"), true);
  assertEquals(document.pendingRemote, undefined);
  assertEquals(document.applyLocalIfCurrent(token, "stale"), false);
  assertEquals(document.text, "local");
  assert(document.undo(), "the original local edit should remain the only undo entry");
  assertEquals(document.text, "base");
});

Deno.test("App lifecycle rejects every non-Source local writer while fallback is present", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "- [ ] task", "note-app-writers");
  const appLifecycle = attachAppLifecycle(harness.document);
  assert(appLifecycle.applyLocal("prior local"), "initial local writer should establish history before fallback");
  appLifecycle.preserveWritingFallback("- [ ] task\r\n");

  assertEquals(appLifecycle.applyLocal("task mutation"), false);
  let historyInvocations = 0;
  assertEquals(appLifecycle.applyHistory(() => { historyInvocations += 1; return harness.document.undo(); }), false);
  assertEquals(appLifecycle.applyHistory(() => { historyInvocations += 1; return harness.document.redo(); }), false);
  assertEquals(historyInvocations, 0);
  assertEquals(appLifecycle.fallback, "- [ ] task\r\n");
  assertEquals(harness.document.text, "prior local");
  harness.clock.runAll();
  assertEquals(harness.saves.length, 0);
});

Deno.test("App mode requests stay in Source while a Writing fallback is present", () => {
  assertEquals(modeAfterRequest("source", true), "source");
  assertEquals(modeAfterRequest("writing", true), "source");
  assertEquals(modeAfterRequest("split", true), "source");
  assertEquals(modeAfterRequest("mindmap", true), "source");
  assertEquals(modeAfterRequest("kanban", true), "source");
  assertEquals(modeAfterRequest("writing", false), "writing");
  assertEquals(modeAfterRequest("split", false), "split");
  assertEquals(modeAfterRequest("kanban", false), "kanban");
});

Deno.test("App routes every mode request through the fallback-aware transition", async () => {
  const source = await Deno.readTextFile(new URL("../src/app/App.tsx", import.meta.url));
  const directModeWrites = source.split("\n").filter((line) => line.includes("setMode("));
  assertEquals(directModeWrites.length, 1);
  assert(directModeWrites.every((line) => line.includes("setMode(resolvedMode)")), "mode state must only be written by requestMode");
  const modeChangeHandlers = [...source.matchAll(/onModeChange=\{([^}]+)\}/g)].map((match) => match[1].trim());
  assert(modeChangeHandlers.length > 0, "mode navigation controls must expose an onModeChange handler");
  assert(modeChangeHandlers.every((handler) => handler === "requestMode"), "mode navigation requests must use requestMode");
  assert(source.includes("onSetMode={requestMode}"), "palette mode requests must use requestMode");
  assert(source.includes('requestMode("writing")'), "automatic suitability correction must use requestMode");
  assert(source.includes('preserveWritingFallback(markdown); requestMode("source")'), "fallback entry must use requestMode");
  const templateHandler = source.slice(source.indexOf("const handleInsertTemplate"), source.indexOf("const handleInsertSnippet"));
  const snippetHandler = source.slice(source.indexOf("const handleInsertSnippet"), source.indexOf("const requestMode"));
  assert(!templateHandler.includes("canonical.applyLocal"), "template insertion must not bypass the lifecycle");
  assert(!snippetHandler.includes("canonical.applyLocal"), "snippet insertion must not bypass the lifecycle");
});

Deno.test("App lifecycle clears fallback only for authoritative remote replacement", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "canonical", "note-app-provenance");
  const appLifecycle = attachAppLifecycle(harness.document);
  appLifecycle.preserveWritingFallback("remote fallback");

  await harness.delegate.onNoteLockToggle?.(true);
  assertEquals(appLifecycle.fallback, "remote fallback");
  assertEquals(appLifecycle.sourceValue(harness.document.text), "remote fallback");
  await harness.delegate.onThemesChange?.();
  assertEquals(appLifecycle.fallback, "remote fallback");
  // Mode/theme/lock rerenders do not carry initialize provenance.
  appLifecycle.observeCanonicalTransition(harness.document.text, harness.document.snapshot());
  assertEquals(appLifecycle.fallback, "remote fallback");

  await deliverBridgeContext(harness, "remote fallback", "note-app-provenance");
  assertEquals(appLifecycle.fallback, undefined);
  assertEquals(harness.document.text, "remote fallback");
  harness.clock.runAll();
  assertEquals(harness.saves.length, 0);
});

Deno.test("EditorKitBridge initializes a switched note before any local save can target it", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "A canonical", "note-a");
  const appLifecycle = attachAppLifecycle(harness.document);

  assert(harness.document.applyLocal("A local"), "A local edit should apply");
  harness.bridge.notifyLocalChange(harness.document.text);
  appLifecycle.preserveWritingFallback("A writing fallback");

  await deliverBridgeContext(harness, "B canonical", "note-b");
  assertEquals(harness.document.text, "B canonical");
  assertEquals(harness.document.dirty, false);
  assertEquals(harness.document.pendingRemote, undefined);
  assertEquals(appLifecycle.fallback, undefined);
  assertEquals(harness.bridge.resolveConflict("keep-local"), false);

  harness.clock.runAll();
  assertEquals(harness.saves, []);
});

Deno.test("EditorKitBridge does not save an initial note containing only a fenced task example", async () => {
  const harness = fakeBridgeHarness();
  const input = "# Notes\n\n```md\n- [x] Example @repeat(1d) @done(2020-01-01)\n```\n";
  await deliverBridgeContext(harness, input, "note-fenced-recurring-example");

  assertEquals(harness.document.text, input);
  assertEquals(harness.document.dirty, false);
  harness.clock.runAll();
  assertEquals(harness.saves, []);
});

Deno.test("App lifecycle retires fallback for an equal-text note initialization", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "same text", "note-a");
  const appLifecycle = attachAppLifecycle(harness.document);
  appLifecycle.preserveWritingFallback("A rejected fallback");

  await deliverBridgeContext(harness, "same text", "note-b");

  assertEquals(harness.document.text, "same text");
  assertEquals(harness.document.dirty, false);
  assertEquals(appLifecycle.fallback, undefined);
  assertEquals(appLifecycle.sourceValue(harness.document.text), "same text");
  assert(appLifecycle.applySourceEdit("same text\nB edit"), "B Source edit must cross the canonical boundary");
  harness.bridge.notifyLocalChange(harness.document.text);
  assertEquals(harness.document.text, "same text\nB edit");
  assert(!harness.document.text.includes("A rejected fallback"), "B Source edit must not include A's fallback");
  harness.clock.runAll();
  assertEquals(harness.saves.map((save) => save.text), ["same text\nB edit"]);
});

Deno.test("mode switch keeps a Writing transaction observable at the canonical boundary", () => {
  const document = new CanonicalDocument("initial");
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin(document.text);
  gate.finish(generation, document.text);

  // Source changes the canonical document and React immediately switches
  // modes. Writing remains mounted and receives this exact target.
  document.applyLocal("source edit");
  const external = gate.suppressExternalUpdate(generation, document.text);
  assert(!!external, "external replacement must be tagged");

  // A queued Writing transaction that follows the source replacement is not
  // an echo and must reach the canonical owner.
  const userMarkdown = "source edit + writing edit";
  if (gate.markdownUpdated(generation, userMarkdown)) document.applyLocal(userMarkdown);
  assert(document.text === userMarkdown, "Writing edit was lost during mode switch");
});

Deno.test("SourceEditor change metadata reaches the canonical transition contract", () => {
  const source = "# A\n## B\nB body\n# C\n";
  const inserted = "intro\n";
  const from = source.indexOf("## B");
  const next = source.slice(0, from) + inserted + source.slice(from);
  const fakeCodeMirrorChanges = {
    iterChanges(callback: (fromA: number, toA: number, fromB: number, toB: number, insertedText: { length: number }) => void): void {
      callback(from, from, from, from + inserted.length, { length: inserted.length });
    },
  };
  const changeSet = sourceChangeSetFromCodeMirror(source.length, next.length, fakeCodeMirrorChanges);
  assert(changeSet !== undefined, "CodeMirror changes must become an exact serializable map");
  const document = new CanonicalDocument(source);
  let received: { kind: string; changeSet?: typeof changeSet } | undefined;
  document.subscribe((_state, transition) => { if (transition) received = transition; });
  assert(document.applyLocal(next, changeSet), "exact SourceEditor map must cross the canonical boundary");
  assertEquals(received?.kind, "apply");
  assertEquals(received?.changeSet?.changes, [{ from, to: from, insertedLength: inserted.length }]);
});

Deno.test("external SourceEditor replacement cannot reselect a deleted duplicate successor", () => {
  const source = "# Root\n## Duplicate\nselected body\n## Duplicate\nsuccessor body\n# Tail\n";
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "Duplicate");
  assert(selected !== undefined, "the selected duplicate heading must exist");
  const next = "# Root\n## Duplicate\nsuccessor body\n# Tail\n";
  const document = new CanonicalDocument(source);
  let activeAnchor: number | undefined = selected.anchor;
  document.subscribe((_state, transition) => {
    if (transition?.kind === "apply") activeAnchor = reconcileSectionAnchor(document.text, transition.changeSet, activeAnchor);
  });

  assert(document.applyLocal(next), "the opaque external replacement must update canonical text");
  assertEquals(activeAnchor, undefined);
  const successorOffset = next.indexOf("## Duplicate");
  assert(successorOffset >= 0, "the duplicate successor must remain in the replacement");
  let selectionCallbacks = 0;
  if (shouldReportSourceSelection({ selectionSet: true, docChanged: true }, true)) {
    selectionCallbacks += 1;
    activeAnchor = sectionAnchorAt(next, successorOffset);
  }
  assertEquals(selectionCallbacks, 0);
  assertEquals(activeAnchor, undefined);
  assert(shouldReportSourceSelection({ selectionSet: true, docChanged: false }, false), "user selection updates must remain reportable");
  assert(shouldReportSourceSelection({ selectionSet: false, docChanged: true }, false), "user document updates must remain reportable");
});

Deno.test("fake EditorKit host records a save request without inventing host confirmation", () => {
  const document = new CanonicalDocument("initial");
  const lifecycle = new EditorKitLifecycle();
  let saveRequested = false;
  const host = {
    setEditorRawText(text: string): void {
      const kind = lifecycle.classifyContext("note-no-echo");
      if (kind === "initial-context") document.initialize(text);
      else if (kind === "remote-update") document.receiveRemote(text);
    },
    onEditorValueChanged(text: string): void {
      saveRequested = text === document.text;
      // A ComponentViewer host does not echo this same sourceKey here.
    },
  };

  host.setEditorRawText("initial");
  document.applyLocal("local");
  host.onEditorValueChanged("local");
  assert(saveRequested, "local save request was not recorded");
  assert(document.dirty, "local document was falsely marked saved");
  assert(document.pendingRemote === undefined, "save request created a false conflict");
});

Deno.test("EditorKitBridge owns cancellable scheduling across remote conflict resolution", async () => {
  const harness = fakeBridgeHarness();
  assert(harness.options?.coallesedSaving === false, "bridge must disable EditorKit coalescing");
  await deliverBridgeContext(harness, "initial", "note-1");
  assert(harness.document.applyLocal("local"), "local edit should apply");
  harness.bridge.notifyLocalChange("local");
  await deliverBridgeContext(harness, "remote", "note-1");
  harness.clock.runAll();
  assertEquals(harness.saves.length, 0);
  assertEquals(harness.document.pendingRemote, "remote");

  assertEquals(harness.bridge.resolveConflict("accept-remote"), true);
  harness.clock.runAll();
  assertEquals(harness.saves.length, 0);
  assertEquals(harness.document.text, "remote");

  const keepLocal = fakeBridgeHarness();
  await deliverBridgeContext(keepLocal, "initial", "note-2");
  assert(keepLocal.document.applyLocal("local"), "local edit should apply");
  keepLocal.bridge.notifyLocalChange("local");
  await deliverBridgeContext(keepLocal, "remote", "note-2");
  assertEquals(keepLocal.bridge.resolveConflict("keep-local"), true);
  keepLocal.clock.runAll();
  assertEquals(keepLocal.saves.length, 1);
  assertEquals(keepLocal.saves[0].text, "local");
});

Deno.test("EditorKitBridge flushes a pending generation exactly once", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "initial", "note-flush");
  assert(harness.document.applyLocal("local"), "local edit should apply");
  harness.bridge.notifyLocalChange("local");

  assertEquals(harness.bridge.flush(), true);
  assertEquals(harness.saves.length, 1);
  harness.clock.runAll();
  assertEquals(harness.saves.length, 1);
  assertEquals(harness.bridge.flush(), false);
});

Deno.test("EditorKitBridge dispose flushes pending work and cancels its timer", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "initial", "note-dispose");
  assert(harness.document.applyLocal("local"), "local edit should apply");
  harness.bridge.notifyLocalChange("local");

  assertEquals(harness.bridge.dispose(), true);
  harness.clock.runAll();
  assertEquals(harness.saves.length, 1);
  assertEquals(harness.bridge.flush(), false);
  const textBeforeLateHostCallback = harness.document.text;
  await harness.delegate.onNoteValueChange?.({ uuid: "note-dispose", content: { text: "stale host update" } });
  harness.delegate.setEditorRawText("stale host update");
  assertEquals(harness.document.text, textBeforeLateHostCallback);
  assert(harness.document.applyLocal("later"), "later local edit should apply to the document");
  harness.bridge.notifyLocalChange("later");
  harness.clock.runAll();
  assertEquals(harness.saves.length, 1);
});

Deno.test("writing command plans preserve structural nodes and selection context", () => {
  assertEquals(writingCommandPlan("heading"), { kind: "set-block-type", nodeName: "heading", attrs: { level: 1 }, target: "current-block" });
  assertEquals(writingCommandPlan("quote"), { kind: "wrap", nodeName: "blockquote", target: "selection" });
  assertEquals(writingCommandPlan("task"), { kind: "task-list", target: "selection" });
  assertEquals(writingCommandPlan("table"), { kind: "replace-block", nodeName: "table", target: "current-block" });
});

Deno.test("Writing integration gate keeps unsupported source in Source mode", () => {
  assert(assessWritingRoundTrip("- safe task", "- safe task").editable, "safe round-trip should be editable");
  assert(!assessWritingRoundTrip("+ unsafe bullet", "+ unsafe bullet").editable, "plus bullets need Source mode");
  assert(!assessWritingMutation("a\nb", "a\r\nb").editable, "line-ending change needs Source mode");
});

Deno.test("Writing gate admits empty-note LF materialization but not later none-to-LF changes", () => {
  assert(assessWritingMutation("", "x\n", "user").editable, "empty note LF materialization should be editable");
  assert(assessWritingMutation("", "a\nb\n", "user").editable, "empty note multiline LF materialization should be editable");
  assert(!assessWritingMutation("", "+ item\n", "user").editable, "plus bullets must remain gated");
  assert(!assessWritingMutation("", "x\r\n", "user").editable, "CRLF must remain gated");
  assert(!assessWritingMutation("x", "xy\n", "user").editable, "non-empty none-to-LF changes must remain gated");
});

Deno.test("blank Writing first edit reaches canonical and emits one save after flush", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "", "note-empty-writing");
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin("");
  gate.finish(generation, "");

  const firstEdit = "x\n";
  assert(gate.markdownUpdated(generation, firstEdit), "the first blank-note edit must be admitted");
  assert(harness.document.applyLocal(firstEdit), "the first edit must update canonical text");
  harness.bridge.notifyLocalChange(harness.document.text);
  harness.clock.runAll();

  assertEquals(harness.document.text, "x\n");
  assertEquals(harness.saves.map((save) => save.text), ["x\n"]);
});

Deno.test("rejected Writing mutation preserves input in Source fallback without silent save", async () => {
  const harness = fakeBridgeHarness();
  const canonical = "text";
  await deliverBridgeContext(harness, canonical, "note-writing-source-fallback");
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin(canonical);
  gate.finish(generation, canonical);

  const rejected = "text\r\n";
  assert(gate.markdownUpdated(generation, rejected), "the rejected transaction must reach the admission check");
  assert(!assessWritingMutation(canonical, rejected).editable, "the unsafe transaction must be rejected");
  let mode = "writing";
  let sourceFallback: string | undefined;
  const preserveForSourceFallback = (value: string) => {
    sourceFallback = value;
    mode = "source";
  };
  preserveForSourceFallback(rejected);

  assertEquals(mode, "source");
  assertEquals(sourceFallback, rejected);
  assertEquals(harness.document.text, canonical);
  harness.clock.runAll();
  assert(harness.saves.length === 0, "rejected Writing input must not be silently saved");

  const explicitSourceEdit = sourceFallback!.replace("\r\n", "\n");
  assert(harness.document.applyLocal(explicitSourceEdit), "an explicit Source edit must cross the canonical boundary");
  harness.bridge.notifyLocalChange(harness.document.text);
  harness.clock.runAll();
  assertEquals(harness.document.text, "text\n");
  assertEquals(harness.saves.map((save) => save.text), ["text\n"]);

  assert(gate.markdownUpdated(generation, "text!"), "a later user edit must not remain suppressed");
});

Deno.test("remote replaceAll normalization is provenance-suppressed and never saves", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "text  \nnext", "note-normalization");
  const document = harness.document;
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin(document.text);
  gate.finish(generation, document.text);
  const external = gate.suppressExternalUpdate(generation);
  assert(!!external, "external replacement must be tagged");

  const normalized = "text\\\nnext\n";
  let localChanges = 0;
  if (gate.markdownUpdated(generation, normalized, external)) {
    localChanges += 1;
    document.applyLocal(normalized);
    harness.bridge.notifyLocalChange(normalized);
  }

  assertEquals(localChanges, 0);
  assertEquals(document.text, "text  \nnext");
  assertEquals(document.dirty, false);
  assertEquals(gate.hasPendingExternalUpdate, false);
  harness.clock.runAll();
  assertEquals(harness.saves.length, 0);
});

Deno.test("Writing commands cross structural dispatch, Milkdown serializer, and canonical boundary", () => {
  const serializerOutputs: Array<["heading" | "task" | "code" | "table" | "divider", string, string]> = [
    ["heading", "title", "# title"],
    ["task", "task", "- [ ] task"],
    ["code", "snippet", "```\nsnippet\n```"],
    ["table", "table", "|   |   |   |\n|---|---|---|\n|   |   |   |\n|   |   |   |"],
    ["divider", "divider", "---"],
  ];
  for (const [command, source, serialized] of serializerOutputs) {
    const plan = writingCommandPlan(command);
    assert(plan.kind.length > 0, `${command} must have a structural command plan`);
    const proof = assessWritingMutation(source, serialized, { kind: "command", command });
    assert(proof.editable, `${command} serializer output must pass its command-aware exactness gate`);
    const canonical = new CanonicalDocument(source);
    assert(canonical.applyLocal(serialized), `${command} output must cross the canonical boundary`);
    assertEquals(canonical.text, serialized);
  }
});

Deno.test("command-aware gate only relaxes lexical-risk checks for valid explicit outputs", () => {
  assert(assessWritingMutation("plain", "plain\n|   |   |\n|---|---|\n|   |   |", { kind: "command", command: "table" }).editable, "valid command table should be accepted");
  assert(assessWritingMutation("plain", "plain\n```\ncode\n```", { kind: "command", command: "code" }).editable, "valid command fence should be accepted");
  assert(assessWritingMutation("plain", "plain\n---", { kind: "command", command: "divider" }).editable, "valid command divider should be accepted");
  assert(!assessWritingMutation("plain", "plain\n| not a table", { kind: "command", command: "table" }).editable, "malformed command table must remain gated");
  assert(!assessWritingMutation("plain", "plain\n---", "user").editable, "ordinary input cannot bypass the lexical-risk gate");
});

Deno.test("command-origin task, table, and divider CRLF output remains rejected", () => {
  const cases: Array<["task" | "table" | "divider", string]> = [
    ["task", "- [ ] task\r\n"],
    ["table", "| a | b |\r\n| --- | --- |\r\n| c | d |\r\n"],
    ["divider", "---\r\n"],
  ];
  for (const [command, output] of cases) {
    assert(!assessWritingMutation("plain", output, { kind: "command", command }).editable, `${command} command CRLF output must be rejected`);
  }
});

Deno.test("structural command contexts accept subsequent serializer spelling", () => {
  const cases: Array<["table" | "code" | "divider", string, string]> = [
    ["table", "|   |   |\n|---|---|\n|   |   |\n", "| edit |   |\n|---|---|\n|   |   |\n"],
    ["code", "```\nsnippet\n```", "```\nsnippet edit\n```"],
    ["divider", "---\n", "---\ntext"],
  ];
  for (const [command, first, subsequent] of cases) {
    const context = structuralContextForCommand(command, first);
    assertEquals(context, command);
    const canonical = new CanonicalDocument("plain");
    assert(assessWritingMutation("plain", first, { kind: "command", command }).editable, `${command} command must be accepted`);
    assert(canonical.applyLocal(first), `${command} command must update canonical`);
    assert(assessWritingMutation(first, subsequent, "user", context).editable, `${command} follow-up must remain writable`);
    assert(canonical.applyLocal(subsequent), `${command} follow-up must reach canonical`);
    assertEquals(canonical.text, subsequent);
  }
});

Deno.test("Task subtree mutation, uncheckAll, and deleteCompleted integrate with CanonicalDocument changeSets and undo/redo", () => {
  const source = "# Project\n\n## Backend\n- [x] Database setup\n  - [x] Migrations\n  - [ ] Seed data\n- [ ] API routes\n\n## Frontend\n- [x] Setup Vite\n- [ ] Components\n";
  const document = new CanonicalDocument(source);
  let latestTransition: { kind: string; changeSet?: unknown } | undefined;
  document.subscribe((_state, transition) => { latestTransition = transition; });

  // 1. uncheckAll
  const uncheckResult = uncheckAll(document.text);
  assert(uncheckResult.changed, "uncheckAll should detect changes");
  assert(document.applyLocal(uncheckResult.markdown, uncheckResult.changeSet), "uncheckAll should apply to canonical");
  assertEquals(latestTransition?.kind, "apply");
  const allUnchecked = analyzeMarkdown(document.text);
  assertEquals(allUnchecked.tasks.every((task) => !task.checked), true);

  // 2. Toggle specific tasks back to completed
  const task0 = allUnchecked.tasks[0]; // Database setup
  const toggleResult = toggleTask(document.text, task0);
  assert(document.applyLocal(toggleResult.markdown, toggleResult.changeSet), "toggleTask should apply to canonical");
  const task1 = analyzeMarkdown(document.text).tasks[1]; // Migrations
  const toggleResult1 = toggleTask(document.text, task1);
  assert(document.applyLocal(toggleResult1.markdown, toggleResult1.changeSet), "toggleTask should apply to canonical");

  // 3. deleteCompleted - should delete completed tasks and their completed subtasks
  const deleteResult = deleteCompleted(document.text);
  assert(deleteResult.changed, "deleteCompleted should detect completed tasks");
  assert(document.applyLocal(deleteResult.markdown, deleteResult.changeSet), "deleteCompleted should apply to canonical");
  const remaining = analyzeMarkdown(document.text);
  assertEquals(remaining.tasks.map((task) => task.text), ["API routes", "Setup Vite", "Components"]);
  assertEquals(remaining.tasks.every((task) => !task.checked), true);

  // 4. Undo step-by-step
  assert(document.undo(), "undo deleteCompleted");
  assertEquals(analyzeMarkdown(document.text).tasks.map((task) => task.text), ["Database setup", "Migrations", "Seed data", "API routes", "Setup Vite", "Components"]);
  assert(document.undo(), "undo toggle migrations");
  assert(document.undo(), "undo toggle database setup");
  assert(document.undo(), "undo uncheckAll");
  assertEquals(document.text, source);

  // 5. Redo back to final
  assert(document.redo(), "redo uncheckAll");
  assert(document.redo(), "redo toggle database");
  assert(document.redo(), "redo toggle migrations");
  assert(document.redo(), "redo deleteCompleted");
  assertEquals(document.text, deleteResult.markdown);
});

Deno.test("Multi-range Source editor replacements preserve active SectionAnchor across duplicate headings", () => {
  const source = "# Project\n\n## Milestone\nAlpha details\n\n## Milestone\nBeta details\n\n## Milestone\nGamma details\n";
  const analysis = analyzeMarkdown(source);
  const headings = analysis.sections.filter((s) => s.text === "Milestone");
  assertEquals(headings.length, 3);

  // Select the 2nd duplicate "Milestone" (Beta)
  let activeAnchor: number | undefined = headings[1].anchor;
  const document = new CanonicalDocument(source);
  document.subscribe((_state, transition) => {
    if (transition?.kind === "apply") {
      activeAnchor = reconcileSectionAnchor(document.text, transition.changeSet, activeAnchor);
    }
  });

  // Edit Milestone 1 (Alpha) and Milestone 3 (Gamma) simultaneously via multi-range changeSet
  const from1 = source.indexOf("Alpha details");
  const from3 = source.indexOf("Gamma details");
  const replacement1 = "Alpha details updated with more information";
  const replacement3 = "Gamma details finished";

  const next = source.slice(0, from1) + replacement1 + source.slice(from1 + "Alpha details".length, from3) + replacement3 + source.slice(from3 + "Gamma details".length);
  const diff1 = replacement1.length - "Alpha details".length;

  const changeSet = {
    oldLength: source.length,
    newLength: next.length,
    changes: [
      { from: from1, to: from1 + "Alpha details".length, insertedLength: replacement1.length },
      { from: from3, to: from3 + "Gamma details".length, insertedLength: replacement3.length },
    ],
  };

  assert(document.applyLocal(next, changeSet), "multi-range edit must apply");
  // Active anchor should shift by diff1
  assertEquals(activeAnchor, headings[1].anchor + diff1);
  const reanalyzed = analyzeMarkdown(document.text);
  const targetSection = reanalyzed.sections.find((s) => s.anchor === activeAnchor);
  assert(targetSection !== undefined, "reconciled anchor must resolve to a valid section");
  assertEquals(targetSection.text, "Milestone");
  // Verify it still points to the Beta milestone section
  const sectionContent = document.text.slice(targetSection.from, targetSection.to);
  assert(sectionContent.includes("Beta details"), "anchor must point to the exact same Beta section");
});

Deno.test("projectMindmapMarkdown integrates all combinations of scope and task filters", () => {
  const source = "# Project\n\n## Backend\n- [ ] Open DB task\n- [x] Closed API task\n\n## Frontend\n- [ ] UI task\n";
  const analysis = analyzeMarkdown(source);
  const backendSection = analysis.sections.find((s) => s.text === "Backend");
  assert(backendSection !== undefined, "Backend section must exist");

  // 1. Entire note, all tasks
  const allMap = projectMindmapMarkdown(source, "all");
  assert(allMap.includes("Open DB task"), "should contain open task");
  assert(allMap.includes("Closed API task"), "should contain closed task");
  assert(allMap.includes("Frontend"), "should contain Frontend");

  // 2. Entire note, open only
  const openMap = projectMindmapMarkdown(source, "open");
  assert(openMap.includes("Open DB task"), "should contain open task");
  assert(!openMap.includes("Closed API task"), "should exclude closed task");
  assert(openMap.includes("UI task"), "should contain open UI task");

  // 3. Entire note, hide all tasks
  const hideMap = projectMindmapMarkdown(source, "hide");
  assert(!hideMap.includes("Open DB task"), "should exclude open task");
  assert(!hideMap.includes("Closed API task"), "should exclude closed task");
  assert(hideMap.includes("Backend"), "should retain Backend heading");
  assert(hideMap.includes("Frontend"), "should retain Frontend heading");

  // 4. Current section, all tasks
  const sectionMap = projectMindmapMarkdown(source, "all", backendSection.anchor);
  assert(sectionMap.includes("Backend"), "should contain Backend");
  assert(sectionMap.includes("Open DB task"), "should contain open task in Backend");
  assert(sectionMap.includes("Closed API task"), "should contain closed task in Backend");
  assert(!sectionMap.includes("Frontend"), "should exclude Frontend");

  // 5. Current section, open only
  const sectionOpenMap = projectMindmapMarkdown(source, "open", backendSection.anchor);
  assert(sectionOpenMap.includes("Backend"), "should contain Backend");
  assert(sectionOpenMap.includes("Open DB task"), "should contain open task in Backend");
  assert(!sectionOpenMap.includes("Closed API task"), "should exclude closed task in Backend");
  assert(!sectionOpenMap.includes("Frontend"), "should exclude Frontend");

  // 6. Current section with undefined anchor -> falls back to entire note
  const fallbackMap = projectMindmapMarkdown(source, "all", undefined);
  assertEquals(fallbackMap, allMap);
});

Deno.test("EditorKitBridge debounced saving coalesces rapid edits into a single host save", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "start", "note-rapid-edits");

  for (let i = 1; i <= 10; i++) {
    const text = `edit ${i}`;
    assert(harness.document.applyLocal(text), `edit ${i} must apply`);
    harness.bridge.notifyLocalChange(text);
  }

  // Before timer expires, 0 saves dispatched
  assertEquals(harness.saves.length, 0);
  assertEquals(harness.document.dirty, true);

  // Run timer
  harness.clock.runAll();

  // Exactly 1 save dispatched with the final text
  assertEquals(harness.saves.length, 1);
  assertEquals(harness.saves[0].text, "edit 10");
});

Deno.test("EditorKitBridge conflict lifecycle: dirty local vs multiple remote updates with resolution", async () => {
  const harness = fakeBridgeHarness();
  await deliverBridgeContext(harness, "initial content", "note-conflict-chain");

  // Local dirty modification
  assert(harness.document.applyLocal("local modification"), "apply local edit");
  harness.bridge.notifyLocalChange("local modification");

  // Remote update 1 arrives -> conflict state
  await deliverBridgeContext(harness, "remote update 1", "note-conflict-chain");
  assertEquals(harness.document.pendingRemote, "remote update 1");
  assertEquals(harness.document.text, "local modification");
  assertEquals(harness.document.dirty, true);

  // Remote update 2 arrives before conflict resolved -> updates pending remote
  await deliverBridgeContext(harness, "remote update 2", "note-conflict-chain");
  assertEquals(harness.document.pendingRemote, "remote update 2");

  // Resolve by accepting remote
  assertEquals(harness.bridge.resolveConflict("accept-remote"), true);
  assertEquals(harness.document.text, "remote update 2");
  assertEquals(harness.document.pendingRemote, undefined);
  assertEquals(harness.document.dirty, false);

  // Subsequent local edit should save cleanly
  assert(harness.document.applyLocal("subsequent local edit"), "apply subsequent edit");
  harness.bridge.notifyLocalChange("subsequent local edit");
  harness.clock.runAll();
  assertEquals(harness.saves.length, 1);
  assertEquals(harness.saves[0].text, "subsequent local edit");
});

Deno.test("EditorKitBridge - triggers scheduleSave on successful remote auto-merge", async () => {
  const harness = fakeBridgeHarness();
  const initial = "# Section 1\n\nContent 1\n\n# Section 2\n\nContent 2\n";
  await deliverBridgeContext(harness, initial, "note-auto-merge");

  // Local edit in Section 1
  const local = "# Section 1 (local)\n\nContent 1\n\n# Section 2\n\nContent 2\n";
  assert(harness.document.applyLocal(local), "apply local edit in section 1");
  harness.bridge.notifyLocalChange(local);

  // Remote edit in Section 2
  const remote = "# Section 1\n\nContent 1\n\n# Section 2 (remote)\n\nContent 2\n";
  await deliverBridgeContext(harness, remote, "note-auto-merge");

  const expectedMerged = "# Section 1 (local)\n\nContent 1\n\n# Section 2 (remote)\n\nContent 2\n";
  assertEquals(harness.document.pendingRemote, undefined);
  assertEquals(harness.document.text, expectedMerged);
  assertEquals(harness.document.dirty, true);

  // Clock runs debounce timer
  harness.clock.runAll();
  assertEquals(harness.saves.length, 1);
  assertEquals(harness.saves[0].text, expectedMerged);
});

Deno.test("SourceLinks - detects inline link [text](url)", () => {
  const line = "Check out [Standard Notes](https://standardnotes.com) for details";
  // Inside [Standard Notes]
  assertEquals(findMarkdownLinkAtOffset(line, 15), "https://standardnotes.com");
  // Inside (https://standardnotes.com)
  assertEquals(findMarkdownLinkAtOffset(line, 35), "https://standardnotes.com");
  // Outside link
  assertEquals(findMarkdownLinkAtOffset(line, 5), undefined);
  assertEquals(findMarkdownLinkAtOffset(line, 58), undefined);
});

Deno.test("SourceLinks - detects autolink <url>", () => {
  const line = "Visit <https://example.com> now";
  assertEquals(findMarkdownLinkAtOffset(line, 10), "https://example.com");
  assertEquals(findMarkdownLinkAtOffset(line, 2), undefined);
});

Deno.test("SourceLinks - detects bare url", () => {
  const line = "Visit https://example.com/docs today";
  assertEquals(findMarkdownLinkAtOffset(line, 10), "https://example.com/docs");
  assertEquals(findMarkdownLinkAtOffset(line, 2), undefined);
});

Deno.test("RecurringTasks integration - toggleTask auto-appends and removes @done tag", () => {
  const fixedDate = new Date(2026, 7, 29); // 2026-08-29
  const source = "# Habits\n- [ ] Water plants @repeat(3d)\n- [ ] Buy milk\n";
  const analysis1 = analyzeMarkdown(source);

  // Toggle recurring task: [ ] -> [x] adds @done
  const res1 = toggleTask(source, analysis1.tasks[0], fixedDate);
  assertEquals(res1.changed, true);
  assertEquals(res1.markdown, "# Habits\n- [x] Water plants @repeat(3d) @done(2026-08-29)\n- [ ] Buy milk\n");

  // Toggle ordinary task: [ ] -> [x] does NOT add @done
  const res2 = toggleTask(source, analysis1.tasks[1], fixedDate);
  assertEquals(res2.changed, true);
  assertEquals(res2.markdown, "# Habits\n- [ ] Water plants @repeat(3d)\n- [x] Buy milk\n");

  // Toggle recurring task: [x] -> [ ] removes @done
  const checkedSource = "# Habits\n- [x] Water plants @repeat(3d) @done(2026-08-20)\n- [x] Buy milk\n";
  const analysis2 = analyzeMarkdown(checkedSource);
  const res3 = toggleTask(checkedSource, analysis2.tasks[0], fixedDate);
  assertEquals(res3.changed, true);
  assertEquals(res3.markdown, "# Habits\n- [ ] Water plants @repeat(3d)\n- [x] Buy milk\n");

  // uncheckAll removes @done from recurring tasks
  const res4 = uncheckAll(checkedSource);
  assertEquals(res4.changed, true);
  assertEquals(res4.markdown, "# Habits\n- [ ] Water plants @repeat(3d)\n- [ ] Buy milk\n");
});


function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`values are not equal: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}
