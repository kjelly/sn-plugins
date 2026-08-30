# Mobile-Friendly Editor Experience — Design

Date: 2026-08-30
Status: Approved (brainstorming complete)

## Problem

Markdown Notes+ runs inside a Standard Notes iframe (web, desktop, and React Native
mobile hosts). While a baseline mobile pass exists (drawer sidebar ≤768px,
horizontally scrolling toolbar, `pointer: coarse` task-delete visibility,
`100dvh` on small screens, one E2E spec at 390×844), an audit found these
blockers and gaps on touch devices:

1. **Virtual keyboard**: no `visualViewport` handling anywhere. `100vh` (not
   `dvh`) is used above 768px. The keyboard overlays the editor.
2. **Safe areas**: `viewport-fit=cover` is set in the meta tag but
   `env(safe-area-inset-*)` is never used in CSS. Notch / home indicator can
   clip content.
3. **Outline structural actions unusable on touch**: `OutlineRow.tsx:86-92`
   uses HTML5 drag-and-drop (never fires on touch); the ↑↓←→⧉ buttons are
   hover-revealed (style.css:214) with **no mobile override**, and are 18×18px.
4. **Touch targets below guidance**: toolbar buttons 30px, task-delete 24×24,
   task checkbox 18×18, outline action buttons 18×18.
5. **Link insertion uses `window.prompt`** (`WritingEditor.tsx:230`) —
   unreliable or suppressed in RN WebViews; no way to prefill nicely on any
   platform.
6. **One-shot responsive check**: sidebar initial state checks `innerWidth`
   once at mount (`App.tsx:173`); rotation/desktop window resize never
   re-evaluates.
7. **iOS input auto-zoom**: modal form inputs are <16px font
   (style.css:479, 617), which triggers iOS Safari's zoom-on-focus.
8. **Host platform signal unused**: component-relay adds the host platform as
   a class on `<html>` (e.g. `mobile`); CSS/JS never consume it.

## Goals

- Full mobile experience parity for the four editor modes (Writing, Source,
  Split, Mind Map) without redesigning the UI.
- Platform-agnostic implementation (standard web APIs: `dvh`,
  `visualViewport`, safe-area, pointer events) — no iOS/Android branches.
- Desktop behavior unchanged.

## Non-Goals

- No bottom toolbar / gesture navigation / mobile-specific UI redesign.
- No change to `handleRequestForContentHeight` or iframe sizing (host-owned).
- No `interactive-widget` meta (Safari-only, resizes the whole iframe).
- No `isRunningInMobileApplication()` JS branching.
- No change to the viewport meta's `user-scalable=no` (pinch-zoom inside the
  editor iframe breaks editing gestures; host-level zoom remains available).
  Rationale documented in the user guide instead.

## Strategy

**Approach A + platform class**: CSS media queries are the backbone
(`pointer: coarse`, `max-width`, safe-area env functions). JavaScript only
where CSS cannot do the job: virtual keyboard, pointer-based drag, link
dialog, matchMedia listener. The relay-provided platform class on
`<html>` is consumed opportunistically as a secondary CSS selector — it is
never the sole trigger (it arrives asynchronously after ready).

## Design

### 1. Height, virtual keyboard, safe areas

**Height chain** — `.app-shell` gets a modern height chain globally (not only
≤768px). The `var(--vvh)` layer is added in section 1.2; final chain:

```css
.app-shell {
  height: 100vh;                    /* fallback */
  height: 100dvh;                   /* modern browsers */
  height: var(--vvh, 100dvh);       /* keyboard-aware (see below) */
}
```

**Virtual keyboard hook** — new `useVisualViewport()` (in `src/app/hooks/` or
beside App):
- Guards `typeof window === "undefined" || !window.visualViewport` → no-op
  (Deno/SSR safe).
- Listens to `visualViewport` `resize` and `scroll`; writes
  `--vvh: <visualViewport.height>px` on `document.documentElement.style`.
- When the keyboard opens, the shell shrinks to the visible viewport so the
  caret line and footer remain reachable.
- Removed on cleanup. No interaction with `handleRequestForContentHeight`
  (the app reports fixed-height `scrollHeight`; the host keeps iframe sizing).

**Safe areas**:

```css
.app-shell {
  padding-left: max(4px, env(safe-area-inset-left));
  padding-right: max(4px, env(safe-area-inset-right));
}
footer.note-meta { padding-bottom: max(4px, env(safe-area-inset-bottom)); }
```

The mobile sidebar drawer (fixed, `inset: 0`) gets
`padding-top: max(12px, env(safe-area-inset-top))` on its header and
`padding-bottom: env(safe-area-inset-bottom)` on its container.

### 2. Touch targets and outline panel

**Persistent outline actions** (`@media (pointer: coarse)`, with the `.mobile`
html class as a secondary selector so host-native mobile apps get the same
treatment even before media query kicks in):

```css
@media (pointer: coarse) {
  .outline-structural-actions { display: flex; }        /* overrides display:none */
  .outline-structural-actions button,
  .outline-task-actions button { width: 40px; height: 40px; }
  .pane-toolbar button { min-height: 40px; min-width: 42px; }
  .sidebar-close-btn { width: 40px; height: 40px; }
  .task-delete { width: 36px; height: 36px; }
  .task-checkbox { width: 22px; height: 22px; }
  /* fold gutters, mode buttons similarly */
}
```

Desktop hover-reveal behavior is preserved (the media query only applies on
coarse pointers).

**Pointer-based outline drag** (`OutlineRow.tsx`):
- Remove `draggable` / HTML5 DnD entirely; one pointer-event implementation
  for mouse + touch.
- Drag handle gets `onPointerDown`: start after a **250ms hold** (long-press)
  so vertical scroll gestures can cancel (pointermove beyond a 10px
  horizontal+vertical tolerance cancels the pending hold).
- On activation: `setPointerCapture`, handle gets `touch-action: none` class,
  dragged row gains `.dragging` (opacity + shadow), target drop position shows
  a 2px insertion line.
- `pointermove` uses `document.elementFromPoint(x, y)` to hit-test sibling
  `.outline-row` containers; `pointerup` commits via the **existing
  `onReorder` mutation** — no new sort logic.
- Cancel on `pointercancel` (system gesture steals the pointer).

### 3. Link dialog modal (replaces `window.prompt`)

- New `LinkDialogModal` (in `src/editor/`): single URL text input prefilled
  with the existing href (when editing), confirm/cancel buttons, backdrop
  click closes, Esc closes.
- Reuses the `TemplateManagerModal` styling pattern
  (`.modal-backdrop`/`.template-modal-content`) narrowed to `max-width: 420px`.
- Input: `font-size: 16px` (prevents iOS zoom), `enterkeyhint="done"`.
  The input autofocuses when the dialog opens (all platforms); on
  coarse-pointer devices this pulls the OS keyboard immediately, which is
  expected for a URL-entry dialog.
- `promptAndApplyLink` (`WritingEditor.tsx:228-233`) becomes async through the
  modal: pending view state stored in a ref; confirm applies the existing
  link command; cancel is a no-op. Used on **all platforms** (desktop too).
- Slash menu / toolbar Ctrl+K paths route through the same modal.

### 4. Input typography and misc CSS

- All form inputs inside modals get `font-size: 16px` (Template manager,
  link dialog) — prevents iOS auto-zoom.
- `html { -webkit-text-size-adjust: 100%; }`
- `button { -webkit-tap-highlight-color: transparent; }`
- Outline drag handle: `touch-action: none` while armed.
- `.mobile` platform class: hide `.slash-hint` (already hidden ≤768px; extend
  to host-mobile regardless of width).

### 5. Responsive sidebar state

`App.tsx:173` one-shot `innerWidth > 900` becomes a
`matchMedia("(max-width: 900px)")` listener:
- Crossing the breakpoint auto-closes/opens the sidebar **only if the user
  has not manually toggled it** in this session (manual toggles recorded in a
  ref).
- Existing behavior preserved: initial state closed on ≤900px, auto-close on
  heading selection ≤768px (`App.tsx:407-417`).

### 6. Testing

Extend `tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts` (390×844
project):
- Outline structural buttons visible and ≥40px (bounding-box assertions).
- Pointer-drag an outline row via `page.mouse` (pointer events fire for
  mouse; long-press tolerance verified by first scrolling attempt that
  cancels).
- Link dialog: open via toolbar Link button, type URL, confirm, assert
  `a[href]` appears in writing mode.
- `--vvh` CSS variable present after load (mock/inject `visualViewport` in
  the harness or assert the fallback chain).
- Modal inputs compute to 16px font.
- Existing 3 mobile tests keep passing.

Unit tests (Deno): `useVisualViewport` no-op guards; link dialog open/confirm/
cancel state machine if extracted to a pure helper.

## Components and files touched

| File | Change |
|---|---|
| `src/style.css` | height chain, safe areas, coarse-pointer block expansion, tap-highlight, 16px modal inputs |
| `src/app/App.tsx` | matchMedia sidebar listener + manual-override ref; mount `useVisualViewport` |
| `src/app/hooks/useVisualViewport.ts` (new) | keyboard-aware height variable |
| `src/editor/WritingEditor.tsx` | `promptAndApplyLink` → LinkDialogModal flow |
| `src/editor/LinkDialogModal.tsx` (new) | URL input modal |
| `src/templates/TemplateManagerModal.tsx` | 16px input font (CSS-level) |
| `src/outline/OutlineRow.tsx` | pointer drag, remove HTML5 DnD |
| `tests/e2e/specs/7_mobile_viewport_and_touch.spec.ts` | new cases |

## Error handling

- `visualViewport` absent (old WebView, Deno tests) → CSS fallback `100dvh`
  → fallback `100vh`; app remains usable.
- Pointer drag interrupted (`pointercancel`, backdrop scroll) → drag aborts,
  no mutation applied.
- Link dialog cancelled → document untouched (same guarantee as prompt
  cancel today).
- matchMedia unsupported → current one-shot behavior retained as fallback.

## Success criteria

- On a 390×844 viewport: all outline/task/toolbar controls visible without
  hover, ≥40px targets, drag reorder works via touch pointer events,
  keyboard does not permanently cover the caret or footer, link insertion
  works end-to-end, no iOS input zoom on focus.
- Desktop regression: all existing Playwright + Deno tests pass unchanged.