function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { isSafeExternalUrl, openExternalLink, resetLinkOpenerStateForTesting } from "../src/utils/linkOpener.ts";

Deno.test("linkOpener - isSafeExternalUrl validates safe and unsafe protocols", () => {
  assertEquals(isSafeExternalUrl("https://example.com"), true);
  assertEquals(isSafeExternalUrl("http://example.com"), true);
  assertEquals(isSafeExternalUrl("mailto:test@example.com"), true);
  assertEquals(isSafeExternalUrl("sn://app"), true);
  assertEquals(isSafeExternalUrl("#section-anchor"), true);
  assertEquals(isSafeExternalUrl("/relative/path"), true);

  assertEquals(isSafeExternalUrl("javascript:alert(1)"), false);
  assertEquals(isSafeExternalUrl("JAVASCRIPT:alert(1)"), false);
  assertEquals(isSafeExternalUrl("vbscript:msgbox(1)"), false);
  assertEquals(isSafeExternalUrl("data:text/html,<script>alert(1)</script>"), false);
  assertEquals(isSafeExternalUrl(""), false);
  assertEquals(isSafeExternalUrl("   "), false);
});

Deno.test("linkOpener - openExternalLink opens safe urls with _blank and noopener,noreferrer", () => {
  resetLinkOpenerStateForTesting();
  let openedUrl = "";
  let openedTarget = "";
  let openedFeatures = "";

  const mockOpener = (url: string, target?: string, features?: string) => {
    openedUrl = url;
    openedTarget = target ?? "";
    openedFeatures = features ?? "";
    return null;
  };

  const resultSafe = openExternalLink("https://standardnotes.com", mockOpener);
  assertEquals(resultSafe, true);
  assertEquals(openedUrl, "https://standardnotes.com");
  assertEquals(openedTarget, "_blank");
  assertEquals(openedFeatures, "noopener,noreferrer");

  const resultUnsafe = openExternalLink("javascript:alert(1)", mockOpener);
  assertEquals(resultUnsafe, false);
});

Deno.test("linkOpener - deduplicates rapid link opening to prevent duplicate tabs", () => {
  resetLinkOpenerStateForTesting();
  const openedCalls: string[] = [];
  const mockOpener = (url: string) => {
    openedCalls.push(url);
    return null;
  };

  // First call opens link
  const first = openExternalLink("https://example.com", mockOpener, 1000);
  assertEquals(first, true);
  assertEquals(openedCalls.length, 1);

  // Second rapid call for same url within 250ms is suppressed
  const duplicate = openExternalLink("https://example.com", mockOpener, 1050);
  assertEquals(duplicate, false);
  assertEquals(openedCalls.length, 1);

  // Third call for different url is allowed
  const different = openExternalLink("https://other.com", mockOpener, 1100);
  assertEquals(different, true);
  assertEquals(openedCalls.length, 2);

  // Fourth call after debounce window expires (e.g. 600ms later) is allowed
  const later = openExternalLink("https://example.com", mockOpener, 1600);
  assertEquals(later, true);
  assertEquals(openedCalls.length, 3);
});
