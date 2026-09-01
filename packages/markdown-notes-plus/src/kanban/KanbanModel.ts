import { analyzeMarkdown, type MarkdownAnalysis, type MovableTaskSubtree, type SectionInfo, type TaskInfo } from "../markdown/analysis.ts";

export const KANBAN_COLUMN_NAMES = ["Backlog", "Doing", "Review", "Done"] as const;
export type KanbanColumnName = typeof KANBAN_COLUMN_NAMES[number];

export type KanbanCardRef = { boardAnchor: number; cardAnchor: number };
export type KanbanDropTarget = {
  boardAnchor: number;
  columnAnchor: number;
  beforeCardAnchor?: number;
  index?: number;
};

export type KanbanCard = KanbanCardRef & {
  columnAnchor: number;
  text: string;
  checked: boolean;
  rootTaskFrom: number;
  movable: boolean;
  payload?: MovableTaskSubtree["payload"];
  reason?: string;
};

export type KanbanColumn = {
  anchor: number;
  name: KanbanColumnName;
  section: SectionInfo;
  cards: KanbanCard[];
  dropAllowed: boolean;
  reason?: string;
};

export type KanbanBoard = {
  anchor: number;
  title: string;
  section: SectionInfo;
  columns: KanbanColumn[];
  valid: boolean;
  sourceOnly: boolean;
  reason?: string;
};

export type KanbanModel = {
  markdown: string;
  analysis: MarkdownAnalysis;
  boards: KanbanBoard[];
  candidates: KanbanBoard[];
};

function sectionContains(outer: SectionInfo, inner: SectionInfo): boolean {
  return inner.from >= outer.from && inner.from < outer.to;
}

function isDescendantHeading(section: SectionInfo, board: SectionInfo): boolean {
  return section.anchor !== board.anchor && sectionContains(board, section);
}

function taskFact(analysis: MarkdownAnalysis, task: TaskInfo): MovableTaskSubtree | undefined {
  return analysis.movableTaskSubtrees.find((candidate) => candidate.rootTaskFrom === task.from);
}

function boardColumns(
  analysis: MarkdownAnalysis,
  boardAnchor: number,
  directChildren: SectionInfo[],
): { columns: KanbanColumn[]; valid: boolean; sourceOnly: boolean; reason?: string } {
  const matching = new Map<KanbanColumnName, SectionInfo[]>();
  for (const name of KANBAN_COLUMN_NAMES) matching.set(name, []);
  for (const child of directChildren) {
    const name = KANBAN_COLUMN_NAMES.find((candidate) => candidate === child.text.trim());
    if (name) matching.get(name)!.push(child);
  }
  const missing = KANBAN_COLUMN_NAMES.filter((name) => matching.get(name)!.length !== 1);
  const directColumns = KANBAN_COLUMN_NAMES.flatMap((name) => matching.get(name)!.length === 1 ? [matching.get(name)![0]] : []);
  const columnHasDescendantHeading = directColumns.some((column) => analysis.sections.some((section) => isDescendantHeading(section, column)));
  const sourceOnly = columnHasDescendantHeading || missing.length > 0;
  const reason = columnHasDescendantHeading
    ? "A Kanban column contains a descendant heading; this board is source-only."
    : missing.length > 0
    ? `Board requires exactly one direct ${missing.join(", ")} heading.`
    : undefined;
  const columns: KanbanColumn[] = KANBAN_COLUMN_NAMES.flatMap((name) => {
    const section = matching.get(name)![0];
    if (!section) return [];
    return [{ anchor: section.anchor, name, section, cards: [], dropAllowed: !sourceOnly, ...(sourceOnly ? { reason } : {}) }];
  });
  if (!sourceOnly) {
    for (const column of columns) {
      const tasks = analysis.tasks.filter((task) => {
        const taskSection = analysis.sectionAt(task.from);
        return task.depth === 0 && taskSection?.anchor === column.anchor;
      });
      for (const task of tasks) {
        const fact = taskFact(analysis, task);
        if (!fact) continue;
        const card: KanbanCard = {
          boardAnchor,
          cardAnchor: task.from,
          columnAnchor: column.anchor,
          text: task.text,
          checked: task.checked,
          rootTaskFrom: task.from,
          movable: fact.movable,
          ...(fact.payload ? { payload: fact.payload } : {}),
          ...(fact.reason ? { reason: fact.reason } : {}),
        };
        column.cards.push(card);
      }
    }
  }
  return { columns, valid: !sourceOnly && columns.length === KANBAN_COLUMN_NAMES.length, sourceOnly, ...(reason ? { reason } : {}) };
}

export function analyzeKanban(markdown: string, analysis: MarkdownAnalysis = analyzeMarkdown(markdown)): KanbanModel {
  const boards: KanbanBoard[] = [];
  for (const section of analysis.sections) {
    const directChildren = analysis.sections.filter((candidate) => candidate.parentAnchor === section.anchor && candidate.level === section.level + 1);
    if (directChildren.length === 0) continue;
    const directNamedCount = directChildren.filter((candidate) => KANBAN_COLUMN_NAMES.includes(candidate.text.trim() as KanbanColumnName)).length;
    if (directNamedCount === 0) continue;
    const namedDescendants = analysis.sections.filter((candidate) => sectionContains(section, candidate)).filter((candidate) => KANBAN_COLUMN_NAMES.includes(candidate.text.trim() as KanbanColumnName));
    if (new Set(namedDescendants.map((candidate) => candidate.text.trim())).size < KANBAN_COLUMN_NAMES.length) continue;
    const result = boardColumns(analysis, section.anchor, directChildren);
    const hasBoardShape = result.valid || result.sourceOnly;
    if (!hasBoardShape) continue;
    boards.push({
      anchor: section.anchor,
      title: section.text.trim(),
      section,
      columns: result.columns,
      valid: result.valid,
      sourceOnly: result.sourceOnly,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }
  return { markdown, analysis, boards, candidates: boards.filter((board) => board.valid) };
}
