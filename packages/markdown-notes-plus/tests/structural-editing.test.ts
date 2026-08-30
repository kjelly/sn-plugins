function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import {
  moveSubtree,
  moveSubtreeBefore,
  moveSubtreeAfter,
  promoteHeading,
  demoteHeading,
  promoteSubtree,
  demoteSubtree,
  duplicateSubtree,
} from "../src/markdown/structuralEditing.ts";

Deno.test("StructuralEditing - moveSubtree moves middle sibling up and down", () => {
  const doc = `# Section 1
Content 1

# Section 2
Content 2

# Section 3
Content 3

`;
  const analysis = analyzeMarkdown(doc);
  const sec2Anchor = analysis.sections[1].anchor;

  // Move Section 2 up -> [Section 2, Section 1, Section 3]
  const moveUpRes = moveSubtree(doc, sec2Anchor, "up");
  assertEquals(moveUpRes.changed, true);
  assertEquals(
    moveUpRes.markdown,
    `# Section 2
Content 2

# Section 1
Content 1

# Section 3
Content 3

`,
  );
  assertEquals(moveUpRes.changeSet !== undefined, true);

  // Move Section 2 down -> [Section 1, Section 3, Section 2]
  const moveDownRes = moveSubtree(doc, sec2Anchor, "down");
  assertEquals(moveDownRes.changed, true);
  assertEquals(
    moveDownRes.markdown,
    `# Section 1
Content 1

# Section 3
Content 3

# Section 2
Content 2

`,
  );
});

Deno.test("StructuralEditing - moveSubtree first up or last down is no-op", () => {
  const doc = `# First
Content 1

# Second
Content 2
`;
  const analysis = analyzeMarkdown(doc);
  const firstAnchor = analysis.sections[0].anchor;
  const secondAnchor = analysis.sections[1].anchor;

  const upRes = moveSubtree(doc, firstAnchor, "up");
  assertEquals(upRes.changed, false);
  assertEquals(upRes.markdown, doc);

  const downRes = moveSubtree(doc, secondAnchor, "down");
  assertEquals(downRes.changed, false);
  assertEquals(downRes.markdown, doc);
});

Deno.test("StructuralEditing - moveSubtree carries nested descendants and preserves code/HTML/tables/CRLF", () => {
  const doc = "# Parent A\r\nIntro A\r\n\r\n## Child A1\r\n- [x] Task 1\r\n```js\r\nconsole.log('hi');\r\n```\r\n\r\n# Parent B\r\n<table><tr><td>Table</td></tr></table>\r\n\r\n## Child B1\r\nChild B1 text\r\n";
  const analysis = analyzeMarkdown(doc);
  const parentBAnchor = analysis.sections[2].anchor;

  const moveRes = moveSubtree(doc, parentBAnchor, "up");
  assertEquals(moveRes.changed, true);
  assertEquals(
    moveRes.markdown,
    "# Parent B\r\n<table><tr><td>Table</td></tr></table>\r\n\r\n## Child B1\r\nChild B1 text\r\n# Parent A\r\nIntro A\r\n\r\n## Child A1\r\n- [x] Task 1\r\n```js\r\nconsole.log('hi');\r\n```\r\n\r\n",
  );
});

Deno.test("StructuralEditing - moveSubtreeBefore and moveSubtreeAfter reorder siblings", () => {
  const doc = `# S1
Text 1

# S2
Text 2

# S3
Text 3

`;
  const analysis = analyzeMarkdown(doc);
  const s1Anchor = analysis.sections[0].anchor;
  const s2Anchor = analysis.sections[1].anchor;
  const s3Anchor = analysis.sections[2].anchor;

  // Move S3 before S1 -> [S3, S1, S2]
  const resBefore = moveSubtreeBefore(doc, s3Anchor, s1Anchor);
  assertEquals(resBefore.changed, true);
  assertEquals(
    resBefore.markdown,
    `# S3
Text 3

# S1
Text 1

# S2
Text 2

`,
  );

  // Move S1 after S3 -> [S2, S3, S1]
  const resAfter = moveSubtreeAfter(doc, s1Anchor, s3Anchor);
  assertEquals(resAfter.changed, true);
  assertEquals(
    resAfter.markdown,
    `# S2
Text 2

# S3
Text 3

# S1
Text 1

`,
  );

  // Move S2 after S3 -> [S1, S3, S2]
  const resS2AfterS3 = moveSubtreeAfter(doc, s2Anchor, s3Anchor);
  assertEquals(resS2AfterS3.changed, true);
  assertEquals(
    resS2AfterS3.markdown,
    `# S1
Text 1

# S3
Text 3

# S2
Text 2

`,
  );

  // Non-sibling or same anchor rejects
  assertEquals(moveSubtreeBefore(doc, s1Anchor, s1Anchor).changed, false);
});

Deno.test("StructuralEditing - promoteHeading and demoteHeading modify single ATX heading", () => {
  const doc = `### Section Title ###
Content
#### Child Title
Child content
`;
  const analysis = analyzeMarkdown(doc);
  const h1Anchor = analysis.headings[0].from;

  // Promote level 3 -> level 2
  const promoteRes = promoteHeading(doc, h1Anchor);
  assertEquals(promoteRes.changed, true);
  assertEquals(
    promoteRes.markdown,
    `## Section Title ###
Content
#### Child Title
Child content
`,
  );

  // Demote level 3 -> level 4
  const demoteRes = demoteHeading(doc, h1Anchor);
  assertEquals(demoteRes.changed, true);
  assertEquals(
    demoteRes.markdown,
    `#### Section Title ###
Content
#### Child Title
Child content
`,
  );
});

Deno.test("StructuralEditing - promoteSubtree and demoteSubtree modify all descendant ATX headings", () => {
  const doc = `## Parent
Intro

### Child 1
Text 1

#### Grandchild 1
Text 1.1

### Child 2
Text 2
`;
  const analysis = analyzeMarkdown(doc);
  const rootAnchor = analysis.sections[0].anchor;

  // Promote subtree: 2->1, 3->2, 4->3, 3->2
  const promoteRes = promoteSubtree(doc, rootAnchor);
  assertEquals(promoteRes.changed, true);
  assertEquals(
    promoteRes.markdown,
    `# Parent
Intro

## Child 1
Text 1

### Grandchild 1
Text 1.1

## Child 2
Text 2
`,
  );

  // Demote subtree: 2->3, 3->4, 4->5, 3->4
  const demoteRes = demoteSubtree(doc, rootAnchor);
  assertEquals(demoteRes.changed, true);
  assertEquals(
    demoteRes.markdown,
    `### Parent
Intro

#### Child 1
Text 1

##### Grandchild 1
Text 1.1

#### Child 2
Text 2
`,
  );
});

Deno.test("StructuralEditing - promote/demote atomic rejection for Setext or boundary levels", () => {
  // Level 1 promote -> rejected
  const docLevel1 = `# Level 1
Content
`;
  const a1 = analyzeMarkdown(docLevel1);
  assertEquals(promoteHeading(docLevel1, a1.headings[0].from).changed, false);
  assertEquals(promoteSubtree(docLevel1, a1.sections[0].anchor).changed, false);

  // Level 6 demote in subtree -> rejected
  const docLevel6 = `##### Level 5
###### Level 6
`;
  const a6 = analyzeMarkdown(docLevel6);
  assertEquals(demoteSubtree(docLevel6, a6.sections[0].anchor).changed, false);

  // Setext heading -> promote/demote rejected
  const docSetext = `Setext Heading
==============
Content
`;
  const aSetext = analyzeMarkdown(docSetext);
  assertEquals(promoteHeading(docSetext, aSetext.headings[0].from).changed, false);
  assertEquals(demoteHeading(docSetext, aSetext.headings[0].from).changed, false);
  assertEquals(promoteSubtree(docSetext, aSetext.sections[0].anchor).changed, false);
  assertEquals(demoteSubtree(docSetext, aSetext.sections[0].anchor).changed, false);

  // Mixed ATX parent with Setext child -> atomic subtree rejection
  const docMixed = `# ATX Parent
Setext Child
------------
`;
  const aMixed = analyzeMarkdown(docMixed);
  assertEquals(promoteSubtree(docMixed, aMixed.sections[0].anchor).changed, false);
  assertEquals(demoteSubtree(docMixed, aMixed.sections[0].anchor).changed, false);
});

Deno.test("StructuralEditing - duplicateSubtree duplicates section byte-for-byte", () => {
  const doc = `# Section Alpha
Some text
- [ ] Task

# Section Beta
Beta text
`;
  const analysis = analyzeMarkdown(doc);
  const alphaAnchor = analysis.sections[0].anchor;

  const dupRes = duplicateSubtree(doc, alphaAnchor);
  assertEquals(dupRes.changed, true);
  assertEquals(
    dupRes.markdown,
    `# Section Alpha
Some text
- [ ] Task

# Section Alpha
Some text
- [ ] Task

# Section Beta
Beta text
`,
  );
});
