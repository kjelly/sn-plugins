import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { MockHost } from "../pages/MockHost";
import { EditorPage } from "../pages/EditorPage";
import { corePerfFixtures, PERF_FIXTURE_GENERATOR_VERSION } from "../../performance/perfFixtures.ts";

type BrowserPerfTrace = {
  enabled: boolean;
  activeGeneration: number;
  marks: Array<{ name: string; startTime: number; generation: number; sequence?: number }>;
  measures: Array<{ name: string; startTime: number; duration: number; generation: number; sequence?: number }>;
};

type CacheMode = "cold" | "warm";
type InputKind = "english" | "cjk" | "syntax";
type Fixture = ReturnType<typeof corePerfFixtures>[number];
type Summary = { runs: number; median: number; p95: number; mad: number; samples: number[] };

type LoadSample = {
  fixture: string;
  cacheMode: CacheMode;
  run: number;
  phases: Record<string, number>;
  longTasks: number[];
};

type TypingSample = {
  fixture: string;
  inputKind: InputKind;
  run: number;
  requestedInputs: number;
  committedInputs: number;
  fallbackAt?: number;
  phases: Record<string, number[]>;
  longTasks: number[];
};

const STARTUP_MEASURES = [
  "context_to_preview_ms",
  "context_to_app_ms",
  "context_to_writing_interactive_ms",
  "analysis_ms",
  "writing_preflight_ms",
  "milkdown_create_ms",
  "roundtrip_proof_ms",
] as const;

const TYPING_MEASURES = [
  "input_to_canonical_ms",
  "transaction_to_markdown_ms",
  "mutation_proof_ms",
  "canonical_commit_ms",
  "transaction_to_canonical_ms",
  "projection_schedule_ms",
] as const;

const SYNTAX_SEQUENCE = "* _ # [ ] < >";

test.skip(process.env.PERF_ENABLED !== "1", "Run performance benchmarks through mise run test:e2e:perf");

function nearestRank(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function summarize(samples: number[]): Summary {
  const center = median(samples);
  return {
    runs: samples.length,
    median: center,
    p95: nearestRank(samples, 0.95),
    mad: median(samples.map((sample) => Math.abs(sample - center))),
    samples,
  };
}

function valuesFor(trace: BrowserPerfTrace, name: string): number[] {
  return trace.measures.filter((measure) => measure.name === name).map((measure) => measure.duration);
}

function validateLoadSample(sample: LoadSample, identity: string): void {
  for (const phase of STARTUP_MEASURES) {
    expect(Number.isFinite(sample.phases[phase]), `${identity} must contain ${phase}`).toBe(true);
    expect(sample.phases[phase], `${identity} ${phase} must not be negative`).toBeGreaterThanOrEqual(0);
  }
  expect(
    sample.phases.context_to_writing_interactive_ms,
    `${identity} must contain a positive context_to_writing_interactive_ms measure`,
  ).toBeGreaterThan(0);
}

function validateTypingSample(sample: TypingSample, typingCount: number, identity: string): void {
  expect(sample.requestedInputs, `${identity} requested input count`).toBe(typingCount);
  expect(sample.committedInputs, `${identity} committed input count`).toBe(typingCount);
  expect(sample.fallbackAt, `${identity} must not fall back before all inputs commit`).toBeUndefined();
  for (const phase of TYPING_MEASURES) {
    const values = sample.phases[phase];
    expect(Array.isArray(values), `${identity} must contain ${phase}`).toBe(true);
    expect(values, `${identity} ${phase} samples`).toHaveLength(typingCount);
    expect(values.every((value) => Number.isFinite(value) && value >= 0), `${identity} ${phase} samples must be finite`).toBe(true);
  }
}

function longTaskSummary(tasks: number[]): { count: number; max: number; totalBlockingTime: number } {
  return {
    count: tasks.filter((duration) => duration > 50).length,
    max: tasks.length === 0 ? 0 : Math.max(...tasks),
    totalBlockingTime: tasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0),
  };
}

function perfInitScript(): void {
  (globalThis as typeof globalThis & { __MARKDOWN_NOTES_PERF_ENABLED__?: boolean }).__MARKDOWN_NOTES_PERF_ENABLED__ = true;
  const target = globalThis as typeof globalThis & { __MARKDOWN_NOTES_LONG_TASKS__?: number[] };
  target.__MARKDOWN_NOTES_LONG_TASKS__ = [];
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) target.__MARKDOWN_NOTES_LONG_TASKS__?.push(entry.duration);
  });
  observer.observe({ type: "longtask", buffered: true });
}

async function disableHttpCache(context: BrowserContext, page: Page): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
}

async function openMeasuredPage(browser: Browser, fixture: Fixture, cacheMode: CacheMode, identity: string): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await browser.newContext();
  await context.addInitScript(perfInitScript);
  if (cacheMode === "warm") {
    const warmingPage = await context.newPage();
    await new MockHost(warmingPage).goto(fixture.markdown, `${identity}-cache-prime`);
    await warmingPage.close();
  }
  const page = await context.newPage();
  if (cacheMode === "cold") await disableHttpCache(context, page);
  return { context, page };
}

async function readTrace(page: Page): Promise<{ trace: BrowserPerfTrace; longTasks: number[] }> {
  const frame = page.frames().find((candidate) => candidate.url().includes("/index.html"));
  if (!frame) throw new Error("Editor frame is missing");
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
  return { trace: result.trace, longTasks: result.longTasks };
}

async function runLoadSample(browser: Browser, fixture: Fixture, cacheMode: CacheMode, run: number): Promise<LoadSample> {
  const { context, page } = await openMeasuredPage(browser, fixture, cacheMode, `load-${fixture.id}-${cacheMode}-${run}`);
  try {
    await new MockHost(page).goto(fixture.markdown, `load-${fixture.id}-${cacheMode}-${run}`);
    const { trace, longTasks } = await readTrace(page);
    const phases: Record<string, number> = {};
    for (const name of STARTUP_MEASURES) {
      const values = valuesFor(trace, name);
      expect(values.length, `${fixture.id}/${cacheMode}/${run} must record ${name}`).toBeGreaterThan(0);
      const value = values.at(-1);
      if (value === undefined) throw new Error(`${fixture.id}/${cacheMode}/${run} is missing ${name}`);
      phases[name] = value;
    }
    expect(trace.marks.some((mark) => mark.name === "context_received")).toBe(true);
    expect(trace.marks.some((mark) => mark.name === "writing_interactive")).toBe(true);
    expect(JSON.stringify(trace)).not.toContain(fixture.markdown.slice(0, 64));
    const sample = { fixture: fixture.id, cacheMode, run, phases, longTasks };
    validateLoadSample(sample, `${fixture.id}/${cacheMode}/${run}`);
    return sample;
  } finally {
    await context.close();
  }
}

function inputCharacter(kind: InputKind, index: number): string {
  if (kind === "english") return "a";
  if (kind === "cjk") return "界";
  return SYNTAX_SEQUENCE[index % SYNTAX_SEQUENCE.length];
}

async function runTypingSample(
  browser: Browser,
  fixture: Fixture,
  inputKind: InputKind,
  run: number,
  typingCount: number,
): Promise<TypingSample> {
  const { context, page } = await openMeasuredPage(browser, fixture, "warm", `typing-${fixture.id}-${inputKind}-${run}`);
  try {
    const host = new MockHost(page);
    const editor = new EditorPage(page);
    await host.goto(fixture.markdown, `typing-${fixture.id}-${inputKind}-${run}`);
    await expect(editor.writingEditor).toBeEditable();
    await editor.placeWritingCaretAtEnd();
    const frame = page.frames().find((candidate) => candidate.url().includes("/index.html"));
    if (!frame) throw new Error("Editor frame is missing");
    let committedInputs = 0;
    let fallbackAt: number | undefined;
    for (let index = 0; index < typingCount; index += 1) {
      await page.keyboard.insertText(inputCharacter(inputKind, index));
      const outcome = await frame.waitForFunction((expectedCount) => {
        const trace = (globalThis as typeof globalThis & { __MARKDOWN_NOTES_PERF_TRACE__?: BrowserPerfTrace })
          .__MARKDOWN_NOTES_PERF_TRACE__;
        const commits = trace?.measures.filter((measure) => measure.name === "transaction_to_canonical_ms").length ?? 0;
        const editable = document.querySelector('.milkdown .editor[contenteditable="true"]') !== null;
        return commits >= expectedCount ? "committed" : editable ? false : "fallback";
      }, committedInputs + 1).then((handle) => handle.jsonValue());
      if (outcome === "fallback") {
        fallbackAt = index;
        break;
      }
      committedInputs += 1;
    }
    const { trace, longTasks } = await readTrace(page);
    const phases = Object.fromEntries(TYPING_MEASURES.map((name) => [name, valuesFor(trace, name)]));
    for (const name of TYPING_MEASURES) {
      const sequences = trace.measures
        .filter((measure) => measure.name === name)
        .map((measure) => measure.sequence);
      expect(sequences, `${fixture.id}/${inputKind}/${run} ${name} sequence count`).toHaveLength(typingCount);
      expect(sequences.every((sequence) => sequence !== undefined), `${name} requires explicit sequences`).toBe(true);
      expect(new Set(sequences).size, `${name} sequences must be unique`).toBe(sequences.length);
    }
    expect(JSON.stringify(trace)).not.toContain(fixture.markdown.slice(0, 64));
    const sample = { fixture: fixture.id, inputKind, run, requestedInputs: typingCount, committedInputs, ...(fallbackAt === undefined ? {} : { fallbackAt }), phases, longTasks };
    validateTypingSample(sample, typingCount, `${fixture.id}/${inputKind}/${run}`);
    return sample;
  } finally {
    await context.close();
  }
}

async function environment(browser: Browser): Promise<Record<string, string>> {
  let cpuGovernor = "unknown";
  try {
    cpuGovernor = (await readFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor", "utf8")).trim();
  } catch {
    // Some VMs do not expose a CPU governor.
  }
  return {
    os: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
    cpuGovernor,
    deno: "n/a",
    v8: process.versions.v8,
    browser: "chromium",
    browserVersion: browser.version(),
  };
}

async function bundleSizes(): Promise<Array<{ file: string; rawBytes: number; gzipBytes: number }>> {
  const assetDirectory = join(process.cwd(), "dist", "assets");
  const entries = await readdir(assetDirectory);
  const sizes = [];
  for (const file of entries.sort()) {
    const path = join(assetDirectory, file);
    if (!(await stat(path)).isFile()) continue;
    const bytes = await readFile(path);
    sizes.push({ file, rawBytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength });
  }
  return sizes;
}

function buildMetrics(loadSamples: LoadSample[], typingSamples: TypingSample[]) {
  const metrics = [];
  const loadGroups = new Map<string, LoadSample[]>();
  for (const sample of loadSamples) {
    const key = `${sample.fixture}:${sample.cacheMode}`;
    loadGroups.set(key, [...(loadGroups.get(key) ?? []), sample]);
  }
  for (const [key, group] of loadGroups) {
    const [fixture, cacheMode] = key.split(":");
    for (const phase of STARTUP_MEASURES) {
      metrics.push({
        fixture,
        phase: `${cacheMode}:${phase}`,
        primary: phase === "context_to_writing_interactive_ms",
        result: summarize(group.map((sample) => sample.phases[phase])),
      });
    }
    for (const field of ["count", "max", "totalBlockingTime"] as const) {
      metrics.push({
        fixture,
        phase: `${cacheMode}:long_tasks_${field}`,
        primary: false,
        result: summarize(group.map((sample) => longTaskSummary(sample.longTasks)[field])),
      });
    }
  }

  const typingGroups = new Map<string, TypingSample[]>();
  for (const sample of typingSamples) {
    const key = `${sample.fixture}:${sample.inputKind}`;
    typingGroups.set(key, [...(typingGroups.get(key) ?? []), sample]);
  }
  for (const [key, group] of typingGroups) {
    const [fixture, inputKind] = key.split(":");
    for (const phase of TYPING_MEASURES) {
      const runP50 = group.map((sample) => median(sample.phases[phase]));
      const runP95 = group.map((sample) => nearestRank(sample.phases[phase], 0.95));
      metrics.push({ fixture, phase: `typing:${inputKind}:${phase}:run_p50`, primary: false, result: summarize(runP50) });
      metrics.push({ fixture, phase: `typing:${inputKind}:${phase}:run_p95`, primary: false, result: summarize(runP95) });
      if (phase === "input_to_canonical_ms" && inputKind !== "syntax") {
        metrics.push({
          fixture,
          phase: `typing:${inputKind}:typing_p95_ms`,
          primary: true,
          result: summarize(runP95),
        });
      }
    }
  }
  return metrics;
}

test.describe("editor performance contract", () => {
  test("records reproducible startup, long-task, and typing baselines without note content", async ({ browser }, testInfo) => {
    test.setTimeout(24 * 60 * 60 * 1000);
    const smoke = process.env.PERF_SMOKE === "1";
    const loadRunsRequested = Number(process.env.PERF_LOAD_RUNS ?? process.env.PERF_RUNS ?? (smoke ? "1" : "40"));
    const typingRunsRequested = Number(process.env.PERF_TYPING_RUNS ?? process.env.PERF_RUNS ?? (smoke ? "1" : "20"));
    const loadRuns = smoke ? Math.max(1, loadRunsRequested) : Math.max(40, loadRunsRequested);
    const typingRuns = smoke ? Math.max(1, typingRunsRequested) : Math.max(20, typingRunsRequested);
    const typingCount = smoke ? Number(process.env.PERF_TYPING_COUNT ?? "5") : 100;
    const warmups = smoke ? 0 : Math.max(3, Number(process.env.PERF_WARMUPS ?? "3"));
    const requestedFixture = process.env.PERF_FIXTURE;
    const requestedPhase = process.env.PERF_PHASE ?? "all";
    const requestedCacheMode = process.env.PERF_CACHE_MODE;
    const requestedInputKind = process.env.PERF_INPUT_KIND;
    const fixtures = corePerfFixtures().filter((fixture) => !requestedFixture || fixture.id === requestedFixture);
    const cacheModes = (["cold", "warm"] as CacheMode[]).filter((mode) => !requestedCacheMode || mode === requestedCacheMode);
    const inputKinds = (["english", "cjk", "syntax"] as InputKind[]).filter((kind) => !requestedInputKind || kind === requestedInputKind);
    expect(["all", "load", "typing"], `Unknown PERF_PHASE ${requestedPhase}`).toContain(requestedPhase);
    expect(fixtures.length, `Unknown PERF_FIXTURE ${requestedFixture ?? ""}`).toBeGreaterThan(0);
    expect(cacheModes.length, `Unknown PERF_CACHE_MODE ${requestedCacheMode ?? ""}`).toBeGreaterThan(0);
    expect(inputKinds.length, `Unknown PERF_INPUT_KIND ${requestedInputKind ?? ""}`).toBeGreaterThan(0);

    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const baselineSha = process.env.PERF_BASELINE_SHA ?? commit;
    const output = process.env.PERF_OUTPUT ?? `artifacts/performance/browser-${commit.slice(0, 12)}.json`;
    const reportEnvironment = await environment(browser);
    const browserIdentity = { name: "chromium", version: browser.version() };
    const fixtureIdentity = fixtures.map((fixture) => ({ id: fixture.id, counts: fixture.counts }));
    const bundle = await bundleSizes();
    let loadSamples: LoadSample[] = [];
    let typingSamples: TypingSample[] = [];

    if (process.env.PERF_RESUME === "1") {
      const previous = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
      expect(previous.schemaVersion, "Resume schema must match").toBe(2);
      expect(previous.commit, "Resume commit must match").toBe(commit);
      expect(previous.baselineSha, "Resume baseline SHA must match").toBe(baselineSha);
      expect(previous.formal, "Resume mode must match").toBe(!smoke);
      expect(previous.environment, "Resume environment must match").toEqual(reportEnvironment);
      expect(previous.browser, "Resume browser must match").toEqual(browserIdentity);
      expect(previous.fixtures, "Resume fixtures must match").toEqual(fixtureIdentity);
      expect(previous.cacheModes, "Resume cache modes must match").toEqual(cacheModes);
      expect(previous.inputKinds, "Resume input kinds must match").toEqual(inputKinds);
      expect(previous.requestedPhase, "Resume phase must match").toBe(requestedPhase);
      expect(previous.warmups, "Resume warmups must match").toBe(warmups);
      expect(previous.loadRuns, "Resume load runs must match").toBe(loadRuns);
      expect(previous.typingRuns, "Resume typing runs must match").toBe(typingRuns);
      expect(previous.typingCount, "Resume typing count must match").toBe(typingCount);
      loadSamples = previous.loadSamples as LoadSample[];
      typingSamples = previous.typingSamples as TypingSample[];
      for (const sample of loadSamples) validateLoadSample(sample, `resume/${sample.fixture}/${sample.cacheMode}/${sample.run}`);
      for (const sample of typingSamples) validateTypingSample(sample, typingCount, `resume/${sample.fixture}/${sample.inputKind}/${sample.run}`);
    }

    const writeReport = async (complete: boolean): Promise<void> => {
      const metrics = buildMetrics(loadSamples, typingSamples);
      const fullProofCount = typingSamples.reduce((total, sample) => total + sample.phases.mutation_proof_ms.length, 0);
      const report = {
        schemaVersion: 2,
        generatorVersion: PERF_FIXTURE_GENERATOR_VERSION,
        kind: "browser-benchmark",
        formal: !smoke,
        complete,
        commit,
        baselineSha,
        headSha: commit,
        createdAt: new Date().toISOString(),
        environment: reportEnvironment,
        browser: browserIdentity,
        requestedPhase,
        cacheModes,
        inputKinds,
        warmups,
        loadRuns,
        typingRuns,
        typingCount,
        fixtures: fixtureIdentity,
        metrics,
        bundle,
        longTasks: loadSamples.map((sample) => ({ fixture: sample.fixture, cacheMode: sample.cacheMode, run: sample.run, ...longTaskSummary(sample.longTasks), samples: sample.longTasks })),
        pathHitCounts: { fast: 0, bounded: 0, full: fullProofCount, available: true },
        loadSamples,
        typingSamples,
      };
      await mkdir(dirname(output), { recursive: true });
      const temporaryOutput = `${output}.tmp-${process.pid}`;
      await writeFile(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`);
      await rename(temporaryOutput, output);
    };

    if (requestedPhase === "all" || requestedPhase === "load") {
      for (const fixture of fixtures) {
        for (const cacheMode of cacheModes) {
          const existing = loadSamples.filter((sample) => sample.fixture === fixture.id && sample.cacheMode === cacheMode);
          expect([0, loadRuns], `Checkpoint for ${fixture.id}/${cacheMode} must contain a complete group`).toContain(existing.length);
          if (existing.length === loadRuns) {
            console.log(`[perf] resumed load fixture=${fixture.id} cache=${cacheMode} samples=${loadRuns}`);
            continue;
          }
          for (let warmup = 0; warmup < warmups; warmup += 1) await runLoadSample(browser, fixture, cacheMode, -warmup - 1);
          for (let run = 0; run < loadRuns; run += 1) loadSamples.push(await runLoadSample(browser, fixture, cacheMode, run));
          await writeReport(false);
          console.log(`[perf] completed load fixture=${fixture.id} cache=${cacheMode} samples=${loadRuns}`);
        }
      }
    }
    if (requestedPhase === "all" || requestedPhase === "typing") {
      for (const fixture of fixtures) {
        for (const inputKind of inputKinds) {
          const existing = typingSamples.filter((sample) => sample.fixture === fixture.id && sample.inputKind === inputKind);
          expect([0, typingRuns], `Checkpoint for ${fixture.id}/${inputKind} must contain a complete group`).toContain(existing.length);
          if (existing.length === typingRuns) {
            console.log(`[perf] resumed typing fixture=${fixture.id} input=${inputKind} samples=${typingRuns}`);
            continue;
          }
          for (let warmup = 0; warmup < warmups; warmup += 1) {
            await runTypingSample(browser, fixture, inputKind, -warmup - 1, typingCount);
          }
          for (let run = 0; run < typingRuns; run += 1) {
            typingSamples.push(await runTypingSample(browser, fixture, inputKind, run, typingCount));
          }
          await writeReport(false);
          console.log(`[perf] completed typing fixture=${fixture.id} input=${inputKind} samples=${typingRuns}`);
        }
      }
    }

    await writeReport(true);
    await testInfo.attach("editor-performance.json", {
      path: output,
      contentType: "application/json",
    });
  });
});
