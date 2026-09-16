export const MERMAID_RENDER_DEBOUNCE_MS = 400;
export const MAX_MERMAID_SOURCE_LENGTH = 20_000;

const ALLOWED_DIAGRAM_TYPES = new Map<string, string>([
  ["flowchart", "flowchart"],
  ["flowchart-v2", "flowchart"],
  ["sequence", "sequence"],
  ["class", "class"],
  ["classDiagram", "class"],
  ["state", "state"],
  ["stateDiagram", "state"],
  ["er", "entity relationship"],
]);

export type MermaidTheme = {
  mode: "default" | "dark";
  background: string;
  foreground: string;
  accent: string;
};

export class MermaidRenderError extends Error {
  constructor(
    public readonly code: "empty" | "too-large" | "config" | "interaction" | "html-label" | "icon" | "type" | "invalid" | "unsafe-output",
    message: string,
  ) {
    super(message);
    this.name = "MermaidRenderError";
  }
}

export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === "string" && language.trim().toLowerCase() === "mermaid";
}

export function validateMermaidSource(source: string): void {
  if (!source.trim()) {
    throw new MermaidRenderError("empty", "The Mermaid diagram is empty.");
  }
  if (source.length > MAX_MERMAID_SOURCE_LENGTH) {
    throw new MermaidRenderError(
      "too-large",
      `The Mermaid diagram is too large to preview (maximum ${MAX_MERMAID_SOURCE_LENGTH.toLocaleString()} characters).`,
    );
  }
  if (/^\uFEFF?\s*---(?:\r?\n|$)/.test(source) || /%%\s*\{/.test(source)) {
    throw new MermaidRenderError("config", "Diagram-level Mermaid configuration is not supported.");
  }
  if (/^\s*(?:click\s+|links?\s+\S+\s*:)/im.test(source)) {
    throw new MermaidRenderError("interaction", "Interactive Mermaid links are not supported.");
  }
  if (/<\/?[a-z][^>]*>/i.test(source)) {
    throw new MermaidRenderError("html-label", "HTML labels are not supported in Mermaid previews.");
  }
  if (/@\{[^}]*\bicon\s*:/i.test(source)) {
    throw new MermaidRenderError("icon", "Mermaid icon syntax and remote icon packs are not supported.");
  }
}

export function allowedMermaidDiagramLabel(type: string): string | undefined {
  return ALLOWED_DIAGRAM_TYPES.get(type);
}

function unsafeCssUrl(value: string): boolean {
  for (const match of value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!match[2].trim().startsWith("#")) return true;
  }
  return /@import|javascript:|https?:|data:/i.test(value);
}

function isUrlAttribute(name: string): boolean {
  return [
    "fill",
    "stroke",
    "filter",
    "clip-path",
    "mask",
    "marker",
    "marker-start",
    "marker-mid",
    "marker-end",
  ].includes(name);
}

export function sanitizeMermaidSvg(svg: string): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    throw new MermaidRenderError("unsafe-output", "This browser cannot safely display Mermaid previews.");
  }

  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) {
    throw new MermaidRenderError("unsafe-output", "Mermaid produced an invalid preview.");
  }

  if (document.querySelector("script, foreignObject, iframe, object, embed, image, use")) {
    throw new MermaidRenderError("unsafe-output", "The Mermaid preview contains unsupported content.");
  }

  for (const anchor of Array.from(document.querySelectorAll("a"))) {
    anchor.replaceWith(...Array.from(anchor.childNodes));
  }

  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "href" || name === "xlink:href" || name === "target") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style" && unsafeCssUrl(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (isUrlAttribute(name) && /url\(/i.test(value) && !/^url\(\s*["']?#[-\w:.]+["']?\s*\)$/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    if (unsafeCssUrl(style.textContent ?? "")) style.remove();
  }

  root.removeAttribute("onclick");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  return new XMLSerializer().serializeToString(root);
}
