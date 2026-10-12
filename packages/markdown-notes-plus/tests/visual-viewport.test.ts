import { test } from "bun:test";

import { computeViewportHeightCss } from "../src/app/viewportHeight.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`${String(actual)} !== ${String(expected)}`);
}

function assertUndefined(value: unknown): void {
  if (value !== undefined) throw new Error(`expected undefined, got ${String(value)}`);
}

test("computeViewportHeightCss returns no declaration for non-positive heights", () => {
  assertUndefined(computeViewportHeightCss(0));
  assertUndefined(computeViewportHeightCss(-1));
  assertUndefined(computeViewportHeightCss(Number.NaN));
});

test("computeViewportHeightCss preserves positive integer and fractional heights", () => {
  assertEquals(computeViewportHeightCss(844), "844px");
  assertEquals(computeViewportHeightCss(390.5), "390.5px");
});
