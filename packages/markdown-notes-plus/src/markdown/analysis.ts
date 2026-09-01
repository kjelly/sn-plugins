export {
  analyzeMarkdown,
  checkAllInSection,
  deleteCompleted,
  deleteCompletedInSection,
  deleteCompletedInHeadingPath,
  deleteTask,
  headingIndexByAnchor,
  headingsInSection,
  isMindmapSuitable,
  mindmapText,
  nextSiblingSection,
  outlineText,
  parentSection,
  previousSiblingSection,
  remapSourceOffset,
  sectionAnchorAt,
  sectionAt,
  sectionByAnchor,
  scanMarkdownStructure,
  siblingSections,
  splitMarkdownLines,
  toggleTask,
  uncheckAll,
  uncheckAllInSection,
  uncheckAllInHeadingPath,
} from "./analysisCore.ts";
export type {
  CommandResult,
  MovableTaskPayload,
  MovableTaskSubtree,
  HeadingInfo,
  HeadingSyntax,
  MarkdownAnalysis,
  MarkdownLine,
  MarkdownRange,
  MarkdownStructure,
  MindmapFilter,
  SectionInfo,
  TaskInfo,
} from "./analysisCore.ts";

import { analyzeMarkdown as analyze } from "./analysisCore.ts";
import type { MindmapFilter, SectionInfo, TaskInfo } from "./analysisCore.ts";

/** Keep one analysis-defined Markdown subtree and remove only filtered tasks within it. */
export function projectMindmapMarkdown(markdown: string, filter: MindmapFilter, section?: SectionInfo | number): string {
  const analysis = analyze(markdown);
  const selected = section === undefined
    ? undefined
    : typeof section === "number" ? analysis.sectionByAnchor(section) : analysis.sectionByAnchor(section.anchor);
  const scoped = selected ? markdown.slice(selected.from, selected.to) : markdown;
  if (filter === "all") return scoped;
  const ranges = taskProjectionRanges(analyze(scoped).tasks, filter);
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push(range);
  }
  let output = scoped;
  for (const range of merged.reverse()) output = output.slice(0, range.from) + output.slice(range.to);
  return output;
}

type TaskRange = { from: number; to: number };
type TaskProjection = { keep: TaskRange[]; remove: TaskRange[] };

/** Project filtering from analyzed task subtrees while retaining open descendants. */
function taskProjectionRanges(tasks: Array<TaskInfo>, filter: MindmapFilter): TaskRange[] {
  const children = tasks.map(() => [] as number[]);
  const parent = tasks.map(() => -1);
  for (let child = 0; child < tasks.length; child += 1) {
    let best = -1;
    for (let candidate = 0; candidate < child; candidate += 1) {
      if (tasks[candidate].itemStart > tasks[child].itemStart || tasks[candidate].itemEnd <= tasks[child].itemStart) continue;
      if (tasks[candidate].depth >= tasks[child].depth) continue;
      if (best < 0 || tasks[candidate].itemStart >= tasks[best].itemStart) best = candidate;
    }
    if (best >= 0) {
      parent[child] = best;
      children[best].push(child);
    }
  }

  const shouldRemove = (task: TaskInfo): boolean => filter === "hide" || task.checked;
  const project = (index: number): TaskProjection => {
    const descendants = children[index].map(project);
    const nestedRemovals = descendants.flatMap((result) => result.remove);
    if (!shouldRemove(tasks[index])) return { keep: [{ from: tasks[index].itemStart, to: tasks[index].itemEnd }], remove: nestedRemovals };

    const retained = descendants.flatMap((result) => result.keep);
    return {
      keep: retained,
      remove: [...subtractRanges({ from: tasks[index].itemStart, to: tasks[index].itemEnd }, retained), ...nestedRemovals],
    };
  };

  return tasks.flatMap((_, index) => parent[index] < 0 ? project(index).remove : []).sort((a, b) => a.from - b.from);
}

function subtractRanges(source: TaskRange, retained: TaskRange[]): TaskRange[] {
  let cursor = source.from;
  const result: TaskRange[] = [];
  for (const range of retained.sort((a, b) => a.from - b.from)) {
    const from = Math.max(source.from, range.from);
    const to = Math.min(source.to, range.to);
    if (to <= from) continue;
    if (from > cursor) result.push({ from: cursor, to: from });
    cursor = Math.max(cursor, to);
  }
  if (cursor < source.to) result.push({ from: cursor, to: source.to });
  return result;
}
