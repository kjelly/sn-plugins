export type PerfFixtureCounts = {
  bytes: number;
  utf16Length: number;
  lines: number;
  headings: number;
  tasks: number;
};

export type GeneratedPerfMarkdown = {
  id: string;
  generatorVersion: 1;
  markdown: string;
  counts: PerfFixtureCounts;
};

const encoder = new TextEncoder();

function count(markdown: string): PerfFixtureCounts {
  const lines = markdown === "" ? 0 : markdown.split(/\r\n|\r|\n/).length;
  return {
    bytes: encoder.encode(markdown).byteLength,
    utf16Length: markdown.length,
    lines,
    headings: (markdown.match(/^ {0,3}#{1,6}(?:\s+|$)/gm) ?? []).length,
    tasks: (markdown.match(/^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\](?:\s+|$)/gm) ?? []).length,
  };
}

function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function fitAsciiToBytes(prefix: string, targetBytes: number): string {
  const current = encoder.encode(prefix).byteLength;
  if (current > targetBytes) throw new Error(`Fixture prefix exceeds target bytes: ${current} > ${targetBytes}`);
  if (current === targetBytes) return prefix;
  const remaining = targetBytes - current;
  return prefix + (remaining === 1 ? "\n" : `${"x".repeat(remaining - 1)}\n`);
}

function generateSized(id: string, targetBytes: number, seed: number, mixed: boolean): GeneratedPerfMarkdown {
  const random = makeRng(seed);
  const blocks: string[] = [];
  let bytes = 0;
  let index = 0;
  while (bytes < targetBytes - 512) {
    const heading = `## Section ${index}\n\n`;
    const paragraph = `Paragraph ${index} keeps deterministic text ${Math.floor(random() * 1_000_000)} and [a link](https://example.invalid/${index}).\n\n`;
    const extra = mixed
      ? `- [${index % 3 === 0 ? "x" : " "}] Task ${index}\n- item ${index}\n\n`
      : "";
    const block = heading + paragraph + extra;
    const blockBytes = encoder.encode(block).byteLength;
    if (bytes + blockBytes > targetBytes - 128) break;
    blocks.push(block);
    bytes += blockBytes;
    index += 1;
  }
  const markdown = fitAsciiToBytes(blocks.join(""), targetBytes);
  return { id, generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generatePlainFixture(targetBytes: number, id = `plain-${targetBytes}`, seed = 0x51a7): GeneratedPerfMarkdown {
  return generateSized(id, targetBytes, seed, false);
}

export function generateMixedFixture(targetBytes: number, id = `mixed-${targetBytes}`, seed = 0xc0ffee): GeneratedPerfMarkdown {
  return generateSized(id, targetBytes, seed, true);
}

export function generateFlatTasksFixture(taskCount: number): GeneratedPerfMarkdown {
  const id = `tasks-flat-${taskCount}`;
  const markdown = Array.from({ length: taskCount }, (_, index) => `- [${index % 4 === 0 ? "x" : " "}] Task ${index}\n`).join("");
  return { id, generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateNestedTasksFixture(scale: number): GeneratedPerfMarkdown {
  const depth = 40;
  const groups = 25 * scale;
  const id = `tasks-nested-${scale}x`;
  const chunks: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    for (let level = 0; level < depth; level += 1) chunks.push(`${"  ".repeat(level)}- [ ] Nested ${group}:${level}\n`);
  }
  const markdown = chunks.join("");
  return { id, generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateTaskContinuationFixture(scale: number): GeneratedPerfMarkdown {
  const tasks = 500 * scale;
  const id = `tasks-continuation-${scale}x`;
  const markdown = Array.from(
    { length: tasks },
    (_, index) => `- [ ] Task ${index}\n  continuation ${index}\n\n`,
  ).join("");
  return { id, generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateHeadingsFixture(headingCount: number): GeneratedPerfMarkdown {
  const id = `headings-dense-${headingCount}`;
  const markdown = Array.from({ length: headingCount }, (_, index) => `# Heading ${index}\n`).join("");
  return { id, generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateFencesFixture(fenceCount: number): GeneratedPerfMarkdown {
  const id = `fences-dense-${fenceCount}`;
  const markdown = Array.from({ length: fenceCount }, (_, index) => `\`\`\`text\nopaque ${index}\n\`\`\`\n`).join("");
  return { id, generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateGfmStructuralFixture(): GeneratedPerfMarkdown {
  const markdown = "# GFM\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [ ] task\n\nline  \nbreak\n\n```ts\nconst x = 1;\n```\n";
  return { id: "gfm-structural", generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateSourceOnlyFixture(): GeneratedPerfMarkdown {
  const markdown = "# Source only\n\n<div>raw</div>\n\n[label][ref]\n\n[ref]: https://example.invalid\n";
  return { id: "source-only", generatorVersion: 1, markdown, counts: count(markdown) };
}

export function generateCrlfNormalizableFixture(): GeneratedPerfMarkdown {
  const markdown = "# CRLF\r\nParagraph\r\n\r\n- [ ] task\r\n";
  return { id: "crlf-normalizable", generatorVersion: 1, markdown, counts: count(markdown) };
}
