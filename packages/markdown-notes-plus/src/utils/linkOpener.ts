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

let lastOpenedUrl: string | undefined;
let lastOpenedTimestamp = 0;

/** Reset internal debounce state (useful for test isolation). */
export function resetLinkOpenerStateForTesting(): void {
  lastOpenedUrl = undefined;
  lastOpenedTimestamp = 0;
}

/**
 * Safely open a URL in a new browser tab/window.
 * Includes deduplication guard to prevent double-firing from bubbling/nested events.
 */
export function openExternalLink(
  url: string,
  opener: WindowOpener = (u, t, f) => globalThis.open(u, t, f),
  now: number = Date.now(),
): boolean {
  if (!isSafeExternalUrl(url)) return false;
  const trimmed = url.trim();

  // Deduplicate identical link opening within 250ms (prevents opening multiple tabs on single click)
  if (lastOpenedUrl === trimmed && now - lastOpenedTimestamp < 250) {
    return false;
  }

  lastOpenedUrl = trimmed;
  lastOpenedTimestamp = now;
  opener(trimmed, "_blank", "noopener,noreferrer");
  return true;
}
