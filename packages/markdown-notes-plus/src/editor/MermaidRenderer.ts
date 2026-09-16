import {
  allowedMermaidDiagramLabel,
  MermaidRenderError,
  type MermaidTheme,
  validateMermaidSource,
} from "./MermaidPolicy.ts";

export {
  allowedMermaidDiagramLabel,
  isMermaidLanguage,
  MAX_MERMAID_SOURCE_LENGTH,
  MERMAID_RENDER_DEBOUNCE_MS,
  MermaidRenderError,
  sanitizeMermaidSvg,
  validateMermaidSource,
} from "./MermaidPolicy.ts";
export type { MermaidTheme } from "./MermaidPolicy.ts";

export type MermaidRenderResult = {
  imageBytes: ArrayBuffer;
  mediaType: "image/png";
  diagramType: string;
  altText: string;
  description: string;
};

let renderQueue: Promise<void> = Promise.resolve();
let rendererFrame: HTMLIFrameElement | undefined;
let rendererFrameReady: Promise<Window> | undefined;
let requestSequence = 0;

type RendererResponse = {
  channel: "sn-mermaid-render-response";
  id: string;
  ok: boolean;
  imageBytes?: ArrayBuffer;
  mediaType?: "image/png";
  diagramType?: string;
  error?: {
    code?: MermaidRenderError["code"];
    message?: string;
  };
};

function disposeRendererFrame(): void {
  rendererFrame?.remove();
  rendererFrame = undefined;
  rendererFrameReady = undefined;
}

function getRendererWindow(): Promise<Window> {
  if (rendererFrameReady) return rendererFrameReady;

  const frame = document.createElement("iframe");
  frame.className = "mermaid-render-frame";
  frame.title = "Mermaid renderer";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.src = new URL("./mermaid-renderer.html", document.baseURI).toString();
  rendererFrame = frame;
  rendererFrameReady = new Promise<Window>((resolve, reject) => {
    frame.addEventListener("load", () => {
      if (frame.contentWindow) resolve(frame.contentWindow);
      else reject(new Error("The Mermaid renderer is unavailable."));
    }, { once: true });
    frame.addEventListener("error", () => reject(new Error("The Mermaid renderer could not be loaded.")), { once: true });
  }).catch((error) => {
    disposeRendererFrame();
    throw error;
  });
  document.body.appendChild(frame);
  return rendererFrameReady;
}

async function requestRender(
  source: string,
  theme: MermaidTheme,
): Promise<{ imageBytes: ArrayBuffer; mediaType: "image/png"; diagramType: string }> {
  const target = await getRendererWindow();
  const id = `mermaid-render-${Date.now().toString(36)}-${(requestSequence++).toString(36)}`;

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = globalThis.setTimeout(() => {
      channel.port1.close();
      disposeRendererFrame();
      reject(new MermaidRenderError("invalid", "The Mermaid renderer timed out."));
    }, 10_000);

    function finish(): void {
      globalThis.clearTimeout(timeout);
      channel.port1.close();
    }

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const response = event.data as Partial<RendererResponse>;
      if (response.channel !== "sn-mermaid-render-response" || response.id !== id) return;
      finish();
      if (
        response.ok &&
        response.imageBytes instanceof ArrayBuffer &&
        response.mediaType === "image/png" &&
        typeof response.diagramType === "string"
      ) {
        resolve({ imageBytes: response.imageBytes, mediaType: response.mediaType, diagramType: response.diagramType });
        return;
      }
      const code = response.error?.code;
      const message = response.error?.message;
      reject(new MermaidRenderError(code ?? "invalid", message ?? "The Mermaid diagram could not be rendered."));
    };

    target.postMessage({ channel: "sn-mermaid-render-request", id, source, theme }, "*", [channel.port2]);
  });
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(work, work);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function renderMermaid(source: string, theme: MermaidTheme): Promise<MermaidRenderResult> {
  validateMermaidSource(source);

  return enqueue(async () => {
    try {
      const rendered = await requestRender(source, theme);
      const detectedType = rendered.diagramType;
      const diagramLabel = allowedMermaidDiagramLabel(detectedType);
      if (!diagramLabel) {
        throw new MermaidRenderError("type", `Mermaid diagram type “${detectedType}” is not allowed.`);
      }
      return {
        imageBytes: rendered.imageBytes,
        mediaType: rendered.mediaType,
        diagramType: detectedType,
        altText: `Mermaid ${diagramLabel} diagram`,
        description: `Mermaid ${diagramLabel} diagram preview. Edit the diagram in Code view; Source mode is the only exact Markdown editing surface.`,
      };
    } catch (error) {
      if (error instanceof MermaidRenderError) throw error;
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      throw new MermaidRenderError("invalid", `The Mermaid diagram could not be rendered.${detail}`);
    }
  });
}

function relativeLuminance(color: string): number | undefined {
  const match = color.match(/rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const channels = match.slice(1, 4).map((component) => {
    const value = Number(component) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function readMermaidTheme(): MermaidTheme {
  const styles = getComputedStyle(document.body);
  const background = styles.backgroundColor || "rgb(255, 255, 255)";
  const foreground = styles.color || "rgb(31, 41, 55)";
  const accent = styles.getPropertyValue("--sn-stylekit-info-color").trim() || foreground;
  const luminance = relativeLuminance(background);
  const systemDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return {
    mode: luminance === undefined ? (systemDark ? "dark" : "default") : luminance < 0.35 ? "dark" : "default",
    background,
    foreground,
    accent,
  };
}
