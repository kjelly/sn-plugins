function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { filterSparseOutline } from "../src/outline/SparseOutline.ts";

const sampleHeadings = [
  { text: "Intro", level: 1 },
  { text: "Overview", level: 2 },
  { text: "Details", level: 3 },
  { text: "Architecture", level: 1 },
  { text: "Components", level: 2 },
  { text: "Summary", level: 2 },
];

Deno.test("SparseOutline - filters by maxLevel", () => {
  const max1 = filterSparseOutline(sampleHeadings, { maxLevel: 1 });
  assertEquals(max1.map((h) => h.text), ["Intro", "Architecture"]);

  const max2 = filterSparseOutline(sampleHeadings, { maxLevel: 2 });
  assertEquals(max2.map((h) => h.text), ["Intro", "Overview", "Architecture", "Components", "Summary"]);
});

Deno.test("SparseOutline - filters by search query", () => {
  const queryResult = filterSparseOutline(sampleHeadings, { query: "arch" });
  assertEquals(queryResult.map((h) => h.text), ["Architecture"]);

  const emptyQuery = filterSparseOutline(sampleHeadings, { query: "   " });
  assertEquals(emptyQuery.length, sampleHeadings.length);
});

Deno.test("SparseOutline - combines maxLevel and query", () => {
  const combined = filterSparseOutline(sampleHeadings, { maxLevel: 2, query: "summary" });
  assertEquals(combined.map((h) => h.text), ["Summary"]);

  const none = filterSparseOutline(sampleHeadings, { maxLevel: 1, query: "summary" });
  assertEquals(none.length, 0);
});
