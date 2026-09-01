function assert(condition: unknown, message = "assertion failed"): asserts condition { if (!condition) throw new Error(message); }
function assertEquals<T>(actual: T, expected: T): void { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };
import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import { analyzeKanban } from "../src/kanban/KanbanModel.ts";
import { scanMarkdownStructure, splitMarkdownLines, splitPhysicalLines } from "../src/markdown/structureScanner.ts";

const boardMarkdown = `# Board
## Backlog
- [ ] Parent
  - [x] Child

## Doing
- [ ] Doing task
## Review
## Done
`;

Deno.test("Kanban model uses direct named headings and keeps nested tasks with their root card", () => {
  const analysis = analyzeMarkdown(boardMarkdown);
  const model = analyzeKanban(boardMarkdown, analysis);
  assertEquals(model.candidates.length, 1);
  assertEquals(model.candidates[0].columns.map((column) => column.name), ["Backlog", "Doing", "Review", "Done"]);
  assertEquals(model.candidates[0].columns[0].cards.map((card) => card.text), ["Parent"]);
  assertEquals(analysis.movableTaskSubtrees.find((fact) => fact.rootTaskFrom === boardMarkdown.indexOf("  - [x] Child"))?.movable, false);
});

Deno.test("Kanban rejects non-portable task candidates and stops legacy itemEnd at headings", () => {
  const source = "- [ ] LF task\n## Heading\n- [ ] next\r- [ ] bare CR\n- [ ] unterminated";
  const analysis = analyzeMarkdown(source);
  assertEquals(analysis.tasks[0].itemEnd, source.indexOf("## Heading"));
  assertEquals(analysis.movableTaskSubtrees[0].movable, true);
  assertEquals(analysis.physicalLines.find((line) => line.text === "- [ ] next")?.eolKind, "CR");
  assertEquals(analysis.movableTaskSubtrees.at(-1)?.movable, false);
  assert(!analysis.movableTaskSubtrees.some((fact) => fact.movable && fact.payload?.eolKind === "CR"));
});

Deno.test("Kanban requires exactly one direct heading for each destination", () => {
  const source = `# Board
## Backlog
### Doing
## Review
## Done
`;
  const model = analyzeKanban(source);
  assertEquals(model.candidates.length, 0);
  assertEquals(model.boards.length, 1);
  assertEquals(model.boards[0].sourceOnly, true);
});

Deno.test("Any heading below a direct column makes the parent source-only, while a nested board remains independent", () => {
  const source = `# Parent
## Backlog
### Detail
- [ ] leaked parent task
### Child board
#### Backlog
- [ ] nested card
#### Doing
#### Review
#### Done
## Doing
## Review
## Done
`;
  const model = analyzeKanban(source);
  assertEquals(model.boards.length, 2);
  assertEquals(model.boards[0].valid, false);
  assertEquals(model.boards[0].reason, "A Kanban column contains a descendant heading; this board is source-only.");
  assertEquals(model.boards[0].columns.every((column) => column.cards.length === 0 && !column.dropAllowed), true);
  assertEquals(model.candidates.map((board) => board.title), ["Child board"]);
  assertEquals(model.candidates[0].columns[0].cards.map((card) => card.text), ["nested card"]);
});

Deno.test("Physical lines recognize bare CR without changing the legacy Markdown line contract", () => {
  const source = "alpha\rbeta\n";
  assertEquals(splitPhysicalLines(source).map((line) => ({ start: line.start, contentTo: line.contentTo, eolTo: line.eolTo, eolKind: line.eolKind, text: line.text })), [
    { start: 0, contentTo: 5, eolTo: 6, eolKind: "CR", text: "alpha" },
    { start: 6, contentTo: 10, eolTo: 11, eolKind: "LF", text: "beta" },
  ]);
  assertEquals(splitMarkdownLines(source), [{ start: 0, contentEnd: 10, end: 11, text: source.slice(0, 10) }]);
  assertEquals(scanMarkdownStructure("- [ ] one\r- [ ] two\n").lines.length, 1);
  assertEquals(analyzeMarkdown("- [ ] one\r- [ ] two\n").tasks.length, 0);
});
