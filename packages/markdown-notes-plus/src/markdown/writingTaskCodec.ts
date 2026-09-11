import { $remark } from "@milkdown/utils";
import type { RemarkPluginRaw, Root } from "@milkdown/transformer";

type WritingPosition = { start?: { offset?: number } };

type WritingMarkdownNode = {
  type: string;
  children?: WritingMarkdownNode[];
  checked?: boolean | null;
  value?: string;
  position?: WritingPosition;
  [key: string]: unknown;
};

type ToMarkdownHandler = (
  node: WritingMarkdownNode,
  parent: WritingMarkdownNode | undefined,
  state: unknown,
  info: unknown,
) => string;

type ToMarkdownExtension = {
  extensions?: ToMarkdownExtension[];
  handlers?: { listItem?: unknown };
};

type RemarkProcessor = {
  data: () => { toMarkdownExtensions?: unknown };
};

type RemarkFile = { toString: () => string };

const EMPTY_TASK_PLACEHOLDER = "writingEmptyTaskListItemPlaceholder";

function findListItemHandler(extension: ToMarkdownExtension): ToMarkdownHandler | undefined {
  let result: ToMarkdownHandler | undefined;
  for (const nested of extension.extensions ?? []) {
    const nestedHandler = findListItemHandler(nested);
    if (nestedHandler) result = nestedHandler;
  }
  if (typeof extension.handlers?.listItem === "function") {
    result = extension.handlers.listItem as ToMarkdownHandler;
  }
  return result;
}

function findExistingListItemHandler(extensions: ToMarkdownExtension[]): ToMarkdownHandler | undefined {
  let result: ToMarkdownHandler | undefined;
  for (const extension of extensions) {
    const handler = findListItemHandler(extension);
    if (handler) result = handler;
  }
  return result;
}

function emptyTaskChecked(node: WritingMarkdownNode, source: string): boolean | undefined {
  if (node.type !== "listItem" || (node.checked !== null && node.checked !== undefined)) return undefined;
  const children = node.children;
  if (!children || children.length !== 1) return undefined;
  const paragraph = children[0];
  const paragraphChildren = paragraph?.children;
  const marker = paragraphChildren?.[0];
  if (paragraph.type !== "paragraph" || paragraphChildren?.length !== 1 || marker?.type !== "text" || typeof marker.value !== "string") return undefined;
  if (marker.value !== "[ ]" && marker.value !== "[x]" && marker.value !== "[X]") return undefined;

  const start = node.position?.start?.offset;
  if (typeof start !== "number") return undefined;
  const remainder = source.slice(start);
  const lineEnd = remainder.search(/[\r\n]/);
  const line = remainder.slice(0, lineEnd < 0 ? remainder.length : lineEnd);
  const match = line.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\][ \t]*$/);
  return match ? match[1].toLowerCase() === "x" : undefined;
}

function normalizeEmptyTaskItems(node: WritingMarkdownNode, source: string): void {
  for (const child of node.children ?? []) {
    const checked = emptyTaskChecked(child, source);
    if (checked !== undefined) {
      child.checked = checked;
      const paragraph = child.children?.[0];
      if (paragraph) paragraph.children = [];
    }
    normalizeEmptyTaskItems(child, source);
  }
}

function isEmptyTask(node: WritingMarkdownNode): boolean {
  const paragraph = node.children?.[0];
  return node.type === "listItem" && typeof node.checked === "boolean" && node.children?.length === 1 && paragraph?.type === "paragraph" && (!paragraph.children || paragraph.children.length === 0);
}

function emptyTaskAwareListItemHandler(base: ToMarkdownHandler): ToMarkdownHandler {
  return (node, parent, state, info) => {
    if (!isEmptyTask(node)) return base(node, parent, state, info);

    const paragraph = node.children?.[0];
    if (!paragraph) return base(node, parent, state, info);
    const syntheticNode: WritingMarkdownNode = {
      ...node,
      children: [{ ...paragraph, children: [{ type: "text", value: EMPTY_TASK_PLACEHOLDER }] }],
    };
    const rendered = base(syntheticNode, parent, state, info);
    const withoutPlaceholder = rendered.replace(` ${EMPTY_TASK_PLACEHOLDER}`, "");
    if (withoutPlaceholder !== rendered) return withoutPlaceholder;
    return rendered
      .replace(EMPTY_TASK_PLACEHOLDER, "")
      .replace(/(\[[ xX]\])[ \t]+(?=\r?\n|$)/, "$1");
  };
}

/** Add the reversible empty-task representation to Writing's Markdown codec. */
export const remarkWritingEmptyTaskListItem: RemarkPluginRaw<Record<string, never>> = function (this: RemarkProcessor) {
  const data = this.data();
  const extensions = Array.isArray(data.toMarkdownExtensions)
    ? data.toMarkdownExtensions as ToMarkdownExtension[]
    : [];
  const baseHandler = findExistingListItemHandler(extensions);
  if (baseHandler) {
    data.toMarkdownExtensions = [
      ...extensions,
      { handlers: { listItem: emptyTaskAwareListItemHandler(baseHandler) } },
    ];
  }

  return (tree: Root, file: RemarkFile) => {
    normalizeEmptyTaskItems(tree as unknown as WritingMarkdownNode, file.toString());
    return tree;
  };
};

/** Milkdown wrapper used by the production Writing editor. */
export const writingEmptyTaskListItem = $remark(
  "writingEmptyTaskListItem",
  () => remarkWritingEmptyTaskListItem,
);
