import { useEffect, useRef, useState } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { projectMindmapMarkdown } from "../markdown/analysis";
import { openExternalLink } from "../utils/linkOpener";

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
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeName.toUpperCase() === "STYLE" && "setAttribute" in node) {
            (node as HTMLElement).setAttribute("nonce", "sn-editor-csp-nonce");
          }
        });
      }
    });
    observer.observe(svg.current, { childList: true, subtree: true });

    try {
      map.current = Markmap.create(svg.current, { duration: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180, pan: true, zoom: true });
      return () => {
        observer.disconnect();
        map.current?.destroy();
        map.current = undefined;
      };
    } catch (reason) {
      observer.disconnect();
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
        el.classList.add("task-icon-enabled");
        el.classList.remove("task-icon-disabled");
      } else {
        if ("setAttribute" in el) el.setAttribute("disabled", "true");
        el.classList.add("task-icon-disabled");
        el.classList.remove("task-icon-enabled");
      }
    });
  };

  useEffect(() => {
    const svgEl = svg.current;
    if (!svgEl) return undefined;

    const isTaskCheckbox = (el: Element | null) => {
      return el?.closest('input[type="checkbox"], svg[viewBox="0 -3 24 24"]');
    };

    const stopFold = (event: MouseEvent) => {
      const target = event.target as Element;
      if (isTaskCheckbox(target) || target.closest("a")) {
        event.stopPropagation();
      }
    };

    const handleSvgClick = (event: MouseEvent) => {
      const target = event.target as Element;
      const anchor = target.closest("a");
      if (anchor) {
        event.preventDefault();
        event.stopPropagation();
        const href = anchor.getAttribute("href");
        if (href) {
          openExternalLink(href);
        }
        return;
      }

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

    svgEl.addEventListener("mousedown", stopFold, true);
    svgEl.addEventListener("click", handleSvgClick, true);

    return () => {
      svgEl.removeEventListener("mousedown", stopFold, true);
      svgEl.removeEventListener("click", handleSvgClick, true);
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
