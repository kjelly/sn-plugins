import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../helpers/process.ts";

test("Bun benchmark reports can be compared and reject a different runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "markdown-notes-bun-benchmark-"));
  try {
    const basePath = join(directory, "base.json");
    const headPath = join(directory, "head.json");
    const output = join(directory, "comparison.json");
    const benchmark = await runCommand(process.execPath, {
      args: ["scripts/benchmark-performance.mjs", "--smoke", "--fixture", "plain-10k", "--runs", "1", "--output", basePath],
    });
    expect(new TextDecoder().decode(benchmark.stderr)).toBe("");
    expect(benchmark.code).toBe(0);
    const report = await Bun.file(basePath).json();
    expect(report.environment.bun).toBe(Bun.version);
    expect(report.environment.javascriptCore).toBe(process.versions.webkit);
    expect(report.metrics.length).toBeGreaterThan(0);
    await Bun.write(headPath, JSON.stringify(report));

    const args = ["scripts/compare-performance.mjs", "--base-report", basePath, "--head-report", headPath, "--output", output];
    const comparison = await runCommand(process.execPath, { args });
    expect(comparison.code).toBe(0);
    expect((await Bun.file(output).json()).metrics.every((metric: { medianDeltaPercent: number }) => metric.medianDeltaPercent === 0)).toBe(true);

    report.environment.bun = "different-version";
    await Bun.write(headPath, JSON.stringify(report));
    const mismatch = await runCommand(process.execPath, { args });
    expect(mismatch.code).not.toBe(0);
    expect(new TextDecoder().decode(mismatch.stderr)).toContain("Environment mismatch for bun");

    report.schemaVersion = 6;
    await Bun.write(headPath, JSON.stringify(report));
    const legacy = await runCommand(process.execPath, { args });
    expect(legacy.code).not.toBe(0);
    expect(new TextDecoder().decode(legacy.stderr)).toContain("Incompatible performance report schema");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
