import React from "react";
import { isSafeExternalUrl, openExternalLink } from "../utils/linkOpener.ts";
import { parseFlashcardMarkdown, type FlashcardMarkdownNode } from "./FlashcardMarkdownAst.ts";

export { parseFlashcardMarkdown, type FlashcardMarkdownNode } from "./FlashcardMarkdownAst.ts";

function textualChildren(node: FlashcardMarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textualChildren).join("");
}

function renderChildren(node: FlashcardMarkdownNode, key: string): React.ReactNode[] {
  return (node.children ?? []).map((child, index) => renderNode(child, `${key}-${index}`));
}

function renderNode(node: FlashcardMarkdownNode, key: string): React.ReactNode {
  switch (node.type) {
    case "root": return <React.Fragment key={key}>{renderChildren(node, key)}</React.Fragment>;
    case "text": return node.value ?? "";
    case "paragraph": return <p key={key}>{renderChildren(node, key)}</p>;
    case "emphasis": return <em key={key}>{renderChildren(node, key)}</em>;
    case "strong": return <strong key={key}>{renderChildren(node, key)}</strong>;
    case "delete": return <del key={key}>{renderChildren(node, key)}</del>;
    case "inlineCode": return <code key={key}>{node.value ?? ""}</code>;
    case "code": return <pre key={key}><code>{node.value ?? ""}</code></pre>;
    case "blockquote": return <blockquote key={key}>{renderChildren(node, key)}</blockquote>;
    case "heading": {
      const level = Math.min(6, Math.max(1, node.depth ?? 2));
      return React.createElement(`h${level}`, { key }, renderChildren(node, key));
    }
    case "thematicBreak": return <hr key={key} />;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      return React.createElement(tag, { key, ...(node.ordered && node.start && node.start !== 1 ? { start: node.start } : {}) }, renderChildren(node, key));
    }
    case "listItem": return <li key={key}>{node.checked === true || node.checked === false
      ? <><input type="checkbox" checked={node.checked} disabled aria-label={node.checked ? "Completed" : "Not completed"} /> {renderChildren(node, key)}</>
      : renderChildren(node, key)}</li>;
    case "link": {
      const url = node.url ?? "";
      if (!isSafeExternalUrl(url)) return <span key={key} className="flashcard-unsafe-link">{renderChildren(node, key)}</span>;
      return <a
        key={key}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          openExternalLink(url);
        }}
      >{renderChildren(node, key)}</a>;
    }
    case "image": return <span key={key} className="flashcard-image-placeholder" role="img" aria-label={node.alt || "Image"}>[Image: {node.alt || "no description"}]</span>;
    case "table": return <div key={key} className="flashcard-table-scroll"><table><tbody>{renderChildren(node, key)}</tbody></table></div>;
    case "tableRow": return <tr key={key}>{renderChildren(node, key)}</tr>;
    case "tableCell": return <td key={key}>{renderChildren(node, key)}</td>;
    case "break": return <br key={key} />;
    case "html": return <span key={key} className="flashcard-raw-html">Raw HTML omitted</span>;
    default: return <React.Fragment key={key}>{node.children ? renderChildren(node, key) : textualChildren(node)}</React.Fragment>;
  }
}

export function renderFlashcardMarkdown(markdown: string): React.ReactNode {
  try {
    return renderNode(parseFlashcardMarkdown(markdown), "flashcard-markdown");
  } catch {
    return <pre>{markdown}</pre>;
  }
}

export function FlashcardMarkdown({ markdown }: { markdown: string }) {
  return <div className="flashcard-markdown">{renderFlashcardMarkdown(markdown)}</div>;
}
