import type { Node as ProseNode } from "@milkdown/prose/model";

export function writingTaskIsHidden(checked: boolean): boolean {
  return checked;
}

export function writingControlIsDisabled(readOnly: boolean, editable: boolean): boolean {
  return readOnly || !editable;
}

export type WritingControlState = { readonly readOnly: boolean; refresh: () => void };

/** Own the node-view control lifecycle so refresh and destroy are both safe. */
export class WritingControlRegistry {
  private readonly controls = new Set<WritingControlState>();

  add(control: WritingControlState): () => void {
    this.controls.add(control);
    return () => { this.controls.delete(control); };
  }

  refresh(): void {
    for (const control of this.controls) control.refresh();
  }

  get size(): number { return this.controls.size; }
}

/** Resolve a task node to its document-order task ordinal, independent of its text. */
export function taskOrdinalAtDocumentPosition(doc: ProseNode, position: number): number | undefined {
  let ordinal = 0;
  let matched: number | undefined;
  doc.descendants((node, nodePosition) => {
    if (node.type.name !== "list_item" || node.attrs.checked == null) return true;
    if (nodePosition === position) {
      matched = ordinal;
      return false;
    }
    ordinal += 1;
    return true;
  });
  return matched;
}
