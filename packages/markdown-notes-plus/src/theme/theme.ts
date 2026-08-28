export type ThemeMode = "system" | "light" | "dark" | "high-contrast";

export function installThemeBridge(onChange: () => void): () => void {
  const listener = () => onChange();
  globalThis.addEventListener("sn-theme-change", listener);
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", listener);
  return () => {
    globalThis.removeEventListener("sn-theme-change", listener);
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").removeEventListener("change", listener);
  };
}
