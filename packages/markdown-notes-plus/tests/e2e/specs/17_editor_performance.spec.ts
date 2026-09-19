import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost";
import { EditorPage } from "../pages/EditorPage";
import { corePerfFixtures } from "../../performance/perfFixtures.ts";

type BrowserPerfTrace = {
  enabled: boolean;
  activeGeneration: number;
  marks: Array<{ name: string; startTime: number; generation: number }>;
  measures: Array<{ name: string; startTime: number; duration: number; generation: number }>;
};

test.skip(process.env.PERF_ENABLED !== "1", "Run performance benchmarks through mise run test:e2e:perf");

test.describe("editor performance contract", () => {
  test("records startup, long-task, and typing measurements without note content", async ({ page }, testInfo) => {
    test.setTimeout(60 * 60 * 1000);
    await page.addInitScript(() => {
      (globalThis as typeof globalThis & { __MARKDOWN_NOTES_PERF_ENABLED__?: boolean }).__MARKDOWN_NOTES_PERF_ENABLED__ = true;
      const target = globalThis as typeof globalThis & { __MARKDOWN_NOTES_LONG_TASKS__?: number[] };
      target.__MARKDOWN_NOTES_LONG_TASKS__ = [];
      if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) target.__MARKDOWN_NOTES_LONG_TASKS__?.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
    });

    const requestedRuns = Number(process.env.PERF_RUNS ?? "40");
    const smoke = process.env.PERF_SMOKE === "1";
    const runs = smoke ? Math.max(1, requestedRuns) : Math.max(40, requestedRuns);
    const typingCount = smoke ? 5 : 100;
    const requestedFixture = process.env.PERF_FIXTURE;
    const fixtures = corePerfFixtures().filter((fixture) => !requestedFixture || fixture.id === requestedFixture);
    expect(fixtures.length, `Unknown PERF_FIXTURE ${requestedFixture ?? ""}`).toBeGreaterThan(0);

    const samples: Array<{
      fixture: string;
      run: number;
      inputKind: "english" | "cjk";
      trace: BrowserPerfTrace;
      longTasks: number[];
      typingP95: number;
    }> = [];

    for (const fixture of fixtures) {
      for (let run = 0; run < runs; run += 1) {
        const host = new MockHost(page);
        const editor = new EditorPage(page);
        await host.goto(fixture.markdown, `perf-${fixture.id}-${run}`);
        await expect(editor.writingEditor).toBeEditable();
        await editor.writingEditor.click();
        const frame = page.frames().find((candidate) => candidate.url().includes("/index.html"));
        if (!frame) throw new Error("Editor frame is missing");
        const inputKind = run % 2 === 0 ? "english" : "cjk";
        const character = inputKind === "english" ? "a" : "界";
        for (let index = 0; index < typingCount; index += 1) {
          await page.keyboard.insertText(character);
          await frame.waitForFunction((expectedCount) => {
            const trace = (globalThis as typeof globalThis & { __MARKDOWN_NOTES_PERF_TRACE__?: BrowserPerfTrace })
              .__MARKDOWN_NOTES_PERF_TRACE__;
            return (trace?.measures.filter((measure) => measure.name === "transaction_to_canonical_ms").length ?? 0) >= expectedCount;
          }, index + 1);
        }
        const result = await frame.evaluate(() => {
          const target = globalThis as typeof globalThis & {
            __MARKDOWN_NOTES_PERF_TRACE__?: BrowserPerfTrace;
            __MARKDOWN_NOTES_LONG_TASKS__?: number[];
          };
          return {
            trace: target.__MARKDOWN_NOTES_PERF_TRACE__,
            longTasks: target.__MARKDOWN_NOTES_LONG_TASKS__ ?? [],
          };
        });
        if (!result.trace) throw new Error("Performance trace was not published");
        const typing = result.trace.measures
          .filter((measure) => measure.name === "transaction_to_canonical_ms")
          .map((measure) => measure.duration)
          .sort((left, right) => left - right);
        expect(
          typing.length,
          `Each run must record transaction-to-canonical latency; measures=${result.trace.measures.map((measure) => measure.name).join(",")}; marks=${result.trace.marks.map((mark) => mark.name).join(",")}`,
        ).toBeGreaterThan(0);
        const typingP95 = typing[Math.max(0, Math.ceil(typing.length * 0.95) - 1)] ?? 0;
        expect(typing.length).toBe(typingCount);
        samples.push({ fixture: fixture.id, run, inputKind, trace: result.trace, longTasks: result.longTasks, typingP95 });

        expect(result.trace.marks.some((mark) => mark.name === "context_received")).toBe(true);
        expect(result.trace.marks.some((mark) => mark.name === "writing_interactive")).toBe(true);
        expect(JSON.stringify(result.trace)).not.toContain(fixture.markdown.slice(0, 64));
      }
    }

    await testInfo.attach("editor-performance.json", {
      body: Buffer.from(JSON.stringify({ schemaVersion: 1, formal: !smoke, runs, typingCount, samples }, null, 2)),
      contentType: "application/json",
    });
  });
});
