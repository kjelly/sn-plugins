export type ThemeMode = "system" | "light" | "dark" | "high-contrast";

const projectionThemeListeners = new Set<() => void>();

export function subscribeProjectionThemeChanges(listener: () => void): () => void {
  projectionThemeListeners.add(listener);
  return () => projectionThemeListeners.delete(listener);
}

export function installThemeBridge(onChange: () => void): () => void {
  const waitingStylesheets = new Map<HTMLLinkElement, { href: string; settle: () => void }>();
  const settledStylesheets = new Map<HTMLLinkElement, string>();

  const notifyProjectionListeners = () => {
    const stylesheets = typeof document === "undefined"
      ? []
      : Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'));
    const activeStylesheets = new Set(stylesheets);
    for (const [link, waiting] of waitingStylesheets) {
      if (activeStylesheets.has(link)) continue;
      link.removeEventListener("load", waiting.settle);
      link.removeEventListener("error", waiting.settle);
      waitingStylesheets.delete(link);
      settledStylesheets.delete(link);
    }
    const pending = stylesheets.filter((link) => !link.sheet && settledStylesheets.get(link) !== link.href);

    if (pending.length === 0) {
      for (const projectionListener of projectionThemeListeners) projectionListener();
      return;
    }

    for (const link of pending) {
      const existing = waitingStylesheets.get(link);
      if (existing?.href === link.href) continue;
      if (existing) {
        link.removeEventListener("load", existing.settle);
        link.removeEventListener("error", existing.settle);
      }
      const href = link.href;
      const settle = () => {
        waitingStylesheets.delete(link);
        settledStylesheets.set(link, href);
        notifyProjectionListeners();
      };
      waitingStylesheets.set(link, { href, settle });
      link.addEventListener("load", settle, { once: true });
      link.addEventListener("error", settle, { once: true });
    }
  };

  const listener = () => {
    onChange();
    notifyProjectionListeners();
  };

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
        listener();
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
          listener();
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
    for (const [link, pending] of waitingStylesheets) {
      link.removeEventListener("load", pending.settle);
      link.removeEventListener("error", pending.settle);
    }
    waitingStylesheets.clear();
    settledStylesheets.clear();
  };
}
