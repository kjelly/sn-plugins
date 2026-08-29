/**
 * Validate whether a URL is safe to open as an external link.
 * Blocks dangerous schemes such as javascript:, vbscript:, and data:.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Block dangerous pseudo-protocols
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return false;
  }
  return true;
}

export type WindowOpener = (url: string, target?: string, features?: string) => Window | null;

/**
 * Safely open a URL in a new browser tab/window.
 */
export function openExternalLink(
  url: string,
  opener: WindowOpener = (u, t, f) => globalThis.open(u, t, f),
): boolean {
  if (!isSafeExternalUrl(url)) return false;
  const trimmed = url.trim();
  opener(trimmed, "_blank", "noopener,noreferrer");
  return true;
}
