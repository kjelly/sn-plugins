import assert from "node:assert/strict";
import { Ctx, Container, Clock, type MilkdownPlugin } from "@milkdown/ctx";
import { editorViewCtx, marksCtx, nodesCtx, parserCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { Editor } from "@milkdown/core";
import { remarkPreserveEmptyLinePlugin, schema as commonmarkSchema } from "@milkdown/preset-commonmark";
import { schema as gfmSchema } from "@milkdown/preset-gfm";
import { splitBlock } from "@milkdown/prose/commands";
import { DOMSerializer, Schema, type Node as ProseNode } from "@milkdown/prose/model";
import { history, undo, undoDepth } from "@milkdown/prose/history";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { ParserState, SerializerState } from "@milkdown/transformer";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { CanonicalDocument } from "../src/document/CanonicalDocument";
import { applyWritingCommand, writingLinkHref } from "../src/editor/WritingCommands";
import { applyWritingOriginTransaction, assessWritingMutation, assessWritingRoundTrip, reconnectWritingSuffix, WRITING_STRUCTURAL_CONTEXT_META, WRITING_TRANSACTION_ORIGIN_META, WritingEditorChangeGate, type WritingMutationOrigin, type WritingOriginState } from "../src/editor/WritingEditorLifecycle";
import { writingCommandPlan, type WritingCommandName } from "../src/editor/WritingCommandPlan";
import { taskOrdinalAtDocumentPosition, WritingControlRegistry } from "../src/editor/WritingTaskControls";
import { EditorKitBridge, type EditorKitDelegate } from "../src/standardnotes/EditorKitBridge";
import { configureWritingEditor, replaceAllWithOrigin, synchronizeWritingEditorValue, writingCommonmark, writingLinkSchema } from "../src/editor/WritingEditor";
import { analyzeMarkdown, deleteTask } from "../src/markdown/analysis.ts";
import { normalizeBareUrls } from "../src/document/normalizeBareUrls.ts";

function createWritingEnvironment(plugins: MilkdownPlugin[] = writingCommonmark, resourceLink = false): { context: Ctx; schema: Schema; parse: (source: string) => ReturnType<NonNullable<typeof ParserState.create>> extends (source: string) => infer Document ? Document : never; serialize: (document: ProseNode) => string } {
  const context = new Ctx(new Container(), new Clock());
  context.inject(nodesCtx, []).inject(marksCtx, []).inject(remarkStringifyOptionsCtx, {});
  // Mirror the production Writing preset's schema boundary. This helper does
  // not run Milkdown's browser lifecycle; it only makes parser/serializer
  // assertions against the same filtered preset that WritingEditor installs.
  const writingCommonmarkSchema = plugins.filter((plugin) => commonmarkSchema.includes(plugin) || plugin === writingLinkSchema[0] || plugin === writingLinkSchema[1]);
  for (const plugin of [...writingCommonmarkSchema, ...gfmSchema]) {
    const handler = plugin(context);
    if (handler) void handler();
  }
  const schema = new Schema({ nodes: Object.fromEntries(context.get(nodesCtx)), marks: Object.fromEntries(context.get(marksCtx)) });
  const processor = remark().use(remarkGfm).data("settings", { resourceLink });
  const parse = ParserState.create!(schema, processor);
  const serialize = SerializerState.create!(schema, processor);
  context.inject(editorViewCtx, {} as never);
  return { context, schema, parse, serialize };
}

type RecordedNode = RecordedElement | RecordedFragment | RecordedText;

class RecordedElement {
  readonly nodeType = 1;
  readonly childNodes: RecordedNode[] = [];
  readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) {}

  appendChild(child: RecordedNode): RecordedNode {
    this.childNodes.push(child);
    return child;
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

class RecordedFragment {
  readonly nodeType = 11;
  readonly childNodes: RecordedNode[] = [];

  appendChild(child: RecordedNode): RecordedNode {
    this.childNodes.push(child);
    return child;
  }
}

class RecordedText {
  readonly nodeType = 3;

  constructor(readonly textContent: string) {}
}

function recordedDocument(): Document {
  return {
    createDocumentFragment: () => new RecordedFragment(),
    createElement: (tagName: string) => new RecordedElement(tagName),
    createElementNS: (_namespace: string, tagName: string) => new RecordedElement(tagName),
    createTextNode: (text: string) => new RecordedText(text),
  } as unknown as Document;
}

function findRecordedElement(node: RecordedNode, tagName: string): RecordedElement | undefined {
  if (node instanceof RecordedElement && node.tagName === tagName) return node;
  if (!(node instanceof RecordedElement) && !(node instanceof RecordedFragment)) return undefined;
  for (const child of node.childNodes) {
    const match = findRecordedElement(child, tagName);
    if (match) return match;
  }
  return undefined;
}

function serializeWritingLinkDom(source: string): { anchor: RecordedElement; markdown: string; rawHref: unknown } {
  const { schema, parse, serialize } = createWritingEnvironment();
  const parsed = parse(source);
  const document = recordedDocument();
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(parsed.content, { document });
  const anchor = findRecordedElement(fragment as unknown as RecordedFragment, "a");
  assert(anchor, "Writing DOM serialization must produce an anchor");
  return { anchor, markdown: serialize(parsed), rawHref: parsed.firstChild?.firstChild?.marks[0]?.attrs.href };
}

function testWritingEditorPresetLifecycle(): void {
  const editor = Editor.make();
  const installed: unknown[] = [];
  const use = editor.use.bind(editor);
  (editor as unknown as { use: (plugins: MilkdownPlugin | MilkdownPlugin[]) => Editor }).use = (plugins) => {
    installed.push(plugins);
    return use(plugins);
  };
  const readOnlyRef = { current: false };
  const registeredEditor = configureWritingEditor(editor, {
    host: {} as HTMLDivElement,
    value: "",
    valueRef: { current: "" },
    readOnlyRef,
    controls: new WritingControlRegistry(),
    onDeleteTaskRef: { current: () => undefined },
    editability: { readOnlyRef, capabilityRef: { current: false } },
    onMarkdownUpdated: () => undefined,
  });
  assert.equal(registeredEditor, editor, "WritingEditor configuration must preserve the Editor instance");
  const registeredPreset = installed.find((plugins): plugins is MilkdownPlugin[] => plugins === writingCommonmark);
  assert(registeredPreset, "WritingEditor must register its filtered CommonMark preset");
  assert(Array.isArray(registeredPreset), "WritingEditor must register the preset plugin array");

  const { schema, parse, serialize } = createWritingEnvironment(registeredPreset);
  const canonical = new CanonicalDocument("");
  let state = EditorState.create({ schema, doc: parse("") });
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin("");
  let previous = serialize(state.doc);
  gate.finish(generation, previous);
  const fallback: string[] = [];
  let writingEditable = false;
  const view = {
    get state() { return state; },
    editable: true,
    focus() {},
    dispatch(transaction: typeof state.tr) {
      state = state.apply(transaction);
      const markdown = serialize(state.doc);
      if (!gate.markdownUpdated(generation, markdown, "user")) return;
      const proof = assessWritingMutation(previous, markdown);
      writingEditable = proof.editable;
      if (!proof.editable) fallback.push(markdown);
      else {
        assert.equal(canonical.applyLocal(markdown), true, "editable Writing output must reach canonical Markdown");
        previous = markdown;
      }
    },
  };

  view.dispatch(state.tr.insertText("# aa"));
  assert.equal(splitBlock(state, (transaction) => view.dispatch(transaction)), true, "first Enter must split the Writing block");
  assert.equal(splitBlock(state, (transaction) => view.dispatch(transaction)), true, "second Enter must create the empty Writing paragraph");

  const serialized = serialize(state.doc);
  assert.equal(fallback.length, 0, "the Writing lifecycle must not request Source fallback");
  assert.equal(writingEditable, true, "Writing must remain editable after # aa + Enter + Enter");
  assert(!serialized.includes("<br />"), "Writing serialization must not contain synthetic <br />");
  assert(!canonical.text.includes("<br />"), "canonical Markdown must not contain synthetic <br />");
  assert.equal(canonical.text, serialized, "canonical Markdown must match the final Writing serialization");
}

{
  const { parse, serialize } = createWritingEnvironment(writingCommonmark, true);
  for (const bare of ["https://bare.example/path", "https://x.test/a]b", "https://x.test/a(b)"]) {
    const bareSerialized = serialize(parse(bare));
    assert.equal(assessWritingRoundTrip(bare, reconnectWritingSuffix(bare, bareSerialized)).editable, false, "bare URL must fail the initial exact proof");

    const normalized = normalizeBareUrls(bare).markdown;
    const parsed = parse(normalized);
    const normalizedLink = parsed.firstChild?.firstChild;
    const linkMark = normalizedLink?.marks.find((mark) => mark.type.name === "link");
    assert(linkMark, "normalized URL must parse as a resource link mark");
    assert.equal(linkMark.attrs.href, bare, "normalized link href must preserve URL semantics");
    const normalizedSerialized = reconnectWritingSuffix(normalized, serialize(parsed));
    assert.equal(normalizedSerialized, normalized, "resourceLink serializer must preserve an explicit Markdown link after suffix reconnect");
    assert.equal(assessWritingRoundTrip(normalized, normalizedSerialized).editable, true, "normalized URL must pass the exact proof");
    assert.equal(assessWritingMutation(normalized, normalized, "user").editable, true, "normalized URL must not immediately fall back after canonical handoff");
  }
}

testWritingEditorPresetLifecycle();

{
  const unsafe = serializeWritingLinkDom("[Malicious](javascript:alert(1))\n");
  assert.equal(unsafe.anchor.hasAttribute("href"), false, "unsafe Writing links must omit the href attribute");
  assert.equal(unsafe.rawHref, "javascript:alert(1)", "unsafe link mark value must remain lossless");
  assert.match(unsafe.markdown, /javascript:alert/, "unsafe link Markdown must retain its destination");

  const safe = serializeWritingLinkDom("[Safe](https://example.test/path)\n");
  assert.equal(safe.anchor.getAttribute("href"), "https://example.test/path", "safe Writing links must retain their href");
}

{
  assert.equal(writingCommonmark.includes(remarkPreserveEmptyLinePlugin.options), false, "Writing preset must exclude the synthetic empty-line options context");
  assert.equal(writingCommonmark.includes(remarkPreserveEmptyLinePlugin.plugin), false, "Writing preset must exclude the synthetic empty-line plugin by identity");
  const { context, schema, parse, serialize } = createWritingEnvironment();
  assert.throws(() => context.get(remarkPreserveEmptyLinePlugin.id), "Writing preset must not register the synthetic empty-line context");
  const heading = schema.nodes.heading.create({ level: 1 }, schema.text("aa"));
  const emptyParagraph = schema.nodes.paragraph.create();
  const doc = schema.nodes.doc.create(null, [heading, emptyParagraph, schema.nodes.paragraph.create()]);
  const state = EditorState.create({ schema, doc });
  context.set(editorViewCtx, { get state() { return state; } } as never);

  const serialized = serialize(state.doc);
  assert.equal(serialized, "# aa\n\n\n\n", "Writing empty paragraphs must serialize as ordinary LF blank lines");
  assert(!serialized.includes("<br />") && !serialized.includes("<html>"), "Writing must not synthesize raw HTML for empty paragraphs");
  assert.equal(assessWritingMutation("# aa\n", serialized).editable, true, "empty paragraph serialization must remain editable");
  const reloaded = serialize(parse(serialized));
  assert.equal(reloaded, "# aa\n", "ordinary LF blank lines must parse and reload as canonical Markdown");
  assert(!reloaded.includes("<br />") && !reloaded.includes("<html>"), "reloaded Writing Markdown must remain free of synthetic HTML");

  const sourceLiteral = "# aa\n\n<br />\n";
  assert.equal(assessWritingMutation("# aa\n\n", sourceLiteral).editable, false, "literal Source HTML must remain protected by the Writing gate");
}

function testWritingInitializationReplacementHandoff(): void {
  const unsafe = "## aaa\nasdfsaf";
  const safe = "## aaa\n\nasdfsaf\n";
  const { context, schema, parse, serialize } = createWritingEnvironment();
  let state = EditorState.create({ schema, doc: parse(unsafe) });
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin(unsafe);
  const changes: string[] = [];
  const capabilities: boolean[] = [];
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      state = state.apply(transaction);
      const markdown = serialize(state.doc);
      const origin = (transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META) ?? "user") as WritingMutationOrigin;
      if (gate.markdownUpdated(generation, markdown, origin) && origin === "user") changes.push(markdown);
    },
    focus() {},
    editable: false,
  };
  context.inject(parserCtx, parse).inject(editorViewCtx, view as never);

  const unsafeSerialized = serialize(state.doc);
  assert.equal(unsafeSerialized, safe, "the reproducing source must materialize with the separating blank line");
  assert.equal(assessWritingRoundTrip(unsafe, unsafeSerialized).editable, false, "the original source must remain read-only");
  gate.finish(generation, unsafe);

  const proof = synchronizeWritingEditorValue({
    gate,
    generation,
    value: safe,
    replace: (value, origin) => replaceAllWithOrigin(context, value, origin),
    serialize: () => serialize(state.doc),
    report: (result) => capabilities.push(result.editable),
  });

  assert.equal(proof.editable, true, "the late canonical replacement must restore Writing capability");
  assert.deepEqual(capabilities, [true], "the replacement handoff must report the refreshed capability");
  assert.equal(serialize(state.doc), safe, "the Milkdown document must contain the current canonical value");

  view.dispatch(state.tr.insertText("!"));
  assert.equal(changes.length, 1, "one user input after the handoff must reach onChange once");
}

testWritingInitializationReplacementHandoff();

function serializeCommandThroughCanonical(source: string, command: WritingCommandName): string {
  const { context, schema, parse, serialize } = createWritingEnvironment();
  let state = EditorState.create({ schema, doc: parse(source) });
  let commandOrigin: unknown;
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      commandOrigin = transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META);
      state = state.apply(transaction);
    },
    focus() {},
    editable: true,
  };
  assert.equal(applyWritingCommand(view as never, command), true, `${command} must dispatch`);
  assert.deepEqual(commandOrigin, { kind: "command", command }, `${command} must carry command origin`);
  context.set(editorViewCtx, view as never);
  const serialized = serialize(state.doc);
  assert.equal(assessWritingMutation(source, serialized, { kind: "command", command }).editable, true, `${command} must pass command gate`);
  const canonical = new CanonicalDocument(source);
  assert.equal(canonical.applyLocal(serialized), true, `${command} must reach canonical`);
  return canonical.text;
}

function serializeCommandThenImmediateUserEdit(source: string, command: "code" | "table" | "divider"): string {
  const { context, schema, parse, serialize } = createWritingEnvironment();
  let state = EditorState.create({ schema, doc: parse(source) });
  let originState: WritingOriginState = { origin: "user" };
  let commandStructural: unknown;
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      if (transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META)?.kind === "command") commandStructural = transaction.getMeta(WRITING_STRUCTURAL_CONTEXT_META);
      originState = applyWritingOriginTransaction(transaction, originState);
      state = state.apply(transaction);
    },
    focus() {},
    editable: true,
  };

  assert.equal(applyWritingCommand(view as never, command), true, `${command} must dispatch`);
  const commandMarkdown = serialize(state.doc);
  const commandVersion = originState.structural?.version;
  assert.deepEqual(commandStructural, { context: command, version: commandVersion }, `${command} must publish structural provenance before dispatch`);
  const userTransaction = state.tr.insertText(" edit", state.selection.from);
  originState = applyWritingOriginTransaction(userTransaction, originState);
  state = state.apply(userTransaction);
  const serialized = serialize(state.doc);
  assert.equal(originState.origin, "user", `${command} follow-up must be a user transaction`);
  assert.deepEqual(originState.structural, { context: command, version: commandVersion }, `${command} context must cross debounce`);
  assert.equal(assessWritingMutation(commandMarkdown, serialized, "user", originState.structural?.context).editable, true, `${command} follow-up must pass the carried structural gate`);
  context.set(editorViewCtx, view as never);
  return serialized;
}

const cases: Array<[WritingCommandName, string, string]> = [
  ["heading", "title", "# title\n"],
  ["task", "task", "* [ ] task\n"],
  ["code", "snippet", "```\nsnippet\n```\n"],
  ["table", "table", "|    |    |    |\n| :- | :- | :- |\n|    |    |    |\n|    |    |    |\n"],
  ["divider", "divider", "***\n"],
];

for (const [command, source, expected] of cases) {
  assert.deepEqual(writingCommandPlan(command).kind.length > 0, true);
  assert.equal(serializeCommandThroughCanonical(source, command), expected, `${command} canonical output`);
}

for (const [command, source] of [["code", "snippet"], ["table", "table"], ["divider", "divider"]] as const) {
  const result = serializeCommandThenImmediateUserEdit(source, command);
  assert.match(result, /edit/, `${command} immediate user edit must reach canonical serialization`);
  const canonical = new CanonicalDocument(source);
  assert.equal(canonical.applyLocal(result), true, `${command} coalesced result must reach canonical`);
  assert.match(canonical.text, /edit/, `${command} canonical output must retain the user edit`);
}

for (const [command, output] of [["task", "- [ ] task\r\n"], ["table", "| a | b |\r\n| --- | --- |\r\n| c | d |\r\n"], ["link", "[label](target)\r\n"], ["divider", "---\r\n"]] as const) {
  assert.equal(assessWritingMutation("plain", output, { kind: "command", command }).editable, false, `${command} CRLF output must be rejected`);
}

function makeLinkView(source: string, selectionFrom: number, selectionTo = selectionFrom) {
  const { schema, parse, serialize } = createWritingEnvironment();
  const doc = parse(source);
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, selectionFrom, selectionTo) });
  let dispatches = 0;
  let origin: unknown;
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      dispatches += 1;
      origin = transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META);
      state = state.apply(transaction);
    },
    focus() {},
    editable: true,
  };
  return { view, get state() { return state; }, serialize, get dispatches() { return dispatches; }, get origin() { return origin; } };
}

{
  const { schema, parse, serialize } = createWritingEnvironment();
  const source = "label";
  let state = EditorState.create({ schema, doc: parse(source) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
  let origin: unknown;
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      origin = transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META);
      state = state.apply(transaction);
    },
    focus() {},
    editable: true,
  };
  assert.equal(applyWritingCommand(view as never, "link", undefined, " https://example.test "), true, "selected text must create a link");
  assert.deepEqual(origin, { kind: "command", command: "link" });
  const serialized = serialize(state.doc);
  assert.equal(serialized, "[label](< https://example.test >)\n", "link URL must reach the serializer without command-side trimming");
  assert.equal(assessWritingMutation(source, serialized, { kind: "command", command: "link" }).editable, true, "link creation must pass the normal command admission boundary");
  assert.equal(serialize(parse(serialized)), serialized, "link serialization must be idempotent");
  const canonical = new CanonicalDocument(source);
  assert.equal(canonical.applyLocal(serialized), true, "serialized link must reach canonical Markdown");
}

{
  const view = makeLinkView("[label](old \"title\")", 3);
  assert.equal(applyWritingCommand(view.view as never, "link", undefined, "new"), true, "caret in a link must update its URL");
  assert.equal(view.serialize(view.state.doc), "[label](new \"title\")\n", "caret edit must preserve the existing title over the equal-mark range");
}

{
  const source = "[label](old)";
  const view = makeLinkView(source, 1, 6);
  assert.equal(applyWritingCommand(view.view as never, "link", undefined, ""), true, "empty URL must unlink selected text");
  assert.equal(view.serialize(view.state.doc), "label\n");
}

{
  const source = "[label](old \"title\")";
  const view = makeLinkView(source, 1, 6);
  assert.equal(applyWritingCommand(view.view as never, "link", undefined, "new"), true, "selected link text must update its mark");
  assert.equal(view.serialize(view.state.doc), "[label](new \"title\")\n", "selected link update must preserve its title");
}

{
  const source = "plain";
  const view = makeLinkView(source, 3);
  assert.equal(applyWritingCommand(view.view as never, "link", undefined, "next"), true, "caret outside a link must set a stored mark");
  const storedLink = view.state.storedMarks?.find((mark) => mark.type.name === "link");
  assert.equal(storedLink?.attrs.href, "next");
  assert.equal(storedLink?.attrs.title, null);
  const noOp = makeLinkView(source, 3);
  assert.equal(applyWritingCommand(noOp.view as never, "link", undefined, ""), false, "empty URL outside a link must be a no-op");
  assert.equal(noOp.dispatches, 0, "empty URL no-op must not dispatch");
}

{
  const source = "plain";
  const view = makeLinkView(source, 1, 6);
  (view.view as { editable: boolean }).editable = false;
  assert.equal(applyWritingCommand(view.view as never, "link", undefined, "blocked"), false, "read-only Writing must reject link commands");
  assert.equal(view.dispatches, 0, "read-only link command must not dispatch");
}

{
  const source = "/link";
  const cancelled = makeLinkView(source, 6);
  assert.equal(applyWritingCommand(cancelled.view as never, "link"), false, "cancelled link prompt must not apply a command");
  assert.equal(cancelled.state.doc.textContent, source, "cancel must leave the slash command text intact");

  const confirmed = makeLinkView(source, 6);
  assert.equal(applyWritingCommand(confirmed.view as never, "link", { from: 1, to: 6, query: "link" }, "target"), true, "confirmed slash link must apply");
  assert.equal(confirmed.dispatches, 1, "confirmed slash link must dispatch one atomic transaction");
  assert.equal(confirmed.state.doc.textContent, "", "confirming /link must remove the slash command text");
  const storedLink = confirmed.state.storedMarks?.find((mark) => mark.type.name === "link");
  assert.equal(storedLink?.attrs.href, "target", "confirmed slash link must retain the link stored mark");
  assert.equal(writingLinkHref(confirmed.view as never), "target", "link prompt must read the stored link URL");
  const typedState = confirmed.state.apply(confirmed.state.tr.insertText("text", confirmed.state.selection.from));
  assert.equal(confirmed.serialize(typedState.doc), "[text](target)\n", "text typed after /link must use the confirmed link");
  assert.equal(applyWritingCommand(confirmed.view as never, "link", undefined, "updated"), true, "stored link URL must be updateable at the caret");
  assert.equal(confirmed.state.storedMarks?.find((mark) => mark.type.name === "link")?.attrs.href, "updated", "stored link update must replace its URL");
  assert.equal(applyWritingCommand(confirmed.view as never, "link", undefined, ""), true, "empty URL at a stored link caret must unlink future text");
  assert.equal(confirmed.state.storedMarks?.some((mark) => mark.type.name === "link"), false, "empty URL must remove the stored link");
  const unlinkedTypedState = confirmed.state.apply(confirmed.state.tr.insertText("text", confirmed.state.selection.from));
  assert.equal(confirmed.serialize(unlinkedTypedState.doc), "text\n", "text typed after unlinking a stored link must serialize unlinked");
}

{
  const source = "[/link](old \"title\")";
  const confirmed = makeLinkView(source, 6);
  assert.equal(applyWritingCommand(confirmed.view as never, "link", { from: 1, to: 6, query: "link" }, "target"), true, "slash link over titled link text must apply");
  assert.equal(confirmed.dispatches, 1, "titled slash link must dispatch one atomic transaction");
  const storedLink = confirmed.state.storedMarks?.find((mark) => mark.type.name === "link");
  assert.equal(storedLink?.attrs.href, "target", "titled slash link must retain the requested URL");
  assert.equal(storedLink?.attrs.title, "title", "titled slash link must retain the existing title");
  const typedState = confirmed.state.apply(confirmed.state.tr.insertText("text", confirmed.state.selection.from));
  assert.equal(confirmed.serialize(typedState.doc), "[text](target \"title\")\n", "text typed after titled /link must retain the title");
}

{
  const source = "[prefix /link](old \"title\")";
  const confirmed = makeLinkView(source, 13);
  assert.equal(applyWritingCommand(confirmed.view as never, "link", { from: 8, to: 13, query: "link" }, "target"), true, "partial titled slash link must apply");
  assert.equal(confirmed.dispatches, 1, "partial titled slash link must dispatch one atomic transaction");
  const typedState = confirmed.state.apply(confirmed.state.tr.insertText("next", confirmed.state.selection.from));
  assert.equal(confirmed.serialize(typedState.doc), "[prefix](old \"title\") [next](target \"title\")\n", "partial slash link must preserve the prefix link and use the target only for later input");
}

{
  const source = "prefix /link";
  const confirmed = makeLinkView(source, 12);
  assert.equal(applyWritingCommand(confirmed.view as never, "link", { from: 8, to: 13, query: "link" }, "target"), true, "partial unlinked slash link must apply");
  const typedState = confirmed.state.apply(confirmed.state.tr.insertText("next", confirmed.state.selection.from));
  assert.equal(confirmed.serialize(typedState.doc), "prefix [next](target)\n", "partial unlinked slash link must preserve text outside the consumed range");
}

{
  const source = "/link\n";
  const canonical = new CanonicalDocument();
  let delegate: EditorKitDelegate | undefined;
  const saves: string[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const bridge = new EditorKitBridge(canonical, () => undefined, (nextDelegate) => {
    delegate = nextDelegate;
    return {
      saveItemWithPresave(note, presave) {
        presave?.();
        saves.push(note.content?.text as string);
      },
    };
  }, {
    setTimeout(handler) { const id = nextTimer++; timers.set(id, handler); return id; },
    clearTimeout(id) { timers.delete(id as number); },
  });
  bridge.start();
  void delegate!.onNoteValueChange?.({ uuid: "link-no-op", content: { text: source } });
  delegate!.setEditorRawText(source);

  const { schema, parse, serialize } = createWritingEnvironment();
  const doc = parse(source);
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 6),
    plugins: [history()],
  });
  const beforeDoc = state.doc;
  const beforeUndoDepth = undoDepth(state);
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin(source);
  gate.finish(generation, source);
  let dispatches = 0;
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      dispatches += 1;
      state = state.apply(transaction);
      const markdown = serialize(state.doc);
      const origin = (transaction.getMeta(WRITING_TRANSACTION_ORIGIN_META) ?? "user") as WritingMutationOrigin;
      if (!transaction.docChanged || !gate.markdownUpdated(generation, markdown, origin)) return;
      const proof = assessWritingMutation(source, markdown, origin);
      if (!proof.editable || !canonical.applyLocal(markdown)) return;
      bridge.notifyLocalChange(canonical.text);
    },
    focus() {},
    editable: true,
  };

  assert.equal(applyWritingCommand(view as never, "link", { from: 1, to: 6, query: "link" }, ""), false, "empty slash link outside a link must be a no-op");
  assert.equal(dispatches, 0, "empty slash link must not dispatch a deletion transaction");
  assert(beforeDoc.eq(state.doc), "empty slash link must leave the editor document unchanged");
  assert.equal(serialize(state.doc), source, "empty slash link must leave serialized Markdown unchanged");
  assert.equal(canonical.text, source, "empty slash link must leave canonical Markdown unchanged");
  assert.equal(undoDepth(state), beforeUndoDepth, "empty slash link must not add undo history");
  while (timers.size > 0) {
    const timer = timers.entries().next().value as [number, () => void];
    timers.delete(timer[0]);
    timer[1]();
  }
  assert.deepEqual(saves, [], "empty slash link must not request a bridge save");
  assert.equal(canonical.dirty, false, "empty slash link must not dirty the canonical document");
}

{
  const source = "A\n";
  const canonical = new CanonicalDocument();
  const { schema, parse, serialize } = createWritingEnvironment();
  let state = EditorState.create({ schema, doc: parse(source), plugins: [history()] });
  let latestTransaction: typeof state.tr | undefined;
  const writingReset = () => {
    state = EditorState.create({ schema, doc: parse("B\n"), plugins: [history()] });
  };
  const view = {
    get state() { return state; },
    dispatch(transaction: typeof state.tr) {
      latestTransaction = transaction;
      state = state.apply(transaction);
    },
    focus() {},
    editable: true,
  };
  const context = new Ctx(new Container(), new Clock());
  context.inject(parserCtx, parse).inject(editorViewCtx, view as never);

  // This is the actual ProseMirror history boundary used by Milkdown.
  state = state.apply(state.tr.insertText(" user", 1));
  assert.equal(undoDepth(state), 1, "A user edit must be undoable before the note switch");

  let delegate: EditorKitDelegate | undefined;
  const bridge = new EditorKitBridge(canonical, () => undefined, (nextDelegate) => {
    delegate = nextDelegate;
    return { saveItemWithPresave() {} };
  }, undefined, writingReset);
  bridge.start();
  await delegate!.onNoteValueChange?.({ uuid: "note-a", content: { text: source } });
  delegate!.setEditorRawText(source);
  await delegate!.onNoteValueChange?.({ uuid: "note-b", content: { text: "B\n" } });
  delegate!.setEditorRawText("B\n");
  delegate!.clearUndoHistory?.();

  assert.equal(canonical.text, "B\n");
  assert.equal(canonical.dirty, false);
  assert.equal(undoDepth(state), 0, "the host clear callback must establish an empty Writing history epoch");
  assert.equal(undo(state), false, "a switched note must not undo A's user edit");
  assert.equal(serialize(state.doc), "B\n");

  state = state.apply(state.tr.insertText(" user", 1));
  latestTransaction = undefined;
  assert.equal(undoDepth(state), 1, "B user edits must remain undoable");

  const external = { kind: "external-replace" as const, generation: 1, version: 1 };
  replaceAllWithOrigin(context, "B replacement\n", external);
  assert.equal(latestTransaction?.getMeta("addToHistory"), false, "external replacement must not enter history");
  assert.deepEqual(latestTransaction?.getMeta(WRITING_TRANSACTION_ORIGIN_META), external);
  assert.equal(undoDepth(state), 1, "external replacement must not mask the existing B user history");
  assert.equal(undo(state), true, "B user edit must still be undoable after external replacement");
  assert.equal(serialize(state.doc), "B replacement\n");
}

{
  const source = "- [ ] duplicate\n  - [ ] nested\n- [ ] duplicate\n- [ ] tail\n";
  const { parse } = createWritingEnvironment();
  const doc = parse(source);
  const positions: number[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "list_item" && node.attrs.checked != null) positions.push(position);
    return true;
  });
  assert.deepEqual(positions.map((position) => taskOrdinalAtDocumentPosition(doc, position)), [0, 1, 2, 3]);
  const ordinal = taskOrdinalAtDocumentPosition(doc, positions[2]);
  assert.equal(ordinal, 2, "Milkdown task node must resolve by document-order ordinal");
  const currentTask = analyzeMarkdown(source).tasks[ordinal!];
  assert(currentTask, "ordinal must resolve in fresh Markdown analysis");
  const result = deleteTask(source, currentTask, ordinal);
  assert.deepEqual(result.changeSet?.changes, [{ from: currentTask.itemStart, to: currentTask.itemEnd, insertedLength: 0 }]);
}

console.log(`Milkdown component boundary: ${cases.length} commands passed`);
