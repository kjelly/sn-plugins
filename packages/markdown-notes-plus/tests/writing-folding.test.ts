function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import {
  computeSectionBreadcrumbs,
} from "../src/editor/WritingFolding.ts";

Deno.test("WritingFolding - computeSectionBreadcrumbs calculates root-to-target path", () => {
  const doc = `# Root A
## Child A1
### Grandchild A1.1
# Root B
## Child B1
`;
  const analysis = analyzeMarkdown(doc);

  // Breadcrumbs for Grandchild A1.1 (Level 3)
  const grandchildAnchor = analysis.headings[2].from;
  const trail = computeSectionBreadcrumbs(analysis, grandchildAnchor);
  assertEquals(trail.length, 3);
  assertEquals(trail.map((b) => b.text), ["Root A", "Child A1", "Grandchild A1.1"]);
  assertEquals(trail.map((b) => b.level), [1, 2, 3]);

  // Breadcrumbs for Child B1 (Level 2)
  const childB1Anchor = analysis.headings[4].from;
  const trailB1 = computeSectionBreadcrumbs(analysis, childB1Anchor);
  assertEquals(trailB1.length, 2);
  assertEquals(trailB1.map((b) => b.text), ["Root B", "Child B1"]);

  // Breadcrumbs for Root B (Level 1)
  const rootBAnchor = analysis.headings[3].from;
  const trailRootB = computeSectionBreadcrumbs(analysis, rootBAnchor);
  assertEquals(trailRootB.length, 1);
  assertEquals(trailRootB[0].text, "Root B");

  // Breadcrumbs for non-existent anchor
  assertEquals(computeSectionBreadcrumbs(analysis, 99999), []);
});

Deno.test("WritingFolding - computeSectionBreadcrumbs handles deep hierarchy and multiple roots", () => {
  const doc = `# Chapter 1
## Section 1.1
### Subsection 1.1.1
#### Paragraph 1.1.1.1
##### Item 1.1.1.1.1
###### Detail 1.1.1.1.1.1
# Chapter 2
`;
  const analysis = analyzeMarkdown(doc);
  const detailAnchor = analysis.headings[5].from;
  const trail = computeSectionBreadcrumbs(analysis, detailAnchor);
  assertEquals(trail.length, 6);
  assertEquals(trail.map((b) => b.level), [1, 2, 3, 4, 5, 6]);
  assertEquals(trail[5].text, "Detail 1.1.1.1.1.1");
  assertEquals(trail[0].text, "Chapter 1");
});

