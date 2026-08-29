# Multi-Device 3-Way Auto-Merge & Conflicted Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automated multi-device Markdown note synchronization via 3-way line merging for non-overlapping concurrent edits, while safely delegating true overlapping conflicts to Standard Notes' native Conflicted Copy sync mechanism.

**Architecture:** A standalone pure functional `ThreeWayMerge` algorithm computes line-level diffs across base, local, and remote snapshots. `CanonicalDocument` tracks `baseText` across lifecycle transitions and attempts auto-merging on `receiveRemote`. `EditorKitBridge` orchestrates auto-save dispatch upon successful merges and coordinates conflict resolution with the host.

**Tech Stack:** TypeScript, Deno Test Runner, React 18, Standard Notes EditorKit.

## Global Constraints
- Target package directory: `/home/ubuntu/nfs/github/sn-plugins/packages/markdown-notes-plus`
- Zero external heavy diff libraries; implementation must be self-contained in TypeScript.
- Strictly adhere to TDD: write failing unit tests before implementation.
- All existing lint (`deno lint src tests`) and tests (`deno test --no-prompt tests/index.test.ts`, `tests/integration.test.ts`) must pass.

---

### Task 1: 3-Way Line Merge Algorithm (`ThreeWayMerge.ts`)

**Files:**
- Create: `src/document/ThreeWayMerge.ts`
- Create: `tests/three-way-merge.test.ts`

**Interfaces:**
- Produces:
  ```typescript
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

  export function threeWayMerge(base: string, local: string, remote: string): MergeResult;
  ```

- [ ] **Step 1: Write failing unit tests for `threeWayMerge`**

Create `tests/three-way-merge.test.ts`:
```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { threeWayMerge } from "../src/document/ThreeWayMerge.ts";

Deno.test("ThreeWayMerge - identical documents", () => {
  const base = "# Title\n\nHello world\n";
  const result = threeWayMerge(base, base, base);
  assertEquals(result.success, true);
  assertEquals(result.text, base);
});

Deno.test("ThreeWayMerge - non-overlapping edits in different sections", () => {
  const base = "# Title\n\nSection 1\n\nSection 2\n";
  const local = "# Title\n\nSection 1 (local edit)\n\nSection 2\n";
  const remote = "# Title\n\nSection 1\n\nSection 2 (remote edit)\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "# Title\n\nSection 1 (local edit)\n\nSection 2 (remote edit)\n");
});

Deno.test("ThreeWayMerge - identical concurrent edits", () => {
  const base = "- [ ] Task 1\n- [ ] Task 2\n";
  const local = "- [x] Task 1\n- [ ] Task 2\n";
  const remote = "- [x] Task 1\n- [ ] Task 2\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "- [x] Task 1\n- [ ] Task 2\n");
});

Deno.test("ThreeWayMerge - independent additions at head and tail", () => {
  const base = "Middle content\n";
  const local = "Header note\n\nMiddle content\n";
  const remote = "Middle content\n\nFooter note\n";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, true);
  assertEquals(result.text, "Header note\n\nMiddle content\n\nFooter note\n");
});

Deno.test("ThreeWayMerge - conflicting edit on the same line", () => {
  const base = "# Original Title\n\nContent";
  const local = "# Local Title\n\nContent";
  const remote = "# Remote Title\n\nContent";
  const result = threeWayMerge(base, local, remote);
  assertEquals(result.success, false);
  assertEquals(result.text, undefined);
  assertEquals(result.conflicts?.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --no-prompt tests/three-way-merge.test.ts`
Expected: FAIL (Module not found `ThreeWayMerge.ts`)

- [ ] **Step 3: Implement `ThreeWayMerge.ts`**

Create `src/document/ThreeWayMerge.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --no-prompt tests/three-way-merge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add src/document/ThreeWayMerge.ts tests/three-way-merge.test.ts
git commit -m "feat(document): implement 3-way line merge algorithm"
```

---

### Task 2: Integrate 3-Way Auto-Merge into `CanonicalDocument`

**Files:**
- Modify: `src/document/CanonicalDocument.ts`
- Modify: `tests/index.test.ts`

**Interfaces:**
- Consumes: `threeWayMerge` from `src/document/ThreeWayMerge.ts`
- Produces:
  ```typescript
  export type ReceiveRemoteResult = "initialized" | "merged" | "conflicted";
  ```
  `CanonicalDocument.prototype.receiveRemote(text: string): ReceiveRemoteResult`
  `CanonicalDocument.prototype.getBaseText(): string`

- [ ] **Step 1: Write failing unit test in `tests/index.test.ts` for CanonicalDocument auto-merge**

Add to `tests/index.test.ts`:
```typescript
Deno.test("CanonicalDocument - auto-merges non-overlapping remote update when dirty", () => {
  const doc = new CanonicalDocument("# Header\n\nSection A\n\nSection B\n");
  doc.applyLocal("# Header\n\nSection A (local edit)\n\nSection B\n");
  assertEquals(doc.dirty, true);

  const status = doc.receiveRemote("# Header\n\nSection A\n\nSection B (remote edit)\n");
  assertEquals(status, "merged");
  assertEquals(doc.dirty, true);
  assertEquals(doc.pendingRemote, undefined);
  assertEquals(doc.text, "# Header\n\nSection A (local edit)\n\nSection B (remote edit)\n");
});

Deno.test("CanonicalDocument - flags conflict on overlapping remote update when dirty", () => {
  const doc = new CanonicalDocument("# Header\n\nSection A\n");
  doc.applyLocal("# Header\n\nSection A (local)\n");
  assertEquals(doc.dirty, true);

  const status = doc.receiveRemote("# Header\n\nSection A (remote)\n");
  assertEquals(status, "conflicted");
  assertEquals(doc.pendingRemote, "# Header\n\nSection A (remote)\n");
  assertEquals(doc.text, "# Header\n\nSection A (local)\n");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --no-prompt tests/index.test.ts`
Expected: FAIL (doc.receiveRemote return type mismatch / assertion failure)

- [ ] **Step 3: Modify `src/document/CanonicalDocument.ts`**

Update `src/document/CanonicalDocument.ts`:
- Import `threeWayMerge` from `./ThreeWayMerge.ts`.
- Add `private baseText: string`.
- Initialize `baseText` in constructor and `initialize(text)`.
- Update `markSaved(text)` to update `baseText = text`.
- Update `receiveRemote(text)` to perform 3-way merge when dirty and return `"initialized" | "merged" | "conflicted"`.
- Update `resolveRemote(choice)`:
  - If `"accept-remote"`: `this.initialize(remote);`
  - If `"keep-local"`: `this.baseText = remote; this.state = { ...this.state, pendingRemote: undefined, dirty: true }; this.emit();`

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --no-prompt tests/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add src/document/CanonicalDocument.ts tests/index.test.ts
git commit -m "feat(document): integrate 3-way auto-merge into CanonicalDocument"
```

---

### Task 3: Coordinate Auto-Save and Conflict Resolution in `EditorKitBridge`

**Files:**
- Modify: `src/standardnotes/EditorKitBridge.ts`
- Modify: `tests/integration.test.ts`

**Interfaces:**
- Consumes: `CanonicalDocument.prototype.receiveRemote`
- Produces: Auto-scheduled save on `receiveRemote` returning `"merged"`, updated conflict resolution keeping host sync intact.

- [ ] **Step 1: Write integration tests for bridge remote update auto-merging**

Add tests in `tests/integration.test.ts`:
```typescript
Deno.test("EditorKitBridge - triggers scheduleSave on successful remote auto-merge", () => {
  let savedText = "";
  const doc = new CanonicalDocument("Line 1\nLine 2\nLine 3\n");
  const fakeKit = {
    saveItemWithPresave: (_note: any, presave?: () => void) => {
      if (presave) presave();
      savedText = doc.text;
    }
  };
  let bridgeDelegate: any;
  const bridge = new EditorKitBridge(
    doc,
    () => {},
    (delegate) => {
      bridgeDelegate = delegate;
      return fakeKit;
    },
  );
  bridge.start();

  // Initial note load
  bridgeDelegate.onNoteValueChange({ uuid: "note-1", content: { text: "Line 1\nLine 2\nLine 3\n" } });
  bridgeDelegate.setEditorRawText("Line 1\nLine 2\nLine 3\n");

  // Local change
  doc.applyLocal("Line 1 (local)\nLine 2\nLine 3\n");

  // Remote update arriving with non-overlapping change
  bridgeDelegate.onNoteValueChange({ uuid: "note-1", content: { text: "Line 1\nLine 2\nLine 3 (remote)\n" } });
  bridgeDelegate.setEditorRawText("Line 1\nLine 2\nLine 3 (remote)\n");

  assertEquals(doc.pendingRemote, undefined);
  assertEquals(doc.text, "Line 1 (local)\nLine 2\nLine 3 (remote)\n");
  assertEquals(bridge.getState().localDirty, true);
  
  // Flush bridge save
  bridge.flush();
  assertEquals(savedText, "Line 1 (local)\nLine 2\nLine 3 (remote)\n");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --no-prompt tests/integration.test.ts`
Expected: FAIL

- [ ] **Step 3: Modify `src/standardnotes/EditorKitBridge.ts`**

In `src/standardnotes/EditorKitBridge.ts`:
```typescript
else if (kind !== "metadata") {
  const result = this.document.receiveRemote(text);
  if (result === "merged") {
    this.scheduleSave(this.document.text);
  } else if (result === "initialized") {
    this.cancelPendingSave();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --no-prompt tests/integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add src/standardnotes/EditorKitBridge.ts tests/integration.test.ts
git commit -m "feat(bridge): schedule auto-save on successful remote auto-merge"
```

---

### Task 4: UI Messaging & Full Suite Verification

**Files:**
- Modify: `src/app/App.tsx`
- Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts`
- Run: `npm run build`
- Run: `npm run test:e2e`

- [ ] **Step 1: Update conflict banner text in `src/app/App.tsx`**

Update conflict alert banner in `src/app/App.tsx` to clearly explain Conflicted Copy fallback:
```tsx
{snapshot.pendingRemote !== undefined ? (
  <aside className="conflict" role="alert">
    <span>Another device modified the same section. Keep local edits or accept remote version.</span>
    <button onClick={() => bridge.resolveConflict("keep-local")} title="Keep local changes (Standard Notes creates a Conflicted Copy if needed)">Keep local</button>
    <button onClick={() => bridge.resolveConflict("accept-remote")} title="Discard local changes and use remote version">Accept remote</button>
  </aside>
) : null}
```

- [ ] **Step 2: Run all unit and integration tests**

Run:
```bash
deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/three-way-merge.test.ts
```
Expected: All tests PASS.

- [ ] **Step 3: Run project build and typecheck**

Run:
```bash
npm run typecheck && npm run build
```
Expected: Clean build with 0 errors.

- [ ] **Step 4: Run end-to-end tests**

Run:
```bash
npm run test:e2e
```
Expected: All Playwright E2E tests pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/app/App.tsx
git commit -m "feat(ui): refine conflict banner wording for Conflicted Copy guidance"
```
