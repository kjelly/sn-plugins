import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { createTextChangeSet, type TextChange } from "./PositionMap.ts";
import type { CommandResult } from "../markdown/analysisCore.ts";

type PositionedNode = {
  type?: string;
  url?: unknown;
  children?: PositionedNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

const gfm = remark().use(remarkGfm);
const resourceLinkSerializer = remark().use(remarkGfm).data("settings", { resourceLink: true });

function serializeResourceLink(source: string): string {
  const root = {
    type: "root",
    children: [{
      type: "paragraph",
      children: [{ type: "link", title: null, url: source, children: [{ type: "text", value: source }] }],
    }],
  } as Parameters<typeof resourceLinkSerializer.stringify>[0];
  return resourceLinkSerializer.stringify(root).replace(/\n$/, "");
}

/**
 * Convert only GFM autolink-literal nodes whose source is a bare HTTP(S) URL.
 * The source equality check excludes explicit Markdown links and angle-bracket
 * autolinks, while the AST boundary excludes code and HTML.
 */
export function normalizeBareUrls(markdown: string): CommandResult {
  const changes: TextChange[] = [];
  const root = gfm.parse(markdown) as PositionedNode;

  const visit = (node: PositionedNode): void => {
    if (node.type === "link" && typeof node.url === "string") {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (typeof from === "number" && typeof to === "number" && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to <= markdown.length) {
        const source = markdown.slice(from, to);
        if (source === node.url && /^https?:\/\//i.test(source)) {
          const replacement = serializeResourceLink(source);
          changes.push({ from, to, insertedLength: replacement.length });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);

  const sorted = changes.sort((left, right) => left.from - right.from || left.to - right.to);
  const newLength = markdown.length + sorted.reduce(
    (total, change) => total + change.insertedLength - (change.to - change.from),
    0,
  );
  const changeSet = createTextChangeSet(markdown.length, newLength, sorted);
  if (!changeSet || sorted.length === 0) return { markdown, changed: false };

  let output = markdown;
  for (const change of [...sorted].reverse()) {
    const source = markdown.slice(change.from, change.to);
    const replacement = serializeResourceLink(source);
    output = output.slice(0, change.from) + replacement + output.slice(change.to);
  }
  return { markdown: output, changed: true, changeSet };
}
