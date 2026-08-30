# Mobile-Friendly Editor Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor fully usable on touch/mobile devices — keyboard-aware height, safe-area padding, persistent ≥40px touch targets, pointer-based outline drag, and a modal link dialog replacing `window.prompt` — without changing desktop behavior.

**Architecture:** CSS media queries (`pointer: coarse`, `max-width: 768px`, safe-area `env()`) are the backbone; JS only where CSS cannot work: a `useVisualViewport` hook that publishes `--vvh`, a pointer-events rewrite of outline drag-and-drop, a `LinkDialogModal` React component, and a `matchMedia` listener for responsive sidebar state. Spec: `docs/superpowers/specs/2026-08-30-mobile-friendly-editor-design.md`.

**Tech Stack:** React 18, TypeScript, Milkdown 7 (ProseMirror), CodeMirror 6, Vite, Deno (unit tests), Playwright (E2E, 390×844 mobile spec).

**Commands (repo root = `/home/ubuntu/nfs/github/sn-plugins/packages/markdown-notes-plus`):**

| Purpose | Command |
|---|---|
| Unit tests | `npm run test:unit` (runs `deno test --no-prompt tests/index.test.ts tests/review-diagnostics.test.ts`) |
| Lint | `npm run lint` (`deno lint src tests`) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Mobile E2E only | `npx playwright test tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts` |
| Full E2E | `npx playwright test` |

**Conventions:** No comments in code unless marking subtle invariants. Commit after every green test run. Test files declare `declare const Deno: { test(...) }` and a local `assertEquals` when needed (see `tests/writing-folding.test.ts`). New unit test files must be added to the `test`/`test:unit` scripts in `package.json` **only if they need to run in CI unit suite** — for this plan, unit tests are added to `tests/index.test.ts` imports? No — see note: `tests/index.test.ts` is a single self-contained file; per-file tests like `tests/writing-folding.test.ts` run via `test:integration`. **Decision for this plan:** new unit tests go into standalone files under `tests/` and are run directly with `npx deno test --no-prompt tests/<file>.test.ts` for the TDD loop; the `test:unit` npm script is extended in the final task to include new files, matching how `tests/review-diagnostics.test.ts` is wired.

**Playwright context:** `tests/e2e/pages/MockHost.ts` provides `host.goto(initialText, uuid, locked)` which loads `/test-host.html` and injects the note; `EditorPage` (same dir) exposes locators (`editor.sidebarPane`, `editor.writingEditor`, `editor.outlineHeadings`, `editor.writingLinkButton`, etc.). The app runs inside `page.frameLocator("#editor-frame")`. Default Playwright project is Desktop Chrome; the mobile spec sets `test.use({ viewport: { width: 390, height: 844 } })` per-file.

**Key file facts for the implementer:**

- `src/style.css` — single global stylesheet, 722 lines. Existing blocks: `@media (pointer: coarse)` at line 695, `@media (max-width: 768px)` at line 701, `.outline-structural-actions { display: none; }` at line 214 with hover-reveal at line 215, `.modal-backdrop` at line 394, `.template-modal-content` at line 405.
- `src/app/App.tsx` — `sidebarOpen` initial state line 173; global keydown Ctrl+\ at lines 280–289; `focusHeading` auto-close at lines 407–417.
- `src/editor/WritingEditor.tsx` — `promptAndApplyLink` at lines 228–233 (the only `window.prompt`); called from three sites: toolbar command (`applyPendingCommand` line 710), slash menu (`executeItem` line 262), keyboard shortcut (line 453).
- `src/outline/OutlineRow.tsx` — HTML5 DnD props (`draggable`, `onDragStart/Over/Leave/Drop`) on lines 78–92.
- `src/outline/OutlinePanel.tsx` — DnD handlers lines 61–128; drag state type `OutlineDragState` in `src/outline/OutlineDragState.ts` (keep: `{ draggedAnchor, targetAnchor?, placement? }`).
- `siblingSections(analysis, anchor)` from `src/markdown/analysis.ts` returns sibling sections; `onMoveSubtreeBefore/After` mutations already exist and must be reused (no new sort logic).

---

### Task 1: Height chain — `100dvh` + safe-area padding (CSS only)

**Files:**
- Modify: `src/style.css:77` (`.app-shell`), `src/style.css:703` (768px block), `src/style.css:253` (`.note-meta`), `src/style.css:719` (drawer)

- [ ] **Step 1: Update `.app-shell` height chain and safe-area padding**

In `src/style.css`, replace line 77:

```css
.app-shell { width: 100%; max-width: 100%; height: 100vh; min-height: 100vh; margin: 0; padding: 2px 4px; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; }
```

with:

```css
.app-shell { width: 100%; max-width: 100%; height: 100vh; height: 100dvh; height: var(--vvh, 100dvh); min-height: 100vh; margin: 0; padding: 2px 4px; padding-left: max(4px, env(safe-area-inset-left)); padding-right: max(4px, env(safe-area-inset-right)); display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; }
```

(`--vvh` arrives in Task 4; until then `var(--vvh, 100dvh)` falls back harmlessly. Browsers that don't know `dvh` ignore that declaration and use the preceding `100vh`.)

- [ ] **Step 2: Add safe-area bottom padding to footer**

Replace `.note-meta` (line 253):

```css
.note-meta { font-size: 0.72rem; color: var(--editor-muted); padding: 1px 4px; margin: 0; line-height: 1.2; text-align: right; flex-shrink: 0; opacity: 0.75; }
```

with:

```css
.note-meta { font-size: 0.72rem; color: var(--editor-muted); padding: 1px 4px; padding-bottom: max(1px, env(safe-area-inset-bottom)); margin: 0; line-height: 1.2; text-align: right; flex-shrink: 0; opacity: 0.75; }
```

- [ ] **Step 3: Add safe-area insets to the mobile drawer sidebar**

In the `@media (max-width: 768px)` block, replace the `.workspace-layout.with-sidebar .sidebar-pane` rule (line 719):

```css
  .workspace-layout.with-sidebar .sidebar-pane { position: fixed; top: 0; right: 0; bottom: 0; width: min(85vw, 320px); z-index: 100; background: var(--editor-bg); box-shadow: -4px 0 20px color-mix(in srgb, var(--editor-fg) 25%, transparent); padding: 12px; padding-top: max(12px, env(safe-area-inset-top)); padding-bottom: max(12px, env(safe-area-inset-bottom)); border-left: 1px solid var(--editor-border); }
```

- [ ] **Step 4: Drop the now-redundant mobile height override**

In the `@media (max-width: 768px)` block, replace `.app-shell { padding: 0; height: 100dvh; min-height: 100dvh; }` (line 703) with:

```css
  .app-shell { padding-top: 0; padding-bottom: 0; }
```

(Height chain now lives on the base rule; horizontal safe-area padding from Step 1 still applies via the base rule. The old rule also zeroed horizontal padding — that zeroing is replaced by `max(4px, env(...))` which is what we want on phones too.)

- [ ] **Step 5: Verify mobile E2E still passes**

Run: `npx playwright test tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/style.css
git commit -m "style(mobile): dvh height chain and safe-area insets"
```

---

### Task 2: `useVisualViewport` hook (virtual keyboard height)

**Files:**
- Create: `src/app/useVisualViewport.ts`
- Test: `tests/visual-viewport.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/visual-viewport.test.ts`:

```ts
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { computeViewportHeightCss } from "../src/app/useVisualViewport.ts";

Deno.test("useVisualViewport - computeViewportHeightCss clamps and formats height", () => {
  if (computeViewportHeightCss(0) !== undefined) throw new Error("height 0 must map to undefined");
  if (computeViewportHeightCss(-10) !== undefined) throw new Error("negative height must map to undefined");
  if (computeViewportHeightCss(612) !== "612px") throw new Error("612 must map to '612px'");
  if (computeViewportHeightCss(612.4) !== "612.4px") throw new Error("fractional heights are preserved");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx deno test --no-prompt tests/visual-viewport.test.ts`
Expected: FAIL — module `../src/app/useVisualViewport.ts` not found.

- [ ] **Step 3: Implement the hook**

Create `src/app/useVisualViewport.ts`:

```ts
import { useEffect } from "react";

export function computeViewportHeightCss(height: number): string | undefined {
  if (!(height > 0)) return undefined;
  return `${height}px`;
}

/** Publishes the visual viewport height as --vvh on <html> so .app-shell can shrink when the mobile keyboard opens. */
export function useVisualViewport(): void {
  useEffect(() => {
    if (typeof window === "undefined" || !("visualViewport" in window)) return undefined;
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const root = document.documentElement;
    const publish = () => {
      const css = computeViewportHeightCss(viewport.height);
      if (css) root.style.setProperty("--vvh", css);
    };
    publish();
    viewport.addEventListener("resize", publish);
    viewport.addEventListener("scroll", publish);
    return () => {
      viewport.removeEventListener("resize", publish);
      viewport.removeEventListener("scroll", publish);
      root.style.removeProperty("--vvh");
    };
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx deno test --no-prompt tests/visual-viewport.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Mount the hook in App**

In `src/app/App.tsx`:

Add to imports (after the `installThemeBridge` import, line 36):

```ts
import { useVisualViewport } from "./useVisualViewport";
```

Inside `export function App() {` (after the `bridgeState` line, 208), add:

```ts
  useVisualViewport();
```

- [ ] **Step 6: Typecheck, lint, and run unit suite**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/useVisualViewport.ts src/app/App.tsx tests/visual-viewport.test.ts
git commit -m "feat(mobile): visualViewport hook drives --vvh shell height"
```

---

### Task 3: Coarse-pointer touch targets and persistent outline actions (CSS)

**Files:**
- Modify: `src/style.css:695-699` (`@media (pointer: coarse)` block)

- [ ] **Step 1: Replace the coarse-pointer block**

Replace lines 695–699:

```css
@media (pointer: coarse) {
  .milkdown-writing li[data-item-type="task"] .task-delete { opacity: 0.7; visibility: visible; width: 24px; height: 24px; min-height: 24px; font-size: 16px; }
  .milkdown-writing li[data-item-type="task"] .task-checkbox { width: 18px; height: 18px; min-width: 18px; min-height: 18px; }
  .pane-toolbar button { min-height: 30px; }
}
```

with:

```css
@media (pointer: coarse) {
  .milkdown-writing li[data-item-type="task"] .task-delete { opacity: 0.7; visibility: visible; width: 36px; height: 36px; min-height: 36px; font-size: 16px; }
  .milkdown-writing li[data-item-type="task"] .task-checkbox { width: 22px; height: 22px; min-width: 22px; min-height: 22px; }
  .pane-toolbar button { min-height: 40px; min-width: 42px; }
  .mode-buttons button { min-height: 40px; }
  .sidebar-close-btn { width: 40px; height: 40px; min-width: 40px; min-height: 40px; font-size: 16px; }
  .outline-structural-actions { display: inline-flex; }
  .outline-action-btn { width: 40px; height: 40px; min-width: 40px; min-height: 40px; font-size: 1rem; border-radius: 5px; }
  .section-task-actions button { width: 40px; height: 40px; min-width: 40px; min-height: 40px; font-size: 1rem; border-radius: 5px; }
  .outline-panel li { min-height: 44px; }
  .outline-heading-btn { min-height: 44px; }
  .outline-fold-toggle { width: 28px; min-width: 28px; height: 28px; font-size: 1rem; }
  .outline-drag-handle { width: 32px; min-width: 32px; height: 32px; font-size: 1.1rem; opacity: 0.8; }
}
```

Why `.outline-structural-actions { display: inline-flex; }` works: the desktop rule `.outline-panel li:hover .outline-structural-actions { display: inline-flex; }` (line 215) sets the same value on hover; the coarse-pointer rule overrides the base `display: none` (line 214) unconditionally inside the media query, so actions are always visible on touch. Desktop hover behavior is untouched (media query is false on fine-pointer devices).

- [ ] **Step 2: Add mobile platform-class fallback for host-native apps**

Append directly after the coarse-pointer block (before the `@media (max-width: 768px)` block):

```css
html.mobile .outline-structural-actions { display: inline-flex; }
html.mobile .pane-toolbar button { min-height: 40px; min-width: 42px; }
html.mobile .slash-hint { display: none; }
```

(The Standard Notes component relay adds the host platform string — e.g. `mobile` — as a class on `<html>`. This is a secondary selector; media queries remain the primary trigger.)

- [ ] **Step 3: Add tap-highlight and text-size-adjust globals**

Append after the `html.mobile` rules:

```css
html { -webkit-text-size-adjust: 100%; }
button { -webkit-tap-highlight-color: transparent; }
```

- [ ] **Step 4: Bump modal form inputs to 16px (iOS zoom prevention)**

Replace the `.form-group input, .form-group textarea` rule (line 610):

```css
.form-group input, .form-group textarea {
  padding: 6px 8px;
  border: 1px solid var(--editor-border);
  border-radius: 5px;
  background: var(--editor-bg);
  color: var(--editor-fg);
  font: inherit;
  font-size: 0.84rem;
}
```

with:

```css
.form-group input, .form-group textarea {
  padding: 6px 8px;
  border: 1px solid var(--editor-border);
  border-radius: 5px;
  background: var(--editor-bg);
  color: var(--editor-fg);
  font: inherit;
  font-size: 16px;
}
```

And replace `.template-search-input`'s `font-size: 0.85rem;` (line 479) with `font-size: 16px;`.

- [ ] **Step 5: Verify mobile E2E passes**

Run: `npx playwright test tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/style.css
git commit -m "style(mobile): persistent outline actions and 40px touch targets on coarse pointers"
```

---

### Task 4: Pointer-based outline drag (replaces HTML5 DnD)

The current drag flow: `OutlineRow` HTML5 DnD events → `OutlinePanel` handlers compute `{draggedAnchor, targetAnchor, placement}` → drop calls existing `onMoveSubtreeBefore/After`. We keep that state shape and mutation path, but drive it with Pointer Events plus a long-press activation gate.

**Files:**
- Create: `src/outline/OutlinePointerDrag.ts`
- Modify: `src/outline/OutlineRow.tsx` (remove HTML5 DnD, add pointer handlers)
- Modify: `src/outline/OutlinePanel.tsx` (replace DnD handlers with pointer flow)
- Test: `tests/outline-pointer-drag.test.ts`

- [ ] **Step 1: Write the failing unit test for the activation gate**

Create `tests/outline-pointer-drag.test.ts`:

```ts
declare const Deno: { test(name: string, fn: () => void | Promise<void>): void };

import { createOutlineDragActivationGate } from "../src/outline/OutlinePointerDrag.ts";

function fakeTimers() {
  let now = 0;
  const pending: { id: number; fn: () => void; at: number }[] = [];
  return {
    advance(ms: number) {
      now += ms;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].at <= now) {
          const job = pending.splice(i, 1)[0];
          job.fn();
        }
      }
    },
    setTimeout: (fn: () => void, ms: number) => {
      const id = pending.length + 1;
      pending.push({ id, fn, at: now + ms });
      return id;
    },
    clearTimeout: (id: number) => {
      const index = pending.findIndex((p) => p.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
  };
}

Deno.test("OutlinePointerDrag - hold 250ms without movement activates drag", () => {
  const t = fakeTimers();
  const gate = createOutlineDragActivationGate(t.setTimeout, t.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  t.advance(200);
  gate.move(105, 204);
  t.advance(60);
  if (events.length !== 0) throw new Error("must not activate early");
  t.advance(60);
  if (events.join(",") !== "activated") throw new Error("small movement within tolerance must still activate");
});

Deno.test("OutlinePointerDrag - movement beyond 10px tolerance cancels pending activation", () => {
  const t = fakeTimers();
  const gate = createOutlineDragActivationGate(t.setTimeout, t.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  gate.move(111, 200);
  if (events.join(",") !== "cancelled") throw new Error("horizontal overscroll must cancel before timer fires");
  t.advance(300);
  if (events.join(",") !== "cancelled") throw new Error("timer must not fire after cancel");
});

Deno.test("OutlinePointerDrag - pointerup before hold completes cancels", () => {
  const t = fakeTimers();
  const gate = createOutlineDragActivationGate(t.setTimeout, t.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  gate.up();
  t.advance(300);
  if (events.join(",") !== "cancelled") throw new Error("early release must cancel, not activate");
});

Deno.test("OutlinePointerDrag - after activation, move events do not re-trigger", () => {
  const t = fakeTimers();
  const gate = createOutlineDragActivationGate(t.setTimeout, t.clearTimeout);
  const events: string[] = [];
  gate.onActivate(() => events.push("activated"));
  gate.onCancel(() => events.push("cancelled"));
  gate.start(100, 200);
  t.advance(260);
  gate.move(150, 300);
  gate.move(200, 400);
  if (events.join(",") !== "activated") throw new Error("post-activation movement must not cancel or double-activate");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx deno test --no-prompt tests/outline-pointer-drag.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `OutlinePointerDrag.ts`**

Create `src/outline/OutlinePointerDrag.ts`:

```ts
export const OUTLINE_DRAG_HOLD_MS = 250;
export const OUTLINE_DRAG_MOVE_TOLERANCE_PX = 10;

type Timer = { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void };

/** Long-press gate for outline drag: activates after HOLD_MS without movement beyond tolerance. */
export function createOutlineDragActivationGate(
  setTimeoutImpl: (fn: () => void, ms: number) => number,
  clearTimeoutImpl: (id: number) => void,
) {
  let startX = 0;
  let startY = 0;
  let timerId: number | undefined;
  let activated = false;
  let activate: () => void = () => {};
  let cancel: () => void = () => {};
  return {
    onActivate(fn: () => void) { activate = fn; },
    onCancel(fn: () => void) { cancel = fn; },
    start(x: number, y: number) {
      startX = x;
      startY = y;
      activated = false;
      timerId = setTimeoutImpl(() => {
        timerId = undefined;
        activated = true;
        activate();
      }, OUTLINE_DRAG_HOLD_MS);
    },
    move(x: number, y: number) {
      if (activated || timerId === undefined) return;
      if (Math.abs(x - startX) > OUTLINE_DRAG_MOVE_TOLERANCE_PX || Math.abs(y - startY) > OUTLINE_DRAG_MOVE_TOLERANCE_PX) {
        this.up();
      }
    },
    up() {
      if (timerId !== undefined) {
        clearTimeoutImpl(timerId);
        timerId = undefined;
      }
      if (!activated) {
        activated = true;
        cancel();
      }
    },
  };
}

/** Find the outline row anchor under a point, if any. */
export function outlineRowAnchorAtPoint(x: number, y: number, container: ParentNode): number | undefined {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest?.(".outline-row");
  if (!row || !container.contains(row)) return undefined;
  const anchor = Number((row as HTMLElement).dataset.anchor);
  return Number.isFinite(anchor) ? anchor : undefined;
}
```

(Note: the fake-timer test drives the pure gate with injected timer functions; `outlineRowAnchorAtPoint` is DOM-only and is covered by E2E.)

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx deno test --no-prompt tests/outline-pointer-drag.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite `OutlineRow.tsx` drag wiring**

In `src/outline/OutlineRow.tsx`:

1. Replace the four DnD props in `OutlineRowProps` (lines 29–32) with:

```ts
  onHandlePointerDown: (anchor: number, e: React.PointerEvent) => void;
```

2. Remove `onDragStart`, `onDragOver`, `onDragLeave`, `onDrop` from the destructuring (lines 55–58) and add `onHandlePointerDown,`.

3. Replace the `<li>` opening (lines 78–83):

```tsx
    <li
      data-anchor={heading.from}
      className={`level-${heading.level} outline-row ${dropPlacement ? `drop-${dropPlacement}` : ""} ${isActive ? "active-row" : ""} ${isFocused ? "focused-row" : ""} ${isDragging ? "dragging" : ""}`}
    >
```

4. Replace the drag handle span (lines 85–92):

```tsx
        <span
          className="outline-drag-handle"
          onPointerDown={(e) => onHandlePointerDown(heading.from, e)}
          title={readOnly ? undefined : "Hold, then drag to reorder sibling section"}
        >
          ⠿
        </span>
```

(`draggable` attribute and `onDragStart` are gone — pointer events serve mouse and touch alike.)

5. Add `isDragging?: boolean;` to `OutlineRowProps` (next to `dropPlacement`).

- [ ] **Step 6: Rewrite `OutlinePanel.tsx` drag flow**

Replace `handleDragStart`/`handleDragOver`/`handleDragLeave`/`handleDrop`/`handleDragEnd` (lines 61–128) with:

```tsx
  const dragSessionRef = useRef<{
    anchor: number;
    gate: ReturnType<typeof createOutlineDragActivationGate>;
  } | undefined>();
  const [dragState, setDragState] = useState<OutlineDragState | undefined>();
  const [draggingAnchor, setDraggingAnchor] = useState<number>();

  const commitDrop = (targetAnchor: number) => {
    const session = dragSessionRef.current;
    if (!session || session.anchor === targetAnchor) return;
    const siblings = siblingSections(analysis, session.anchor);
    if (!siblings.some((s) => s.anchor === targetAnchor)) return;
    const placement = dragStateRef.current?.placement ?? "before";
    if (placement === "before") onMoveSubtreeBefore(session.anchor, targetAnchor);
    else onMoveSubtreeAfter(session.anchor, targetAnchor);
  };

  const endDrag = () => {
    dragSessionRef.current?.gate.up();
    dragSessionRef.current = undefined;
    setDraggingAnchor(undefined);
    setDragState(undefined);
  };
```

For `commitDrop` to read the latest drag state without stale-closure risk, add a ref mirror right after `dragState`:

```tsx
  const dragStateRef = useRef<OutlineDragState | undefined>();
  dragStateRef.current = dragState;
```

The row pointer-down handler:

```tsx
  const handleHandlePointerDown = (anchor: number, e: React.PointerEvent) => {
    if (readOnly) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const handle = e.currentTarget as HTMLElement;
    const list = handle.closest(".outline-panel");
    if (!list) return;
    const gate = createOutlineDragActivationGate(window.setTimeout.bind(window), window.clearTimeout.bind(window));
    gate.onActivate(() => {
      try { handle.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
      document.body.classList.add("outline-pointer-dragging");
      setDraggingAnchor(anchor);
    });
    gate.onCancel(() => { dragSessionRef.current = undefined; });
    dragSessionRef.current = { anchor, gate };
    gate.start(e.clientX, e.clientY);
  };
```

Window-level move/up listeners that live for the session (attach on activation):

```tsx
  useEffect(() => {
    if (draggingAnchor === undefined) return undefined;
    const handleMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;
      if (!event.buttons && event.pointerType === "mouse") { endDrag(); return; }
      const targetAnchor = outlineRowAnchorAtPoint(event.clientX, event.clientY, listEl);
      if (targetAnchor === undefined || targetAnchor === draggingAnchor) {
        setDragState((prev) => (prev && prev.targetAnchor !== undefined ? { draggedAnchor: prev.draggedAnchor } : prev));
        return;
      }
      const siblings = siblingSections(analysis, draggingAnchor);
      if (!siblings.some((s) => s.anchor === targetAnchor)) return;
      const row = listEl.querySelector(`.outline-row[data-anchor="${targetAnchor}"]`) as HTMLElement | null;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const placement: "before" | "after" = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      setDragState({ draggedAnchor: draggingAnchor, targetAnchor, placement });
    };
    const handleUp = () => {
      const session = dragSessionRef.current;
      if (session) {
        const targetAnchor = dragStateRef.current?.targetAnchor;
        if (targetAnchor !== undefined) commitDrop(targetAnchor);
      }
      endDrag();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", endDrag);
      document.body.classList.remove("outline-pointer-dragging");
    };
  }, [draggingAnchor, analysis]);
```

`listEl` — capture the panel's `<ol>` container via a ref. Change the `<ol className="outline-list">` to `<ol className="outline-list" ref={listRef}>` and add `const listRef = useRef<HTMLOListElement>(null); const listEl = listRef.current;` near the top of the component. **Important:** `listEl` may be null when the sidebar is hidden on the first render; `handleMove` already guards by checking `outlineRowAnchorAtPoint`'s container — make it `if (!listEl) return;` at the top of `handleMove` and `handleHandlePointerDown` uses `handle.closest(".outline-panel")` (always live since the handle itself is inside it).

Update the `OutlineRow` usage in the map: pass `onHandlePointerDown={handleHandlePointerDown}`, `isDragging={draggingAnchor === heading.from}`, and remove the four DnD props. Also import `useRef, useEffect` (add `useEffect` — `useRef` may already be absent; current imports are `React, { useState }`) and import `createOutlineDragActivationGate, outlineRowAnchorAtPoint` from `./OutlinePointerDrag.ts`. Remove `onDragEnd` from the `<section>` wrapper.

Also pass placement from state as before: keep `dropPlacement={dragState?.targetAnchor === heading.from ? dragState.placement : undefined}`.

- [ ] **Step 7: Add drag visuals CSS**

Append to `src/style.css` (after the `.outline-drag-handle` rules, ~line 207):

```css
.outline-drag-handle { touch-action: none; }
body.outline-pointer-dragging { user-select: none; }
.outline-panel li.dragging { opacity: 0.45; box-shadow: 0 4px 14px color-mix(in srgb, var(--editor-fg) 25%, transparent); }
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Run the outline-related unit tests and integration boundary**

Run: `npx deno test --no-prompt tests/outline-pointer-drag.test.ts tests/outline-projection.test.ts tests/structural-editing.test.ts && npm run test:integration`
Expected: all pass.

- [ ] **Step 10: Add E2E test for pointer drag + persistent buttons**

In `tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`, append inside the describe block:

```ts
  test("Outline structural buttons are visible without hover and meet 40px touch targets", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Alpha\n\nAlpha body.\n\n# Beta\n\nBeta body.\n", "note-mobile-outline-btns", false);
    await expect(editor.status).toHaveText("Ready");

    await editor.sidebarToggleBtn.click();
    await expect(editor.sidebarPane).toBeVisible();

    const upButton = editor.outlinePanel.locator("li[data-anchor] .outline-structural-actions button").first();
    await expect(upButton).toBeVisible();
    const box = await upButton.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    expect(box!.width).toBeGreaterThanOrEqual(40);
  });

  test("Pointer drag reorders outline sibling sections after long-press", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Alpha\n\nAlpha body.\n\n# Beta\n\nBeta body.\n\n# Gamma\n\nGamma body.\n", "note-mobile-outline-drag", false);
    await expect(editor.status).toHaveText("Ready");

    await editor.sidebarToggleBtn.click();
    await expect(editor.sidebarPane).toBeVisible();

    const rows = editor.outlinePanel.locator("li[data-anchor]");
    await expect(rows).toHaveCount(3);

    const gammaHandle = rows.nth(2).locator(".outline-drag-handle");
    const betaRow = rows.nth(1);
    const betaBox = await betaRow.boundingBox();
    await page.mouse.move(gammaHandleBoundingBox.x + 4, gammaHandleBoundingBox.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(betaBox.x + 20, betaBox.y + 2, { steps: 8 });
    await page.mouse.up();

    await expect(rows.nth(1).locator(".outline-heading-btn")).toContainText("Gamma");
    await editor.switchMode("Source");
    const text = await editor.getSourceText();
    if (!text.includes("Gamma body.") || text.indexOf("Gamma body.") < text.indexOf("Beta body.")) {
      throw new Error("Gamma must move before Beta");
    }
  });
```

The second test needs the Gamma handle box; compute it before `mouse.down()`:

```ts
    const gammaHandleBoundingBox = await gammaHandle.boundingBox();
```

Place this line immediately after `const gammaHandle = rows.nth(2).locator(".outline-drag-handle");`.

**Note on pointer events in Playwright:** desktop Chromium fires pointer events for `page.mouse` actions, and `pointerType` will be `"mouse"`, so `event.buttons` checks in `handleMove` apply; the long-press wait (`waitForTimeout(400) > 250ms hold`) satisfies the gate. If `page.mouse.move` before `waitForTimeout` causes a >10px drift, the steps-based move after the hold is what matters — the initial move is a tap-position, not a drag.

- [ ] **Step 11: Run the full mobile spec**

Run: `npx playwright test tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`
Expected: 5 passed (3 existing + 2 new).

- [ ] **Step 12: Commit**

```bash
git add src/outline/OutlinePointerDrag.ts src/outline/OutlineRow.tsx src/outline/OutlinePanel.tsx src/style.css tests/outline-pointer-drag.test.ts tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts
git commit -m "feat(mobile): pointer-based outline drag with long-press activation"
```

---

### Task 5: `LinkDialogModal` replaces `window.prompt`

**Files:**
- Create: `src/editor/LinkDialogModal.tsx`
- Modify: `src/editor/WritingEditor.tsx` (async link flow)
- Test: E2E in `tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`

- [ ] **Step 1: Create the modal component**

Create `src/editor/LinkDialogModal.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";

export type LinkDialogModalProps = {
  isOpen: boolean;
  initialHref: string;
  onCancel: () => void;
  onConfirm: (href: string) => void;
};

export function LinkDialogModal({ isOpen, initialHref, onCancel, onConfirm }: LinkDialogModalProps) {
  const [href, setHref] = useState(initialHref);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) setHref(initialHref);
  }, [isOpen, initialHref]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="link-dialog-content template-modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Insert link"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="template-modal-header">
          <span className="link-dialog-title">Insert link</span>
        </div>
        <form
          className="link-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(href);
          }}
        >
          <input
            ref={inputRef}
            className="link-dialog-input"
            type="url"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="https://example.com"
            aria-label="Link URL"
            enterKeyHint="done"
          />
          <div className="link-dialog-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn-primary">OK</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add modal CSS**

Append to `src/style.css` (after the template-modal block, before the coarse-pointer media query):

```css
.link-dialog-content { max-width: 420px; }
.link-dialog-form { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
.link-dialog-input { padding: 8px 10px; border: 1px solid var(--editor-border); border-radius: 5px; background: var(--editor-bg); color: var(--editor-fg); font: inherit; font-size: 16px; }
.link-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.link-dialog-actions button { min-height: 40px; min-width: 72px; }
.link-dialog-title { font-weight: 600; font-size: 0.95rem; }
```

- [ ] **Step 3: Rewrite the link flow in `WritingEditor.tsx`**

`promptAndApplyLink` is called from three places (toolbar `applyPendingCommand` line 710, slash menu `executeItem` line 262, keyboard shortcut line 453). The prompt cannot block inside ProseMirror key handlers, so the flow becomes: capture the pending link request (view + range) in a ref, open the modal, then apply on confirm.

1. Add state + refs inside `WritingEditor` (after `appliedInsert`, ~line 671):

```ts
  const [linkDialog, setLinkDialog] = useState<{ initialHref: string } | undefined>();
  const pendingLinkRef = useRef<{ view: ProseEditorView; range?: SlashMatch }>();
```

2. Add the confirm/cancel handlers (after `applyPendingInsert`):

```ts
  const applyLinkFromDialog = (href: string) => {
    const pending = pendingLinkRef.current;
    pendingLinkRef.current = undefined;
    setLinkDialog(undefined);
    if (!pending) return;
    const trimmed = href.trim();
    if (!trimmed) return;
    applyWritingCommand(pending.view, "link", pending.range, trimmed);
  };

  const cancelLinkDialog = () => {
    pendingLinkRef.current = undefined;
    setLinkDialog(undefined);
  };
```

3. Change `promptAndApplyLink` (lines 228–233) to a non-blocking opener. Replace the function:

```ts
function requestWritingLink(view: ProseEditorView, editability: WritingEditability, openDialog: (initialHref: string) => void, range?: SlashMatch): boolean {
  if (!canApplyWritingLink(view, editability)) return false;
  openDialog(writingLinkHref(view) ?? "");
  return true;
}
```

4. Every call site stores the pending request and opens the dialog:

- Keyboard shortcut plugin (line 453): the plugin is created once at editor build, so it must read the opener through a stable ref. Add a parameter: `writingKeyboardShortcutsPlugin(editability, openLinkDialogRef)` where `openLinkDialogRef: { current?: (view: ProseEditorView, range?: SlashMatch) => void }`. Change the call inside it:

```ts
        if (isWritingLinkShortcut(event)) {
          if (!canApplyWritingLink(view, editability)) return false;
          event.preventDefault();
          openLinkDialogRef.current?.(view);
          return true;
        }
```

- Slash menu `executeItem` (line 262): `slashMenuPlugin` already receives refs; add `openLinkDialogRef` the same way, and change the link branch:

```ts
        if (item.name === "link") openLinkDialogRef.current?.(currentView, range);
        else applyWritingCommand(currentView, item.name, range);
```

- Toolbar command `applyPendingCommand` (line 710): change to:

```ts
      if (pending.name === "link") openLinkDialogRef.current?.(view);
      else applyWritingCommand(view, pending.name);
```

5. Wire the ref in `WritingEditor` body (before `configureWritingEditor` call):

```ts
  const openLinkDialogRef = useRef<(view: ProseEditorView, range?: SlashMatch) => void>();
  openLinkDialogRef.current = (view, range) => {
    pendingLinkRef.current = { view, range };
    setLinkDialog({ initialHref: writingLinkHref(view) ?? "" });
  };
```

Pass `openLinkDialogRef` into `configureWritingEditor` (extend `WritingEditorConfiguration` with `openLinkDialogRef`) and from there into `slashMenuPlugin(editability, libraryRef, serializerRef, parserRef, openLinkDialogRef)` and `writingKeyboardShortcutsPlugin(editability, openLinkDialogRef)`.

6. Render the modal — replace the return (line 800):

```tsx
  return <>
    <div className={`milkdown-writing${readOnly ? " is-readonly" : ""}`} ref={host} onClick={handleClick} aria-label="Writing editor" />
    <LinkDialogModal
      isOpen={linkDialog !== undefined}
      initialHref={linkDialog?.initialHref ?? ""}
      onConfirm={applyLinkFromDialog}
      onCancel={cancelLinkDialog}
    />
  </>;
```

Import `LinkDialogModal` and `useState` (`React, { useEffect, useRef }` → add `useState`) at the top of `WritingEditor.tsx`.

**Key detail:** `writingLinkHref(view)` must be called *when the dialog opens* (not from the pending ref later) because the selection may move; `applyLinkFromDialog` relies on `pending.view`'s stored selection state inside `applyWritingCommand(view, "link", range, href)` — the existing `applyWritingCommand` link plan already reads the current selection/range, and ProseMirror views are live objects, so the stored `view` reference stays valid even after focus moves to the dialog input (ProseMirror keeps its selection when unfocused). If E2E shows the selection is lost when the input steals focus, add `view.focus()` restoration in `applyLinkFromDialog` before `applyWritingCommand` — the E2E test in Step 5 verifies the actual behavior, and the fallback is one line.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Add E2E test for the link dialog**

In `tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`, append inside the describe block:

```ts
  test("Link button opens modal dialog instead of window.prompt; confirm inserts anchor", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    let promptCalls = 0;
    await page.exposeFunction("__promptSpy", () => { promptCalls += 1; });
    await host.goto("# Link Note\n\nSome text.\n", "note-mobile-link", false);
    await expect(editor.status).toHaveText("Ready");

    await editor.writingEditor.click();
    await editor.writingEditor.locator("p").last().click();
    await page.keyboard.type("Link text");
    await page.keyboard.press("Shift+Home");

    await editor.writingLinkButton.click();

    const dialog = editor.frame.locator(".link-dialog-content");
    await expect(dialog).toBeVisible();
    const input = dialog.locator("input.link-dialog-input");
    await input.fill("https://example.com/mobile");
    await dialog.getByRole("button", { name: "OK" }).click();

    await expect(dialog).not.toBeVisible();
    const anchor = editor.writingEditor.locator('a[href="https://example.com/mobile"]');
    await expect(anchor).toContainText("Link text");

    await editor.switchMode("Source");
    await expect(editor.sourceEditor).toContainText("[Link text](https://example.com/mobile)");
  });
```

(The `exposeFunction` spy is defensive: Playwright auto-dismisses `window.prompt`, which would silently swallow the old flow; a zero count asserts we never regress to prompt.)

**Wait — `Shift+Home` selects within the current line in contenteditable but the typed text is in the last paragraph;** simplify selection to avoid fragile keyboard selection: after typing "Link text", double-click the word to select it:

```ts
    await editor.writingEditor.locator("p").last().dblclick();
```

Replace the `Shift+Home` line with the `dblclick` (keep `await page.keyboard.type("Link text");` before it — double-click selects the whole word run "Link text").

- [ ] **Step 6: Run the full mobile spec**

Run: `npx playwright test tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add src/editor/LinkDialogModal.tsx src/editor/WritingEditor.tsx src/style.css tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts
git commit -m "feat(editor): LinkDialogModal replaces window.prompt on all platforms"
```

---

### Task 6: Responsive sidebar state via `matchMedia`

**Files:**
- Modify: `src/app/App.tsx:173` and the keydown effect (lines 280–289)

- [ ] **Step 1: Replace the one-shot initial state with a matchMedia-driven state**

Replace line 173:

```ts
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== "undefined" ? window.innerWidth > 900 : true);
```

with:

```ts
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 900px)").matches ? false : true : true);
  const sidebarManuallyToggled = useRef(false);
```

- [ ] **Step 2: Add the breakpoint listener effect**

After the Ctrl+\ keydown effect (lines 280–289), add:

```ts
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(max-width: 900px)");
    const listener = () => {
      if (sidebarManuallyToggled.current) return;
      setSidebarOpen(!query.matches);
    };
    listener();
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
```

(The immediate `listener()` call aligns state if the initial lazy state and the query ever disagree, e.g. viewport changed between render and effect.)

- [ ] **Step 3: Record manual toggles**

Mark every user-initiated toggle. In the Ctrl+\ handler (line 284) change:

```ts
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        sidebarManuallyToggled.current = true;
        setSidebarOpen((open) => !open);
      }
```

The three `onClick` sites — `SidebarToggleButton` usage (lines 489, 504, 505: `onToggle={() => setSidebarOpen((open) => !open)}`), backdrop (line 508), close button (line 510), and `focusHeading`'s auto-close (line 411) — all funnel through `setSidebarOpen`. Rather than touching each call site, wrap the setter:

```ts
  const toggleSidebar = useCallback(() => {
    sidebarManuallyToggled.current = true;
    setSidebarOpen((open) => !open);
  }, []);
  const closeSidebar = useCallback(() => {
    sidebarManuallyToggled.current = true;
    setSidebarOpen(false);
  }, []);
```

Use `toggleSidebar` for `SidebarToggleButton`'s `onToggle` (all three toolbars) and the Ctrl+\ handler; use `closeSidebar` for the backdrop `onClick`, the sidebar close button, and `focusHeading`'s auto-close. Leave the effect's `setSidebarOpen(!query.matches)` as the only non-manual writer.

- [ ] **Step 4: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: all pass.

- [ ] **Step 5: Run mobile E2E**

Run: `npx playwright test tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts`
Expected: 6 passed (auto-close on heading selection still works because `closeSidebar` sets the manual flag — intentional: after the drawer auto-closes on heading jump, the user has interacted, so resize should not reopen it).

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(mobile): matchMedia-driven sidebar state with manual-override tracking"
```

---

### Task 7: Final wiring — unit test script, full verification

**Files:**
- Modify: `package.json` (test scripts), `docs/user-guide.md` (mobile section)
- Test: full suites

- [ ] **Step 1: Add new unit tests to the npm test scripts**

In `package.json`, change:

```json
    "test": "deno test --no-prompt tests/index.test.ts tests/review-diagnostics.test.ts",
    "test:unit": "deno test --no-prompt tests/index.test.ts tests/review-diagnostics.test.ts",
```

to:

```json
    "test": "deno test --no-prompt tests/index.test.ts tests/review-diagnostics.test.ts tests/visual-viewport.test.ts tests/outline-pointer-drag.test.ts",
    "test:unit": "deno test --no-prompt tests/index.test.ts tests/review-diagnostics.test.ts tests/visual-viewport.test.ts tests/outline-pointer-drag.test.ts",
```

- [ ] **Step 2: Run the full local verification matrix**

Run:

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration && npx playwright test
```

Expected: typecheck clean, lint clean, unit pass, integration pass, all E2E specs pass (including the 6 mobile tests and every pre-existing desktop spec — desktop hover-reveal must be intact on fine-pointer viewports, `user-scalable=no` unchanged).

- [ ] **Step 3: Document mobile behavior in the user guide**

In `docs/user-guide.md`, add a subsection under the modes overview chapter (after the sidebar chapter fits best — match the existing chapter structure; the file is in Chinese):

```markdown
## 行動裝置使用說明

在手機或平板（觸控裝置）上，編輯器會自動調整：

- 側邊欄（大綱與已完成任務）在小螢幕會變成抽屜：點工具列的「Sidebar」開啟，點標題導覽後自動關閉。
- 大綱列的 ↑↓←→⧉ 與任務按鈕在觸控裝置上永遠顯示，且加大為 40px 以上的點擊目標。
- 大綱拖曳排序：按住 ⠿ 把手約四分之一秒後即可拖動到同層兄弟節段的上下位置。
- 插入連結（工具列 Link、Ctrl+K、斜線選單）會開啟內建對話框輸入網址，不再使用瀏覽器 prompt。
- 虛擬鍵盤彈出時編輯區會自動縮到可視範圍，游標行與狀態列不會被鍵盤遮住。
- 畫面邊緣（劉海、Home 橫條）會保留安全距離。

注意：`user-scalable=no` 是刻意保留的——編輯器 iframe 內的雙指縮放會干擾編輯手勢；需要縮放時請使用系統層級的無障礙縮放或 Standard Notes 主應用的縮放功能。
```

- [ ] **Step 4: Commit**

```bash
git add package.json docs/user-guide.md
git commit -m "docs(user-guide): mobile usage section; wire new unit tests into CI scripts"
```

---

## Self-Review Notes (already applied)

- **Spec coverage check:** §1 height/keyboard/safe-area → Tasks 1–2; §2 touch targets + outline drag → Tasks 3–4; §3 link modal + input typography + responsive sidebar + platform class + misc CSS → Tasks 3, 5, 6; §6 testing → unit tests in Tasks 2/4, E2E in Tasks 4/5, full matrix in Task 7; user-guide documentation → Task 7.
- **Type consistency:** `OutlineDragState` shape unchanged; `onMoveSubtreeBefore/After` reused; `createOutlineDragActivationGate`/`outlineRowAnchorAtPoint` names consistent between Task 4 test and implementation; `openLinkDialogRef` signature `(view: ProseEditorView, range?: SlashMatch) => void` consistent across plugin params and call sites; `--vvh` variable name consistent between Task 2 hook and Task 1 CSS.
- **Placeholder scan:** none — every step carries complete code or exact edit instructions.