function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

/// <reference lib="deno.ns" />

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
  readDir(path: string | URL): AsyncIterable<{ isFile: boolean; isDirectory: boolean; name: string }>;
  readTextFile(path: string | URL): Promise<string>;
};

import {
  analyzeMarkdown,
  checkAllInSection,
  deleteCompleted,
  deleteCompletedInSection,
  deleteCompletedInHeadingPath,
  deleteTask,
  isMindmapSuitable,
  mindmapText,
  remapSourceOffset,
  scanMarkdownStructure,
  sectionAnchorAt,
  sectionAt,
  sectionByAnchor,
  splitMarkdownLines,
  toggleTask,
  uncheckAll,
  uncheckAllInSection,
  uncheckAllInHeadingPath,
} from "../src/markdown/analysis.ts";
import { groupTasksByHeading } from "../src/tasks/TaskIndex.ts";
import { createTextChangeSet, mapTextPosition } from "../src/document/PositionMap.ts";
import { CanonicalDocument } from "../src/document/CanonicalDocument.ts";
import { reconcileSectionAnchor } from "../src/document/SectionAnchor.ts";
import { assessWritingMutation, assessWritingRoundTrip, WritingEditorChangeGate } from "../src/editor/WritingEditorLifecycle.ts";
import { EditorKitLifecycle } from "../src/standardnotes/EditorKitLifecycle.ts";
import { projectMindmapMarkdown } from "../src/markdown/analysis.ts";
import { WritingControlRegistry, writingControlIsDisabled, writingTaskIsHidden } from "../src/editor/WritingTaskControls.ts";
import { isWritingLinkShortcut } from "../src/editor/WritingShortcuts.ts";
import { WRITING_COMMANDS, writingCommandPlan } from "../src/editor/WritingCommandPlan.ts";
import { normalizeBareUrls } from "../src/document/normalizeBareUrls.ts";
import {
  armWritingEnableAttempt,
  createWritingEnableAttemptState,
  observeWritingCanonical,
  observeWritingCapability,
} from "../src/app/AppModeTransition.ts";

Deno.test("preserves empty, trailing-newline, blank-line, and CRLF source exactly", () => {
  assertEquals(splitMarkdownLines(""), []);
  assertEquals(analyzeMarkdown("").tasks, []);

  const sources = [
    "- [ ] item",
    "- [ ] item\n",
    "- [ ] item\n\n",
    "- [ ] item\r\n\r\n",
  ];
  for (const source of sources) {
    const task = analyzeMarkdown(source).tasks[0];
    assert(task);
    const result = toggleTask(source, task);
    assertEquals(result.markdown, source.replace("[ ]", "[x]"));
    assertEquals(result.markdown.length, source.length);
  }

  assertEquals(uncheckAll(""), { markdown: "", changed: false });
  assertEquals(deleteCompleted(""), { markdown: "", changed: false });
});

Deno.test("recognizes normal, lowercase-X, and uppercase-X tasks", () => {
  const source = "- [ ] normal\n- [x] lowercase\n- [X] uppercase";
  const tasks = analyzeMarkdown(source).tasks;

  assertEquals(tasks.length, 3);
  assertEquals(tasks.map((task) => task.checked), [false, true, true]);
  assertEquals(tasks.map((task) => task.text), ["normal", "lowercase", "uppercase"]);
});

Deno.test("toggles only the checkbox character", () => {
  for (const source of ["- [ ] open", "- [x] checked", "- [X] checked"]) {
    const task = analyzeMarkdown(source).tasks[0];
    assert(task);
    const result = toggleTask(source, task);
    assertEquals(result.markdown.length, source.length);
    assertEquals(result.markdown.slice(0, task.checkboxOffset), source.slice(0, task.checkboxOffset));
    assertEquals(result.markdown.slice(task.checkboxOffset + 1), source.slice(task.checkboxOffset + 1));
  }
});

Deno.test("recognizes nested tasks and deletes a task subtree", () => {
  const source = "# Plan\n- [ ] parent\n  - [ ] child\n- [ ] sibling\n";
  const analysis = analyzeMarkdown(source);

  assertEquals(analysis.tasks.map((task) => task.depth), [0, 2, 0]);
  assertEquals(analysis.tasks[0].headingPath, ["Plan"]);

  const result = deleteTask(source, analysis.tasks[0]);
  assertEquals(result.markdown, "# Plan\n- [ ] sibling\n");
});

Deno.test("Writing hides completed tasks as a local projection without changing canonical projections", () => {
  const source = "# Work\n- [x] done\n- [ ] next\n";
  const before = analyzeMarkdown(source);
  assert(writingTaskIsHidden(before.tasks[0].checked), "completed task must be hidden in Writing projection");
  assert(!writingTaskIsHidden(before.tasks[1].checked), "open task must remain visible in Writing projection");
  assertEquals(source, "# Work\n- [x] done\n- [ ] next\n");
  assertEquals(analyzeMarkdown(source).tasks.map((task) => ({ text: task.text, checked: task.checked })), [
    { text: "done", checked: true },
    { text: "next", checked: false },
  ]);
  assertEquals(analyzeMarkdown(source).tasks.filter((task) => task.checked).map((task) => task.text), ["done"]);
  assert(writingControlIsDisabled(true, true), "read-only controls must be disabled");
  assert(writingControlIsDisabled(false, false), "non-editable controls must be disabled");
  assert(!writingControlIsDisabled(false, true), "editable controls must remain enabled");
});

Deno.test("Writing hides only a completed parent task row and keeps an open child actionable", () => {
  const tasks = analyzeMarkdown("- [x] parent\n  - [ ] child\n").tasks;
  assertEquals(tasks.map((task) => task.checked), [true, false]);
  assert(writingTaskIsHidden(tasks[0].checked), "completed parent row must be hidden");
  assert(!writingTaskIsHidden(tasks[1].checked), "open nested child row must remain visible");
});

Deno.test("Writing control registry refreshes transitions and safely unregisters node views", () => {
  const registry = new WritingControlRegistry();
  let readOnly = false;
  const editable = true;
  let checkboxDisabled = true;
  let deleteDisabled = true;
  const unregister = registry.add({
    get readOnly() { return writingControlIsDisabled(readOnly, editable); },
    refresh() {
      checkboxDisabled = writingControlIsDisabled(readOnly, editable);
      deleteDisabled = checkboxDisabled;
    },
  });

  assertEquals(registry.size, 1);
  registry.refresh();
  assertEquals([checkboxDisabled, deleteDisabled], [false, false]);
  readOnly = true;
  registry.refresh();
  assertEquals([checkboxDisabled, deleteDisabled], [true, true]);
  unregister();
  unregister();
  assertEquals(registry.size, 0);
  registry.refresh();
  assertEquals([checkboxDisabled, deleteDisabled], [true, true]);
});

Deno.test("deleteTask validates a fresh exact task reference and preserves CRLF subtree ranges", () => {
  const source = "- [ ] duplicate\r\n  - [ ] nested\r\n- [ ] duplicate\r\n- [ ] tail\r\n";
  const initial = analyzeMarkdown(source);
  const selected = initial.tasks[1];
  assert(selected);
  const result = deleteTask(source, selected);
  assertEquals(result.markdown, "- [ ] duplicate\r\n- [ ] duplicate\r\n- [ ] tail\r\n");
  assertEquals(result.changeSet?.changes, [{ from: selected.itemStart, to: selected.itemEnd, insertedLength: 0 }]);

  const duplicate = initial.tasks[2];
  assert(duplicate);
  assertEquals(deleteTask(source, selected, 2), { markdown: source, changed: false });
  const duplicateResult = deleteTask(source, duplicate, 2);
  assertEquals(duplicateResult.markdown, "- [ ] duplicate\r\n  - [ ] nested\r\n- [ ] tail\r\n");

  const stale = { ...selected, text: "stale" };
  assertEquals(deleteTask(source, stale), { markdown: source, changed: false });
  const shifted = `prefix\r\n${source}`;
  assertEquals(deleteTask(shifted, selected), { markdown: shifted, changed: false });
});

Deno.test("Writing task deletion is one canonical mutation with one undo and redo", () => {
  const source = "# Work\n- [ ] parent\n  - [ ] child\n- [ ] sibling\n";
  const document = new CanonicalDocument(source);
  let applyTransitions = 0;
  document.subscribe((_state, transition) => { if (transition?.kind === "apply") applyTransitions += 1; });
  const task = analyzeMarkdown(document.text).tasks[0];
  assert(task);
  const result = deleteTask(document.text, task, 0);
  assert(result.changeSet);
  assert(document.applyLocal(result.markdown, result.changeSet));
  assertEquals(applyTransitions, 1);
  assertEquals(document.text, "# Work\n- [ ] sibling\n");
  assert(document.undo(), "delete must occupy one undo step");
  assertEquals(document.text, source);
  assert(document.redo(), "delete must occupy one redo step");
  assertEquals(document.text, "# Work\n- [ ] sibling\n");
});

Deno.test("recognizes quoted and tab-indented GFM tasks", () => {
  const source = [
    "> - [ ] quoted parent",
    ">   - [x] quoted child",
    "- [ ] normal parent",
    "\t- [ ] tab-indented child",
  ].join("\n");
  const tasks = analyzeMarkdown(source).tasks;

  assertEquals(tasks.map((task) => task.text), ["quoted parent", "quoted child", "normal parent", "tab-indented child"]);
  assertEquals(tasks.map((task) => task.checked), [false, true, false, false]);
  assertEquals(tasks.map((task) => task.depth), [0, 2, 0, 4]);
});

Deno.test("does not carry a list task container across a blockquote boundary", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = [`> - parent`, `      - [x] top-level tab-indented code`, `- [x] real`].join(newline);
    const tasks = analyzeMarkdown(source).tasks;
    assertEquals(tasks.map((task) => task.text), ["real"]);
    assertEquals(uncheckAll(source).markdown, source.replace("- [x] real", "- [ ] real"));
  }
});

Deno.test("CanonicalDocument keeps exact source and makes remote conflicts explicit", () => {
  const source = "  note\r\n\r\n";
  const document = new CanonicalDocument(source);
  assertEquals(document.text, source);
  assert(document.applyLocal("  local note\r\n\r\n- [ ] local"));
  assertEquals(document.receiveRemote("  remote note\r\n\r\n"), "conflicted");
  assertEquals(document.text, "  local note\r\n\r\n- [ ] local");
  assertEquals(document.pendingRemote, "  remote note\r\n\r\n");
  assert(document.resolveRemote("accept-remote"));
  assertEquals(document.text, "  remote note\r\n\r\n");
  assertEquals(document.dirty, false);
});

Deno.test("recognizes Setext headings without changing task projections", () => {
  const source = ["Title", "=====", "Subtitle", "-----", "- [ ] task"].join("\n");
  const analysis = analyzeMarkdown(source);

  assertEquals(analysis.headings.map((heading) => ({ level: heading.level, text: heading.text, path: heading.path })), [
    { level: 1, text: "Title", path: ["Title"] },
    { level: 2, text: "Subtitle", path: ["Title", "Subtitle"] },
  ]);
  assertEquals(analysis.tasks.map((task) => task.text), ["task"]);
});

Deno.test("excludes fenced code, inline code, tables, and HTML blocks", () => {
  const source = [
    "```markdown",
    "- [ ] fenced",
    "```",
    "`- [ ] inline`",
    "| - [ ] table |",
    "<!--",
    "- [ ] comment",
    "-->",
    "<div>",
    "- [ ] html",
    "</div>",
    "- [ ] real",
  ].join("\n");

  const tasks = analyzeMarkdown(source).tasks;
  assertEquals(tasks.length, 1);
  assertEquals(tasks[0].text, "real");
});

Deno.test("keeps nested-list fenced code opaque for LF and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = [
      "- parent",
      "    ```markdown",
      "    - [x] must stay code",
      "    ```",
    ].join(newline);
    const analysis = analyzeMarkdown(source);
    assertEquals(analysis.tasks, []);
    assertEquals(mindmapText(source, "all"), "");
    assertEquals(uncheckAll(source), { markdown: source, changed: false });
    assertEquals(deleteCompleted(source), { markdown: source, changed: false });
  }
});

Deno.test("recognizes and operates on tasks after a nested-list fence closes", () => {
  const source = [
    "- parent",
    "    ```markdown",
    "    - [x] must stay code",
    "    ```",
    "- [x] real completed task",
  ].join("\n");
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.tasks.map((task) => task.text), ["real completed task"]);
  assertEquals(uncheckAll(source).markdown, source.replace("[x] real", "[ ] real"));
  assertEquals(deleteCompleted(source).markdown, ["- parent", "    ```markdown", "    - [x] must stay code", "    ```", ""].join("\n"));
});

Deno.test("keeps list-relative indented code opaque across line endings and containers", () => {
  for (const newline of ["\n", "\r\n"]) {
    const fixtures = [
      { parent: "- parent", codeIndent: "      ", real: "- [x] real" },
      { parent: "1. parent", codeIndent: "       ", real: "1. [x] real" },
      { parent: "> - parent", codeIndent: ">       ", real: "> - [x] real" },
      { parent: "- \tparent", codeIndent: "        ", real: "- [x] real" },
    ];
    for (const fixture of fixtures) {
      const lines = [
        fixture.parent,
        `${fixture.codeIndent}\`\`\`markdown`,
        `${fixture.codeIndent}- [x] must-stay-code`,
        `${fixture.codeIndent}\`\`\``,
        fixture.real,
      ];
      const source = lines.join(newline);
      const codeStart = source.indexOf(lines[1]);
      const realStart = source.indexOf(fixture.real);
      const analysis = analyzeMarkdown(source);

      assertEquals(analysis.opaqueFencedRanges, [{ from: codeStart, to: realStart }]);
      assertEquals(analysis.tasks.map((task) => ({ text: task.text, from: task.from, checked: task.checked })), [{ text: "real", from: realStart, checked: true }]);
      assertEquals(uncheckAll(source).markdown, source.slice(0, realStart) + source.slice(realStart).replace("[x]", "[ ]"));
      const deleted = deleteCompleted(source);
      assertEquals({ markdown: deleted.markdown, changed: deleted.changed }, { markdown: source.slice(0, realStart), changed: true });
      assertEquals(deleted.changeSet?.changes, [{ from: realStart, to: source.length, insertedLength: 0 }]);
      assertEquals(mindmapText(source, "all"), "  • ☑ real");
    }
  }
});

Deno.test("does not reject a nested list task before the indented-code threshold", () => {
  const source = "- parent\n    - [ ] nested task";
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.opaqueFencedRanges, []);
  assertEquals(analysis.tasks.map((task) => task.text), ["nested task"]);
});

Deno.test("keeps tab-indented list fences opaque for LF and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const fixtures = [
      [
        "- unordered parent",
        "\t```markdown",
        "\t- [x] must stay code",
        "\t```",
        "- [x] real",
      ],
      [
        "1. ordered parent",
        "\t ~~~markdown",
        "\t - [x] must stay code",
        "\t ~~~\t",
        "1. [x] real",
      ],
    ];
    for (const lines of fixtures) {
      const codeOnly = lines.slice(0, 4).join(newline);
      assertEquals(analyzeMarkdown(codeOnly).tasks, []);
      assertEquals(uncheckAll(codeOnly), { markdown: codeOnly, changed: false });
      assertEquals(deleteCompleted(codeOnly), { markdown: codeOnly, changed: false });

      const source = lines.join(newline);
      const analysis = analyzeMarkdown(source);
      assertEquals(analysis.opaqueFencedRanges.length, 1);
      assertEquals(analysis.tasks.map((task) => task.text), ["real"]);
      assertEquals(uncheckAll(source).markdown, source.replace("[x] real", "[ ] real"));
      const deleted = deleteCompleted(source);
      assertEquals({ markdown: deleted.markdown, changed: deleted.changed }, {
        markdown: source.slice(0, source.lastIndexOf(newline) + newline.length),
        changed: true,
      });
      assertEquals(deleted.changeSet?.changes, [{ from: source.lastIndexOf(newline) + newline.length, to: source.length, insertedLength: 0 }]);
    }
  }
});

Deno.test("keeps marker-padding-tab list fences opaque for LF and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const fixtures = [
      [
        "- \tparent",
        "    ```markdown",
        "    - [x] must stay code",
        "    ```",
        "- [x] real",
      ],
      [
        "1.\tparent",
        "    ```markdown",
        "    - [x] must stay code",
        "    ```",
        "1. [x] real",
      ],
      [
        "> - \tparent",
        ">     ```markdown",
        ">     - [x] must stay code",
        ">     ```",
        "> - [x] real",
      ],
    ];
    for (const lines of fixtures) {
      const source = lines.join(newline);
      const fenceStart = source.indexOf(lines[1]);
      const realStart = source.indexOf(lines[4]);
      const analysis = analyzeMarkdown(source);
      assertEquals(analysis.opaqueFencedRanges, [{ from: fenceStart, to: realStart }]);
      assertEquals(analysis.tasks.map((task) => task.text), ["real"]);
      assertEquals(uncheckAll(source).markdown, source.replace("[x] real", "[ ] real"));
      assertEquals(deleteCompleted(source).markdown, source.slice(0, realStart));
      assertEquals(mindmapText(source, "all"), "  • ☑ real");
    }
  }
});

Deno.test("tracks nested, ordered, blockquote-list, and tilde fence containers", () => {
  const source = [
    "- parent",
    "  - child",
    "      ~~~markdown",
    "      - [x] nested code",
    "      ~~~",
    "1. ordered parent",
    "      ~~~",
    "      - [x] ordered code",
    "      ~~~",
    "> - quoted parent",
    ">     ~~~markdown",
    ">     - [x] quoted code",
    ">     ~~~",
  ].join("\n");
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.tasks, []);
  assert(analysis.opaqueFencedRanges.length === 3);
});

Deno.test("ends a quoted fence at the quote-container boundary", () => {
  const source = [
    "> - parent",
    ">     ```markdown",
    ">     - [x] must stay code",
    "- [ ] real",
  ].join("\n");
  const fenceStart = source.indexOf(">     ```markdown");
  const realStart = source.indexOf("- [ ] real");
  const analysis = analyzeMarkdown(source);

  assertEquals(analysis.opaqueFencedRanges, [{ from: fenceStart, to: realStart }]);
  assertEquals(analysis.tasks.map((task) => task.text), ["real"]);
  assertEquals(uncheckAll(source).markdown, source);
});

Deno.test("accepts a dedented closing fence inside a quoted list container", () => {
  const source = [
    "> - parent",
    ">     ```markdown",
    ">     - [x] must stay code",
    ">   ```",
    "> - [ ] real",
  ].join("\n");
  const analysis = analyzeMarkdown(source);

  assertEquals(analysis.tasks.map((task) => task.text), ["real"]);
  assertEquals(uncheckAll(source).markdown, source);
});

Deno.test("requires matching fence character, length, and closing tail", () => {
  const source = [
    "- parent",
    "    ```javascript",
    "    - [x] code",
    "    ``",
    "    ~~~",
    "    - [x] still code",
    "    ``` trailing text",
    "    - [x] still code",
    "    ```",
    "- [ ] real",
  ].join("\n");
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.tasks.map((task) => task.text), ["real"]);
  assertEquals(analysis.opaqueFencedRanges.length, 1);
  assertEquals(uncheckAll(source), { markdown: source, changed: false });
});

Deno.test("does not turn top-level indented code into a list-contained fence", () => {
  const source = [
    "    ```markdown",
    "    - [x] indented code",
    "    ```",
    "- [x] real",
  ].join("\n");
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.opaqueFencedRanges, []);
  assertEquals(analysis.tasks.map((task) => task.text), ["real"]);
});

Deno.test("analysis exposes the same scanner result consumed by projections", () => {
  const source = "- parent\n    ```\n    - [x] opaque\n    ```\n- [ ] visible";
  const structure = scanMarkdownStructure(source);
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.opaqueFencedRanges, structure.opaqueFencedRanges);
  assertEquals(analysis.tasks.map((task) => task.text), ["visible"]);
});

Deno.test("does not reject a task whose text contains a pipe", () => {
  assertEquals(analyzeMarkdown("- [ ] keep | this text").tasks.length, 1);
});

Deno.test("does not parse tasks inside multiline HTML or a table body", () => {
  const source = [
    "<div>",
    "<p>text</p>",
    "- [x] html fake",
    "</div>",
    "| name | value |",
    "| --- | --- |",
    "- [x] table fake | value",
    "| end | row |",
    "- [x] real",
  ].join("\n");
  assertEquals(analyzeMarkdown(source).tasks.map((task) => task.text), ["real"]);
});

Deno.test("handles nested four-space tasks and resumes after HTML block forms", () => {
  const source = [
    "# Code",
    "    - [ ] indented code fake",
    "- [ ] parent",
    "    - [ ] nested",
    "    indented code - [ ] fake",
    "<br>",
    "<?xml",
    "- [ ] processing fake",
    "?>",
    "<![CDATA[",
    "- [ ] cdata fake",
    "]]>",
    "- [ ] real",
  ].join("\n");
  assertEquals(analyzeMarkdown(source).tasks.map((task) => task.text), ["parent", "nested", "real"]);
});

Deno.test("accepts four-space tasks only below a list parent", () => {
  const source = ["    - [ ] code", "- [ ] parent", "    - [ ] child", "    - [ ] sibling"].join("\n");
  assertEquals(analyzeMarkdown(source).tasks.map((task) => task.text), ["parent", "child", "sibling"]);
});

Deno.test("uncheckAll changes checked tasks and preserves source line endings", () => {
  const source = "- [X] first\r\n\r\n- [x] second\r\n- [ ] open\r\n";
  const result = uncheckAll(source);

  assertEquals(result.changed, true);
  assertEquals(result.markdown, "- [ ] first\r\n\r\n- [ ] second\r\n- [ ] open\r\n");
});

Deno.test("deleteCompleted removes checked task subtrees", () => {
  const source = "- [x] completed\n  - [x] child\n- [ ] open\n- [X] also completed\n";
  const result = deleteCompleted(source);

  assertEquals(result.changed, true);
  assertEquals(result.markdown, "- [ ] open\n");
});

Deno.test("Writing editor gate ignores initialization but emits the first real edit", () => {
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin("initial");
  assertEquals(gate.markdownUpdated(generation, "initial"), false);
  gate.finish(generation, "initial");
  assertEquals(gate.markdownUpdated(generation, "initial edit"), true);
  assertEquals(gate.renderedMarkdown, "initial edit");

  const external = gate.suppressExternalUpdate(generation, "from source");
  assert(external);
  assertEquals(gate.markdownUpdated(generation, "from source", external), false);
  assertEquals(gate.markdownUpdated(generation, "from source + edit"), true);
});

Deno.test("Writing gate never swallows a user transaction ordered after a source update", () => {
  const gate = new WritingEditorChangeGate();
  const generation = gate.begin("initial");
  gate.finish(generation, "initial");
  const external = gate.suppressExternalUpdate(generation, "from source");
  assert(external);
  assertEquals(gate.markdownUpdated(generation, "from source + user edit"), true);
  assertEquals(gate.hasPendingExternalUpdate, false);
});

Deno.test("EditorKit lifecycle treats same-text context as remote because hosts do not echo saves", () => {
  const lifecycle = new EditorKitLifecycle();
  const document = new CanonicalDocument();
  let classifiedKind: string | undefined;
  const hostSetEditorRawText = (text: string) => {
    const kind = lifecycle.classifyContext("note-same-text");
    classifiedKind = kind;
    if (kind === "initial-context") document.initialize(text);
    else if (kind === "remote-update") document.receiveRemote(text);
  };

  hostSetEditorRawText("initial");
  assertEquals(classifiedKind, "initial-context");
  document.applyLocal("local");
  hostSetEditorRawText("local");
  assertEquals(classifiedKind, "remote-update");
  assertEquals(document.dirty, true);
  assertEquals(document.pendingRemote, undefined);
});

Deno.test("EditorKit fake host does not echo the requested save", () => {
  const document = new CanonicalDocument();
  const lifecycle = new EditorKitLifecycle();
  const requested: string[] = [];
  const fakeHost = {
    onEditorValueChanged(text: string): void { requested.push(text); },
    setEditorRawText(text: string): void {
      const kind = lifecycle.classifyContext("note-no-echo");
      if (kind === "initial-context") document.initialize(text);
      else if (kind === "remote-update") document.receiveRemote(text);
    },
  };
  fakeHost.setEditorRawText("initial");
  assertEquals(document.text, "initial");

  assert(document.applyLocal("local"));
  fakeHost.onEditorValueChanged("local");
  assertEquals(requested, ["local"]);
  // The fake host intentionally sends no same-sourceKey context callback.
  assertEquals(document.dirty, true);
  assertEquals(document.pendingRemote, undefined);
});

Deno.test("EditorKit lifecycle initializes a different note and preserves unknown-uuid semantics", () => {
  const lifecycle = new EditorKitLifecycle();
  assertEquals(lifecycle.classifyContext(undefined), "initial-context");
  assertEquals(lifecycle.classifyContext(undefined), "remote-update");
  assertEquals(lifecycle.classifyContext("note-a"), "remote-update");
  assertEquals(lifecycle.classifyContext("note-a"), "remote-update");
  assertEquals(lifecycle.classifyContext("note-b"), "initial-context");
  assertEquals(lifecycle.classifyContext("note-b", true), "metadata");
});

Deno.test("Writing round-trip gate rejects lexical forms Milkdown cannot prove lossless", () => {
  assertEquals(assessWritingRoundTrip("- task", "- task").editable, true);
  assertEquals(assessWritingRoundTrip("# Title\n\nParagraph\n\n\n\n\n\n", "# Title\n\nParagraph\n").editable, false);
  for (const source of [
    "+ task",
    "- task\r\n",
    "text  \nnext",
    "| a | b |\n| --- | --- |",
    "<div>raw</div>",
    "```md\nraw\n```",
  ]) {
    assertEquals(assessWritingRoundTrip(source, source), { editable: false, reason: "Writing cannot preserve this Markdown exactly; use Source mode." });
  }
  assertEquals(assessWritingRoundTrip("plain\r\n", "plain\r\n").editable, false);
  assertEquals(assessWritingMutation("plain\r\n", "plain\r\n").editable, false);
  assertEquals(assessWritingMutation("plain", "plain\r\nedit").editable, false);
});

Deno.test("Writing lifecycle distinguishes initial and mutation losslessness reasons", () => {
  assertEquals(assessWritingRoundTrip("+ unsafe bullet", "+ unsafe bullet"), {
    editable: false,
    reason: "Writing cannot preserve this Markdown exactly; use Source mode.",
  });
  assertEquals(assessWritingMutation("plain", "plain\n+ unsafe bullet"), {
    editable: false,
    reason: "This edit cannot be preserved exactly in Writing; use Source mode.",
  });
});

Deno.test("normalizes only GFM-confirmed bare HTTP(S) URLs with exact UTF-16 changes", () => {
  const source = "😀 https://one.test/a, [two](https://two.test) <https://three.test> https://四.test/路.";
  const result = normalizeBareUrls(source);
  const first = source.indexOf("https://one.test/a");
  const second = source.indexOf("https://四.test/路");
  assertEquals(result.markdown, "😀 [https://one.test/a](https://one.test/a), [two](https://two.test) <https://three.test> [https://四.test/路](https://四.test/路).");
  assertEquals(result.changeSet?.changes, [
    { from: first, to: first + "https://one.test/a".length, insertedLength: "[https://one.test/a](https://one.test/a)".length },
    { from: second, to: second + "https://四.test/路".length, insertedLength: "[https://四.test/路](https://四.test/路)".length },
  ]);
  assertEquals(result.changeSet?.oldLength, source.length);
  assertEquals(result.changeSet?.newLength, result.markdown.length);
});

Deno.test("normalizer leaves code, HTML, existing links, and autolinks untouched", () => {
  const source = [
    "`https://inline.test`",
    "    https://indented.test",
    "```md",
    "https://fenced.test",
    "```",
    "<!-- https://comment.test -->",
    "<div>https://html.test</div>",
    "outside https://visible.test!",
  ].join("\n");
  const result = normalizeBareUrls(source);
  assertEquals(result.markdown, source.replace("https://visible.test", "[https://visible.test](https://visible.test)"));
  assertEquals(result.changeSet?.changes.length, 1);
});

Deno.test("normalizer escapes URL Markdown punctuation without changing the source URL", () => {
  const source = "https://x.test/a]b https://x.test/a(b)";
  const result = normalizeBareUrls(source);
  assertEquals(result.markdown, "[https://x.test/a\\]b](https://x.test/a]b) [https://x.test/a(b)](https://x.test/a\\(b\\))");
  assertEquals(result.changeSet?.changes, [
    { from: 0, to: "https://x.test/a]b".length, insertedLength: "[https://x.test/a\\]b](https://x.test/a]b)".length },
    { from: "https://x.test/a]b ".length, to: source.length, insertedLength: "[https://x.test/a(b)](https://x.test/a\\(b\\))".length },
  ]);
});

Deno.test("normalizer preserves every terminal line-ending suffix", () => {
  for (const suffix of ["", "\n", "\n\n", "\r\n", "\r\n\r\n"]) {
    const source = `https://suffix.test${suffix}`;
    const result = normalizeBareUrls(source);
    assertEquals(result.markdown, `[https://suffix.test](https://suffix.test)${suffix}`);
    if (suffix) assertEquals(result.markdown.slice(-suffix.length), suffix);
  }
});

Deno.test("Writing enable attempts require the exact proof target and one document generation", () => {
  let state = createWritingEnableAttemptState();
  state = armWritingEnableAttempt(state, "target", 4, true);
  assertEquals(state.pending, { id: 1, expectedCanonicalText: "target", documentGeneration: 4 });

  state = observeWritingCanonical(state, {
    previousCanonicalText: "previous",
    currentCanonicalText: "target",
    documentGeneration: 5,
    initialized: false,
  });
  assertEquals(state.pending, {
    id: 1,
    expectedCanonicalText: "target",
    documentGeneration: 4,
    committedGeneration: 5,
  });

  let outcome = observeWritingCapability(state, {
    editable: true,
    proofSource: "target",
    currentCanonicalText: "target",
    documentGeneration: 5,
  });
  assertEquals(outcome.enableWriting, true);
  assertEquals(outcome.state.pending, undefined);
  outcome = observeWritingCapability(outcome.state, {
    editable: true,
    proofSource: "target",
    currentCanonicalText: "target",
    documentGeneration: 5,
  });
  assertEquals(outcome.enableWriting, false);

  state = armWritingEnableAttempt(outcome.state, "target", 5, true);
  outcome = observeWritingCapability(state, {
    editable: false,
    proofSource: "target",
    currentCanonicalText: "target",
    documentGeneration: 5,
  });
  assertEquals(outcome.enableWriting, false);
  outcome = observeWritingCapability(outcome.state, {
    editable: true,
    proofSource: "target",
    currentCanonicalText: "target",
    documentGeneration: 5,
  });
  assertEquals(outcome.enableWriting, false);

  state = armWritingEnableAttempt(outcome.state, "target", 5, true);
  state = observeWritingCanonical(state, {
    previousCanonicalText: "target",
    currentCanonicalText: "changed",
    documentGeneration: 5,
    initialized: false,
  });
  assertEquals(state.pending, undefined);

  state = armWritingEnableAttempt(state, "target", 5, true);
  state = observeWritingCanonical(state, {
    previousCanonicalText: "previous",
    currentCanonicalText: "target",
    documentGeneration: 6,
    initialized: true,
  });
  assertEquals(state.pending, undefined);

  state = armWritingEnableAttempt(state, "target", 5, false);
  assertEquals(state.pending, undefined);
});

Deno.test("empty Writing notes allow only LF-safe initial materialization", () => {
  assertEquals(assessWritingMutation("", "x\n", "user").editable, true);
  assertEquals(assessWritingMutation("", "a\nb\n", "user").editable, true);
  assertEquals(assessWritingMutation("", "+ item\n", "user").editable, false);
  assertEquals(assessWritingMutation("", "x\r\n", "user").editable, false);
  assertEquals(assessWritingMutation("x", "xy\n", "user").editable, false);
});

Deno.test("Writing exposes link command membership and local Mod-k recognition", () => {
  assert(WRITING_COMMANDS.includes("link"), "link must be available to Writing command consumers");
  assertEquals(writingCommandPlan("link"), { kind: "link", target: "selection-or-stored-mark" });
  assert(isWritingLinkShortcut({ key: "k", ctrlKey: true, metaKey: false }));
  assert(isWritingLinkShortcut({ key: "K", ctrlKey: false, metaKey: true }));
  assert(!isWritingLinkShortcut({ key: "k", ctrlKey: false, metaKey: false }));
});

Deno.test("toolbar/history mutations use the same canonical save notification path", () => {
  const document = new CanonicalDocument("one");
  const saved: string[] = [];
  const apply = (mutation: () => boolean) => { if (mutation()) saved.push(document.text); };
  apply(() => document.applyLocal("two"));
  apply(() => document.undo());
  apply(() => document.redo());
  assertEquals(saved, ["two", "one", "two"]);
});

Deno.test("mindmap projection preserves ordinary Markdown and heading-local task placement", () => {
  const source = [
    "# First",
    "ordinary paragraph",
    "- [ ] first task",
    "## Second",
    "ordinary **Markdown**",
    "- [x] completed",
    "- [ ] second task",
  ].join("\n");
  assertEquals(projectMindmapMarkdown(source, "all"), source);
  assertEquals(projectMindmapMarkdown(source, "open"), source.replace("- [x] completed\n", ""));
  assertEquals(projectMindmapMarkdown(source, "hide"), source.replace("- [ ] first task\n", "").replace("- [x] completed\n", "").replace("- [ ] second task", ""));
});

Deno.test("open mindmap filtering retains an open child of a completed parent", () => {
  const source = "- [x] completed parent\n  - [ ] open child\n- [ ] sibling\n";
  assertEquals(projectMindmapMarkdown(source, "open"), "  - [ ] open child\n- [ ] sibling\n");
  assertEquals(projectMindmapMarkdown(source, "hide"), "");
});

Deno.test("analysis defines heading subtree boundaries and source-anchor lookup", () => {
  const source = [
    "# A",
    "intro",
    "## B",
    "- [ ] open in B",
    "### C",
    "- [x] completed in C",
    "## D",
    "- [ ] open in D",
  ].join("\n");
  const analysis = analyzeMarkdown(source);
  const b = analysis.sections.find((section) => section.text === "B");
  const d = analysis.sections.find((section) => section.text === "D");
  assert(b && d);
  assertEquals(source.slice(b.from, b.to), [
    "## B",
    "- [ ] open in B",
    "### C",
    "- [x] completed in C",
    "",
  ].join("\n"));
  assertEquals(b.to, d.from);
  assertEquals(sectionAt(analysis, source.indexOf("- [ ] open in B"))?.anchor, b.anchor);
  assertEquals(sectionAt(analysis, source.indexOf("### C"))?.text, "C");
  assertEquals(sectionByAnchor(analysis, b.anchor)?.text, "B");
});

Deno.test("mindmap scope slices before applying task filters and keeps canonical unchanged", () => {
  const source = [
    "## Duplicate",
    "- [x] first completed",
    "## Duplicate",
    "- [ ] second open",
  ].join("\n");
  const document = new CanonicalDocument(source);
  const sections = analyzeMarkdown(source).sections;
  const second = sections[1];
  assert(second);
  const projected = projectMindmapMarkdown(source, "open", second);
  assertEquals(projected, "## Duplicate\n- [ ] second open");
  assertEquals(projectMindmapMarkdown(source, "all", sections[0]), "## Duplicate\n- [x] first completed\n");
  assertEquals(document.text, source);
  assertEquals(sectionByAnchor(source, second.anchor)?.from, second.from);
});

Deno.test("source cursor selects the analysis subtree and its anchor remaps after edits above it", () => {
  const source = "# A\nintro\n## B\nbody\n";
  const anchor = sectionAnchorAt(source, source.indexOf("body"));
  assertEquals(anchor, source.indexOf("## B"));

  const edited = "new intro\n" + source;
  const remapped = remapSourceOffset(source, edited, anchor!);
  assertEquals(remapped, edited.indexOf("## B"));
  assertEquals(sectionAt(edited, remapped)?.text, "B");
  const atAnchor = "## " + source;
  const shiftedAnchor = remapSourceOffset(source, atAnchor, anchor!);
  assertEquals(shiftedAnchor, atAnchor.indexOf("## B"));
  const insertedAtAnchor = source.slice(0, anchor!) + "intro\n" + source.slice(anchor!);
  assertEquals(remapSourceOffset(source, insertedAtAnchor, anchor!), anchor! + "intro\n".length);
  assertEquals(sectionAnchorAt(edited, 0), undefined);
});

Deno.test("multi-range task edits preserve the selected B section and current-section projection", () => {
  const source = "# A\n- [x] A task\n## B\n- [ ] B task\n# C\n- [x] C task\n";
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "B");
  assert(selected);
  const result = uncheckAll(source);
  assert(result.changeSet && result.changeSet.changes.length === 2, "task batch must publish two exact ranges");
  const document = new CanonicalDocument(source);
  let transition: Parameters<NonNullable<Parameters<typeof document.subscribe>[0]>>[1];
  document.subscribe((_state, next) => { transition = next; });
  assert(document.applyLocal(result.markdown, result.changeSet));
  const anchor = reconcileSectionAnchor(document.text, transition?.changeSet, selected.anchor);
  assert(anchor !== undefined, "B anchor must remain mappable");
  const next = analyzeMarkdown(document.text).sectionByAnchor(anchor);
  assert(next);
  assertEquals(projectMindmapMarkdown(document.text, "all", next), document.text.slice(next.from, next.to));
  assertEquals(next.text, "B");
});

Deno.test("duplicate headings preserve the selected exact heading through multi-range edits", () => {
  const source = "# Root\n- [x] before\n## Dup\n- [ ] first\n## Dup\n- [ ] second\n# Tail\n- [x] after\n";
  const sections = analyzeMarkdown(source).sections.filter((section) => section.text === "Dup");
  assertEquals(sections.length, 2);
  const result = uncheckAll(source);
  const document = new CanonicalDocument(source);
  let transition: Parameters<NonNullable<Parameters<typeof document.subscribe>[0]>>[1];
  document.subscribe((_state, next) => { transition = next; });
  assert(document.applyLocal(result.markdown, result.changeSet));
  const anchor = reconcileSectionAnchor(document.text, transition?.changeSet, sections[1].anchor);
  assert(anchor !== undefined);
  assertEquals(analyzeMarkdown(document.text).sectionByAnchor(anchor)?.text, "Dup");
  assertEquals(analyzeMarkdown(document.text).sections.filter((section) => section.text === "Dup")[1].anchor, anchor);
});

Deno.test("Source Replace All exact multiple matches around B preserves its source anchor", () => {
  const source = "# A\nneedle\n## B\nneedle\n# C\nneedle\n";
  const matches: number[] = [];
  for (let from = source.indexOf("needle"); from >= 0; from = source.indexOf("needle", from + 1)) matches.push(from);
  const next = source.replaceAll("needle", "replaced");
  const changeSet = createTextChangeSet(source.length, next.length, matches.map((from) => ({ from, to: from + 6, insertedLength: 8 })));
  assert(changeSet);
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "B");
  assert(selected);
  const document = new CanonicalDocument(source);
  assert(document.applyLocal(next, changeSet));
  assertEquals(reconcileSectionAnchor(next, changeSet, selected.anchor), next.indexOf("## B"));
});

Deno.test("deleting the selected heading clears the section instead of selecting its successor", () => {
  const source = "# A\n## B\nB body\n## C\nC body\n";
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "B");
  assert(selected);
  const headingEnd = source.indexOf("\n", selected.from) + 1;
  const next = source.slice(0, selected.from) + source.slice(headingEnd);
  const changeSet = createTextChangeSet(source.length, next.length, [{ from: selected.from, to: headingEnd, insertedLength: 0 }]);
  assert(changeSet);
  const document = new CanonicalDocument(source);
  assert(document.applyLocal(next, changeSet));
  assertEquals(mapTextPosition(changeSet, selected.anchor), undefined);
  assertEquals(reconcileSectionAnchor(next, changeSet, selected.anchor), undefined);
  assert(analyzeMarkdown(next).sections.some((section) => section.text === "C"), "successor remains in the document");
});

Deno.test("insertion at a selected heading anchor follows the original heading", () => {
  const source = "# A\n## B\nB body\n";
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "B");
  assert(selected);
  const inserted = "intro\n";
  const next = source.slice(0, selected.anchor) + inserted + source.slice(selected.anchor);
  const changeSet = createTextChangeSet(source.length, next.length, [{ from: selected.anchor, to: selected.anchor, insertedLength: inserted.length }]);
  assert(changeSet);
  const mapped = reconcileSectionAnchor(next, changeSet, selected.anchor);
  assertEquals(mapped, selected.anchor + inserted.length);
  assertEquals(analyzeMarkdown(next).sectionByAnchor(mapped!)?.text, "B");
});

Deno.test("undo and redo of a multi-range mutation preserve B selection", () => {
  const source = "# A\n- [x] A task\n## B\nB body\n# C\n- [x] C task\n";
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "B");
  assert(selected);
  const result = uncheckAll(source);
  const document = new CanonicalDocument(source);
  const transitions: Array<{ text: string; changeSet?: typeof result.changeSet }> = [];
  document.subscribe((state, transition) => { if (transition?.kind !== undefined) transitions.push({ text: state.text, changeSet: transition.changeSet }); });
  assert(document.applyLocal(result.markdown, result.changeSet));
  const applied = transitions.at(-1)!;
  assertEquals(reconcileSectionAnchor(applied.text, applied.changeSet, selected.anchor), analyzeMarkdown(applied.text).sections.find((section) => section.text === "B")?.anchor);
  assert(document.undo());
  const undone = transitions.at(-1)!;
  assertEquals(reconcileSectionAnchor(undone.text, undone.changeSet, selected.anchor), selected.anchor);
  assert(document.redo());
  const redone = transitions.at(-1)!;
  assertEquals(reconcileSectionAnchor(redone.text, redone.changeSet, selected.anchor), analyzeMarkdown(redone.text).sections.find((section) => section.text === "B")?.anchor);
});

Deno.test("opaque canonical updates clear the selected section", () => {
  const source = "# A\n## B\nB body\n";
  const selected = analyzeMarkdown(source).sections.find((section) => section.text === "B");
  assert(selected);
  const document = new CanonicalDocument(source);
  assert(document.applyLocal("# A\n## B\nchanged\n"));
  assertEquals(reconcileSectionAnchor(document.text, undefined, selected.anchor), undefined);
});

Deno.test("isMindmapSuitable correctly detects structured vs unstructured markdown", () => {
  assert(!isMindmapSuitable(""));
  assert(!isMindmapSuitable("   \n\n  "));
  assert(!isMindmapSuitable("This is a simple paragraph with no headings or lists."));
  assert(!isMindmapSuitable("Line one of thought.\nLine two of thought without bullet points."));

  assert(isMindmapSuitable("# Title\nSome content"));
  assert(isMindmapSuitable("## Subheading\nParagraph"));
  assert(isMindmapSuitable("- [ ] Buy groceries"));
  assert(isMindmapSuitable("- [x] Done task"));
  assert(isMindmapSuitable("- Bullet item 1\n- Bullet item 2"));
  assert(isMindmapSuitable("* Star item"));
  assert(isMindmapSuitable("1. First numbered item\n2. Second numbered item"));
});

Deno.test("section and headingPath batch task operations correctly mutate target groups", () => {
  const source = `# Section 1
- [ ] Task 1.1
- [x] Task 1.2
- [ ] Task 1.3

# Section 2
- [ ] Task 2.1
- [x] Task 2.2
`;

  const analysis = analyzeMarkdown(source);
  const sec1 = analysis.sections[0];
  const sec2 = analysis.sections[1];
  assert(sec1 && sec2);

  // 1. checkAllInSection on Section 1
  const checkSec1 = checkAllInSection(source, sec1.anchor);
  assert(checkSec1.changed);
  assertEquals(checkSec1.markdown, `# Section 1
- [x] Task 1.1
- [x] Task 1.2
- [x] Task 1.3

# Section 2
- [ ] Task 2.1
- [x] Task 2.2
`);

  // 2. uncheckAllInSection on Section 1
  const uncheckSec1 = uncheckAllInSection(checkSec1.markdown, sec1.anchor);
  assert(uncheckSec1.changed);
  assertEquals(uncheckSec1.markdown, `# Section 1
- [ ] Task 1.1
- [ ] Task 1.2
- [ ] Task 1.3

# Section 2
- [ ] Task 2.1
- [x] Task 2.2
`);

  // 3. deleteCompletedInSection on Section 2
  const deleteSec2 = deleteCompletedInSection(source, sec2.anchor);
  assert(deleteSec2.changed);
  assertEquals(deleteSec2.markdown, `# Section 1
- [ ] Task 1.1
- [x] Task 1.2
- [ ] Task 1.3

# Section 2
- [ ] Task 2.1
`);

  // 4. uncheckAllInHeadingPath
  const uncheckPath = uncheckAllInHeadingPath(source, ["Section 2"]);
  assert(uncheckPath.changed);
  assertEquals(uncheckPath.markdown, `# Section 1
- [ ] Task 1.1
- [x] Task 1.2
- [ ] Task 1.3

# Section 2
- [ ] Task 2.1
- [ ] Task 2.2
`);

  // 5. deleteCompletedInHeadingPath
  const deletePath = deleteCompletedInHeadingPath(source, ["Section 1"]);
  assert(deletePath.changed);
  assertEquals(deletePath.markdown, `# Section 1
- [ ] Task 1.1
- [ ] Task 1.3

# Section 2
- [ ] Task 2.1
- [x] Task 2.2
`);

  // 6. groupTasksByHeading
  const groups = groupTasksByHeading(analysis.tasks.filter((t) => t.checked));
  assertEquals(groups.length, 2);
  assertEquals(groups[0].title, "Section 1");
  assertEquals(groups[0].tasks.length, 1);
  assertEquals(groups[1].title, "Section 2");
  assertEquals(groups[1].tasks.length, 1);
});

Deno.test("CanonicalDocument - auto-merges non-overlapping remote update when dirty", () => {
  const doc = new CanonicalDocument("# Header\n\nSection A\n\nSection B\n");
  doc.applyLocal("# Header\n\nSection A (local edit)\n\nSection B\n");
  assertEquals(doc.dirty, true);

  const status = doc.receiveRemote("# Header\n\nSection A\n\nSection B (remote edit)\n");
  assertEquals(status, "merged");
  assertEquals(doc.dirty, true);
  assertEquals(doc.pendingRemote, undefined);
  assertEquals(doc.text, "# Header\n\nSection A (local edit)\n\nSection B (remote edit)\n");
});

Deno.test("CanonicalDocument - flags conflict on overlapping remote update when dirty", () => {
  const doc = new CanonicalDocument("# Header\n\nSection A\n");
  doc.applyLocal("# Header\n\nSection A (local)\n");
  assertEquals(doc.dirty, true);

  const status = doc.receiveRemote("# Header\n\nSection A (remote)\n");
  assertEquals(status, "conflicted");
  assertEquals(doc.pendingRemote, "# Header\n\nSection A (remote)\n");
  assertEquals(doc.text, "# Header\n\nSection A (local)\n");
});
