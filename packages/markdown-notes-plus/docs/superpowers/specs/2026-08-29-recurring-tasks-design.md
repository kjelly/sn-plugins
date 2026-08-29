# Design Specification: Recurring Tasks with Inline Tags

## 1. Overview & Goals

This specification defines the Recurring Tasks system for `markdown-notes-plus` using the inline tag approach compatible with Obsidian, TaskPaper, and Todo.txt conventions.

### Core Objectives:
1. **Inline Tag Convention**: Support `@repeat(...)` (or `@recur(...)`) and `@done(YYYY-MM-DD)`.
2. **Selective Auto-tagging on Complete**: When checking a task containing `@repeat(...)`, automatically append or update `@done(YYYY-MM-DD)` with today's date. Ordinary tasks without `@repeat(...)` remain clean `- [x]`.
3. **Auto-clearing on Incomplete**: When unchecking a task, automatically remove `@done(...)`.
4. **Lifecycle Auto-Reset on Note Open**: When a note is opened or loaded, automatically evaluate all completed recurring tasks against the current date. If `today >= doneDate + repeatDuration`, reset `- [x]` to `- [ ]` and clear `@done(...)` while preserving `@repeat(...)`.
5. **Multi-Mode Synchronization**: Support task toggling and recurrence across Writing mode (Milkdown), Mindmap mode (Markmap), Source mode, and the Tasks sidebar.

---

## 2. Syntax & Grammar Specification

### 2.1 Task Structure
```markdown
- [ ] Water plants @repeat(3d)
- [x] Weekly server backup @repeat(1w) @done(2026-08-22)
- [ ] Monthly budgeting @repeat(monthly)
- [x] Ordinary one-time task
```

### 2.2 Supported Repeat Units
The `@repeat(...)` tag supports:
- **Days**: `Nd`, `N day`, `N days`, `daily` (e.g. `@repeat(3d)`, `@repeat(5 days)`, `@repeat(daily)`)
- **Weeks**: `Nw`, `N week`, `N weeks`, `weekly` (e.g. `@repeat(1w)`, `@repeat(2 weeks)`, `@repeat(weekly)`)
- **Months**: `Nm`, `N month`, `N months`, `monthly` (e.g. `@repeat(1m)`, `@repeat(monthly)`)
- **Years**: `Ny`, `N year`, `N years`, `yearly` (e.g. `@repeat(1y)`, `@repeat(yearly)`)

Case-insensitive matching: `@repeat(1W)`, `@REPEAT(DAILY)`, etc.

### 2.3 Date Format
- Standard ISO date: `@done(YYYY-MM-DD)` (local time).

---

## 3. Architecture & Components

```
┌────────────────────────────────────────────────────────┐
│                   App Note Lifecycle                   │
│   (On note open / switch / remote update)              │
│                           │                            │
│                           ▼                            │
│              evaluateRecurringTasks(text)              │
│       (Scan overdue tasks, reset [x] -> [ ])           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
               ┌─────────────────────────┐
               │    CanonicalDocument    │
               │   (Single Truth Source) │
               └────────────┬────────────┘
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
  Writing Mode         Mindmap Mode        Tasks Sidebar
(Milkdown nodeView)  (Markmap SVG click)  (Batch / Item click)
        │                   │                    │
        └───────────────────┼────────────────────┘
                            ▼
                 mutateTaskRecurrence(task)
             - Toggle [ ] -> [x]: add @done(today)
             - Toggle [x] -> [ ]: remove @done(...)
```

### 3.1 Module: `src/tasks/RecurringTasks.ts`

- **`parseRepeatInterval(repeatStr: string): { amount: number; unit: 'd' | 'w' | 'm' | 'y' } | undefined`**:
  - Parses repeat expressions into numeric quantity and unit.
- **`calculateNextDueDate(doneDateStr: string, repeatStr: string): Date | undefined`**:
  - Calculates the due timestamp by adding the interval to `doneDate`.
- **`isRecurringTaskOverdue(doneDateStr: string, repeatStr: string, today: Date = new Date()): boolean`**:
  - Checks if `today.startOfDay >= dueDate.startOfDay`.
- **`updateTaskTextForToggle(taskText: string, nextChecked: boolean, today: Date = new Date()): string`**:
  - If `nextChecked === true` and taskText has `@repeat(...)`: adds/updates `@done(YYYY-MM-DD)`.
  - If `nextChecked === false`: strips `@done\([^\)]*\)`.
  - If taskText has no `@repeat(...)`: leaves text unchanged.
- **`evaluateRecurringTasks(markdown: string, today: Date = new Date()): { markdown: string; resetCount: number; changed: boolean; changeSet?: TextChangeSet }`**:
  - Scans all lines in `markdown`.
  - For each line matching `- \[(x|X)\] (.*@repeat\([^)]+\).*@done\((\d{4}-\d{2}-\d{2})\).*)`:
    - Checks if overdue.
    - If overdue: converts `[x]` to `[ ]`, strips `@done(...)`, preserves `@repeat(...)`.
  - Returns new markdown string and change metadata.

### 3.2 Integration with `src/markdown/analysisCore.ts`

- Extend `toggleTask(markdown, task, today)`:
  - When flipping from `[ ]` to `[x]`: if task text has `@repeat(...)`, updates task text with `@done(YYYY-MM-DD)` alongside checkbox replacement.
  - When flipping from `[x]` to `[ ]`: removes `@done(...)`.
  - Creates exact `changeSet` for remapping active anchors.

### 3.3 Integration with `src/editor/WritingEditor.tsx`

- In `taskListItemView`:
  - When clicking checkbox:
    - Inspects node's text content for `@repeat(...)`.
    - If completing and `@repeat(...)` is present: appends ` @done(YYYY-MM-DD)` text node or updates text.
    - If unchecking: strips `@done(...)` from text content.

### 3.4 Integration with `src/app/App.tsx` & Note Load

- When loading note or switching notes in `App.tsx`:
  - Runs `evaluateRecurringTasks(snapshot.text, new Date())`.
  - If `changed`:
    - Applies local mutation to `CanonicalDocument`.
    - Triggers debounced save to host.
    - Sets `recurringResetNotice` in status bar/toolbar (e.g. `🔁 1 recurring task reset`).

---

## 4. Edge Cases & Safety

1. **Leap Years & Month Ends**:
   - `date.setMonth(date.getMonth() + 1)` correctly rolls over February 28/29 to March.
2. **Invalid Date Format in @done**:
   - If `@done(...)` contains invalid date string (e.g. `@done(invalid)`), consider it overdue and reset to clean state.
3. **Multiple Cycles Missed**:
   - If user opens a note 30 days later for a `@repeat(5d)` task, it resets once to `[ ]` for the current cycle.
4. **Milkdown Round-Trip Safety**:
   - Inline `@repeat(...)` and `@done(...)` tags are ordinary text and preserve 100% fidelity through parser and serializer without triggering lossless guard fallbacks.

---

## 5. Testing Strategy

1. **Unit Tests (`tests/recurring-tasks.test.ts`)**:
   - `parseRepeatInterval`: test all units (`5d`, `1w`, `2m`, `1y`, `daily`, `weekly`, `monthly`, `yearly`).
   - `isRecurringTaskOverdue`: test before due date, on due date, and after due date.
   - `evaluateRecurringTasks`: test multiple tasks with mixed repeat rules, non-repeat tasks, indented subtasks, and CRLF line endings.
2. **Integration Tests (`tests/integration.test.ts`)**:
   - Test `toggleTask` automatically appending `@done(...)` for `@repeat` tasks and leaving standard tasks untouched.
   - Test `uncheckAll` cleaning `@done(...)` tags.
   - Test round-trip evaluation through `CanonicalDocument` and `EditorKitBridge` debounced save.
3. **Playwright E2E Tests (`tests/e2e/specs/8_recurring_tasks.spec.ts`)**:
   - Test checking a `@repeat(3d)` task in Writing mode inserts `@done(YYYY-MM-DD)`.
   - Test opening a note with an overdue recurring task automatically resets it to unchecked `[ ]`.
   - Test mindmap checkbox toggle updates `@done` correctly.
