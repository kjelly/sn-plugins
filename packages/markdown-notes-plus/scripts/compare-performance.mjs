const SCHEMA_VERSION = 2;

function argument(name) {
  return argumentsFor(name)[0];
}

function argumentsFor(name) {
  const values = [];
  for (let index = 0; index < Deno.args.length; index += 1) {
    if (Deno.args[index] === name && Deno.args[index + 1]) values.push(Deno.args[index + 1]);
  }
  return values;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function run(command, args, cwd, stdout = "inherit") {
  const child = new Deno.Command(command, { args, cwd, stdout, stderr: "inherit" });
  if (stdout === "piped") {
    const result = await child.output();
    if (!result.success) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.code}`);
    return new TextDecoder().decode(result.stdout).trim();
  }
  const status = await child.spawn().status;
  if (!status.success) throw new Error(`${command} ${args.join(" ")} failed with exit code ${status.code}`);
  return "";
}

async function readReport(path) {
  const report = JSON.parse(await Deno.readTextFile(path));
  if (report.schemaVersion !== SCHEMA_VERSION || report.generatorVersion !== 1) {
    throw new Error(`Incompatible performance report schema: ${path}`);
  }
  return report;
}

function validateEnvironment(base, head) {
  for (const key of ["os", "arch", "cpu", "cpuGovernor", "deno", "v8", "browser", "browserVersion"]) {
    if (base.environment[key] !== head.environment[key]) {
      throw new Error(`Environment mismatch for ${key}: ${base.environment[key]} != ${head.environment[key]}`);
    }
  }
}

function aggregate(reports) {
  const metrics = new Map();
  let expectedKeys;
  for (const report of reports) {
    const reportKeys = report.metrics.map((metric) => `${metric.fixture}:${metric.phase}`).sort();
    if (new Set(reportKeys).size !== reportKeys.length) throw new Error("A performance report contains duplicate metrics");
    if (expectedKeys && JSON.stringify(reportKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error("Performance batches do not contain the same metric set");
    }
    expectedKeys = reportKeys;
    for (const metric of report.metrics) {
      const key = `${metric.fixture}:${metric.phase}`;
      const entry = metrics.get(key) ?? { fixture: metric.fixture, phase: metric.phase, primary: metric.primary === true, medians: [], p95s: [], madRatios: [] };
      if (entry.primary !== (metric.primary === true)) throw new Error(`Performance batches disagree on primary metric ${key}`);
      entry.medians.push(metric.result.median);
      entry.p95s.push(metric.result.p95);
      entry.madRatios.push(metric.result.median === 0
        ? (metric.result.mad === 0 ? 0 : null)
        : (metric.result.mad / metric.result.median) * 100);
      metrics.set(key, entry);
    }
  }
  return new Map([...metrics].map(([key, value]) => {
    const center = median(value.medians);
    const allBatchMediansZero = value.medians.every((sample) => sample === 0);
    const variation = value.medians.length < 2 || allBatchMediansZero
      ? 0
      : center === 0 ? null : ((Math.max(...value.medians) - Math.min(...value.medians)) / center) * 100;
    return [key, {
      fixture: value.fixture,
      phase: value.phase,
      primary: value.primary,
      median: center,
      p95: median(value.p95s),
      batchMedians: value.medians,
      batchP95s: value.p95s,
      madRatios: value.madRatios,
      interBatchMedianVariationPercent: variation,
      stable: value.madRatios.every((ratio) => ratio !== null && ratio <= 5) && variation !== null && variation <= 5,
    }];
  }));
}

function compare(baseReports, headReports) {
  for (const base of baseReports) for (const head of headReports) validateEnvironment(base, head);
  const base = aggregate(baseReports);
  const head = aggregate(headReports);
  const metrics = [];
  for (const [key, baseMetric] of base) {
    const headMetric = head.get(key);
    if (!headMetric) throw new Error(`Head report is missing metric ${key}`);
    metrics.push({
      fixture: baseMetric.fixture,
      phase: baseMetric.phase,
      base: baseMetric,
      head: headMetric,
      medianDeltaPercent: baseMetric.median === 0 ? 0 : ((headMetric.median / baseMetric.median) - 1) * 100,
      p95DeltaPercent: baseMetric.p95 === 0 ? 0 : ((headMetric.p95 / baseMetric.p95) - 1) * 100,
      stable: baseMetric.stable && headMetric.stable,
      primary: baseMetric.primary || headMetric.primary,
    });
  }
  return metrics;
}

async function benchmarkSha(repositoryRoot, temporaryRoot, sha, label, batch) {
  const worktree = `${temporaryRoot}/${label}`;
  if (batch === 0) {
    await run("git", ["worktree", "add", "--detach", worktree, sha], repositoryRoot);
    await run("mise", ["install"], worktree);
    await run("mise", ["run", "deps"], worktree);
    await run("mise", ["run", "build"], worktree);
  }
  const output = `${temporaryRoot}/${label}-${batch}.json`;
  await run("mise", ["run", "bench:perf", "--", "--output", output], worktree);
  return output;
}

const baseReportPaths = argumentsFor("--base-report");
const headReportPaths = argumentsFor("--head-report");
let baseReports;
let headReports;
let baseIdentity;
let headIdentity;
let cleanup;

if (baseReportPaths.length > 0 || headReportPaths.length > 0) {
  if (baseReportPaths.length === 0 || headReportPaths.length === 0) {
    throw new Error("At least one --base-report and --head-report are required");
  }
  baseReports = await Promise.all(baseReportPaths.map(readReport));
  headReports = await Promise.all(headReportPaths.map(readReport));
  baseIdentity = baseReports[0].commit;
  headIdentity = headReports[0].commit;
} else {
  const base = argument("--base");
  const head = argument("--head");
  if (!base || !head) throw new Error("Use --base <sha> --head <sha> or --base-report <file> --head-report <file>");
  const repositoryRoot = await run("git", ["rev-parse", "--show-toplevel"], Deno.cwd(), "piped");
  const spec = await Deno.readTextFile(`${repositoryRoot}/spec.md`);
  if (spec.includes("PENDING_PHASE_0_HARNESS_SHA")) {
    throw new Error("spec.md still contains PENDING_PHASE_0_HARNESS_SHA; create and record the harness-only baseline commit first");
  }
  const temporaryRoot = await Deno.makeTempDir({ prefix: "markdown-notes-perf-" });
  cleanup = async () => {
    for (const label of ["base", "head"]) {
      try {
        await run("git", ["worktree", "remove", "--force", `${temporaryRoot}/${label}`], repositoryRoot, "null");
      } catch {
        // Continue cleanup if a worktree was never created or already removed.
      }
    }
    try {
      await Deno.remove(temporaryRoot, { recursive: true });
    } catch {
      // Reports are copied before cleanup; a failed temp cleanup is non-fatal.
    }
  };
  try {
    const order = [
      ["base", base, 0],
      ["head", head, 0],
      ["head", head, 1],
      ["base", base, 1],
    ];
    const paths = { base: [], head: [] };
    for (const [label, sha, batch] of order) paths[label].push(await benchmarkSha(repositoryRoot, temporaryRoot, sha, label, batch));
    baseReports = await Promise.all(paths.base.map(readReport));
    headReports = await Promise.all(paths.head.map(readReport));
    const artifactDirectory = argument("--artifact-dir") ?? `${repositoryRoot}/packages/markdown-notes-plus/artifacts/performance`;
    await Deno.mkdir(artifactDirectory, { recursive: true });
    for (const label of ["base", "head"]) {
      for (let index = 0; index < paths[label].length; index += 1) {
        await Deno.copyFile(paths[label][index], `${artifactDirectory}/${label}-${String(label === "base" ? base : head).slice(0, 12)}-batch-${index + 1}.json`);
      }
    }
    baseIdentity = base;
    headIdentity = head;
  } finally {
    await cleanup();
  }
}

const metrics = compare(baseReports, headReports);
const primaryMetrics = metrics.filter((metric) => metric.primary);
const report = {
  schemaVersion: SCHEMA_VERSION,
  kind: "performance-comparison",
  createdAt: new Date().toISOString(),
  base: baseIdentity,
  head: headIdentity,
  stable: (primaryMetrics.length > 0 ? primaryMetrics : metrics).every((metric) => metric.stable),
  diagnosticStable: metrics.every((metric) => metric.stable),
  metrics,
};
const output = argument("--output") ?? `artifacts/performance/compare-${String(baseIdentity).slice(0, 12)}-${String(headIdentity).slice(0, 12)}.json`;
await Deno.mkdir(output.slice(0, Math.max(0, output.lastIndexOf("/"))) || ".", { recursive: true });
await Deno.writeTextFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(output);
