import { mkdir, readdir } from "node:fs/promises";
import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import { scanWritingNormalization } from "../src/markdown/writingNormalization.ts";
import { analyzeKanban } from "../src/kanban/KanbanModel.ts";
import { allPerfFixtures, PERF_FIXTURE_GENERATOR_VERSION } from "../tests/performance/perfFixtures.ts";

const SCHEMA_VERSION = 7;
const MIN_SAMPLE_DURATION_MS = 100;
const cliArgs = process.argv.slice(2);

function argument(name, fallback) {
  const index = cliArgs.indexOf(name);
  return index >= 0 && cliArgs[index + 1] ? cliArgs[index + 1] : fallback;
}

function nearestRank(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function summarize(samples) {
  const center = median(samples);
  return {
    runs: samples.length,
    median: center,
    p95: nearestRank(samples, 0.95),
    mad: median(samples.map((sample) => Math.abs(sample - center))),
    samples,
  };
}

function time(operation) {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

function benchmark(operation, warmups, runs) {
  let invocation = 0;
  for (let index = 0; index < warmups; index += 1) operation(invocation++, true);
  let iterations = 1;
  while (iterations < 4096) {
    const duration = time(() => {
      for (let index = 0; index < iterations; index += 1) operation(invocation++, true);
    });
    if (duration >= MIN_SAMPLE_DURATION_MS) break;
    iterations *= 2;
  }
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const duration = time(() => {
      for (let index = 0; index < iterations; index += 1) operation(invocation++, false);
    });
    samples.push(duration / iterations);
  }
  return { ...summarize(samples), iterations };
}

async function commandOutput(command, args) {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "ignore" });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return code === 0 ? output.trim() : "unknown";
}

async function environment() {
  const warnings = [];
  let cpu = process.env.PERF_CPU_MODEL ?? "unknown";
  try {
    const info = await Bun.file("/proc/cpuinfo").text();
    cpu = info.match(/^model name\s*:\s*(.+)$/m)?.[1] ?? cpu;
  } catch (error) {
    warnings.push(`cpu:${error instanceof Error ? error.message : String(error)}`);
  }
  let governor = process.env.PERF_CPU_GOVERNOR ?? "unknown";
  try {
    governor = (await Bun.file("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor").text()).trim();
  } catch (error) {
    warnings.push(`cpuGovernor:${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    os: process.platform,
    arch: process.arch,
    cpu,
    cpuGovernor: governor,
    bun: Bun.version,
    javascriptCore: process.versions.webkit,
    warnings,
  };
}

async function bundleSizes() {
  const sizes = [];
  try {
    for (const entry of await readdir("dist/assets", { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = Bun.file(`dist/assets/${entry.name}`);
      const bytes = await file.bytes();
      const compressed = await new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer();
      sizes.push({ file: entry.name, rawBytes: file.size, gzipBytes: compressed.byteLength });
    }
  } catch {
    return [];
  }
  return sizes.sort((left, right) => left.file.localeCompare(right.file));
}

const smoke = cliArgs.includes("--smoke");
const requestedRuns = Number(argument("--runs", smoke ? "3" : "30"));
const runs = smoke ? Math.max(1, requestedRuns) : Math.max(30, requestedRuns);
const warmups = smoke ? 1 : 5;
const fixtureFilter = argument("--fixture", "");
const fixtures = allPerfFixtures().filter((fixture) => fixtureFilter === "" || fixture.id === fixtureFilter);
if (fixtures.length === 0) throw new Error(`Unknown performance fixture: ${fixtureFilter}`);

const metrics = [];
for (const fixture of fixtures) {
  metrics.push({
    fixture: fixture.id,
    phase: "analysis",
    primary: false,
    counts: fixture.counts,
    result: benchmark(() => analyzeMarkdown(fixture.markdown), warmups, runs),
  });

  if (fixture.id.startsWith("headings-dense")) {
    const analysis = analyzeMarkdown(fixture.markdown);
    metrics.push({
      fixture: fixture.id,
      phase: "kanban",
      primary: false,
      counts: fixture.counts,
      result: benchmark(() => analyzeKanban(fixture.markdown, analysis), warmups, runs),
    });
  }

  if (fixture.id.startsWith("plain-") || fixture.id.startsWith("mixed-") || fixture.id.startsWith("fences-") || fixture.id === "source-only" || fixture.id === "crlf-normalizable") {
    metrics.push({
      fixture: fixture.id,
      phase: "writing_preflight_cold_text",
      primary: false,
      counts: fixture.counts,
      result: benchmark(
        (index, warmup) => scanWritingNormalization(`${fixture.markdown}\nbench-${warmup ? "w" : "r"}-${index}`),
        warmups,
        runs,
      ),
    });
  }
}

const commit = await commandOutput("git", ["rev-parse", "HEAD"]);
const baselineSha = argument("--baseline", commit);
const report = {
  schemaVersion: SCHEMA_VERSION,
  generatorVersion: PERF_FIXTURE_GENERATOR_VERSION,
  kind: "microbenchmark",
  formal: !smoke,
  commit,
  baselineSha,
  headSha: commit,
  createdAt: new Date().toISOString(),
  environment: await environment(),
  warmups,
  runs,
  metrics,
  bundle: await bundleSizes(),
  longTasks: [],
  pathHitCounts: { fast: 0, bounded: 0, full: 0, available: false },
};

const output = argument("--output", `artifacts/performance/micro-${commit.slice(0, 12)}.json`);
await mkdir(output.slice(0, Math.max(0, output.lastIndexOf("/"))) || ".", { recursive: true });
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(output);
