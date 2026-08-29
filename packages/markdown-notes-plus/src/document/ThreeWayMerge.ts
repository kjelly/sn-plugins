export interface MergeConflictHunk {
  base: string[];
  local: string[];
  remote: string[];
}

export interface MergeResult {
  success: boolean;
  text?: string;
  conflicts?: MergeConflictHunk[];
}

interface DiffChunk {
  baseStart: number;
  baseCount: number;
  lines: string[];
}

function computeLcsTable(a: string[], b: string[]): number[][] {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (a[i] === b[j]) {
        matrix[i + 1][j + 1] = matrix[i][j] + 1;
      } else {
        matrix[i + 1][j + 1] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }
  return matrix;
}

function diffLines(baseLines: string[], targetLines: string[]): DiffChunk[] {
  const lcs = computeLcsTable(baseLines, targetLines);
  let i = baseLines.length;
  let j = targetLines.length;

  type DiffOp = { type: "equal" | "delete" | "insert"; baseIdx: number; line: string };
  const ops: DiffOp[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && baseLines[i - 1] === targetLines[j - 1]) {
      ops.push({ type: "equal", baseIdx: i - 1, line: baseLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.push({ type: "insert", baseIdx: i, line: targetLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
      ops.push({ type: "delete", baseIdx: i - 1, line: baseLines[i - 1] });
      i--;
    }
  }
  ops.reverse();

  const chunks: DiffChunk[] = [];
  let currentBase = 0;
  let idx = 0;

  while (idx < ops.length) {
    const op = ops[idx];
    if (op.type === "equal") {
      currentBase = op.baseIdx + 1;
      idx++;
      continue;
    }

    const chunkBaseStart = currentBase;
    let baseCount = 0;
    const lines: string[] = [];

    while (idx < ops.length && ops[idx].type !== "equal") {
      const cur = ops[idx];
      if (cur.type === "delete") {
        baseCount++;
        currentBase = cur.baseIdx + 1;
      } else if (cur.type === "insert") {
        lines.push(cur.line);
      }
      idx++;
    }

    chunks.push({
      baseStart: chunkBaseStart,
      baseCount,
      lines,
    });
  }

  return chunks;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function threeWayMerge(base: string, local: string, remote: string): MergeResult {
  if (local === remote) {
    return { success: true, text: local };
  }
  if (local === base) {
    return { success: true, text: remote };
  }
  if (remote === base) {
    return { success: true, text: local };
  }

  const newline = base.includes("\r\n") || local.includes("\r\n") || remote.includes("\r\n") ? "\r\n" : "\n";
  const baseLines = base.length === 0 ? [] : base.split(/\r?\n/);
  const localLines = local.length === 0 ? [] : local.split(/\r?\n/);
  const remoteLines = remote.length === 0 ? [] : remote.split(/\r?\n/);

  const localChunks = diffLines(baseLines, localLines);
  const remoteChunks = diffLines(baseLines, remoteLines);

  const mergedLines: string[] = [];
  const conflicts: MergeConflictHunk[] = [];

  let baseCursor = 0;
  let lIdx = 0;
  let rIdx = 0;

  while (baseCursor < baseLines.length || lIdx < localChunks.length || rIdx < remoteChunks.length) {
    const lChunk = localChunks[lIdx];
    const rChunk = remoteChunks[rIdx];

    const lActive = lChunk && lChunk.baseStart <= baseCursor;
    const rActive = rChunk && rChunk.baseStart <= baseCursor;

    if (!lActive && !rActive) {
      if (baseCursor < baseLines.length) {
        mergedLines.push(baseLines[baseCursor]);
        baseCursor++;
      }
      continue;
    }

    if (lActive && !rActive) {
      mergedLines.push(...lChunk.lines);
      baseCursor = Math.max(baseCursor, lChunk.baseStart + lChunk.baseCount);
      lIdx++;
      continue;
    }

    if (!lActive && rActive) {
      mergedLines.push(...rChunk.lines);
      baseCursor = Math.max(baseCursor, rChunk.baseStart + rChunk.baseCount);
      rIdx++;
      continue;
    }

    if (lActive && rActive) {
      const lEnd = lChunk.baseStart + lChunk.baseCount;
      const rEnd = rChunk.baseStart + rChunk.baseCount;

      if (arraysEqual(lChunk.lines, rChunk.lines) && lChunk.baseCount === rChunk.baseCount) {
        mergedLines.push(...lChunk.lines);
        baseCursor = Math.max(baseCursor, lEnd);
        lIdx++;
        rIdx++;
      } else if (lEnd <= rChunk.baseStart) {
        mergedLines.push(...lChunk.lines);
        baseCursor = Math.max(baseCursor, lEnd);
        lIdx++;
      } else if (rEnd <= lChunk.baseStart) {
        mergedLines.push(...rChunk.lines);
        baseCursor = Math.max(baseCursor, rEnd);
        rIdx++;
      } else {
        const overlapBaseStart = Math.min(lChunk.baseStart, rChunk.baseStart);
        const overlapBaseEnd = Math.max(lEnd, rEnd);
        const conflictBase = baseLines.slice(overlapBaseStart, overlapBaseEnd);
        conflicts.push({
          base: conflictBase,
          local: lChunk.lines,
          remote: rChunk.lines,
        });
        return { success: false, conflicts };
      }
    }
  }

  return {
    success: true,
    text: mergedLines.join(newline),
  };
}
