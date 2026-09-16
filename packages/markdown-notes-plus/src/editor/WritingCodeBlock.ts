import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView as ProseEditorView, NodeView } from "@milkdown/prose/view";
import {
  isMermaidLanguage,
  MERMAID_RENDER_DEBOUNCE_MS,
  readMermaidTheme,
  renderMermaid,
} from "./MermaidRenderer";
import { subscribeProjectionThemeChanges } from "../theme/theme";

function languageOf(node: ProseNode): string {
  return (node.attrs.language as string) || (node.attrs.params as string) || "text";
}

function makeActionButton(className: string, text: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn-code-action ${className}`;
  button.textContent = text;
  button.title = title;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  return button;
}

export function codeBlockEnhancedView(
  initialNode: ProseNode,
  view: ProseEditorView,
  _getPos: () => number | undefined,
): NodeView {
  let currentNode = initialNode;
  const isMermaid = isMermaidLanguage(languageOf(initialNode));
  let isWrapped = false;
  let previewActive = false;
  let disposed = false;
  let renderGeneration = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let previewUrl: string | undefined;

  const dom = document.createElement("div");
  dom.className = "code-block-wrapper";
  dom.dataset.language = languageOf(initialNode).trim().toLowerCase();

  const header = document.createElement("div");
  header.className = "code-block-header";

  const langLabel = document.createElement("span");
  langLabel.className = "code-lang-label";
  langLabel.textContent = languageOf(initialNode);

  const actions = document.createElement("div");
  actions.className = "code-block-actions";

  const pre = document.createElement("pre");
  pre.className = "code-block-pre";
  const contentDOM = document.createElement("code");
  contentDOM.className = "code-block-content";
  pre.appendChild(contentDOM);

  const wrapBtn = makeActionButton("btn-code-wrap", "Wrap", "Toggle word wrap");
  wrapBtn.addEventListener("click", () => {
    isWrapped = !isWrapped;
    pre.classList.toggle("code-wrap-enabled", isWrapped);
    wrapBtn.classList.toggle("active", isWrapped);
    wrapBtn.setAttribute("aria-pressed", String(isWrapped));
  });

  const copyBtn = makeActionButton("btn-code-copy", "Copy", "Copy code");
  copyBtn.addEventListener("click", async () => {
    const codeText = currentNode.textContent;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = codeText;
        textarea.className = "clipboard-copy-buffer";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      copyBtn.textContent = "Copied!";
    } catch {
      copyBtn.textContent = "Error";
    }
    setTimeout(() => {
      if (!disposed) copyBtn.textContent = "Copy";
    }, 2000);
  });

  const preview = document.createElement("div");
  preview.className = "mermaid-preview";
  preview.hidden = true;

  const previewImage = document.createElement("img");
  previewImage.className = "mermaid-preview-image";

  const previewDescription = document.createElement("p");
  previewDescription.className = "mermaid-preview-description";

  const feedback = document.createElement("p");
  feedback.className = "mermaid-preview-feedback";
  feedback.hidden = true;
  feedback.setAttribute("aria-live", "polite");

  preview.appendChild(previewImage);
  preview.appendChild(previewDescription);

  const codeBtn = makeActionButton("btn-code-mode", "Code", "Show editable Mermaid source");
  const previewBtn = makeActionButton("btn-preview-mode", "Preview", "Render Mermaid preview");
  codeBtn.setAttribute("aria-label", "Show editable Mermaid source");
  previewBtn.setAttribute("aria-label", "Render Mermaid preview");
  codeBtn.setAttribute("aria-pressed", "true");
  previewBtn.setAttribute("aria-pressed", "false");
  codeBtn.classList.add("active");

  function clearRenderTimer(): void {
    if (renderTimer !== undefined) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
  }

  function releasePreviewUrl(): void {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    previewImage.removeAttribute("src");
  }

  function setFeedback(message?: string, isError = false): void {
    feedback.hidden = !message;
    feedback.textContent = message ?? "";
    feedback.setAttribute("role", isError ? "alert" : "status");
    feedback.classList.toggle("is-error", isError);
  }

  function showCode(error?: string): void {
    previewActive = false;
    renderGeneration += 1;
    clearRenderTimer();
    pre.hidden = false;
    preview.hidden = true;
    codeBtn.classList.add("active");
    previewBtn.classList.remove("active");
    codeBtn.setAttribute("aria-pressed", "true");
    previewBtn.setAttribute("aria-pressed", "false");
    releasePreviewUrl();
    setFeedback(error, Boolean(error));
  }

  async function renderCurrent(): Promise<void> {
    const generation = ++renderGeneration;
    const source = currentNode.textContent;
    setFeedback("Rendering Mermaid preview…");
    try {
      const result = await renderMermaid(source, readMermaidTheme());
      if (disposed || !previewActive || generation !== renderGeneration) return;

      const nextUrl = URL.createObjectURL(new Blob([result.imageBytes], { type: result.mediaType }));
      const previousUrl = previewUrl;
      previewUrl = nextUrl;
      previewImage.src = nextUrl;
      previewImage.alt = result.altText;
      previewDescription.textContent = result.description;
      setFeedback();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
      if (disposed || !previewActive || generation !== renderGeneration) return;
      const message = error instanceof Error ? error.message : "The Mermaid diagram could not be rendered.";
      showCode(`${message} The source was not changed.`);
    }
  }

  function scheduleRender(delay = MERMAID_RENDER_DEBOUNCE_MS): void {
    clearRenderTimer();
    const scheduledGeneration = ++renderGeneration;
    setFeedback("Waiting to update Mermaid preview…");
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      if (!disposed && previewActive && scheduledGeneration === renderGeneration) void renderCurrent();
    }, delay);
  }

  codeBtn.addEventListener("click", () => {
    showCode();
    view.focus();
  });
  previewBtn.addEventListener("click", () => {
    if (previewActive) return;
    // The toggle lives inside the ProseMirror node view. Explicitly retire its
    // DOM focus/selection before hiding contentDOM so subsequent keystrokes
    // cannot edit invisible source text.
    view.dom.blur();
    document.getSelection()?.removeAllRanges();
    previewBtn.focus({ preventScroll: true });
    previewActive = true;
    pre.hidden = true;
    preview.hidden = false;
    codeBtn.classList.remove("active");
    previewBtn.classList.add("active");
    codeBtn.setAttribute("aria-pressed", "false");
    previewBtn.setAttribute("aria-pressed", "true");
    void renderCurrent();
  });
  previewImage.addEventListener("error", () => {
    if (!disposed && previewActive && previewUrl) {
      showCode("The Mermaid image could not be displayed. The source was not changed.");
    }
  });

  if (isMermaid) {
    actions.appendChild(codeBtn);
    actions.appendChild(previewBtn);
  }
  actions.appendChild(wrapBtn);
  actions.appendChild(copyBtn);
  header.appendChild(langLabel);
  header.appendChild(actions);
  dom.appendChild(header);
  dom.appendChild(pre);
  if (isMermaid) {
    dom.appendChild(preview);
    dom.appendChild(feedback);
  }

  const unsubscribeTheme = isMermaid
    ? subscribeProjectionThemeChanges(() => {
      if (previewActive) scheduleRender(0);
    })
    : () => undefined;

  return {
    dom,
    contentDOM,
    update: (node: ProseNode) => {
      if (node.type.name !== "code_block" && node.type.name !== "fence") return false;
      if (isMermaidLanguage(languageOf(node)) !== isMermaid) return false;
      const sourceChanged = currentNode.textContent !== node.textContent;
      currentNode = node;
      const language = languageOf(node);
      langLabel.textContent = language;
      dom.dataset.language = language.trim().toLowerCase();
      if (sourceChanged) {
        setFeedback();
        if (previewActive) scheduleRender();
      }
      return true;
    },
    ignoreMutation: (mutation) => {
      const target = mutation.target;
      return target !== contentDOM && !contentDOM.contains(target);
    },
    stopEvent: (event) => {
      const target = event.target;
      return target instanceof Node && (header.contains(target) || preview.contains(target) || feedback.contains(target));
    },
    destroy: () => {
      disposed = true;
      renderGeneration += 1;
      clearRenderTimer();
      unsubscribeTheme();
      releasePreviewUrl();
    },
  };
}
