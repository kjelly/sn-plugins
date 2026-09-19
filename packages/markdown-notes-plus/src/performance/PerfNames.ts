export const PERF_MARKS = {
  contextReceived: "context_received",
  bootstrapPreviewRendered: "bootstrap_preview_rendered",
  mountAppStart: "mount_app_start",
  mountAppEnd: "mount_app_end",
  analysisStart: "analysis_start",
  analysisEnd: "analysis_end",
  writingChunkLoaded: "writing_chunk_loaded",
  writingPreflightStart: "writing_preflight_start",
  writingPreflightEnd: "writing_preflight_end",
  milkdownCreateStart: "milkdown_create_start",
  milkdownCreateEnd: "milkdown_create_end",
  roundtripProofStart: "roundtrip_proof_start",
  roundtripProofEnd: "roundtrip_proof_end",
  writingInteractive: "writing_interactive",
  inputStart: "input_start",
  transactionStart: "transaction_start",
  transactionToMarkdownEnd: "transaction_to_markdown_end",
  mutationProofStart: "mutation_proof_start",
  mutationProofEnd: "mutation_proof_end",
  canonicalCommitStart: "canonical_commit_start",
  canonicalCommitEnd: "canonical_commit_end",
  projectionSchedule: "projection_schedule",
} as const;

export const PERF_MEASURES = {
  contextToPreview: "context_to_preview_ms",
  contextToApp: "context_to_app_ms",
  contextToWritingInteractive: "context_to_writing_interactive_ms",
  analysis: "analysis_ms",
  writingPreflight: "writing_preflight_ms",
  milkdownCreate: "milkdown_create_ms",
  roundtripProof: "roundtrip_proof_ms",
  mutationProof: "mutation_proof_ms",
  canonicalCommit: "canonical_commit_ms",
  inputToCanonical: "input_to_canonical_ms",
  transactionToMarkdown: "transaction_to_markdown_ms",
  transactionToCanonical: "transaction_to_canonical_ms",
  projectionSchedule: "projection_schedule_ms",
} as const;

export type PerfMarkName = typeof PERF_MARKS[keyof typeof PERF_MARKS];
export type PerfMeasureName = typeof PERF_MEASURES[keyof typeof PERF_MEASURES];
