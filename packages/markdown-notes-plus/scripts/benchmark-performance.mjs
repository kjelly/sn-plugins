import { analyzeMarkdown } from "../src/markdown/analysis.ts";
import { scanWritingNormalization } from "../src/markdown/writingNormalization.ts";
import { analyzeKanban } from "../src/kanban/KanbanModel.ts";
import { allPerfFixtures, PERF_FIXTURE_GENERATOR_VERSION } from "../tests/performance/perfFixtures.ts";

const SCHEMA_VERSION = 1;

function argument(name, fallback) {
  const index = Deno.args.indexOf(name);
  return index >= 0 && Deno.args[index + 1] ? Deno.args[index + 1] : fallback;
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
  for (let index = 0; index < warmups; index += 1) operation(index, true);
  const samples = [];
  for (let index = 0; index < runs; index += 1) samples.push(time(() => operation(index, false)));
  return summarize(samples);
}

async function commandOutput(command, args) {
  const output = await new Deno.Command(command, { args, stdout: "piped", stderr: "null" }).output();
  return output.success ? new TextDecoder().decode(output.stdout).trim() : "unknown";
}

async function environment() {
  let cpu = "unknown";
  try {
    const info = await Deno.readTextFile("/proc/cpuinfo");
    cpu = info.match(/^model name\s*:\s*(.+)$/m)?.[1] ?? cpu;
  } catch {
    // Non-Linux runners retain the explicit unknown value.
  }
  let governor = "unknown";
  try {
    governor = (await Deno.readTextFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")).trim();
  } catch {
    // Some VMs do not expose a CPU governor.
  }
  return {
    os: Deno.build.os,
    arch: Deno.build.arch,
    cpu,
    cpuGovernor: governor,
    deno: Deno.version.deno,
    v8: Deno.version.v8,
  };
}

async function bundleSizes() {
  const sizes = [];
  try {
    for await (const entry of Deno.readDir("dist/assets")) {
      if (!entry.isFile) continue;
      const stat = await Deno.stat(`dist/assets/${entry.name}`);
      sizes.push({ file: entry.name, rawBytes: stat.size });
    }
  } catch {
    return [];
  }
  return sizes.sort((left, right) => left.file.localeCompare(right.file));
}

const smoke = Deno.args.includes("--smoke");
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
    counts: fixture.counts,
    result: benchmark(() => analyzeMarkdown(fixture.markdown), warmups, runs),
  });

  if (fixture.id.startsWith("headings-dense")) {
    const analysis = analyzeMarkdown(fixture.markdown);
    metrics.push({
      fixture: fixture.id,
      phase: "kanban",
      counts: fixture.counts,
      result: benchmark(() => analyzeKanban(fixture.markdown, analysis), warmups, runs),
    });
  }

  if (fixture.id.startsWith("plain-") || fixture.id.startsWith("mixed-") || fixture.id.startsWith("fences-") || fixture.id === "source-only" || fixture.id === "crlf-normalizable") {
    metrics.push({
      fixture: fixture.id,
      phase: "writing_preflight_cold_text",
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
const report = {
  schemaVersion: SCHEMA_VERSION,
  generatorVersion: PERF_FIXTURE_GENERATOR_VERSION,
  kind: "microbenchmark",
  formal: !smoke,
  commit,
  createdAt: new Date().toISOString(),
  environment: await environment(),
  warmups,
  runs,
  metrics,
  bundle: await bundleSizes(),
  longTasks: [],
};

const output = argument("--output", `artifacts/performance/micro-${commit.slice(0, 12)}.json`);
await Deno.mkdir(output.slice(0, Math.max(0, output.lastIndexOf("/"))) || ".", { recursive: true });
await Deno.writeTextFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(output);
