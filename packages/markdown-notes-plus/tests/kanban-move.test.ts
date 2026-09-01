import { CanonicalDocument } from "../src/document/CanonicalDocument.ts";
import { analyzeKanban } from "../src/kanban/KanbanModel.ts";
import { moveKanbanCard } from "../src/kanban/KanbanMove.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition { if (!condition) throw new Error(message); }
function assertEquals<T>(actual: T, expected: T): void { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

const source = `# Board
## Backlog\r
- [ ] A\r
  - [x] A child\r
## Doing\r
- [X] B\r
## Review\r
## Done\r
`;

Deno.test("Kanban move preserves CRLF payload bytes and checkbox state", () => {
  const model = analyzeKanban(source);
  const board = model.candidates[0];
  const backlog = board.columns[0];
  const doing = board.columns[1];
  const result = moveKanbanCard({ markdown: source }, backlog.cards[0], { boardAnchor: board.anchor, columnAnchor: doing.anchor });
  assertEquals(result.changed, true);
  assertEquals(result.markdown, `# Board
## Backlog\r
## Doing\r
- [X] B\r
- [ ] A\r
  - [x] A child\r
## Review\r
## Done\r
`);
  assertEquals(result.changeSet?.changes.length, 2);
});

Deno.test("Kanban move rejects cross-board and blocked destinations", () => {
  const first = "# A\n## Backlog\n- [ ] task\n## Doing\n## Review\n## Done\n";
  const second = "# B\n## Backlog\n## Doing\n## Review\n## Done\n";
  const combined = `${first}${second}`;
  const model = analyzeKanban(combined);
  const a = model.candidates[0];
  const b = model.candidates[1];
  const card = a.columns[0].cards[0];
  assertEquals(moveKanbanCard({ markdown: combined }, card, { boardAnchor: b.anchor, columnAnchor: b.columns[1].anchor }).changed, false);
  assertEquals(moveKanbanCard({ markdown: combined, locked: true }, card, { boardAnchor: a.anchor, columnAnchor: a.columns[1].anchor }).changed, false);
  assertEquals(moveKanbanCard({ markdown: combined, fallback: true }, card, { boardAnchor: a.anchor, columnAnchor: a.columns[1].anchor }).changed, false);
});

Deno.test("Kanban moves into an empty EOF destination without a final newline", () => {
  const source = "# Board\n## Backlog\n- [ ] A\n## Doing\n## Review\n## Done";
  const model = analyzeKanban(source);
  const board = model.candidates[0];
  const result = moveKanbanCard({ markdown: source }, board.columns[0].cards[0], { boardAnchor: board.anchor, columnAnchor: board.columns[3].anchor });
  assertEquals(result.changed, true);
  assertEquals(result.markdown, "# Board\n## Backlog\n## Doing\n## Review\n## Done\n- [ ] A\n");
  assertEquals(result.markdown.includes("## Done\n- [ ] A\n"), true);
  assertEquals(result.changeSet?.oldLength, source.length);
  assertEquals(result.changeSet?.newLength, result.markdown.length);
  assertEquals(result.changeSet?.changes[1].from, source.length);
  assertEquals(result.changeSet?.changes[1].insertedLength, board.columns[0].cards[0].payload!.to - board.columns[0].cards[0].payload!.from + 1);
});

Deno.test("Kanban moves into an empty CRLF EOF destination without a final newline", () => {
  const source = "# Board\r\n## Backlog\r\n- [ ] A\r\n## Doing\r\n## Review\r\n## Done";
  const model = analyzeKanban(source);
  const board = model.candidates[0];
  const result = moveKanbanCard({ markdown: source }, board.columns[0].cards[0], { boardAnchor: board.anchor, columnAnchor: board.columns[3].anchor });
  assertEquals(result.changed, true);
  assertEquals(result.markdown, "# Board\r\n## Backlog\r\n## Doing\r\n## Review\r\n## Done\r\n- [ ] A\r\n");
  assertEquals(result.changeSet?.oldLength, source.length);
  assertEquals(result.changeSet?.newLength, result.markdown.length);
  assertEquals(result.changeSet?.changes[1].from, source.length);
  assertEquals(result.changeSet?.changes[1].insertedLength, board.columns[0].cards[0].payload!.to - board.columns[0].cards[0].payload!.from + 2);
});

Deno.test("Kanban moves into a final empty Setext destination without a final LF newline", () => {
  const source = `# Board
## Backlog
- [ ] A
## Doing
## Review
Done
----`;
  const model = analyzeKanban(source);
  const board = model.candidates[0];
  const result = moveKanbanCard({ markdown: source }, board.columns[0].cards[0], { boardAnchor: board.anchor, columnAnchor: board.columns[3].anchor });
  assertEquals(result.changed, true);
  assertEquals(result.markdown, `# Board
## Backlog
## Doing
## Review
Done
----
- [ ] A
`);
  assertEquals(result.changeSet?.oldLength, source.length);
  assertEquals(result.changeSet?.newLength, result.markdown.length);
  assertEquals(result.changeSet?.changes[1].from, source.length);
  assertEquals(result.changeSet?.changes[1].insertedLength, board.columns[0].cards[0].payload!.to - board.columns[0].cards[0].payload!.from + 1);
});

Deno.test("Kanban moves into a final empty Setext destination without a final CRLF newline", () => {
  const source = "# Board\r\n## Backlog\r\n- [ ] A\r\n## Doing\r\n## Review\r\nDone\r\n----";
  const model = analyzeKanban(source);
  const board = model.candidates[0];
  const result = moveKanbanCard({ markdown: source }, board.columns[0].cards[0], { boardAnchor: board.anchor, columnAnchor: board.columns[3].anchor });
  assertEquals(result.changed, true);
  assertEquals(result.markdown, "# Board\r\n## Backlog\r\n## Doing\r\n## Review\r\nDone\r\n----\r\n- [ ] A\r\n");
  assertEquals(result.changeSet?.oldLength, source.length);
  assertEquals(result.changeSet?.newLength, result.markdown.length);
  assertEquals(result.changeSet?.changes[1].from, source.length);
  assertEquals(result.changeSet?.changes[1].insertedLength, board.columns[0].cards[0].payload!.to - board.columns[0].cards[0].payload!.from + 2);
});

Deno.test("Kanban move preserves a post-task blank separator and destination newline style", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = ["# Board", "## Backlog", "- [ ] A", "", "## Doing", "## Review", "## Done"].join(newline);
    const model = analyzeKanban(source);
    const board = model.candidates[0];
    const result = moveKanbanCard({ markdown: source }, board.columns[0].cards[0], {
      boardAnchor: board.anchor,
      columnAnchor: board.columns[3].anchor,
    });

    assertEquals(result.changed, true);
    assertEquals(result.markdown, ["# Board", "## Backlog", "", "## Doing", "## Review", "## Done", "- [ ] A", ""].join(newline));
  }
});

Deno.test("Kanban rejects a root task whose final continuation has no EOL", () => {
  const source = `# Board
## Backlog
## Doing
## Review
## Done
- [ ] Parent
  continuation`;
  const model = analyzeKanban(source);
  const board = model.candidates[0];
  const card = board.columns[3].cards[0];

  assertEquals(card.movable, false);
  assertEquals(card.reason, "A task subtree continuation must have a terminating EOL.");
  const result = moveKanbanCard({ markdown: source }, card, { boardAnchor: board.anchor, columnAnchor: board.columns[2].anchor });
  assertEquals(result.changed, false);
  assertEquals(result.markdown, source);
  assertEquals(result.markdown.includes("continuation## Review"), false);
});

Deno.test("Canonical admission rejects a fresh token while a remote conflict is pending", () => {
  const document = new CanonicalDocument("base");
  assert(document.applyLocal("local"));
  assertEquals(document.receiveRemote("remote"), "conflicted");

  const freshToken = document.token;
  assertEquals(document.applyLocalIfCurrent(freshToken, "must not apply"), false);
  assertEquals(document.text, "local");
  assertEquals(document.pendingRemote, "remote");
});

Deno.test("A stale Kanban move is unchanged after a remote merge", () => {
  const mergeSource = `# Board
## Backlog
- [ ] A
## Doing
## Review
## Done
- [ ] D
- [ ] E
`;
  const document = new CanonicalDocument(mergeSource);
  const renderToken = document.token;
  const renderedModel = analyzeKanban(document.text);
  const board = renderedModel.candidates[0];
  const card = board.columns[0].cards[0];
  const target = { boardAnchor: board.anchor, columnAnchor: board.columns[2].anchor };

  assert(document.applyLocal(mergeSource.replace("- [ ] D", "- [ ] D local")));
  assertEquals(document.receiveRemote(mergeSource.replace("- [ ] E", "- [ ] E remote")), "merged");
  const mergedText = document.text;
  const result = moveKanbanCard({ markdown: mergedText }, card, target);

  assert(result.changed, "the stale command should still produce a candidate result");
  assertEquals(document.applyLocalIfCurrent(renderToken, result.markdown, result.changeSet), false);
  assertEquals(document.text, mergedText);
  assertEquals(document.pendingRemote, undefined);
});

Deno.test("A stale Kanban move is unchanged after a remote conflict", () => {
  const document = new CanonicalDocument(source);
  const renderToken = document.token;
  const renderedModel = analyzeKanban(document.text);
  const board = renderedModel.candidates[0];
  const card = board.columns[0].cards[0];
  const target = { boardAnchor: board.anchor, columnAnchor: board.columns[2].anchor };

  assert(document.applyLocal(source.replace("- [ ] A", "- [ ] L")));
  const remote = source.replace("- [ ] A", "- [ ] R");
  assertEquals(document.receiveRemote(remote), "conflicted");
  const localText = document.text;
  const result = moveKanbanCard({ markdown: localText }, card, target);

  assert(result.changed, "the stale command should still produce a candidate result");
  assertEquals(document.applyLocalIfCurrent(renderToken, result.markdown, result.changeSet), false);
  assertEquals(document.text, localText);
  assertEquals(document.pendingRemote, remote);
});

Deno.test("A same-revision Kanban move still applies through canonical admission", () => {
  const document = new CanonicalDocument(source);
  const model = analyzeKanban(document.text);
  const board = model.candidates[0];
  const result = moveKanbanCard(
    { markdown: document.text },
    board.columns[0].cards[0],
    { boardAnchor: board.anchor, columnAnchor: board.columns[1].anchor },
  );

  assert(result.changed);
  assert(document.applyLocalIfCurrent(document.token, result.markdown, result.changeSet));
  assertEquals(document.text, result.markdown);
});
