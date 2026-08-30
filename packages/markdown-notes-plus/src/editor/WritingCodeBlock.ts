import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView as ProseEditorView, NodeView } from "@milkdown/prose/view";

export function codeBlockEnhancedView(
  initialNode: ProseNode,
  _view: ProseEditorView,
  _getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("div");
  dom.className = "code-block-wrapper";

  const header = document.createElement("div");
  header.className = "code-block-header";

  const langLabel = document.createElement("span");
  langLabel.className = "code-lang-label";
  langLabel.textContent = (initialNode.attrs.language as string) || (initialNode.attrs.params as string) || "text";

  const actions = document.createElement("div");
  actions.className = "code-block-actions";

  let isWrapped = false;
  const wrapBtn = document.createElement("button");
  wrapBtn.type = "button";
  wrapBtn.className = "btn-code-action btn-code-wrap";
  wrapBtn.textContent = "Wrap";
  wrapBtn.title = "Toggle Word Wrap";
  wrapBtn.addEventListener("mousedown", (e) => e.preventDefault());
  wrapBtn.addEventListener("click", () => {
    isWrapped = !isWrapped;
    if (isWrapped) {
      pre.classList.add("code-wrap-enabled");
      wrapBtn.classList.add("active");
    } else {
      pre.classList.remove("code-wrap-enabled");
      wrapBtn.classList.remove("active");
    }
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn-code-action btn-code-copy";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy Code";
  copyBtn.addEventListener("mousedown", (e) => e.preventDefault());
  copyBtn.addEventListener("click", async () => {
    const codeText = pre.textContent || "";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(codeText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = codeText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 2000);
    } catch {
      copyBtn.textContent = "Error";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 2000);
    }
  });

  actions.appendChild(wrapBtn);
  actions.appendChild(copyBtn);
  header.appendChild(langLabel);
  header.appendChild(actions);

  const pre = document.createElement("pre");
  pre.className = "code-block-pre";
  const contentDOM = document.createElement("code");
  contentDOM.className = "code-block-content";
  pre.appendChild(contentDOM);

  dom.appendChild(header);
  dom.appendChild(pre);

  return {
    dom,
    contentDOM,
    update: (node: ProseNode) => {
      if (node.type.name !== "code_block" && node.type.name !== "fence") return false;
      const lang = (node.attrs.language as string) || (node.attrs.params as string) || "text";
      langLabel.textContent = lang;
      return true;
    },
  };
}
