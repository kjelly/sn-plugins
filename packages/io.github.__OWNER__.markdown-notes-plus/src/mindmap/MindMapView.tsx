import { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { projectMindmapMarkdown } from "../markdown/analysis";

export type MindMapFilter = "all" | "open" | "hide";
export const MINDMAP_RENDER_DEBOUNCE_MS = 350;

export function mindMapMarkdown(markdown: string, filter: MindMapFilter): string {
  return projectMindmapMarkdown(markdown, filter);
}

export function MindMapView({ markdown }: { markdown: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const map = useRef<Markmap>();
  const [error, setError] = useState<string>();
  const transformer = useRef(new Transformer()).current;

  useEffect(() => {
    if (!svg.current) return undefined;
    try {
      map.current = Markmap.create(svg.current, { duration: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180, pan: true, zoom: true });
      return () => { map.current?.destroy(); map.current = undefined; };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mind Map initialization failed");
      return undefined;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = globalThis.setTimeout(() => {
      try {
        const { root } = transformer.transform(markdown);
        map.current?.setData(root).then(() => { if (!cancelled) void map.current?.fit(); }).catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Mind Map render failed");
        });
        setError(undefined);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Mind Map transform failed");
      }
    }, MINDMAP_RENDER_DEBOUNCE_MS);
    return () => { cancelled = true; globalThis.clearTimeout(timer); };
  }, [markdown, transformer]);

  return <div className="mindmap-wrap">{error ? <div className="error-box" role="alert">{error}</div> : null}<svg ref={svg} className="mindmap-svg" aria-label="Markdown mind map" /></div>;
}
