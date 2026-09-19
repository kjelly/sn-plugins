import { PERF_MARKS, PERF_MEASURES } from "../../src/performance/PerfNames.ts";
import {
  beginDocumentPerfTraceForText,
  getPerfTraceSnapshot,
  markAndMeasurePerf,
  markPerf,
  setPerfTraceEnabledForTests,
} from "../../src/performance/PerfTrace.ts";
import {
  allPerfFixtures,
  complexityPerfFixtures,
  corePerfFixtures,
  PERF_FIXTURE_GENERATOR_VERSION,
} from "./perfFixtures.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function assertNotEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(actual)} === ${JSON.stringify(expected)}`);
  }
}

Deno.test("performance fixtures are deterministic and report exact core byte sizes", () => {
  const first = allPerfFixtures();
  const second = allPerfFixtures();
  assertEquals(first, second);
  assertEquals(PERF_FIXTURE_GENERATOR_VERSION, 1);

  const core = corePerfFixtures();
  assertEquals(core.map((fixture) => fixture.counts.bytes), [10 * 1024, 100 * 1024, 500 * 1024, 1024 * 1024]);
  for (const fixture of first) {
    assertEquals(fixture.generatorVersion, PERF_FIXTURE_GENERATOR_VERSION);
    assertEquals(new TextEncoder().encode(fixture.markdown).byteLength, fixture.counts.bytes);
    assertEquals(fixture.markdown.length, fixture.counts.utf16Length);
  }
});

Deno.test("complexity fixtures provide three monotonically growing scales", () => {
  const groups = new Map<string, number[]>();
  for (const fixture of complexityPerfFixtures()) {
    const family = fixture.id.replace(/(?:\d+x?|[\d_]+)$/, "");
    const values = groups.get(family) ?? [];
    values.push(fixture.counts.bytes);
    groups.set(family, values);
  }
  for (const values of groups.values()) {
    assertEquals(values.length, 3);
    assertEquals(values.every((value, index) => index === 0 || value > values[index - 1]), true);
  }
});

Deno.test("performance trace resets generations and measures matching marks without content", () => {
  setPerfTraceEnabledForTests(true);
  try {
    markPerf(PERF_MARKS.mountAppStart, {}, true);
    const firstGeneration = beginDocumentPerfTraceForText("# private heading\n");
    markAndMeasurePerf(
      PERF_MARKS.bootstrapPreviewRendered,
      PERF_MEASURES.contextToPreview,
      PERF_MARKS.contextReceived,
      {},
      true,
    );
    const first = getPerfTraceSnapshot();
    assertEquals(first.activeGeneration, firstGeneration);
    assertEquals(first.measures.length, 1);
    assertEquals(first.marks.some((mark) => mark.name === PERF_MARKS.mountAppStart), true);
    assertEquals(JSON.stringify(first).includes("private heading"), false);

    const secondGeneration = beginDocumentPerfTraceForText("second note");
    const second = getPerfTraceSnapshot();
    assertNotEquals(firstGeneration, secondGeneration);
    assertEquals(second.marks.length, 1);
    assertEquals(second.marks[0].name, PERF_MARKS.contextReceived);
    assertEquals(second.measures.length, 0);
  } finally {
    setPerfTraceEnabledForTests(false);
  }
});

Deno.test("performance trace records only-once lifecycle marks once per generation", () => {
  setPerfTraceEnabledForTests(true);
  try {
    beginDocumentPerfTraceForText("text");
    markPerf(PERF_MARKS.writingInteractive, {}, true);
    markPerf(PERF_MARKS.writingInteractive, {}, true);
    const snapshot = getPerfTraceSnapshot();
    assertEquals(snapshot.marks.filter((mark) => mark.name === PERF_MARKS.writingInteractive).length, 1);
  } finally {
    setPerfTraceEnabledForTests(false);
  }
});
