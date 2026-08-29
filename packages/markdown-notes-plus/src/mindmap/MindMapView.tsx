import { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { projectMindmapMarkdown } from "../markdown/analysis";

export type MindMapFilter = "all" | "open" | "hide";
export const MINDMAP_RENDER_DEBOUNCE_MS = 350;

export function mindMapMarkdown(markdown: string, filter: MindMapFilter): string {
  return projectMindmapMarkdown(markdown, filter);
}

export function MindMapView({
  markdown,
  readOnly = false,
  onToggleTask,
}: {
  markdown: string;
  readOnly?: boolean;
  onToggleTask?: (taskIndex: number, checked: boolean) => void;
}) {
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

  const enableCheckboxes = () => {
    if (!svg.current) return;
    const icons = svg.current.querySelectorAll<SVGElement | HTMLInputElement>('input[type="checkbox"], svg[viewBox="0 -3 24 24"]');
    icons.forEach((el) => {
      if (!readOnly) {
        if ("removeAttribute" in el) el.removeAttribute("disabled");
        el.style.cursor = "pointer";
        el.style.pointerEvents = "auto";
      } else {
        if ("setAttribute" in el) el.setAttribute("disabled", "true");
        el.style.cursor = "default";
      }
    });
  };

  useEffect(() => {
    const svgEl = svg.current;
    if (!svgEl) return undefined;

    const isTaskCheckbox = (el: Element | null) => {
      return el?.closest('input[type="checkbox"], svg[viewBox="0 -3 24 24"]');
    };

    const stopCheckboxFold = (event: MouseEvent) => {
      const target = event.target as Element;
      if (isTaskCheckbox(target)) {
        event.stopPropagation();
      }
    };

    const handleCheckboxClick = (event: MouseEvent) => {
      const target = event.target as Element;
      const taskIcon = isTaskCheckbox(target);
      if (taskIcon) {
        event.stopPropagation();
        event.preventDefault();
        if (readOnly) return;
        const allTaskIcons = Array.from(svgEl.querySelectorAll('input[type="checkbox"], svg[viewBox="0 -3 24 24"]'));
        const index = allTaskIcons.indexOf(taskIcon);
        if (index >= 0 && onToggleTask) {
          onToggleTask(index, true);
        }
      }
    };

    svgEl.addEventListener("mousedown", stopCheckboxFold, true);
    svgEl.addEventListener("click", handleCheckboxClick, true);

    return () => {
      svgEl.removeEventListener("mousedown", stopCheckboxFold, true);
      svgEl.removeEventListener("click", handleCheckboxClick, true);
    };
  }, [onToggleTask, readOnly]);

  useEffect(() => {
    let cancelled = false;
    const timer = globalThis.setTimeout(() => {
      try {
        const { root } = transformer.transform(markdown);
        map.current?.setData(root).then(() => {
          if (!cancelled) {
            enableCheckboxes();
            void map.current?.fit();
          }
        }).catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Mind Map render failed");
        });
        setError(undefined);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Mind Map transform failed");
      }
    }, MINDMAP_RENDER_DEBOUNCE_MS);
    return () => { cancelled = true; globalThis.clearTimeout(timer); };
  }, [markdown, transformer, readOnly]);

  return <div className="mindmap-wrap">{error ? <div className="error-box" role="alert">{error}</div> : null}<svg ref={svg} className="mindmap-svg" aria-label="Markdown mind map" /></div>;
}
