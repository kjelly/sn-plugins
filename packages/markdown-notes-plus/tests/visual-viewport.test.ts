/// <reference lib="deno.ns" />

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

import { computeViewportHeightCss } from "../src/app/viewportHeight.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`${String(actual)} !== ${String(expected)}`);
}

function assertUndefined(value: unknown): void {
  if (value !== undefined) throw new Error(`expected undefined, got ${String(value)}`);
}

Deno.test("computeViewportHeightCss returns no declaration for non-positive heights", () => {
  assertUndefined(computeViewportHeightCss(0));
  assertUndefined(computeViewportHeightCss(-1));
  assertUndefined(computeViewportHeightCss(Number.NaN));
});

Deno.test("computeViewportHeightCss preserves positive integer and fractional heights", () => {
  assertEquals(computeViewportHeightCss(844), "844px");
  assertEquals(computeViewportHeightCss(390.5), "390.5px");
});
