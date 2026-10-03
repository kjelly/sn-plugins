const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "sn:", "file:", "tel:", "ftp:"]);
const RELATIVE_LINK_BASE = "https://editor.invalid/";

/** Validate the protocol after browser-style URL parsing, including control characters. */
export function isSafeExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(trimmed, RELATIVE_LINK_BASE).protocol);
  } catch {
    return false;
  }
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
 * Opens links from the embedding application's top-level window when possible.
 *
 * Standard Notes runs editors in a sandboxed iframe. A popup opened by that
 * iframe inherits the sandbox flags, which makes sites that disallow framed
 * content (such as ChatGPT) reject the new tab. Calling `top.open` keeps the
 * navigation in the host browsing context, so the popup is not sandboxed.
 */
function openFromHostWindow(url: string, target?: string, features?: string): Window | null {
  try {
    const hostWindow = globalThis.top;
    if (hostWindow && hostWindow !== (globalThis as unknown as Window)) {
      return hostWindow.open(url, target, features);
    }
  } catch {
    // Access to a host window can be restricted by an embedding environment.
    // Fall back to the editor frame's opener in that case.
  }

  return globalThis.open(url, target, features);
}

/**
 * Safely open a URL in a new browser tab/window.
 * Includes deduplication guard to prevent double-firing from bubbling/nested events.
 */
export function openExternalLink(
  url: string,
  opener: WindowOpener = openFromHostWindow,
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
