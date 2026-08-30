export function isUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function htmlToCleanMarkdown(html: string): string {
  if (typeof DOMParser === "undefined") {
    // Basic fallback for environments without DOMParser
    return html.replace(/<[^>]+>/g, "");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return convertNodeToMarkdown(doc.body).trim().replace(/\n{3,}/g, "\n\n");
}

function convertNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Strip script, style, svg, iframe
  if (["script", "style", "noscript", "svg", "iframe", "head"].includes(tag)) {
    return "";
  }

  const getChildrenText = () => {
    let result = "";
    for (let i = 0; i < el.childNodes.length; i++) {
      result += convertNodeToMarkdown(el.childNodes[i]);
    }
    return result;
  };

  switch (tag) {
    case "h1": return `\n\n# ${getChildrenText().trim()}\n\n`;
    case "h2": return `\n\n## ${getChildrenText().trim()}\n\n`;
    case "h3": return `\n\n### ${getChildrenText().trim()}\n\n`;
    case "h4": return `\n\n#### ${getChildrenText().trim()}\n\n`;
    case "h5": return `\n\n##### ${getChildrenText().trim()}\n\n`;
    case "h6": return `\n\n###### ${getChildrenText().trim()}\n\n`;

    case "p":
    case "div": {
      const content = getChildrenText().trim();
      return content ? `\n\n${content}\n\n` : "";
    }

    case "br": return "\n";
    case "hr": return "\n\n---\n\n";

    case "strong":
    case "b": {
      const content = getChildrenText().trim();
      return content ? `**${content}**` : "";
    }

    case "em":
    case "i": {
      const content = getChildrenText().trim();
      return content ? `*${content}*` : "";
    }

    case "del":
    case "s":
    case "strike": {
      const content = getChildrenText().trim();
      return content ? `~~${content}~~` : "";
    }

    case "code": {
      if (el.parentElement && el.parentElement.tagName.toLowerCase() === "pre") {
        return getChildrenText();
      }
      const content = getChildrenText().replace(/\n/g, " ");
      return content ? `\`${content}\`` : "";
    }

    case "pre": {
      const codeEl = el.querySelector("code");
      const langClass = (codeEl || el).className.match(/(?:lang|language)-(\w+)/);
      const lang = langClass ? langClass[1] : "";
      const codeText = (codeEl || el).textContent || "";
      return `\n\n\`\`\`${lang}\n${codeText.replace(/\r/g, "")}\n\`\`\`\n\n`;
    }

    case "blockquote": {
      const content = getChildrenText().trim();
      return `\n\n${content.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }

    case "a": {
      const href = el.getAttribute("href") || "";
      const text = getChildrenText().trim();
      if (!href) return text;
      return `[${text || href}](${href})`;
    }

    case "ul": {
      let items = "";
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName.toLowerCase() === "li") {
          const checkbox = child.querySelector("input[type=checkbox]") as HTMLInputElement | null;
          if (checkbox) {
            const isChecked = checkbox.checked || checkbox.hasAttribute("checked");
            const liText = child.textContent?.replace(/^[\s\u200B]*/, "").trim() || "";
            items += `- [${isChecked ? "x" : " "}] ${liText}\n`;
          } else {
            const liText = convertNodeToMarkdown(child).trim();
            items += `- ${liText}\n`;
          }
        }
      }
      return `\n\n${items}\n\n`;
    }

    case "ol": {
      let items = "";
      let index = 1;
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName.toLowerCase() === "li") {
          const liText = convertNodeToMarkdown(child).trim();
          items += `${index}. ${liText}\n`;
          index++;
        }
      }
      return `\n\n${items}\n\n`;
    }

    case "table": {
      const rows = Array.from(el.querySelectorAll("tr"));
      if (rows.length === 0) return "";
      let tableMd = "\n\n";
      let isFirstRow = true;
      let columnCount = 0;

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("th, td"));
        if (cells.length === 0) continue;
        if (isFirstRow) columnCount = cells.length;

        const cellTexts = cells.map((cell) => convertNodeToMarkdown(cell).replace(/\n/g, " ").trim());
        tableMd += `| ${cellTexts.join(" | ")} |\n`;

        if (isFirstRow) {
          const divider = Array(columnCount).fill("---").join(" | ");
          tableMd += `| ${divider} |\n`;
          isFirstRow = false;
        }
      }
      return `${tableMd}\n\n`;
    }

    default:
      return getChildrenText();
  }
}

export function processSmartPaste(
  clipboardData: { text?: string; html?: string },
  selectedText?: string,
): { type: "link" | "markdown" | "text"; content: string } {
  const plainText = clipboardData.text || "";
  const htmlText = clipboardData.html || "";

  // 1. If text is selected and clipboard contains a valid URL -> wrap as markdown link
  if (selectedText && selectedText.trim() && isUrl(plainText)) {
    return {
      type: "link",
      content: `[${selectedText.trim()}](${plainText.trim()})`,
    };
  }

  // 2. If rich HTML is present and contains formatting tags -> convert to clean Markdown
  if (htmlText && /<(?:h[1-6]|p|div|ul|ol|table|pre|blockquote|a|strong|b|em|i)\b/i.test(htmlText)) {
    const md = htmlToCleanMarkdown(htmlText);
    if (md) {
      return {
        type: "markdown",
        content: md,
      };
    }
  }

  // 3. Fallback to plain text
  return {
    type: "text",
    content: plainText,
  };
}
