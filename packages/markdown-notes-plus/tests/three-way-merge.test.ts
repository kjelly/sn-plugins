function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { threeWayMerge } from "../src/document/ThreeWayMerge.ts";

Deno.test("ThreeWayMerge - identical documents", () => {
  const base = "# Title\n\nHello world\n";
  const result = threeWayMerge(base, base, base);
  assertEquals(result.success, true);
  assertEquals(result.text, base);
});

Deno.test("ThreeWayMerge - non-overlapping edits in different sections", () => {
  const base = "# Title\n\nSection 1\n\nSection 2\n";
  const local = "# Title\n\nSection 1 (local edit)\n\nSection 2\n";
  const remote = "# Title\n\nSection 1\n\nSection 2 (remote edit)\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "# Title\n\nSection 1 (local edit)\n\nSection 2 (remote edit)\n");
});

Deno.test("ThreeWayMerge - identical concurrent edits", () => {
  const base = "- [ ] Task 1\n- [ ] Task 2\n";
  const local = "- [x] Task 1\n- [ ] Task 2\n";
  const remote = "- [x] Task 1\n- [ ] Task 2\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "- [x] Task 1\n- [ ] Task 2\n");
});

Deno.test("ThreeWayMerge - independent additions at head and tail", () => {
  const base = "Middle content\n";
  const local = "Header note\n\nMiddle content\n";
  const remote = "Middle content\n\nFooter note\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "Header note\n\nMiddle content\n\nFooter note\n");
});

Deno.test("ThreeWayMerge - line deletion in one section and edit in another", () => {
  const base = "Line 1\nLine 2\nLine 3\nLine 4\n";
  const local = "Line 1\nLine 4\n"; // deleted Line 2 and Line 3
  const remote = "Line 1 (remote)\nLine 2\nLine 3\nLine 4\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "Line 1 (remote)\nLine 4\n");
});

Deno.test("ThreeWayMerge - multiple non-consecutive non-overlapping edits", () => {
  const base = "P1\nP2\nP3\nP4\nP5\n";
  const local = "P1 (loc)\nP2\nP3 (loc)\nP4\nP5\n";
  const remote = "P1\nP2 (rem)\nP3\nP4 (rem)\nP5\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "P1 (loc)\nP2 (rem)\nP3 (loc)\nP4 (rem)\nP5\n");
});

Deno.test("ThreeWayMerge - conflicting edit on the same line", () => {
  const base = "# Original Title\n\nContent";
  const local = "# Local Title\n\nContent";
  const remote = "# Remote Title\n\nContent";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, false);
  assertEquals(result.text, undefined);
  assertEquals(result.conflicts?.length, 1);
});
