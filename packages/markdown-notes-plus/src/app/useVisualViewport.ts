import { useEffect } from "react";
import { computeViewportHeightCss } from "./viewportHeight.ts";

export { computeViewportHeightCss } from "./viewportHeight.ts";

export function useVisualViewport(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const root = document.documentElement;
    const publish = () => {
      const height = computeViewportHeightCss(viewport.height);
      if (height) root.style.setProperty("--vvh", height);
      else root.style.removeProperty("--vvh");
    };

    publish();
    viewport.addEventListener("resize", publish);
    viewport.addEventListener("scroll", publish);
    return () => {
      viewport.removeEventListener("resize", publish);
      viewport.removeEventListener("scroll", publish);
      root.style.removeProperty("--vvh");
    };
  }, []);
}
