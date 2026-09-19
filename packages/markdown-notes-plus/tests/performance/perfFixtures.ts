import {
  generateCrlfNormalizableFixture,
  generateFencesFixture,
  generateFlatTasksFixture,
  generateGfmStructuralFixture,
  generateHeadingsFixture,
  generateMixedFixture,
  generateNestedTasksFixture,
  generatePlainFixture,
  generateSourceOnlyFixture,
  generateTaskContinuationFixture,
  type GeneratedPerfMarkdown,
} from "./generatePerfMarkdown.ts";

export const PERF_FIXTURE_GENERATOR_VERSION = 1 as const;

export function corePerfFixtures(): GeneratedPerfMarkdown[] {
  return [
    generatePlainFixture(10 * 1024, "plain-10k"),
    generateMixedFixture(100 * 1024, "mixed-100k"),
    generateMixedFixture(500 * 1024, "mixed-500k"),
    generateMixedFixture(1024 * 1024, "mixed-1m"),
  ];
}

export function complexityPerfFixtures(): GeneratedPerfMarkdown[] {
  return [
    ...[2_500, 5_000, 10_000].map(generateFlatTasksFixture),
    ...[1, 2, 4].map(generateNestedTasksFixture),
    ...[1, 2, 4].map(generateTaskContinuationFixture),
    ...[2_500, 5_000, 10_000].map(generateHeadingsFixture),
    ...[500, 1_000, 2_000].map(generateFencesFixture),
  ];
}

export function semanticPerfFixtures(): GeneratedPerfMarkdown[] {
  return [generateGfmStructuralFixture(), generateSourceOnlyFixture(), generateCrlfNormalizableFixture()];
}

export function allPerfFixtures(): GeneratedPerfMarkdown[] {
  return [...corePerfFixtures(), ...complexityPerfFixtures(), ...semanticPerfFixtures()];
}
