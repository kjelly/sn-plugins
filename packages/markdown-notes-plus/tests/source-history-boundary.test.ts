import assert from "node:assert/strict";
import { history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { Compartment, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { CanonicalDocument } from "../src/document/CanonicalDocument.ts";
import { synchronizeSourceEditor, type SourceEditorView } from "../src/editor/SourceEditorSync.ts";
import { shouldReportSourceSelection } from "../src/editor/SourceSelection.ts";
import { EditorKitBridge, type EditorKitDelegate, type BridgeScheduler } from "../src/standardnotes/EditorKitBridge.ts";

type SourceHarness = {
  view: SourceEditorView;
  historyCompartment: Compartment;
  get dispatchCount(): number;
  get documentChanges(): number;
};

function createSourceHarness(text: string): SourceHarness {
  const historyCompartment = new Compartment();
  let state = EditorState.create({ doc: text, extensions: [historyCompartment.of(history())] });
  let dispatchCount = 0;
  let documentChanges = 0;
  const view: SourceEditorView = {
    get state() { return state; },
    dispatch(spec: TransactionSpec) {
      dispatchCount += 1;
      const next = state.update(spec).state;
      if (next.doc.toString() !== state.doc.toString()) documentChanges += 1;
      state = next;
    },
  };
  return { view, historyCompartment, get dispatchCount() { return dispatchCount; }, get documentChanges() { return documentChanges; } };
}

function userReplace(source: SourceHarness, text: string, userEvent = "input.type"): void {
  source.view.dispatch({
    changes: { from: 0, to: source.view.state.doc.length, insert: text },
    annotations: Transaction.userEvent.of(userEvent),
  });
}

function applyCommand(source: SourceHarness, command: typeof undo | typeof redo): boolean {
  return command({ state: source.view.state, dispatch: (transaction) => source.view.dispatch(transaction) });
}

function fakeScheduler(): { scheduler: BridgeScheduler; runAll(): void } {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  return {
    scheduler: {
      setTimeout(handler) { const id = nextTimer++; timers.set(id, handler); return id; },
      clearTimeout(timer) { timers.delete(timer as number); },
    },
    runAll() { while (timers.size) { const entry = timers.entries().next().value as [number, () => void]; timers.delete(entry[0]); entry[1](); } },
  };
}

function createBridgeHarness(document: CanonicalDocument): {
  bridge: EditorKitBridge;
  delegate: EditorKitDelegate;
  saves: string[];
  scheduler: ReturnType<typeof fakeScheduler>;
} {
  let delegate: EditorKitDelegate | undefined;
  const saves: string[] = [];
  const scheduler = fakeScheduler();
  const bridge = new EditorKitBridge(document, () => undefined, (nextDelegate) => {
    delegate = nextDelegate;
    return {
      saveItemWithPresave(note, presave) {
        presave?.();
        saves.push(note.content?.text as string);
      },
    };
  }, scheduler.scheduler);
  bridge.start();
  return { bridge, delegate: delegate!, saves, scheduler };
}

async function deliverContext(delegate: EditorKitDelegate, text: string): Promise<void> {
  const note = { uuid: "history-boundary", content: { text } };
  await delegate.onNoteValueChange?.(note);
  delegate.setEditorRawText(text);
}

assert.equal(shouldReportSourceSelection({ selectionSet: true, docChanged: true }, true), false);
assert.equal(shouldReportSourceSelection({ selectionSet: true, docChanged: false }, false), true);
assert.equal(shouldReportSourceSelection({ selectionSet: false, docChanged: true }, false), true);

{
  const document = new CanonicalDocument();
  const bridgeHarness = await createBridgeHarness(document);
  const source = createSourceHarness("base\n");
  await deliverContext(bridgeHarness.delegate, "base\n");
  synchronizeSourceEditor(source.view, document.text, source.historyCompartment, 0, document.snapshot().resetGeneration);

  userReplace(source, "local revision\n");
  userReplace(source, "", "delete.backward");
  assert.equal(document.applyLocal(source.view.state.doc.toString()), true);
  bridgeHarness.bridge.notifyLocalChange(document.text);

  await deliverContext(bridgeHarness.delegate, "remote\n");
  assert.equal(document.pendingRemote, "remote\n");
  assert.equal(bridgeHarness.bridge.resolveConflict("accept-remote"), true);
  const resetGeneration = document.snapshot().resetGeneration;
  synchronizeSourceEditor(source.view, document.text, source.historyCompartment, resetGeneration - 1, resetGeneration);

  assert.equal(source.view.state.doc.toString(), "remote\n");
  assert.equal(undoDepth(source.view.state), 0);
  assert.equal(redoDepth(source.view.state), 0);
  assert.equal(applyCommand(source, undo), false);
  assert.equal(applyCommand(source, redo), false);
  assert.equal(document.dirty, false);
  bridgeHarness.scheduler.runAll();
  assert.deepEqual(bridgeHarness.saves, []);
}

{
  const document = new CanonicalDocument("same");
  const source = createSourceHarness("same");
  userReplace(source, "changed");
  assert.equal(applyCommand(source, undo), true);
  assert.equal(source.view.state.doc.toString(), "same");
  assert.equal(redoDepth(source.view.state), 1);
  const beforeDispatches = source.dispatchCount;
  const beforeDocumentChanges = source.documentChanges;

  let emittedResetGeneration: number | undefined;
  document.subscribe((_state, transition) => {
    if (transition?.kind === "initialize") emittedResetGeneration = transition.resetGeneration;
  });
  document.initialize("same");
  assert.equal(emittedResetGeneration, document.snapshot().resetGeneration);
  synchronizeSourceEditor(source.view, document.text, source.historyCompartment, 0, document.snapshot().resetGeneration);

  assert.equal(source.view.state.doc.toString(), "same");
  assert.equal(source.dispatchCount - beforeDispatches, 2);
  assert.equal(source.documentChanges, beforeDocumentChanges);
  assert.equal(undoDepth(source.view.state), 0);
  assert.equal(redoDepth(source.view.state), 0);
}

{
  const source = createSourceHarness("base");
  userReplace(source, "edited");
  synchronizeSourceEditor(source.view, "edited", source.historyCompartment, 0, 0);
  assert.equal(source.view.state.doc.toString(), "edited");
  assert.equal(applyCommand(source, undo), true);
  assert.equal(source.view.state.doc.toString(), "base");
  assert.equal(applyCommand(source, redo), true);
  assert.equal(source.view.state.doc.toString(), "edited");
}

{
  const document = new CanonicalDocument("base\n");
  const source = createSourceHarness("base\n");
  const bridgeHarness = await createBridgeHarness(document);
  await deliverContext(bridgeHarness.delegate, "base\n");
  const resetGeneration = document.snapshot().resetGeneration;
  synchronizeSourceEditor(source.view, "base\n", source.historyCompartment, 0, resetGeneration);

  userReplace(source, "edited\n");
  assert.equal(document.applyLocal(source.view.state.doc.toString()), true);
  bridgeHarness.bridge.notifyLocalChange(document.text);
  assert.equal(undoDepth(source.view.state), 1);

  // This is the App toolbar undo path: canonical text changes, but its
  // resetGeneration remains unchanged because this is local history.
  assert.equal(document.undo(), true);
  assert.equal(document.text, "base\n");
  bridgeHarness.bridge.notifyLocalChange(document.text);
  synchronizeSourceEditor(source.view, document.text, source.historyCompartment, resetGeneration, document.snapshot().resetGeneration);

  assert.equal(source.view.state.doc.toString(), "base\n");
  assert.equal(undoDepth(source.view.state), 0);
  assert.equal(redoDepth(source.view.state), 0);
  assert.equal(applyCommand(source, undo), false);
  assert.equal(source.view.state.doc.toString(), "base\n");
  assert.equal(document.text, "base\n");

  bridgeHarness.scheduler.runAll();
  assert.deepEqual(bridgeHarness.saves, ["base\n"]);
}

{
  const document = new CanonicalDocument("base\n");
  const source = createSourceHarness("base\n");
  const bridgeHarness = await createBridgeHarness(document);
  await deliverContext(bridgeHarness.delegate, "base\n");
  const resetGeneration = document.snapshot().resetGeneration;
  synchronizeSourceEditor(source.view, "base\n", source.historyCompartment, 0, resetGeneration);

  userReplace(source, "edited\n");
  assert.equal(document.applyLocal(source.view.state.doc.toString()), true);
  bridgeHarness.bridge.notifyLocalChange(document.text);
  assert.equal(document.undo(), true);
  bridgeHarness.bridge.notifyLocalChange(document.text);
  synchronizeSourceEditor(source.view, document.text, source.historyCompartment, resetGeneration, document.snapshot().resetGeneration);

  // Redo is another canonical replacement at the same generation and must
  // not restore the old Source history branch.
  assert.equal(document.redo(), true);
  assert.equal(document.text, "edited\n");
  bridgeHarness.bridge.notifyLocalChange(document.text);
  synchronizeSourceEditor(source.view, document.text, source.historyCompartment, resetGeneration, document.snapshot().resetGeneration);

  assert.equal(source.view.state.doc.toString(), "edited\n");
  assert.equal(undoDepth(source.view.state), 0);
  assert.equal(redoDepth(source.view.state), 0);
  assert.equal(applyCommand(source, undo), false);
  assert.equal(source.view.state.doc.toString(), "edited\n");
  assert.equal(document.text, "edited\n");

  bridgeHarness.scheduler.runAll();
  assert.deepEqual(bridgeHarness.saves, ["edited\n"]);
}

console.log("Source history boundary: remote reset, equal-text reset, user history, and selection suppression passed");
