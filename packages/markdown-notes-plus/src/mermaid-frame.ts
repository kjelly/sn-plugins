import mermaid from "mermaid";
import {
  allowedMermaidDiagramLabel,
  MAX_MERMAID_SOURCE_LENGTH,
  MermaidRenderError,
  sanitizeMermaidSvg,
  type MermaidTheme,
  validateMermaidSource,
} from "./editor/MermaidPolicy.ts";

type RenderRequest = {
  channel: "sn-mermaid-render-request";
  id: string;
  source: string;
  theme: MermaidTheme;
};

type RenderResponse = {
  channel: "sn-mermaid-render-response";
  id: string;
  ok: boolean;
  imageBytes?: ArrayBuffer;
  mediaType?: "image/png";
  diagramType?: string;
  error?: {
    code: MermaidRenderError["code"];
    message: string;
  };
};

let renderSequence = 0;
const MAX_RENDER_DIMENSION = 4_096;
const MAX_RENDER_PIXELS = 8_000_000;

function previewDimensions(svg: string): { width: number; height: number } {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const viewBox = document.documentElement.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new MermaidRenderError("unsafe-output", "Mermaid produced a preview without valid dimensions.");
  }

  const scale = Math.min(
    1,
    MAX_RENDER_DIMENSION / viewBox[2],
    MAX_RENDER_DIMENSION / viewBox[3],
    Math.sqrt(MAX_RENDER_PIXELS / (viewBox[2] * viewBox[3])),
  );
  return {
    width: Math.max(1, Math.round(viewBox[2] * scale)),
    height: Math.max(1, Math.round(viewBox[3] * scale)),
  };
}

async function rasterizeSvg(svg: string, background: string): Promise<ArrayBuffer> {
  const sanitizedSvg = sanitizeMermaidSvg(svg);
  const dimensions = previewDimensions(sanitizedSvg);
  const svgUrl = URL.createObjectURL(new Blob([sanitizedSvg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new MermaidRenderError("unsafe-output", "The Mermaid preview could not be rasterized.")), { once: true });
    });
    image.src = svgUrl;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new MermaidRenderError("unsafe-output", "This browser cannot safely display Mermaid previews.");
    context.fillStyle = background;
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new MermaidRenderError("unsafe-output", "The Mermaid preview could not be rasterized.");
    return png.arrayBuffer();
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function isTheme(value: unknown): value is MermaidTheme {
  if (!value || typeof value !== "object") return false;
  const theme = value as Partial<MermaidTheme>;
  return (
    (theme.mode === "default" || theme.mode === "dark") &&
    typeof theme.background === "string" &&
    typeof theme.foreground === "string" &&
    typeof theme.accent === "string"
  );
}

function parseRequest(value: unknown): RenderRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const request = value as Partial<RenderRequest>;
  if (
    request.channel !== "sn-mermaid-render-request" ||
    typeof request.id !== "string" ||
    typeof request.source !== "string" ||
    !isTheme(request.theme)
  ) return undefined;
  return request as RenderRequest;
}

self.addEventListener("message", async (event: MessageEvent<unknown>) => {
  if (event.source !== parent) return;
  const request = parseRequest(event.data);
  const replyPort = event.ports[0];
  if (!request || !replyPort) return;

  try {
    validateMermaidSource(request.source);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: MAX_MERMAID_SOURCE_LENGTH,
      maxEdges: 300,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      theme: request.theme.mode,
      themeVariables: {
        background: request.theme.background,
        primaryTextColor: request.theme.foreground,
        lineColor: request.theme.foreground,
        textColor: request.theme.foreground,
        primaryColor: request.theme.accent,
      },
    });

    const diagramType = mermaid.detectType(request.source);
    if (!allowedMermaidDiagramLabel(diagramType)) {
      throw new MermaidRenderError("type", `Mermaid diagram type “${diagramType}” is not allowed.`);
    }

    const renderRoot = document.getElementById("mermaid-render-root");
    if (!renderRoot) throw new MermaidRenderError("invalid", "The Mermaid renderer is unavailable.");
    renderRoot.replaceChildren();
    const renderId = `mermaid-frame-${Date.now().toString(36)}-${(renderSequence++).toString(36)}`;
    const rendered = await mermaid.render(renderId, request.source, renderRoot);
    renderRoot.replaceChildren();
    const imageBytes = await rasterizeSvg(rendered.svg, request.theme.background);
    const response: RenderResponse = {
      channel: "sn-mermaid-render-response",
      id: request.id,
      ok: true,
      imageBytes,
      mediaType: "image/png",
      diagramType,
    };
    replyPort.postMessage(response, [imageBytes]);
  } catch (error) {
    document.getElementById("mermaid-render-root")?.replaceChildren();
    const normalized = error instanceof MermaidRenderError
      ? error
      : new MermaidRenderError(
        "invalid",
        `The Mermaid diagram could not be rendered.${error instanceof Error && error.message ? ` ${error.message}` : ""}`,
      );
    replyPort.postMessage({
      channel: "sn-mermaid-render-response",
      id: request.id,
      ok: false,
      error: { code: normalized.code, message: normalized.message },
    });
  } finally {
    replyPort.close();
  }
});
