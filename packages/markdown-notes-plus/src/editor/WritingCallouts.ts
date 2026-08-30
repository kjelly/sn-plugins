import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView as ProseEditorView, NodeView } from "@milkdown/prose/view";

export type CalloutType = "note" | "tip" | "important" | "warning" | "caution";

export interface CalloutMeta {
  type: CalloutType;
  title: string;
  icon: string;
  color: string;
}

export const CALLOUT_META: Record<CalloutType, CalloutMeta> = {
  note: { type: "note", title: "Note", icon: "ℹ️", color: "#0969da" },
  tip: { type: "tip", title: "Tip", icon: "💡", color: "#1a7f37" },
  important: { type: "important", title: "Important", icon: "💬", color: "#8250df" },
  warning: { type: "warning", title: "Warning", icon: "⚠️", color: "#9a6700" },
  caution: { type: "caution", title: "Caution", icon: "🛑", color: "#cf222e" },
};

export const CALLOUT_REGEX = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

export function extractCalloutType(node: ProseNode): CalloutType | undefined {
  if (node.type.name !== "blockquote" || node.childCount === 0) return undefined;
  const firstChild = node.firstChild;
  if (!firstChild) return undefined;
  const text = firstChild.textContent.trim();
  const match = text.match(CALLOUT_REGEX);
  if (match) {
    const rawType = match[1].toLowerCase() as CalloutType;
    if (rawType in CALLOUT_META) return rawType;
  }
  return undefined;
}

export function calloutBlockquoteView(
  initialNode: ProseNode,
  _view: ProseEditorView,
  _getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("blockquote");
  const contentDOM = document.createElement("div");
  contentDOM.className = "blockquote-content";
  dom.appendChild(contentDOM);

  let currentCalloutType: CalloutType | undefined;

  const updateCalloutStyling = (node: ProseNode) => {
    const calloutType = extractCalloutType(node);
    if (calloutType !== currentCalloutType) {
      currentCalloutType = calloutType;
      // Remove old callout classes
      dom.classList.remove(
        "callout-card",
        "callout-type-note",
        "callout-type-tip",
        "callout-type-important",
        "callout-type-warning",
        "callout-type-caution",
      );

      if (calloutType) {
        dom.classList.add("callout-card", `callout-type-${calloutType}`);
        dom.dataset.calloutType = calloutType.toUpperCase();
      } else {
        delete dom.dataset.calloutType;
      }
    }
  };

  updateCalloutStyling(initialNode);

  return {
    dom,
    contentDOM,
    update: (node: ProseNode) => {
      if (node.type.name !== "blockquote") return false;
      updateCalloutStyling(node);
      return true;
    },
  };
}
