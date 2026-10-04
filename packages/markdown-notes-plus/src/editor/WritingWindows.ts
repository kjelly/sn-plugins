import { analyzeMarkdown, type HeadingInfo } from "../markdown/analysis.ts";

export const WRITING_WINDOW_THRESHOLD = 128 * 1024;
export const WRITING_WINDOW_MAX_LENGTH = 24 * 1024;

export type WritingWindow = { from: number; to: number; label: string };

/**
 * Split only at a top-level ATX heading preceded by exactly one blank line.
 * The second LF stays outside both editor slices, so a serializer's terminal
 * newline cannot silently remove the separator between adjacent windows.
 */
export function buildWritingWindows(source: string, headings: readonly HeadingInfo[]): WritingWindow[] | undefined {
  if (source.length < WRITING_WINDOW_THRESHOLD) return undefined;
  const starts = headings
    .filter((heading) => heading.syntax === "atx" && heading.from >= 2 &&
      source.slice(heading.from - 2, heading.from) === "\n\n" && source[heading.from - 3] !== "\n")
    .map((heading) => heading.from);
  if (starts.length === 0) return undefined;

  const windows: WritingWindow[] = [];
  let from = 0;
  let candidate = 0;
  while (source.length - from > WRITING_WINDOW_MAX_LENGTH) {
    let next: number | undefined;
    while (candidate < starts.length && starts[candidate] - from - 1 <= WRITING_WINDOW_MAX_LENGTH) {
      if (starts[candidate] > from) next = starts[candidate];
      candidate += 1;
    }
    if (next === undefined) return undefined;
    windows.push({ from, to: next - 1, label: windowLabel(headings, from, next - 1) });
    from = next;
  }
  windows.push({ from, to: source.length, label: windowLabel(headings, from, source.length) });
  return windows.length > 1 ? windows : undefined;
}

function windowLabel(headings: readonly HeadingInfo[], from: number, to: number): string {
  const heading = headings.find((candidate) => candidate.from >= from && candidate.from < to);
  return heading?.text ?? "Opening";
}

/** Apply an accepted local editor result without reparsing or moving the cuts. */
export function replaceWritingWindow(
  source: string,
  windows: readonly WritingWindow[],
  index: number,
  nextFragment: string,
): { source: string; windows: WritingWindow[] } | undefined {
  const window = windows[index];
  if (!window || window.from < 0 || window.to > source.length || window.from > window.to) return undefined;
  if (index < windows.length - 1 && (!nextFragment.endsWith("\n") || nextFragment.endsWith("\n\n"))) return undefined;
  if (index > 0 && source.slice(window.from - 2, window.from) !== "\n\n") return undefined;
  if (index < windows.length - 1 && source[window.to] !== "\n") return undefined;
  if (index < windows.length - 1) {
    const probe = `${nextFragment}\n## writing-window-boundary-probe\n`;
    const boundary = nextFragment.length + 1;
    if (!analyzeMarkdown(probe).headings.some((heading) => heading.from === boundary)) return undefined;
  }
  const nextSource = source.slice(0, window.from) + nextFragment + source.slice(window.to);
  const delta = nextFragment.length - (window.to - window.from);
  const nextWindows = windows.map((current, currentIndex) => currentIndex < index
    ? current
    : currentIndex === index
    ? { ...current, to: current.to + delta }
    : { ...current, from: current.from + delta, to: current.to + delta });
  return { source: nextSource, windows: nextWindows };
}
