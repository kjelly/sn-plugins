import { analyzeMarkdown, type MarkdownAnalysis, type MovableTaskSubtree, type SectionInfo, type TaskInfo } from "../markdown/analysis.ts";

export const KANBAN_COLUMN_NAMES = ["Backlog", "Doing", "Review", "Done"] as const;
export type KanbanColumnName = typeof KANBAN_COLUMN_NAMES[number] | string;

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
  name: string;
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
  const columnHasDescendantHeading = directChildren.some((column) =>
    analysis.sections.some((section) => isDescendantHeading(section, column))
  );
  const trimmedNames = directChildren.map((child) => child.text.trim());
  const duplicateNames = trimmedNames.filter((name, idx) => trimmedNames.indexOf(name) !== idx);
  const hasTooFewColumns = directChildren.length < 2;
  const sourceOnly = columnHasDescendantHeading || hasTooFewColumns || duplicateNames.length > 0;
  const reason = columnHasDescendantHeading
    ? "A Kanban column contains a descendant heading; this board is source-only."
    : hasTooFewColumns
    ? "Board requires at least two column headings."
    : duplicateNames.length > 0
    ? `Board columns must have unique names; duplicate: ${[...new Set(duplicateNames)].join(", ")}.`
    : undefined;

  const columns: KanbanColumn[] = directChildren.map((section) => {
    return {
      anchor: section.anchor,
      name: section.text.trim() || "Untitled",
      section,
      cards: [],
      dropAllowed: !sourceOnly,
      ...(sourceOnly && reason ? { reason } : {}),
    };
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
  return { columns, valid: !sourceOnly && columns.length >= 2, sourceOnly, ...(reason ? { reason } : {}) };
}

export function analyzeKanban(markdown: string, analysis: MarkdownAnalysis = analyzeMarkdown(markdown)): KanbanModel {
  const boards: KanbanBoard[] = [];
  const registeredColumnAnchors = new Set<number>();
  for (const section of analysis.sections) {
    if (registeredColumnAnchors.has(section.anchor)) continue;
    const directChildren = analysis.sections.filter(
      (candidate) => candidate.parentAnchor === section.anchor && candidate.level === section.level + 1
    );
    if (directChildren.length < 2) continue;
    const result = boardColumns(analysis, section.anchor, directChildren);
    const hasBoardShape = result.valid || result.sourceOnly;
    if (!hasBoardShape) continue;
    for (const col of result.columns) {
      registeredColumnAnchors.add(col.anchor);
    }
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
