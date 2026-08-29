function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { isSafeExternalUrl, openExternalLink } from "../src/utils/linkOpener.ts";

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
