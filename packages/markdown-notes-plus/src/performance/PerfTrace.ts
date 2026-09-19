import { PERF_MARKS, type PerfMarkName, type PerfMeasureName } from "./PerfNames.ts";

export type PerfTraceMetadata = {
  generation: number;
  bytes?: number;
  lines?: number;
  headings?: number;
  tasks?: number;
  fixtureId?: string;
  sequence?: number;
};

export type PerfTraceMark = PerfTraceMetadata & {
  name: PerfMarkName;
  startTime: number;
};

export type PerfTraceMeasure = PerfTraceMetadata & {
  name: PerfMeasureName;
  startTime: number;
  duration: number;
};

export type PerfTraceSnapshot = {
  enabled: boolean;
  activeGeneration: number;
  marks: PerfTraceMark[];
  measures: PerfTraceMeasure[];
};

type PerfTraceGlobal = typeof globalThis & {
  __MARKDOWN_NOTES_PERF_TRACE__?: PerfTraceSnapshot;
  __MARKDOWN_NOTES_PERF_ENABLED__?: boolean;
};

const state: PerfTraceSnapshot = {
  enabled: false,
  activeGeneration: 0,
  marks: [],
  measures: [],
};

const once = new Set<string>();
const pendingBeforeDocument = new Map<PerfMarkName, number>();
let environmentChecked = false;

function traceGlobal(): PerfTraceGlobal {
  return globalThis as PerfTraceGlobal;
}

function enabledFromEnvironment(): boolean {
  if (traceGlobal().__MARKDOWN_NOTES_PERF_ENABLED__ === true) return true;
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).get("perf-trace") === "1";
  } catch {
    return false;
  }
}

function syncGlobal(): void {
  if (!state.enabled) return;
  traceGlobal().__MARKDOWN_NOTES_PERF_TRACE__ = state;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function markKey(name: PerfMarkName, generation: number): string {
  return `${generation}:${name}`;
}

function lastMark(name: PerfMarkName, generation: number, sequence?: number): PerfTraceMark | undefined {
  for (let index = state.marks.length - 1; index >= 0; index -= 1) {
    const candidate = state.marks[index];
    if (
      candidate.name === name &&
      candidate.generation === generation &&
      (sequence === undefined || candidate.sequence === sequence)
    ) return candidate;
  }
  return undefined;
}

function publishPerformanceMark(mark: PerfTraceMark): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(mark.name, { detail: { generation: mark.generation, sequence: mark.sequence } });
  } catch {
    performance.mark(mark.name);
  }
}

export function isPerfTraceEnabled(): boolean {
  if (!environmentChecked) {
    state.enabled = enabledFromEnvironment();
    environmentChecked = true;
  }
  if (state.enabled) syncGlobal();
  return state.enabled;
}

export function beginDocumentPerfTrace(metadata: Omit<PerfTraceMetadata, "generation"> = {}): number {
  if (!isPerfTraceEnabled()) return 0;
  state.activeGeneration += 1;
  state.marks.length = 0;
  state.measures.length = 0;
  once.clear();
  for (const [name, startTime] of pendingBeforeDocument) {
    const mark = { name, generation: state.activeGeneration, startTime };
    state.marks.push(mark);
    once.add(markKey(name, state.activeGeneration));
  }
  pendingBeforeDocument.clear();
  markPerf(PERF_MARKS.contextReceived, { generation: state.activeGeneration, ...metadata }, true);
  return state.activeGeneration;
}

export function beginDocumentPerfTraceForText(text: string, fixtureId?: string): number {
  if (!isPerfTraceEnabled()) return 0;
  const lines = text === "" ? 0 : text.split(/\r\n|\r|\n/).length;
  return beginDocumentPerfTrace({
    bytes: new TextEncoder().encode(text).byteLength,
    lines,
    ...(fixtureId ? { fixtureId } : {}),
  });
}

export function currentPerfGeneration(): number {
  return state.activeGeneration;
}

export function markPerf(
  name: PerfMarkName,
  metadata: Partial<PerfTraceMetadata> = {},
  onlyOnce = false,
): PerfTraceMark | undefined {
  if (!isPerfTraceEnabled()) return undefined;
  const generation = metadata.generation ?? state.activeGeneration;
  if (generation <= 0) {
    const startTime = now();
    pendingBeforeDocument.set(name, startTime);
    if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(name);
    return { ...metadata, name, generation: 0, startTime };
  }
  const key = markKey(name, generation);
  if (onlyOnce && once.has(key)) return lastMark(name, generation);
  if (onlyOnce) once.add(key);
  const mark: PerfTraceMark = { ...metadata, name, generation, startTime: now() };
  state.marks.push(mark);
  publishPerformanceMark(mark);
  syncGlobal();
  return mark;
}

export function measurePerf(
  name: PerfMeasureName,
  startName: PerfMarkName,
  endName: PerfMarkName,
  metadata: Partial<PerfTraceMetadata> = {},
  onlyOnce = false,
): PerfTraceMeasure | undefined {
  if (!isPerfTraceEnabled()) return undefined;
  const generation = metadata.generation ?? state.activeGeneration;
  const start = lastMark(startName, generation, metadata.sequence);
  const end = lastMark(endName, generation, metadata.sequence);
  if (!start || !end || end.startTime < start.startTime) return undefined;
  const key = `${generation}:${name}`;
  if (onlyOnce && once.has(key)) return state.measures.find((entry) => entry.name === name && entry.generation === generation);
  if (onlyOnce) once.add(key);
  const measure: PerfTraceMeasure = {
    ...metadata,
    name,
    generation,
    startTime: start.startTime,
    duration: end.startTime - start.startTime,
  };
  state.measures.push(measure);
  if (typeof performance !== "undefined" && typeof performance.measure === "function") {
    try {
      performance.measure(name, {
        start: start.startTime,
        duration: measure.duration,
        detail: { generation, sequence: metadata.sequence },
      });
    } catch {
      // The in-memory trace remains authoritative on browsers without measure options.
    }
  }
  syncGlobal();
  return measure;
}

export function markAndMeasurePerf(
  markName: PerfMarkName,
  measureName: PerfMeasureName,
  startName: PerfMarkName,
  metadata: Partial<PerfTraceMetadata> = {},
  onlyOnce = false,
): void {
  markPerf(markName, metadata, onlyOnce);
  measurePerf(measureName, startName, markName, metadata, onlyOnce);
}

export function getPerfTraceSnapshot(): PerfTraceSnapshot {
  isPerfTraceEnabled();
  return {
    enabled: state.enabled,
    activeGeneration: state.activeGeneration,
    marks: state.marks.map((mark) => ({ ...mark })),
    measures: state.measures.map((measure) => ({ ...measure })),
  };
}

export function setPerfTraceEnabledForTests(enabled: boolean): void {
  traceGlobal().__MARKDOWN_NOTES_PERF_ENABLED__ = enabled;
  environmentChecked = true;
  state.enabled = enabled;
  state.activeGeneration = 0;
  state.marks.length = 0;
  state.measures.length = 0;
  once.clear();
  pendingBeforeDocument.clear();
  if (!enabled) delete traceGlobal().__MARKDOWN_NOTES_PERF_TRACE__;
  else syncGlobal();
}
