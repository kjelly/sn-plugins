function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { analyzeMarkdown, headingsInSection, nextSiblingSection, previousSiblingSection } from "../src/markdown/analysis.ts";
import { createTextChangeSet } from "../src/document/PositionMap.ts";
import {
  getVisibleOutlineHeadings,
  hasDescendantHeadings,
  getAllCollapsibleAnchors,
  buildOutlineSectionFacts,
  reconcileOutlineAnchors,
} from "../src/outline/OutlineProjection.ts";

Deno.test("OutlineProjection - precomputed row facts match section scans", () => {
  const documents = [
    "# Root\n\n- [ ] root task\n\n## Child\n\n- [x] completed\n\n### Grandchild\n\n- [ ] nested\n\n## Sibling\n\n- [ ] sibling\n\n# Other\n",
    "Setext root\n===========\n\n## ATX child\n\n- [x] task\n\n###### Deep\n\n- [ ] deeper\n\nSetext sibling\n--------------\n",
    "- [ ] before headings\n\n# First\n\n- [ ] first\n\n# Second\n\n- [x] second\n",
  ];
  for (const document of documents) {
    const analysis = analyzeMarkdown(document);
    const facts = buildOutlineSectionFacts(analysis);
    for (const heading of analysis.headings) {
      const section = analysis.sectionByAnchor(heading.from)!;
      const tasks = analysis.tasks.filter((task) => task.itemStart >= section.from && task.itemEnd <= section.to);
      const descendants = headingsInSection(analysis, heading.from);
      assertEquals(facts.get(heading.from), {
        taskCount: tasks.length,
        completedCount: tasks.filter((task) => task.checked).length,
        openCount: tasks.filter((task) => !task.checked).length,
        hasSetext: descendants.some((candidate) => candidate.syntax === "setext"),
        hasLevelSix: descendants.some((candidate) => candidate.level >= 6),
        hasPreviousSibling: previousSiblingSection(analysis, heading.from) !== undefined,
        hasNextSibling: nextSiblingSection(analysis, heading.from) !== undefined,
      });
    }
  }
});

Deno.test("OutlineProjection - collapsed heading hides descendants only", () => {
  const doc = `# Root 1
## Child 1.1
### Grandchild 1.1.1
## Child 1.2
# Root 2
`;
  const analysis = analyzeMarkdown(doc);
  const root1Anchor = analysis.headings[0].from;
  const child1Anchor = analysis.headings[1].from;

  // Root 1 has descendants
  assertEquals(hasDescendantHeadings(analysis, root1Anchor), true);
  // Child 1.2 has no descendants
  assertEquals(hasDescendantHeadings(analysis, analysis.headings[3].from), false);

  // Collapse Child 1.1: Root 1, Child 1.1, Child 1.2, Root 2 are visible; Grandchild 1.1.1 is hidden
  const collapsedChild1 = new Set([child1Anchor]);
  const visible1 = getVisibleOutlineHeadings(analysis, collapsedChild1);
  assertEquals(visible1.map((h) => h.text), ["Root 1", "Child 1.1", "Child 1.2", "Root 2"]);

  // Collapse Root 1: Root 1, Root 2 are visible; all 1.x descendants hidden
  const collapsedRoot1 = new Set([root1Anchor]);
  const visible2 = getVisibleOutlineHeadings(analysis, collapsedRoot1);
  assertEquals(visible2.map((h) => h.text), ["Root 1", "Root 2"]);
});

Deno.test("OutlineProjection - nested collapse state survives parent expand", () => {
  const doc = `# Root 1
## Child 1.1
### Grandchild 1.1.1
## Child 1.2
# Root 2
`;
  const analysis = analyzeMarkdown(doc);
  const root1Anchor = analysis.headings[0].from;
  const child1Anchor = analysis.headings[1].from;

  // Both Root 1 and Child 1.1 are in collapsed set
  const collapsedBoth = new Set([root1Anchor, child1Anchor]);
  const visibleBoth = getVisibleOutlineHeadings(analysis, collapsedBoth);
  assertEquals(visibleBoth.map((h) => h.text), ["Root 1", "Root 2"]);

  // When expanding Root 1 (remove from set), Child 1.1 remains collapsed
  collapsedBoth.delete(root1Anchor);
  const visibleAfterRootExpand = getVisibleOutlineHeadings(analysis, collapsedBoth);
  assertEquals(visibleAfterRootExpand.map((h) => h.text), ["Root 1", "Child 1.1", "Child 1.2", "Root 2"]);
});

Deno.test("OutlineProjection - collapse all and expand all", () => {
  const doc = `# Root 1
## Child 1.1
### Grandchild 1.1.1
# Root 2
`;
  const analysis = analyzeMarkdown(doc);

  // GetAllCollapsibleAnchors finds headings with children (Root 1, Child 1.1)
  const collapsible = getAllCollapsibleAnchors(analysis);
  assertEquals(collapsible.length, 2);

  const collapsedAll = new Set(collapsible);
  const visibleAll = getVisibleOutlineHeadings(analysis, collapsedAll);
  assertEquals(visibleAll.map((h) => h.text), ["Root 1", "Root 2"]);

  // Expand all
  const empty = new Set<number>();
  const visibleExpanded = getVisibleOutlineHeadings(analysis, empty);
  assertEquals(visibleExpanded.map((h) => h.text), ["Root 1", "Child 1.1", "Grandchild 1.1.1", "Root 2"]);
});

Deno.test("OutlineProjection - reconcileOutlineAnchors maps across text changes", () => {
  const doc1 = `# Alpha
## Beta
`;
  const a1 = analyzeMarkdown(doc1);
  const betaAnchor = a1.headings[1].from;
  const collapsed = new Set([betaAnchor]);

  // Insert "Prefix\n" (7 chars) at start of doc
  const doc2 = `Prefix\n# Alpha\n## Beta\n`;
  const changeSet = createTextChangeSet(doc1.length, doc2.length, [
    { from: 0, to: 0, insertedLength: 7 },
  ]);
  const a2 = analyzeMarkdown(doc2);

  const remapped = reconcileOutlineAnchors(collapsed, changeSet, a2);
  assertEquals(remapped.has(betaAnchor + 7), true);
  assertEquals(remapped.size, 1);
});
