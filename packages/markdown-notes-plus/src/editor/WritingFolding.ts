import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { MarkdownAnalysis, SectionInfo } from "../markdown/analysis.ts";

export const writingFoldingPluginKey = new PluginKey<WritingFoldingState>("writingFoldingPlugin");

export type WritingFoldingState = {
  foldedHeadingPositions: Set<number>;
  focusedHeadingPosition?: number;
};

export type BreadcrumbItem = {
  text: string;
  anchor: number;
  level: number;
};

/**
 * Compute breadcrumb trail from root section to target section.
 */
export function computeSectionBreadcrumbs(
  analysis: MarkdownAnalysis,
  anchor: number,
): BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [];
  let current: SectionInfo | undefined = analysis.sectionByAnchor(anchor);

  while (current) {
    trail.unshift({
      text: current.text,
      anchor: current.anchor,
      level: current.level,
    });
    if (current.parentAnchor !== undefined) {
      current = analysis.sectionByAnchor(current.parentAnchor);
    } else {
      break;
    }
  }

  return trail;
}

/**
 * Identify hidden node ranges in ProseMirror document for folded headings and/or focused section.
 */
export function computeHiddenBlockRanges(
  doc: ProseNode,
  foldedPositions: Set<number>,
  focusedPosition?: number,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];

  // 1. If focusedPosition is specified, hide everything before focused heading and after focused section
  if (focusedPosition !== undefined) {
    let focusedFound = false;
    let focusedLevel = 1;
    let sectionEndPos = doc.content.size;

    doc.forEach((child, pos) => {
      if (child.type.name === "heading") {
        if (pos === focusedPosition) {
          focusedFound = true;
          focusedLevel = child.attrs.level ?? 1;
        } else if (focusedFound && (child.attrs.level ?? 1) <= focusedLevel) {
          sectionEndPos = pos;
          focusedFound = false;
        }
      }
    });

    if (focusedPosition > 0) {
      ranges.push({ from: 0, to: focusedPosition });
    }
    if (sectionEndPos < doc.content.size) {
      ranges.push({ from: sectionEndPos, to: doc.content.size });
    }
  }

  // 2. Add folded heading ranges
  let activeFoldLevel: number | undefined = undefined;
  let activeFoldStart: number | undefined = undefined;

  doc.forEach((child, pos) => {
    const isHeading = child.type.name === "heading";
    const level = isHeading ? (child.attrs.level ?? 1) : undefined;

    if (activeFoldLevel !== undefined) {
      if (isHeading && level !== undefined && level <= activeFoldLevel) {
        // Section ended
        if (activeFoldStart !== undefined && pos > activeFoldStart) {
          ranges.push({ from: activeFoldStart, to: pos });
        }
        activeFoldLevel = undefined;
        activeFoldStart = undefined;
      }
    }

    if (isHeading && foldedPositions.has(pos)) {
      activeFoldLevel = level;
      activeFoldStart = pos + child.nodeSize;
    }
  });

  if (activeFoldLevel !== undefined && activeFoldStart !== undefined && activeFoldStart < doc.content.size) {
    ranges.push({ from: activeFoldStart, to: doc.content.size });
  }

  return ranges;
}

/**
 * Build ProseMirror decorations for folded heading widgets and hidden blocks.
 */
export function buildFoldingDecorations(
  doc: ProseNode,
  foldedPositions: Set<number>,
  focusedPosition?: number,
  onToggleFold?: (pos: number) => void,
): DecorationSet {
  const decorations: Decoration[] = [];
  const hiddenRanges = computeHiddenBlockRanges(doc, foldedPositions, focusedPosition);

  // Apply hidden style to ranges
  for (const range of hiddenRanges) {
    if (range.from < range.to) {
      doc.nodesBetween(range.from, range.to, (node, pos) => {
        if (pos >= range.from && pos + node.nodeSize <= range.to && node.isBlock) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: "writing-folded-hidden",
              style: "display: none !important;",
            }),
          );
          return false;
        }
        return true;
      });
    }
  }

  // Add fold/unfold button widget on headings with content
  doc.forEach((child, pos) => {
    if (child.type.name === "heading") {
      const isFolded = foldedPositions.has(pos);
      decorations.push(
        Decoration.widget(pos + 1, (view: EditorView) => {
          const btn = document.createElement("span");
          btn.className = `writing-fold-gutter-btn ${isFolded ? "is-folded" : "is-expanded"}`;
          btn.title = isFolded ? "Expand section" : "Collapse section";
          btn.contentEditable = "false";
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onToggleFold) {
              onToggleFold(pos);
            } else {
              // deno-lint-ignore no-explicit-any
              const tr = (view.state as any).tr.setMeta(writingFoldingPluginKey, { togglePos: pos });
              view.dispatch(tr);
            }
          });
          return btn;
        }, { side: -1 }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Milkdown/ProseMirror plugin for Writing-mode folding and section focus.
 */
export function createWritingFoldingPlugin(
  onToggleFold?: (pos: number) => void,
  // deno-lint-ignore no-explicit-any
): Plugin<any> {
  return new Plugin({
    // deno-lint-ignore no-explicit-any
    key: writingFoldingPluginKey as any,
    state: {
      init() {
        return {
          foldedHeadingPositions: new Set<number>(),
          focusedHeadingPosition: undefined,
        };
      },
      apply(tr: Transaction, value: WritingFoldingState, _oldState: EditorState, newState: EditorState): WritingFoldingState {
        const meta = tr.getMeta(writingFoldingPluginKey);
        let nextFolded = value.foldedHeadingPositions;
        let nextFocused = value.focusedHeadingPosition;

        if (tr.docChanged) {
          // Remap positions across edits
          const remapped = new Set<number>();
          for (const pos of value.foldedHeadingPositions) {
            const mapped = tr.mapping.mapResult(pos);
            if (!mapped.deleted && mapped.pos < newState.doc.content.size) {
              remapped.add(mapped.pos);
            }
          }
          nextFolded = remapped;

          if (nextFocused !== undefined) {
            const mappedFocused = tr.mapping.mapResult(nextFocused);
            nextFocused = mappedFocused.deleted ? undefined : mappedFocused.pos;
          }
        }

        if (meta && typeof meta === "object") {
          if ("togglePos" in meta && typeof meta.togglePos === "number") {
            const updated = new Set(nextFolded);
            if (updated.has(meta.togglePos)) {
              updated.delete(meta.togglePos);
            } else {
              updated.add(meta.togglePos);
            }
            nextFolded = updated;
          }
          if ("focusedPos" in meta) {
            nextFocused = meta.focusedPos as number | undefined;
          }
        }

        return {
          foldedHeadingPositions: nextFolded,
          focusedHeadingPosition: nextFocused,
        };
      },
    },
    props: {
      // deno-lint-ignore no-explicit-any
      decorations(state: any): any {
        const pluginState = writingFoldingPluginKey.getState(state);
        if (!pluginState) return DecorationSet.empty;
        return buildFoldingDecorations(
          state.doc,
          pluginState.foldedHeadingPositions,
          pluginState.focusedHeadingPosition,
          onToggleFold,
        );
      },
    },
  });
}
