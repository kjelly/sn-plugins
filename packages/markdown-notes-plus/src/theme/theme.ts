export type ThemeMode = "system" | "light" | "dark" | "high-contrast";

export function installThemeBridge(onChange: () => void): () => void {
  const listener = () => onChange();

  // 1. Custom event from EditorKit bridge
  globalThis.addEventListener("sn-theme-change", listener);

  // 2. System dark mode changes
  const mql = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  mql?.addEventListener("change", listener);

  // 3. PostMessage listener for theme messages from Standard Notes host
  const messageListener = (event: MessageEvent) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data?.action === "themes" || data?.action === "themes-activated" || data?.action === "component-registered") {
        onChange();
      }
    } catch {
      // ignore
    }
  };
  globalThis.addEventListener("message", messageListener);

  // 4. MutationObserver on document.head and documentElement to detect when theme styles/classes change
  let observer: MutationObserver | undefined;
  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "attributes") {
          onChange();
          break;
        }
      }
    });
    if (document.head) {
      observer.observe(document.head, { childList: true, subtree: true });
    }
    if (document.documentElement) {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] });
    }
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] });
    }
  }

  return () => {
    globalThis.removeEventListener("sn-theme-change", listener);
    mql?.removeEventListener("change", listener);
    globalThis.removeEventListener("message", messageListener);
    observer?.disconnect();
  };
}
