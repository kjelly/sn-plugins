import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import { buildWritingWindows, replaceWritingWindow, WRITING_WINDOW_MAX_LENGTH } from "../src/editor/WritingWindows.ts";

declare const Deno: { test(name: string, fn: () => void): void };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Writing windows preserve every source byte and bound each editable slice", () => {
  const source = Array.from({ length: 6_000 }, (_, index) => `## Section ${index}\n\nParagraph ${index}.\n\n`).join("");
  const windows = buildWritingWindows(source, analyzeMarkdown(source).headings);
  assert(windows && windows.length > 1, "expected a windowed large note");
  assert(windows.every((window) => window.to - window.from <= WRITING_WINDOW_MAX_LENGTH), "window exceeds the cap");
  let reconstructed = "";
  for (const window of windows) reconstructed += source.slice(window.from, window.to) + (window.to < source.length ? "\n" : "");
  assert(reconstructed === source, "window projection must preserve exact source");

  const selected = windows[1];
  const fragment = source.slice(selected.from, selected.to);
  const replacement = replaceWritingWindow(source, windows, 1, fragment.replace("Paragraph", "Edited paragraph"));
  assert(replacement, "replacement was not applied");
  assert(replacement.source.includes("Edited paragraph"), "replacement text is missing");
  assert(replacement.windows[2].from === windows[2].from + 7, "later offsets did not move with the edit");
  assert(replacement.source.slice(replacement.windows[2].from, replacement.windows[2].to) ===
    source.slice(windows[2].from, windows[2].to), "later source changed");
});

Deno.test("Writing windows keep whole-document editing when no safe heading cut exists", () => {
  const source = `# One section\n\n${"word ".repeat(30_000)}\n`;
  assert(buildWritingWindows(source, analyzeMarkdown(source).headings) === undefined, "unsplittable note must use full view");
});

Deno.test("Writing windows reject a changed terminal separator", () => {
  const source = Array.from({ length: 6_000 }, (_, index) => `## Section ${index}\n\nParagraph ${index}.\n\n`).join("");
  const windows = buildWritingWindows(source, analyzeMarkdown(source).headings)!;
  const fragment = source.slice(windows[0].from, windows[0].to);
  assert(replaceWritingWindow(source, windows, 0, fragment.trimEnd()) === undefined, "missing boundary LF was accepted");
  assert(replaceWritingWindow(source, windows, 0, `${fragment}\n`) === undefined, "extra boundary LF was accepted");
  assert(replaceWritingWindow(source, windows, 0, `${fragment}\n\`\`\`text\nunfinished\n`) === undefined,
    "an unclosed fence must not swallow the next section heading");
});
