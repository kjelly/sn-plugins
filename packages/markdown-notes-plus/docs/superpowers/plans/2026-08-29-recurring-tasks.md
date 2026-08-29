# Recurring Tasks with Inline Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automated recurring task tracking using inline `@repeat(...)` and `@done(YYYY-MM-DD)` tags, auto-tagging on completion, auto-clearing on unchecking, and auto-resetting overdue tasks on note load.

**Architecture:**
- `RecurringTasks.ts` provides interval parsing, due date calculation, overdue detection, task text transformation on toggle, and full-markdown batch evaluation.
- `analysisCore.ts` updates `toggleTask` and `uncheckAll` to automatically append/remove `@done(...)` for recurring tasks.
- `WritingEditor.tsx` updates ProseMirror node transactions when clicking task checkboxes in rich text mode.
- `App.tsx` evaluates notes upon load/switch, auto-resetting overdue recurring tasks to `[ ]` and scheduling a save.

**Tech Stack:** TypeScript, React, ProseMirror, Milkdown, Markmap, Deno test, Playwright E2E.

## Global Constraints

- Preserve all Markdown formatting, indentation, and line endings (LF/CRLF) losslessly.
- Only add `@done(YYYY-MM-DD)` to tasks containing `@repeat(...)`; ordinary tasks remain clean `- [x]`.
- Support repeat units: `d` (days), `w` (weeks), `m` (months), `y` (years), and aliases (`daily`, `weekly`, `monthly`, `yearly`).
- Use local date string `YYYY-MM-DD` for all dates.

---

### Task 1: Recurring Tasks Engine & Parser

**Files:**
- Create: `packages/markdown-notes-plus/src/tasks/RecurringTasks.ts`
- Create: `packages/markdown-notes-plus/tests/recurring-tasks.test.ts`

**Interfaces:**
- Produces:
  - `parseRepeatInterval(repeatStr: string): { amount: number; unit: 'd' | 'w' | 'm' | 'y' } | undefined`
  - `calculateNextDueDate(doneDateStr: string, repeatStr: string): Date | undefined`
  - `isRecurringTaskOverdue(doneDateStr: string, repeatStr: string, today?: Date): boolean`
  - `updateTaskTextForToggle(taskText: string, nextChecked: boolean, today?: Date): string`
  - `evaluateRecurringTasks(markdown: string, today?: Date): { markdown: string; resetCount: number; changed: boolean }`

- [ ] **Step 1: Write the failing unit test**

Create `tests/recurring-tasks.test.ts`:
```typescript
function assertEquals<T>(actual: T, expected: T, message = "values are not equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import {
  parseRepeatInterval,
  calculateNextDueDate,
  isRecurringTaskOverdue,
  updateTaskTextForToggle,
  evaluateRecurringTasks,
} from "../src/tasks/RecurringTasks.ts";

Deno.test("RecurringTasks - parseRepeatInterval parses units and aliases", () => {
  assertEquals(parseRepeatInterval("3d"), { amount: 3, unit: "d" });
  assertEquals(parseRepeatInterval("5 days"), { amount: 5, unit: "d" });
  assertEquals(parseRepeatInterval("daily"), { amount: 1, unit: "d" });
  assertEquals(parseRepeatInterval("2w"), { amount: 2, unit: "w" });
  assertEquals(parseRepeatInterval("weekly"), { amount: 1, unit: "w" });
  assertEquals(parseRepeatInterval("1m"), { amount: 1, unit: "m" });
  assertEquals(parseRepeatInterval("monthly"), { amount: 1, unit: "m" });
  assertEquals(parseRepeatInterval("1y"), { amount: 1, unit: "y" });
  assertEquals(parseRepeatInterval("yearly"), { amount: 1, unit: "y" });
  assertEquals(parseRepeatInterval("invalid"), undefined);
});

Deno.test("RecurringTasks - isRecurringTaskOverdue compares dates correctly", () => {
  // Done on 2026-08-20 with repeat(5d) -> due on 2026-08-25
  const todayEarly = new Date(2026, 7, 24); // Aug 24
  const todayDue = new Date(2026, 7, 25); // Aug 25
  const todayLate = new Date(2026, 7, 29); // Aug 29

  assertEquals(isRecurringTaskOverdue("2026-08-20", "5d", todayEarly), false);
  assertEquals(isRecurringTaskOverdue("2026-08-20", "5d", todayDue), true);
  assertEquals(isRecurringTaskOverdue("2026-08-20", "5d", todayLate), true);
});

Deno.test("RecurringTasks - updateTaskTextForToggle appends @done on complete and removes on incomplete", () => {
  const fixedToday = new Date(2026, 7, 29); // 2026-08-29

  // Task with @repeat: complete adds @done
  assertEquals(
    updateTaskTextForToggle("Water plants @repeat(3d)", true, fixedToday),
    "Water plants @repeat(3d) @done(2026-08-29)",
  );

  // Task with @repeat: incomplete removes @done
  assertEquals(
    updateTaskTextForToggle("Water plants @repeat(3d) @done(2026-08-26)", false, fixedToday),
    "Water plants @repeat(3d)",
  );

  // Ordinary task without @repeat: no change
  assertEquals(
    updateTaskTextForToggle("Buy groceries", true, fixedToday),
    "Buy groceries",
  );
  assertEquals(
    updateTaskTextForToggle("Buy groceries", false, fixedToday),
    "Buy groceries",
  );
});

Deno.test("RecurringTasks - evaluateRecurringTasks resets overdue tasks only", () => {
  const input = `# Routine
- [x] Water plants @repeat(3d) @done(2026-08-20)
- [x] Weekly backup @repeat(1w) @done(2026-08-28)
- [x] Fixed completed task
- [ ] Open task @repeat(daily)
`;

  const today = new Date(2026, 7, 29); // Aug 29 (Water plants is due Aug 23, Weekly backup is due Sep 4)
  const result = evaluateRecurringTasks(input, today);

  assertEquals(result.changed, true);
  assertEquals(result.resetCount, 1);
  assertEquals(
    result.markdown,
    `# Routine
- [ ] Water plants @repeat(3d)
- [x] Weekly backup @repeat(1w) @done(2026-08-28)
- [x] Fixed completed task
- [ ] Open task @repeat(daily)
`,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --no-prompt tests/recurring-tasks.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/tasks/RecurringTasks.ts`**

Create `src/tasks/RecurringTasks.ts`:
```typescript
export type RepeatInterval = {
  amount: number;
  unit: "d" | "w" | "m" | "y";
};

export const REPEAT_TAG_REGEX = /@repeat\(([^)]+)\)/i;
export const DONE_TAG_REGEX = /@done\((\d{4}-\d{2}-\d{2})\)/i;

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(dateStr: string): Date | undefined {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  return new Date(year, month, day);
}

export function parseRepeatInterval(repeatStr: string): RepeatInterval | undefined {
  if (!repeatStr) return undefined;
  const normalized = repeatStr.trim().toLowerCase();

  if (normalized === "daily") return { amount: 1, unit: "d" };
  if (normalized === "weekly") return { amount: 1, unit: "w" };
  if (normalized === "monthly") return { amount: 1, unit: "m" };
  if (normalized === "yearly") return { amount: 1, unit: "y" };

  const match = normalized.match(/^(\d+)\s*(d(?:ays?)?|w(?:eeks?)?|m(?:onths?)?|y(?:ears?)?)?$/);
  if (!match) return undefined;

  const amount = parseInt(match[1], 10);
  if (isNaN(amount) || amount <= 0) return undefined;

  const unitPrefix = (match[2] ?? "d")[0] as "d" | "w" | "m" | "y";
  return { amount, unit: unitPrefix };
}

export function calculateNextDueDate(doneDateStr: string, repeatStr: string): Date | undefined {
  const doneDate = parseIsoDate(doneDateStr);
  if (!doneDate) return undefined;

  const interval = parseRepeatInterval(repeatStr);
  if (!interval) return undefined;

  const due = new Date(doneDate.getFullYear(), doneDate.getMonth(), doneDate.getDate());
  if (interval.unit === "d") {
    due.setDate(due.getDate() + interval.amount);
  } else if (interval.unit === "w") {
    due.setDate(due.getDate() + interval.amount * 7);
  } else if (interval.unit === "m") {
    due.setMonth(due.getMonth() + interval.amount);
  } else if (interval.unit === "y") {
    due.setFullYear(due.getFullYear() + interval.amount);
  }
  return due;
}

export function isRecurringTaskOverdue(doneDateStr: string, repeatStr: string, today: Date = new Date()): boolean {
  const dueDate = calculateNextDueDate(doneDateStr, repeatStr);
  if (!dueDate) return true; // If invalid, consider overdue to reset to clean state

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();
  return todayStart >= dueStart;
}

export function updateTaskTextForToggle(taskText: string, nextChecked: boolean, today: Date = new Date()): string {
  const repeatMatch = taskText.match(REPEAT_TAG_REGEX);
  if (!repeatMatch) {
    return taskText;
  }

  if (nextChecked) {
    const todayStr = formatIsoDate(today);
    if (DONE_TAG_REGEX.test(taskText)) {
      return taskText.replace(DONE_TAG_REGEX, `@done(${todayStr})`);
    }
    return `${taskText.trimEnd()} @done(${todayStr})`;
  } else {
    return taskText.replace(/\s*@done\([^)]*\)/gi, "").trimEnd();
  }
}

export function evaluateRecurringTasks(markdown: string, today: Date = new Date()): {
  markdown: string;
  resetCount: number;
  changed: boolean;
} {
  let resetCount = 0;
  // Match lines like: - [x] Water plants @repeat(3d) @done(2026-08-20)
  const taskLineRegex = /^(\s*(?:[-*+]|\d+\.)\s+\[)[xX](\]\s+.*)$/gm;

  const updatedMarkdown = markdown.replace(taskLineRegex, (fullLine, prefix, rest) => {
    const repeatMatch = rest.match(REPEAT_TAG_REGEX);
    const doneMatch = rest.match(DONE_TAG_REGEX);

    if (repeatMatch && doneMatch) {
      const repeatExpr = repeatMatch[1];
      const doneDateStr = doneMatch[1];
      if (isRecurringTaskOverdue(doneDateStr, repeatExpr, today)) {
        resetCount += 1;
        // Clean @done tag and switch checkbox to empty space
        const cleanedRest = rest.replace(/\s*@done\([^)]*\)/gi, "");
        return `${prefix} ${cleanedRest}`;
      }
    }
    return fullLine;
  });

  return {
    markdown: updatedMarkdown,
    resetCount,
    changed: resetCount > 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --no-prompt tests/recurring-tasks.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/tasks/RecurringTasks.ts tests/recurring-tasks.test.ts
git commit -m "feat(tasks): implement recurring tasks parser and evaluator engine"
```

---

### Task 2: Task Mutation & Analysis Core Integration

**Files:**
- Modify: `packages/markdown-notes-plus/src/markdown/analysisCore.ts`
- Modify: `packages/markdown-notes-plus/src/markdown/analysis.ts`
- Modify: `packages/markdown-notes-plus/tests/integration.test.ts`

**Interfaces:**
- Consumes: `updateTaskTextForToggle` from `src/tasks/RecurringTasks.ts`

- [ ] **Step 1: Update `toggleTask` and `uncheckAll` in `src/markdown/analysisCore.ts`**

In `src/markdown/analysisCore.ts`:
```typescript
export function toggleTask(markdown: string, task: TaskInfo, today: Date = new Date()): CommandResult {
  if (task.checkboxOffset < 0 || task.checkboxOffset >= markdown.length) return { markdown, changed: false };
  const nextChecked = !task.checked;
  const replacement = nextChecked ? "x" : " ";

  // Find line boundaries for the task header line
  const lineStart = task.from;
  const lineEnd = task.to;
  const lineText = markdown.slice(lineStart, lineEnd);

  // Update text with @done tag if applicable
  const updatedLineText = updateTaskTextForToggle(
    lineText.slice(0, task.checkboxOffset - lineStart) + replacement + lineText.slice(task.checkboxOffset - lineStart + 1),
    nextChecked,
    today,
  );

  if (updatedLineText === lineText) {
    return { markdown, changed: false };
  }

  const nextMarkdown = markdown.slice(0, lineStart) + updatedLineText + markdown.slice(lineEnd);
  return {
    markdown: nextMarkdown,
    changed: true,
    changeSet: createTextChangeSet(markdown.length, nextMarkdown.length, [{
      from: lineStart,
      to: lineEnd,
      insertedLength: updatedLineText.length,
    }]),
  };
}
```

- [ ] **Step 2: Add integration tests in `tests/integration.test.ts`**

Add tests verifying:
- Toggling a `@repeat(...)` task to checked appends `@done(YYYY-MM-DD)`.
- Toggling a `@repeat(...)` task to unchecked removes `@done(...)`.
- Toggling an ordinary task does not add `@done(...)`.
- `uncheckAll` cleans `@done(...)` tags from `@repeat` tasks.

- [ ] **Step 3: Run all unit and integration tests**

Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/recurring-tasks.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit Task 2**

```bash
git add src/markdown/analysisCore.ts src/markdown/analysis.ts tests/integration.test.ts
git commit -m "feat(markdown): integrate recurring task @done auto-tagging into toggleTask"
```

---

### Task 3: Writing Mode (Milkdown) Task Item Checkbox Integration

**Files:**
- Modify: `packages/markdown-notes-plus/src/editor/WritingEditor.tsx`

**Interfaces:**
- Consumes: `updateTaskTextForToggle` from `src/tasks/RecurringTasks.ts`

- [ ] **Step 1: Update `taskListItemView` in `src/editor/WritingEditor.tsx`**

When the checkbox is clicked inside `taskListItemView`:
- If `nextChecked === true` and task node text contains `@repeat(...)`:
  - Update the list item node or its paragraph text node to include `@done(YYYY-MM-DD)`.
- If `nextChecked === false` and task node text contains `@done(...)`:
  - Update the list item node or paragraph text node to remove `@done(...)`.

- [ ] **Step 2: Run tests to verify no regressions**

Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/recurring-tasks.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit Task 3**

```bash
git add src/editor/WritingEditor.tsx
git commit -m "feat(writing): update task text with @done tag on Milkdown checkbox toggle"
```

---

### Task 4: App Lifecycle & Note Load Auto-Reset

**Files:**
- Modify: `packages/markdown-notes-plus/src/app/App.tsx`
- Modify: `packages/markdown-notes-plus/src/app/AppDocumentLifecycle.ts`

**Interfaces:**
- Consumes: `evaluateRecurringTasks` from `src/tasks/RecurringTasks.ts`

- [ ] **Step 1: Add recurring task evaluation on note initialization and transition**

In `src/app/App.tsx`:
When `bridge` delivers note text or note switches:
```typescript
const evaluateNoteRecurringTasks = (rawText: string): string => {
  const { markdown: evaluatedText, resetCount, changed } = evaluateRecurringTasks(rawText, new Date());
  if (changed) {
    canonical.applyLocal(evaluatedText);
    bridge.notifyLocalChange(evaluatedText);
  }
  return changed ? evaluatedText : rawText;
};
```
Trigger `evaluateNoteRecurringTasks` when note loads or resets.

- [ ] **Step 2: Display badge or notice in UI when recurring tasks are reset**

If `resetCount > 0`, display a brief indicator in the status toolbar (e.g. `🔁 1 recurring task reset`).

- [ ] **Step 3: Run all unit and integration tests**

Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/recurring-tasks.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit Task 4**

```bash
git add src/app/App.tsx src/app/AppDocumentLifecycle.ts
git commit -m "feat(lifecycle): auto-reset overdue recurring tasks on note load"
```

---

### Task 5: End-to-End Playwright Tests & Verification

**Files:**
- Create: `packages/markdown-notes-plus/tests/e2e/specs/8_recurring_tasks.spec.ts`

- [ ] **Step 1: Write E2E test suite for recurring tasks**

Create `tests/e2e/specs/8_recurring_tasks.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Recurring Tasks with @repeat and @done", () => {
  test("Writing mode - checking a @repeat task appends @done(YYYY-MM-DD)", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Habits\n\n- [ ] Morning run @repeat(daily)\n- [ ] Read book\n", "habits-1");

    const checkbox = editor.writingPane.locator(".task-checkbox").first();
    await checkbox.click();

    await page.waitForTimeout(400);
    const note = await host.getNote("habits-1");
    expect(note.content.text).toMatch(/- \[x\] Morning run @repeat\(daily\) @done\(\d{4}-\d{2}-\d{2}\)/);
    expect(note.content.text).toContain("- [ ] Read book");
  });

  test("Note load - auto-resets overdue recurring tasks to unchecked state", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    // Provide note with overdue task from 2026-08-20 with repeat(3d)
    const overdueContent = "# Routine\n\n- [x] Water plants @repeat(3d) @done(2026-08-20)\n- [x] One-time done task\n";
    await host.goto(overdueContent, "routine-1");

    // Check Writing pane reflects unchecked state
    const firstCheckbox = editor.writingPane.locator(".task-checkbox").first();
    await expect(firstCheckbox).not.toBeChecked();

    const secondCheckbox = editor.writingPane.locator(".task-checkbox").nth(1);
    await expect(secondCheckbox).toBeChecked();

    // Verify saved content has been auto-reset
    await page.waitForTimeout(400);
    const note = await host.getNote("routine-1");
    expect(note.content.text).toContain("- [ ] Water plants @repeat(3d)");
    expect(note.content.text).not.toContain("@done(2026-08-20)");
    expect(note.content.text).toContain("- [x] One-time done task");
  });
});
```

- [ ] **Step 2: Run linters, typechecks, and test suites**

Run:
```bash
deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/three-way-merge.test.ts tests/link-opener.test.ts tests/recurring-tasks.test.ts
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```
Expected: PASS for all tests and builds.

- [ ] **Step 3: Commit Task 5**

```bash
git add tests/e2e/specs/8_recurring_tasks.spec.ts
git commit -m "test(e2e): add comprehensive recurring tasks end-to-end tests"
```
