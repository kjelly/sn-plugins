function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import {
  analyzeNoteHealth,
  applyDiagnosticAutoFix,
  applyAllSafeAutoFixes,
  OVERLONG_SECTION_THRESHOLD_BYTES,
  slugifyAnchor,
} from "../src/review/ReviewDiagnostics.ts";
import { scanReviewSemantics } from "../src/review/ReviewSemanticScanner.ts";
import { CanonicalDocument } from "../src/document/CanonicalDocument.ts";

Deno.test("ReviewDiagnostics - slugifyAnchor normalizes title to anchor slug", () => {
  assertEquals(slugifyAnchor("1. Getting Started!"), "1-getting-started");
  assertEquals(slugifyAnchor("Architecture & Design"), "architecture-design");
});

Deno.test("ReviewDiagnostics - detects no-h1 and multiple-h1 issues", () => {
  // Case 1: No H1
  const mdNoH1 = `## Section 1\nSome text\n### Subsection`;
  const report1 = analyzeNoteHealth(mdNoH1);
  assertEquals(report1.issues.some((i) => i.id === "no-h1"), true);

  // Case 2: Plain text and empty notes also require an H1.
  assertEquals(analyzeNoteHealth("Plain text only").issues.some((i) => i.id === "no-h1"), true);
  assertEquals(analyzeNoteHealth("").issues.some((i) => i.id === "no-h1"), true);

  // Case 3: Multiple H1s
  const mdMultiH1 = `# Title 1\nIntro\n# Title 2\nAnother title`;
  const report2 = analyzeNoteHealth(mdMultiH1);
  assertEquals(report2.issues.some((i) => i.id === "multiple-h1"), true);
});

Deno.test("ReviewDiagnostics - detects heading level jump and auto fixes it", () => {
  const mdJump = `# Project Title\n\n  #### Direct H4 Jump ###\nBody text`;
  const report = analyzeNoteHealth(mdJump);
  const jumpIssue = report.issues.find((i) => i.fixType === "fix-level-jump");
  assertEquals(jumpIssue !== undefined, true);
  assertEquals(jumpIssue?.sourceRange, { from: 19, to: 23 });

  const fixRes = applyDiagnosticAutoFix(mdJump, jumpIssue!.id);
  assertEquals(fixRes.changed, true);
  assertEquals(fixRes.markdown, `# Project Title\n\n  ## Direct H4 Jump ###\nBody text`);
  assertEquals(fixRes.markdown.slice(0, 19), mdJump.slice(0, 19));
  assertEquals(fixRes.markdown.slice(21), mdJump.slice(23));
});

Deno.test("ReviewDiagnostics - removes an empty heading with an exact LF source range", () => {
  const mdWithEmpty = `# Project Title\n\n## \n\n- [ ] Valid Task\n- [ ] \n- [x] Done Task`;
  const report = analyzeNoteHealth(mdWithEmpty);
  const emptyHeading = report.issues.find((i) => i.fixType === "remove-empty-heading");
  assertEquals(emptyHeading?.sourceRange, { from: 17, to: 21 });

  const fixRes = applyDiagnosticAutoFix(mdWithEmpty, emptyHeading!.id);
  assertEquals(fixRes.changed, true);
  assertEquals(fixRes.markdown, `# Project Title\n\n\n- [ ] Valid Task\n- [ ] \n- [x] Done Task`);
  assertEquals(fixRes.changeSet?.changes, [{ from: 17, to: 21, insertedLength: 0 }]);
});

Deno.test("ReviewDiagnostics - preserves CRLF while removing an empty heading", () => {
  const md = `# Title\r\n\r\n  ##   \r\nBody\r\n`;
  const report = analyzeNoteHealth(md);
  const issue = report.issues.find((entry) => entry.fixType === "remove-empty-heading");
  assertEquals(issue !== undefined, true);

  const result = applyDiagnosticAutoFix(md, issue!.id);
  assertEquals(result.changed, true);
  assertEquals(result.markdown, `# Title\r\n\r\nBody\r\n`);
  assertEquals(result.markdown.includes("\n"), true);
  assertEquals(result.markdown.includes("\r\n"), true);
});

Deno.test("ReviewDiagnostics - diagnoses empty tasks but never auto fixes them", () => {
  const mdWithEmpty = `# Project Title\n\n## \n\n- [ ] Valid Task\n- [ ] \n- [x] Done Task`;
  const report = analyzeNoteHealth(mdWithEmpty);
  const emptyTask = report.issues.find((i) => i.id === "empty-task-5");
  assertEquals(emptyTask !== undefined, true);
  assertEquals(emptyTask?.canAutoFix, undefined);
  assertEquals(emptyTask?.fixType, undefined);

  const fixAllRes = applyAllSafeAutoFixes(mdWithEmpty);
  assertEquals(fixAllRes.fixedCount, 1);
  assertEquals(fixAllRes.changed, true);
  assertEquals(fixAllRes.markdown.includes("## \n"), false);
  assertEquals(fixAllRes.markdown.includes("- [ ] \n"), true);
  assertEquals(fixAllRes.markdown.includes("- [ ] Valid Task"), true);
});

Deno.test("ReviewDiagnostics - detects broken local links", () => {
  const mdWithLinks = `# Project Title\n\n## Section Alpha\n\nSee [Alpha](#section-alpha) and [Broken](#non-existent-section)`;
  const report = analyzeNoteHealth(mdWithLinks);
  const brokenLinkIssue = report.issues.find((i) => i.category === "links");
  assertEquals(brokenLinkIssue !== undefined, true);
  assertEquals(brokenLinkIssue?.message.includes("non-existent-section"), true);
});

Deno.test("ReviewDiagnostics - reports a broken link whose label contains inline code", () => {
  const markdown = "# H\n[outer `code`](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.indexOf("[outer"));
  assertEquals(links[0].message, 'Broken local link: "#missing" does not match any heading in this note');
});

Deno.test("ReviewDiagnostics - reports a broken link whose label contains an HTML comment", () => {
  const markdown = "# H\n[outer <!-- c -->](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.indexOf("[outer"));
  assertEquals(links[0].message, 'Broken local link: "#missing" does not match any heading in this note');
});

Deno.test("ReviewDiagnostics - reports nested-label and angle-bracket AST local links", () => {
  const nested = "# H\n[outer [inner]](#missing)";
  const nestedLinks = analyzeNoteHealth(nested).issues.filter((issue) => issue.category === "links");
  assertEquals(nestedLinks.length, 1);
  assertEquals(nestedLinks[0].anchor, nested.indexOf("[outer"));

  const angle = "# H\n[label](<#missing>)";
  const angleLinks = analyzeNoteHealth(angle).issues.filter((issue) => issue.category === "links");
  assertEquals(angleLinks.length, 1);
  assertEquals(angleLinks[0].anchor, angle.indexOf("[label]"));
});

Deno.test("ReviewDiagnostics - ignores escaped literal links after inline and line-leading comments", () => {
  const inlineComment = "# H\n<!-- c --> \\[literal](#missing)";
  const lineLeadingComment = "# H\n<!-- c -->\n\\[literal](#missing)";
  assertEquals(analyzeNoteHealth(inlineComment).issues.some((issue) => issue.category === "links"), false);
  assertEquals(analyzeNoteHealth(lineLeadingComment).issues.some((issue) => issue.category === "links"), false);
});

Deno.test("ReviewDiagnostics - reports each enclosing AST link despite protected label descendants", () => {
  const markdown = "# H\n[inline `code`](#first) and [comment <!-- c -->](#second)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 2);
  assertEquals(links.map((issue) => issue.anchor), [markdown.indexOf("[inline"), markdown.indexOf("[comment")]);
});

Deno.test("ReviewDiagnostics - masks inline HTML comments by range and keeps outside links visible", () => {
  const markdown = "# Real\nprefix <!-- [inside](#missing) --> and [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].message.includes("missing"), true);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - ignores HTML comment markers inside inline code", () => {
  const markdown = "# Real\n`<!--` [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - protects multiline inline code while keeping an outside link visible", () => {
  const markdown = "# Real\n`code\n[inside](#missing)\n` and [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - does not let a multiline inline-code comment marker swallow an outside link", () => {
  const markdown = "# Real\n`code\ncomment text <!-- marker\n` and [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - HTML comment owns an earlier backtick and leaves the visible heading exposed", () => {
  const markdown = "# A\n<!-- ` -->\n### Visible\n`";
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.protectedRanges, [{ from: 4, to: 14 }]);
  assertEquals(semantic.commentRanges, [{ from: 4, to: 14 }]);
  assertEquals(semantic.inlineCodeRanges, []);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.issues.find((issue) => issue.fixType === "fix-level-jump")?.id, "level-jump-1");
});

Deno.test("ReviewDiagnostics - escaped HTML comment markers stay literal before a multiline inline-code span", () => {
  const markdown = "# A\n\\<!-- ` -->\n### Visible\n`";
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.commentRanges, []);
  assertEquals(semantic.opaqueRanges, []);
  assertEquals(semantic.inlineCodeRanges, [{ from: 10, to: markdown.length }]);
  assertEquals(semantic.protectedRanges, [{ from: 10, to: markdown.length }]);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 1);
  assertEquals(report.issues.some((issue) => issue.id.startsWith("level-jump-")), false);

  const fixAll = applyAllSafeAutoFixes(markdown);
  assertEquals(fixAll.changed, false);
  assertEquals(fixAll.markdown, markdown);
  assertEquals(fixAll.fixedCount, 0);
});

Deno.test("ReviewDiagnostics - HTML block owns an earlier backtick and leaves the visible heading exposed", () => {
  const markdown = "# A\n<div> ` </div>\n### Visible\n`";
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.protectedRanges, [{ from: 4, to: 19 }]);
  assertEquals(semantic.opaqueRanges, [{ from: 4, to: 19 }]);
  assertEquals(semantic.inlineCodeRanges, []);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.issues.find((issue) => issue.fixType === "fix-level-jump")?.id, "level-jump-1");
});

Deno.test("ReviewDiagnostics - multiline inline code owns comment markers", () => {
  const markdown = "# H\n`code\n<!-- ... -->\n### hidden\n`\n## Visible";
  const codeEnd = markdown.indexOf("`\n## Visible") + 1;
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.protectedRanges, [{ from: 4, to: codeEnd }]);
  assertEquals(semantic.inlineCodeRanges, [{ from: 4, to: codeEnd }]);
  assertEquals(semantic.commentRanges, []);
  assertEquals(semantic.opaqueRanges, []);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.issues.some((issue) => issue.id === "level-jump-1"), false);
});

Deno.test("ReviewDiagnostics - multiline inline code owns HTML block markers", () => {
  const markdown = "# H\n`code\n<div> ... </div>\n### hidden\n`\n## Visible";
  const codeEnd = markdown.indexOf("`\n## Visible") + 1;
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.protectedRanges, [{ from: 4, to: codeEnd }]);
  assertEquals(semantic.inlineCodeRanges, [{ from: 4, to: codeEnd }]);
  assertEquals(semantic.commentRanges, []);
  assertEquals(semantic.opaqueRanges, []);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.issues.some((issue) => issue.id === "level-jump-1"), false);
});

Deno.test("ReviewDiagnostics - treats unmatched inline-code delimiters as ordinary text", () => {
  const markdown = "# Real\n`unmatched [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - keeps a valid single span after an unmatched double delimiter protected", () => {
  const markdown = "# Real\n``unmatched ` [inside](#missing) ` and [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - treats escaped backticks as ordinary text", () => {
  const markdown = "# Real\n\\`literal\\` [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - only matching inline-code delimiters close a code span", () => {
  const markdown = "# Real\n``[inside](#missing) `[also-inside](#missing)``";
  assertEquals(analyzeNoteHealth(markdown).issues.some((issue) => issue.category === "links"), false);
});

Deno.test("ReviewDiagnostics - matching outer double delimiters protect inner single ticks across lines", () => {
  const markdown = "# Real\n``[inside](#missing) `\n[also-inside](#missing)`` and [outside](#missing)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - accepts a closing-hash empty ATX heading and preserves CRLF on fix", () => {
  const markdown = "# Title\r\n\r\n## ###\r\nBody\r\n";
  const headingStart = markdown.indexOf("## ###");
  const report = analyzeNoteHealth(markdown);
  const issue = report.issues.find((entry) => entry.fixType === "remove-empty-heading");
  assertEquals(issue?.sourceRange, { from: headingStart, to: headingStart + "## ###\r\n".length });
  assertEquals(analyzeNoteHealth("# Title\n## ##x\n### title").issues.some((entry) => entry.fixType === "remove-empty-heading"), false);

  const result = applyDiagnosticAutoFix(markdown, issue!.id);
  assertEquals(result.changed, true);
  assertEquals(result.markdown, "# Title\r\n\r\nBody\r\n");
});

Deno.test("ReviewDiagnostics - computes metrics and largest sections accurately", () => {
  const mdComplex = `# Title\ni\n## Big Section\n${"Long text line.\n".repeat(50)}\n## Small Section\nShort text.`;
  const report = analyzeNoteHealth(mdComplex);
  assertEquals(report.metrics.headingsCount, 3);
  assertEquals(report.metrics.largestSections.length > 0, true);
  assertEquals(report.metrics.largestSections[0].title, "Big Section");
  assertEquals(report.metrics.largestSections.map((section) => section.title), ["Big Section", "Small Section", "Title"]);

  const title = report.metrics.largestSections.find((section) => section.title === "Title")!;
  const big = report.metrics.largestSections.find((section) => section.title === "Big Section")!;
  const small = report.metrics.largestSections.find((section) => section.title === "Small Section")!;
  assertEquals(title.bytes, new TextEncoder().encode("# Title\ni\n").length);
  assertEquals(big.bytes, new TextEncoder().encode(`## Big Section\n${"Long text line.\n".repeat(50)}\n`).length);
  assertEquals(small.bytes, new TextEncoder().encode("## Small Section\nShort text.").length);
  assertEquals(title.sourceRange.to <= big.sourceRange.from, true);
  assertEquals(big.sourceRange.to <= small.sourceRange.from, true);
});

Deno.test("ReviewDiagnostics - ignores opaque fenced code for raw fixes", () => {
  const md = "# Title\n\n```md\n## \n- [ ] \n```\n";
  const report = analyzeNoteHealth(md);
  assertEquals(report.issues.some((issue) => issue.fixType === "remove-empty-heading"), false);
  assertEquals(report.issues.some((issue) => issue.id.startsWith("empty-task-")), false);
});

Deno.test("ReviewDiagnostics - keeps HTML comments/blocks and inline code opaque", () => {
  const markdown = [
    "<!--",
    "## ",
    "- [ ] ",
    "[comment link](#missing)",
    "-->",
    "<div>",
    "## ",
    "- [ ] ",
    "[block link](#missing)",
    "</div>",
    "`[inline link](#missing) - [ ]`",
    "# Real",
    "- [ ] real",
  ].join("\n");
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.issues.some((issue) => issue.fixType === "remove-empty-heading"), false);
  assertEquals(report.issues.some((issue) => issue.id.startsWith("empty-task-")), false);
  assertEquals(report.issues.some((issue) => issue.category === "links"), false);
  assertEquals(report.metrics.headingsCount, 1);
  assertEquals(report.metrics.tasksCount, 1);
});

Deno.test("ReviewDiagnostics - suppresses links inside fenced code and HTML comments", () => {
  const markdown = "# H\n```md\n[code](#missing)\n```\n<!-- [comment](#missing) -->";
  assertEquals(analyzeNoteHealth(markdown).issues.some((issue) => issue.category === "links"), false);
});

Deno.test("ReviewDiagnostics - Fix All cascades normalized heading levels in one change set", () => {
  const source = "# A\n#### B\n###### C\n";
  const result = applyAllSafeAutoFixes(source);
  assertEquals(result.markdown, "# A\n## B\n### C\n");
  assertEquals(result.fixedCount, 2);
  assertEquals(result.changeSet?.changes, [
    { from: 4, to: 8, insertedLength: 2 },
    { from: 11, to: 17, insertedLength: 3 },
  ]);
  assertEquals(analyzeNoteHealth(result.markdown).issues.some((issue) => issue.fixType === "fix-level-jump"), false);
});

Deno.test("ReviewDiagnostics - Fix All follows the prior normalized level through arbitrary jumps", () => {
  const source = "# A\n# B\n### C\n#### D\n";
  const result = applyAllSafeAutoFixes(source);
  assertEquals(result.markdown, "# A\n# B\n## C\n### D\n");
  assertEquals(result.fixedCount, 2);
  assertEquals(result.changeSet?.changes, [
    { from: 8, to: 11, insertedLength: 2 },
    { from: 14, to: 18, insertedLength: 3 },
  ]);
  assertEquals(analyzeNoteHealth(result.markdown).issues.some((issue) => issue.fixType === "fix-level-jump"), false);
});

Deno.test("ReviewDiagnostics - Fix All prioritizes empty-heading removal over an overlapping level fix", () => {
  const overlappingOnly = "# H\n#### ###\n";
  const removed = applyAllSafeAutoFixes(overlappingOnly);
  assertEquals(removed.markdown, "# H\n");
  assertEquals(removed.changed, true);
  assertEquals(removed.fixedCount, 1);
  assertEquals(removed.changeSet?.changes, [{ from: 4, to: 13, insertedLength: 0 }]);

  const source = "# H\n#### ###\n###### C\n";
  const result = applyAllSafeAutoFixes(source);
  assertEquals(result.markdown, "# H\n## C\n");
  assertEquals(result.fixedCount, 2);
  assertEquals(result.changeSet?.changes, [
    { from: 4, to: 13, insertedLength: 0 },
    { from: 13, to: 19, insertedLength: 2 },
  ]);

  const document = new CanonicalDocument(source);
  let applies = 0;
  document.subscribe((_state, transition) => { if (transition?.kind === "apply") applies += 1; });
  assert(result.changeSet);
  assertEquals(document.applyLocal(result.markdown, result.changeSet), true);
  assertEquals(applies, 1);
  assertEquals(document.text, result.markdown);
  assertEquals(document.undo(), true);
  assertEquals(document.text, source);
});

Deno.test("ReviewDiagnostics - reports empty and overlong sections by exclusive ownership", () => {
  const empty = analyzeNoteHealth("# Parent\n\n## Child\n");
  const emptySection = empty.issues.find((issue) => issue.id === "empty-section-1");
  assertEquals(emptySection?.anchor, 10);
  assertEquals(emptySection?.sourceRange, { from: 10, to: 19 });

  const longBody = "x".repeat(OVERLONG_SECTION_THRESHOLD_BYTES);
  const overlong = analyzeNoteHealth(`# Long\n${longBody}\n# Next`);
  const issue = overlong.issues.find((entry) => entry.id === "overlong-section-0");
  assertEquals(issue !== undefined, true);
  assertEquals(issue?.anchor, 0);
  assertEquals(issue?.sourceRange?.from, 0);
  assertEquals(issue?.sourceRange?.to, `# Long\n${longBody}\n`.length);
  assertEquals(overlong.issues.some((entry) => entry.id === "note-size-warning"), false);
});

Deno.test("ReviewDiagnostics - counts fence variants and tables structurally", () => {
  const markdown = [
    "```ts",
    "``` not a heading",
    "```",
    "~~~md",
    "~~~",
    "> ```md",
    "> # hidden",
    "> ```",
    "- item",
    "  ```md",
    "  # hidden",
    "  ```",
    "a | b | c",
    "--- | --- | ---",
    "1 | 2 | 3",
    "",
    "```unclosed",
    "# still code",
  ].join("\n");
  const metrics = analyzeNoteHealth(markdown).metrics;
  assertEquals(metrics.codeBlocksCount, 5);
  assertEquals(metrics.tablesCount, 1);
  assertEquals(metrics.headingsCount, 0);
});

Deno.test("ReviewDiagnostics - counts a wide list continuation fence from canonical opaque ranges", () => {
  const markdown = [
    "- item",
    "      ```md",
    "      # hidden",
    "      ```",
    "- [ ] real",
  ].join("\n");
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.codeBlocksCount, 1);
  assertEquals(report.metrics.headingsCount, 0);
  assertEquals(report.metrics.tasksCount, 1);
});

Deno.test("ReviewDiagnostics - ignores raw empty child headings as section content", () => {
  const emptyChild = analyzeNoteHealth("# Parent\n## \n");
  assertEquals(emptyChild.issues.some((issue) => issue.id === "empty-section-0"), true);

  const contentAfterEmptyChild = analyzeNoteHealth("# Parent\n## \ncontent\n");
  assertEquals(contentAfterEmptyChild.issues.some((issue) => issue.id === "empty-section-0"), false);
});

Deno.test("ReviewDiagnostics - counts visible inline content without counting comments", () => {
  const visibleContent = [
    "# H\n[visible `code`](#h)",
    "# H\n`visible`",
    "# H\nvisible <!-- annotation --> text",
  ];
  for (const markdown of visibleContent) {
    assertEquals(analyzeNoteHealth(markdown).issues.some((issue) => issue.id === "empty-section-0"), false);
  }

  const commentOnly = [
    "# H\n<!-- annotation -->",
    "# H\n   <!-- annotation -->   ",
  ];
  for (const markdown of commentOnly) {
    assertEquals(analyzeNoteHealth(markdown).issues.some((issue) => issue.id === "empty-section-0"), true);
  }
});

Deno.test("ReviewDiagnostics - keeps fenced and HTML-only sections empty", () => {
  const fenced = "# H\n```md\nvisible\n```";
  const html = "# H\n<div>opaque</div>";
  assertEquals(analyzeNoteHealth(fenced).issues.some((issue) => issue.id === "empty-section-0"), true);
  assertEquals(analyzeNoteHealth(html).issues.some((issue) => issue.id === "empty-section-0"), true);
});

Deno.test("ReviewDiagnostics - preserves astral UTF-16 offsets and terminal empty headings", () => {
  const source = "# Title\n😀\n## ";
  const report = analyzeNoteHealth(source);
  const issue = report.issues.find((entry) => entry.fixType === "remove-empty-heading");
  assertEquals(issue?.sourceRange, { from: 11, to: 14 });
  const result = applyDiagnosticAutoFix(source, issue!.id);
  assertEquals(result.markdown, "# Title\n😀\n");
  assertEquals(result.changeSet?.changes, [{ from: 11, to: 14, insertedLength: 0 }]);
});

Deno.test("ReviewDiagnostics - one CanonicalDocument apply and undo restores Fix All", () => {
  const source = "# A\n#### B\n###### C\n## \n";
  const result = applyAllSafeAutoFixes(source);
  assert(result.changeSet);
  const document = new CanonicalDocument(source);
  let applies = 0;
  document.subscribe((_state, transition) => { if (transition?.kind === "apply") applies += 1; });
  assertEquals(document.applyLocal(result.markdown, result.changeSet), true);
  assertEquals(applies, 1);
  assertEquals(document.text, result.markdown);
  assertEquals(document.undo(), true);
  assertEquals(document.text, source);
});

Deno.test("ReviewDiagnostics - multiline inline code hides structural-looking headings from Review", () => {
  const markdown = "# H\n`code\n### hidden\n`";
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 1);
  assertEquals(report.issues.some((issue) => issue.id.startsWith("level-jump-")), false);
  assertEquals(scanReviewSemantics(markdown).protectedRanges, [{ from: 4, to: markdown.length }]);

  const result = applyAllSafeAutoFixes(markdown);
  assertEquals(result.markdown, markdown);
  assertEquals(result.changed, false);
  assertEquals(result.fixedCount, 0);
});

Deno.test("ReviewDiagnostics - inline code owns a fence-looking line before a visible heading", () => {
  const markdown = ["# A", "`code", "```", "### hidden", "`", "### Visible", "```"].join("\n");
  const semantic = scanReviewSemantics(markdown);
  const codeFrom = markdown.indexOf("`code");
  const codeTo = markdown.indexOf("`", markdown.indexOf("### hidden")) + 1;
  assertEquals(semantic.inlineCodeRanges, [{ from: codeFrom, to: codeTo }]);
  assertEquals(semantic.effectiveFenceRanges, []);
  assertEquals(semantic.effectiveSource.slice(codeFrom, codeTo).replace(/[^\r\n]/g, " "), semantic.effectiveSource.slice(codeFrom, codeTo));

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  const jump = report.issues.find((issue) => issue.fixType === "fix-level-jump");
  assertEquals(jump?.anchor, markdown.indexOf("### Visible"));
  assertEquals(jump?.sourceRange, { from: markdown.indexOf("### Visible"), to: markdown.indexOf("### Visible") + 3 });

  const fixed = applyAllSafeAutoFixes(markdown);
  assertEquals(fixed.markdown.slice(codeFrom, codeTo), markdown.slice(codeFrom, codeTo));
  assertEquals(fixed.markdown, ["# A", "`code", "```", "### hidden", "`", "## Visible", "```"].join("\n"));

  const crlf = ["# A", "😀", "`code", "```", "### hidden", "`", "### Visible", "```"].join("\r\n");
  const crlfSemantic = scanReviewSemantics(crlf);
  const crlfCodeFrom = crlf.indexOf("`code");
  const crlfCodeTo = crlf.indexOf("`", crlf.indexOf("### hidden")) + 1;
  assertEquals(crlfSemantic.inlineCodeRanges, [{ from: crlfCodeFrom, to: crlfCodeTo }]);
  assertEquals(crlfSemantic.effectiveFenceRanges, []);
  assertEquals(crlfSemantic.effectiveSource.length, crlf.length);
  assertEquals(crlfSemantic.effectiveSource.includes("\r\n"), true);
  assertEquals(applyAllSafeAutoFixes(crlf).markdown, ["# A", "😀", "`code", "```", "### hidden", "`", "## Visible", "```"].join("\r\n"));
});

Deno.test("ReviewDiagnostics - masks only an inline-owned orphan fence line and keeps later facts visible", () => {
  const cases = [
    { newline: "\n", marker: "```", astral: "" },
    { newline: "\r\n", marker: "~~~", astral: "😀" },
  ];

  for (const { newline, marker, astral } of cases) {
    const markdown = [
      "# A",
      astral,
      "`code",
      marker,
      "### hidden",
      "- [ ] hidden task",
      "[hidden](#hidden)",
      "`",
      "### Visible",
      "- [ ] trailing task",
      "[final](#final)",
      marker,
      `${marker}js`,
      "### fenced hidden",
      marker,
      "# Final",
    ].filter((_line, index) => !(astral === "" && index === 1)).join(newline);
    const lineEnd = (from: number): number => {
      const newlineOffset = markdown.indexOf("\n", from);
      return newlineOffset < 0 ? markdown.length : newlineOffset + 1;
    };
    const codeFrom = markdown.indexOf("`code");
    const codeTo = markdown.indexOf("`" + newline + "### Visible") + 1;
    const orphanFrom = markdown.indexOf(marker, codeTo);
    const laterFenceFrom = markdown.indexOf(`${marker}js`);
    const laterFenceClose = markdown.indexOf(marker, laterFenceFrom + marker.length);
    const semantic = scanReviewSemantics(markdown);

    assertEquals(semantic.effectiveSource.length, markdown.length);
    assertEquals(semantic.effectiveSource.includes(newline), true);
    assertEquals(semantic.inlineCodeRanges, [{ from: codeFrom, to: codeTo }]);
    assertEquals(
      semantic.effectiveSource.slice(codeFrom, codeTo).replace(/[^\r\n]/g, " "),
      semantic.effectiveSource.slice(codeFrom, codeTo),
    );
    assertEquals(
      semantic.effectiveSource.slice(orphanFrom, lineEnd(orphanFrom)).replace(/[^\r\n]/g, " "),
      semantic.effectiveSource.slice(orphanFrom, lineEnd(orphanFrom)),
    );
    for (let offset = 0; offset < markdown.length; offset += 1) {
      const inInline = offset >= codeFrom && offset < codeTo;
      const inOrphanLine = offset >= orphanFrom && offset < lineEnd(orphanFrom);
      if (!inInline && !inOrphanLine) assertEquals(semantic.effectiveSource[offset], markdown[offset]);
    }

    assertEquals(semantic.effectiveFenceRanges, [{ from: laterFenceFrom, to: lineEnd(laterFenceClose) }]);
    assertEquals(semantic.linkFacts.some((link) => link.destination === "#final"), true);
    const report = analyzeNoteHealth(markdown);
    assertEquals(report.metrics.headingsCount, 3);
    assertEquals(report.metrics.tasksCount, 1);
    assertEquals(report.issues.some((issue) => issue.category === "links"), false);
    const jump = report.issues.find((issue) => issue.fixType === "fix-level-jump");
    assertEquals(jump?.anchor, markdown.indexOf("### Visible"));

    const fixed = applyDiagnosticAutoFix(markdown, jump!.id);
    assertEquals(fixed.markdown.slice(codeFrom, codeTo), markdown.slice(codeFrom, codeTo));
    const fixedOrphanFrom = fixed.markdown.indexOf(marker, fixed.markdown.indexOf("### Visible"));
    const fixedOrphanEnd = fixed.markdown.indexOf("\n", fixedOrphanFrom) + 1;
    assertEquals(fixed.markdown.slice(fixedOrphanFrom, fixedOrphanEnd), markdown.slice(orphanFrom, lineEnd(orphanFrom)));
    assertEquals(fixed.markdown.includes("## Visible"), true);
    assertEquals(fixed.markdown.includes("# Final"), true);
  }
});

Deno.test("ReviewDiagnostics - accepts an inline-owned fence in a nested list container", () => {
  const markdown = [
    "# A",
    "- outer",
    "  - inner",
    "    `code",
    "    ```",
    "    ### hidden",
    "    `",
    "    ```",
    "    - [ ] trailing task",
    "    [Missing](#missing)",
    "# Final",
    "```",
  ].join("\n");
  const semantic = scanReviewSemantics(markdown);
  const orphanFrom = markdown.indexOf("    ```", markdown.indexOf("    `code"));
  const orphanClose = markdown.indexOf("    ```", orphanFrom + 1);
  const orphanEnd = orphanClose + "    ```".length + 1;
  const trailingTask = markdown.indexOf("    - [ ] trailing task");
  const trailingLink = markdown.indexOf("    [Missing](#missing)");
  const trailingLinkLabel = markdown.indexOf("[Missing]");

  assertEquals(semantic.effectiveSource.slice(orphanClose, orphanEnd).replace(/[^\r\n]/g, " "), semantic.effectiveSource.slice(orphanClose, orphanEnd));
  assertEquals(semantic.effectiveSource.slice(trailingTask, trailingLink), markdown.slice(trailingTask, trailingLink));
  assertEquals(semantic.effectiveSource.slice(trailingLink), markdown.slice(trailingLink));
  assertEquals(semantic.effectiveFenceRanges.some((range) => range.from === orphanFrom || range.from === orphanClose), false);
  assertEquals(semantic.effectiveFenceRanges, [{ from: markdown.lastIndexOf("```"), to: markdown.length }]);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.tasksCount, 1);
  assertEquals(report.issues.filter((issue) => issue.category === "links").length, 1);
  assertEquals(report.issues.find((issue) => issue.category === "links")?.anchor, trailingLinkLabel);
  assertEquals(report.metrics.headingsCount, 2);
});

Deno.test("ReviewDiagnostics - multiline inline code does not count a protected table", () => {
  const markdown = "# H\n`code\na | b\n--- | ---\n1 | 2\n`";
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.protectedRanges, [{ from: 4, to: markdown.length }]);
  assertEquals(analyzeNoteHealth(markdown).metrics.tablesCount, 0);
  assertEquals(applyAllSafeAutoFixes(markdown).markdown, markdown);
});

Deno.test("ReviewDiagnostics - counts a real table with an inline-code cell", () => {
  const markdown = "a | `code` | c\n--- | --- | ---\n1 | 2 | 3";
  assertEquals(analyzeNoteHealth(markdown).metrics.tablesCount, 1);
});

Deno.test("ReviewDiagnostics - multiline inline code preserves CRLF and astral UTF-16 boundaries", () => {
  const crlf = "# H\r\n`code\r\n### hidden\r\n`";
  const crlfReport = analyzeNoteHealth(crlf);
  assertEquals(crlfReport.metrics.headingsCount, 1);
  assertEquals(crlfReport.issues.some((issue) => issue.id.startsWith("level-jump-")), false);
  assertEquals(applyAllSafeAutoFixes(crlf).markdown, crlf);

  const astral = "# H\n😀\n`code\n### hidden\n`";
  const astralReport = analyzeNoteHealth(astral);
  assertEquals(astralReport.metrics.headingsCount, 1);
  assertEquals(astralReport.issues.some((issue) => issue.id.startsWith("level-jump-")), false);
  assertEquals(scanReviewSemantics(astral).protectedRanges, [{ from: 7, to: astral.length }]);
  assertEquals(applyAllSafeAutoFixes(astral).markdown, astral);
});

Deno.test("ReviewDiagnostics - projects multiline inline-code headings, tasks, and links while retaining visible facts", () => {
  const markdown = [
    "# Real",
    "`code",
    "### hidden",
    "- [ ] hidden task",
    "[ghost](#ghost)",
    "`",
    "## Visible",
    "- [ ] visible task",
    "[outside](#ghost)",
  ].join("\n");
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.metrics.tasksCount, 1);
  assertEquals(report.issues.filter((issue) => issue.category === "links").length, 1);
  assertEquals(report.issues.find((issue) => issue.category === "links")?.anchor, markdown.lastIndexOf("[outside]"));
  assertEquals(report.metrics.largestSections.map((section) => section.title), ["Real", "Visible"]);
});

Deno.test("ReviewDiagnostics - hidden headings never satisfy outside local links", () => {
  const markdown = "# Real\n`code\n# ghost\n`\n[outside](#ghost)";
  const links = analyzeNoteHealth(markdown).issues.filter((issue) => issue.category === "links");
  assertEquals(links.length, 1);
  assertEquals(links[0].anchor, markdown.lastIndexOf("[outside]"));
});

Deno.test("ReviewDiagnostics - visible heading diagnostics retain original shared-analysis indexes", () => {
  const markdown = "# A\n`code\n### hidden\n`\n#### Real";
  const report = analyzeNoteHealth(markdown);
  const jump = report.issues.find((issue) => issue.fixType === "fix-level-jump");
  assertEquals(jump?.id, "level-jump-2");
  assertEquals(report.issues.some((issue) => issue.id === "level-jump-1"), false);

  const fixed = applyDiagnosticAutoFix(markdown, jump!.id);
  assertEquals(fixed.markdown, "# A\n`code\n### hidden\n`\n## Real");
  assertEquals(applyAllSafeAutoFixes(markdown).markdown, fixed.markdown);
});

Deno.test("ReviewDiagnostics - real heading, task, and link remain visible when inline-code text overlaps", () => {
  const markdown = "# Real `code`\n- [ ] keep `code`\n[real `code`](#missing)";
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 1);
  assertEquals(report.metrics.tasksCount, 1);
  assertEquals(report.issues.filter((issue) => issue.category === "links").length, 1);
  assertEquals(report.issues.find((issue) => issue.category === "links")?.anchor, markdown.indexOf("[real"));
});

Deno.test("ReviewDiagnostics - HTML comment ownership recomputes later effective fences and headings", () => {
  const markdown = ["# A", "<!-- x", "```", "-->", "```", "inside", "```", "### Visible", "```"].join("\n");
  const semantic = scanReviewSemantics(markdown);
  const lineEnd = (from: number): number => {
    const newline = markdown.indexOf("\n", from);
    return newline < 0 ? markdown.length : newline + 1;
  };
  const firstFence = markdown.indexOf("```", markdown.indexOf("-->") + 3);
  const firstFenceClose = markdown.indexOf("```", firstFence + 3);
  const secondFence = markdown.indexOf("```", firstFenceClose + 3);
  assertEquals(semantic.htmlRanges, []);
  assertEquals(semantic.commentRanges, [{ from: markdown.indexOf("<!--"), to: markdown.indexOf("-->") + 3 }]);
  assertEquals(semantic.effectiveFenceRanges, [
    { from: firstFence, to: lineEnd(firstFenceClose) },
    { from: secondFence, to: markdown.length },
  ]);
  assertEquals(semantic.protectedRanges, [
    semantic.commentRanges[0],
    { from: firstFence, to: lineEnd(firstFenceClose) },
    { from: secondFence, to: markdown.length },
  ]);

  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.metrics.codeBlocksCount, 2);
  const jump = report.issues.find((issue) => issue.fixType === "fix-level-jump");
  assertEquals(jump?.anchor, markdown.indexOf("### Visible"));
  assertEquals(jump?.sourceRange, { from: markdown.indexOf("### Visible"), to: markdown.indexOf("### Visible") + 3 });
  assertEquals(report.metrics.largestSections.map((section) => section.title), ["A", "Visible"]);
  assertEquals(report.metrics.largestSections[0].sourceRange.to <= report.metrics.largestSections[1].sourceRange.from, true);
});

Deno.test("ReviewDiagnostics - HTML block, raw tags, PI, and CDATA close before later fences", () => {
  const cases = [
    ["<div>", "</div>"],
    ["<script>", "</script>"],
    ["<style>", "</style>"],
    ["<textarea>", "</textarea>"],
    ["<title>", "</title>"],
    ["<?review", "?>"],
    ["<![CDATA[", "]]>"] ,
  ];
  for (const [opener, terminator] of cases) {
    const markdown = ["# A", opener, "```", terminator, "```", "inside", "```", "### Visible", "```"].join("\n");
    const semantic = scanReviewSemantics(markdown);
    const openerFrom = markdown.indexOf(opener);
    const terminatorFrom = markdown.indexOf(terminator);
    const firstFence = markdown.indexOf("```", terminatorFrom + terminator.length);
    const firstFenceClose = markdown.indexOf("```", firstFence + 3);
    const secondFence = markdown.indexOf("```", firstFenceClose + 3);
    assertEquals(semantic.htmlRanges, [{ from: openerFrom, to: terminatorFrom + terminator.length + 1 }]);
    assertEquals(semantic.effectiveFenceRanges, [
      { from: firstFence, to: firstFenceClose + 4 },
      { from: secondFence, to: markdown.length },
    ]);
    const report = analyzeNoteHealth(markdown);
    assertEquals(report.metrics.headingsCount, 2, `${opener} should leave the visible heading exposed`);
    assertEquals(report.issues.some((issue) => issue.fixType === "fix-level-jump"), true);
  }
});

Deno.test("ReviewDiagnostics - ordinary HTML parents retain ownership across raw child closers", () => {
  const cases = ["script", "style", "textarea", "title"];
  for (const rawTag of cases) {
    const markdown = [
      "# A",
      `<div><${rawTag}>raw child</${rawTag}>`,
      "### must-stay-hidden",
      "</div>",
      "### Visible",
    ].join("\n");
    const semantic = scanReviewSemantics(markdown);
    const htmlFrom = markdown.indexOf("<div>");
    const parentClose = markdown.indexOf("</div>");
    const htmlTo = markdown.indexOf("\n", parentClose) + 1;
    assertEquals(semantic.htmlRanges, [{ from: htmlFrom, to: htmlTo }], `${rawTag} parent range should include the raw child and hidden heading`);
    assertEquals(semantic.protectedRanges, [{ from: htmlFrom, to: htmlTo }]);
    assertEquals(semantic.effectiveSource.includes("### must-stay-hidden"), false);
    assertEquals(semantic.effectiveSource.includes("### Visible"), true);

    const report = analyzeNoteHealth(markdown);
    assertEquals(report.metrics.headingsCount, 2, `${rawTag} child content should not expose the inner heading`);
    assertEquals(report.issues.find((issue) => issue.fixType === "fix-level-jump")?.anchor, markdown.indexOf("### Visible"));
  }
});

Deno.test("ReviewDiagnostics - code-first fence owns HTML markers without creating HTML opacity", () => {
  const markdown = ["# A", "```html", "<!--", "<div>", "-->", "### hidden", "```", "### Visible"].join("\n");
  const semantic = scanReviewSemantics(markdown);
  assertEquals(semantic.htmlRanges, []);
  assertEquals(semantic.commentRanges, []);
  assertEquals(semantic.effectiveFenceRanges, [{ from: markdown.indexOf("```html"), to: markdown.indexOf("```", 8) + 3 + 1 }]);
  assertEquals(semantic.protectedRanges, semantic.effectiveFenceRanges);
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.issues.find((issue) => issue.fixType === "fix-level-jump")?.anchor, markdown.indexOf("### Visible"));
});

Deno.test("ReviewDiagnostics - multiline inline code owns comment and HTML markers", () => {
  const markdown = ["# A", "`code", "<!--", "<div>", "### hidden", "`", "### Visible"].join("\n");
  const semantic = scanReviewSemantics(markdown);
  const codeFrom = markdown.indexOf("`code");
  const codeTo = markdown.indexOf("`", codeFrom + 1) + 1;
  assertEquals(semantic.htmlRanges, []);
  assertEquals(semantic.commentRanges, []);
  assertEquals(semantic.inlineCodeRanges, [{ from: codeFrom, to: codeTo }]);
  assertEquals(semantic.protectedRanges, [{ from: codeFrom, to: codeTo }]);
  const report = analyzeNoteHealth(markdown);
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(report.issues.find((issue) => issue.fixType === "fix-level-jump")?.anchor, markdown.indexOf("### Visible"));
});

Deno.test("ReviewDiagnostics - escaped comment markers use odd/even backslash parity", () => {
  const odd = "# A\n\\<!-- literal -->\n### Visible";
  const oddSemantic = scanReviewSemantics(odd);
  assertEquals(oddSemantic.commentRanges, []);
  assertEquals(analyzeNoteHealth(odd).metrics.headingsCount, 2);

  const even = "# A\n\\\\<!-- owned -->\n### Visible";
  const evenSemantic = scanReviewSemantics(even);
  assertEquals(evenSemantic.commentRanges, [{ from: even.indexOf("<!--"), to: even.indexOf("-->") + 3 }]);
  assertEquals(analyzeNoteHealth(even).metrics.headingsCount, 2);
});

Deno.test("ReviewDiagnostics - HTML ownership preserves CRLF and astral UTF-16 offsets", () => {
  const markdown = ["# A", "😀", "<!-- x", "```", "-->", "```", "inside", "```", "### Visible", "```"].join("\r\n");
  const semantic = scanReviewSemantics(markdown);
  const firstFence = markdown.indexOf("```", markdown.indexOf("-->") + 3);
  const firstFenceClose = markdown.indexOf("```", firstFence + 3);
  const secondFence = markdown.indexOf("```", firstFenceClose + 3);
  assertEquals(semantic.effectiveSource.length, markdown.length);
  assertEquals(semantic.effectiveSource.includes("\r\n"), true);
  assertEquals(semantic.commentRanges, [{ from: markdown.indexOf("<!--"), to: markdown.indexOf("-->") + 3 }]);
  assertEquals(semantic.effectiveFenceRanges, [
    { from: firstFence, to: markdown.indexOf("\n", firstFenceClose) + 1 },
    { from: secondFence, to: markdown.length },
  ]);
  const report = analyzeNoteHealth(markdown);
  const jump = report.issues.find((issue) => issue.fixType === "fix-level-jump");
  const visibleHeading = markdown.indexOf("### Visible");
  assertEquals(report.metrics.headingsCount, 2);
  assertEquals(jump?.anchor, visibleHeading);
  assertEquals(jump?.sourceRange, { from: visibleHeading, to: visibleHeading + 3 });
});
