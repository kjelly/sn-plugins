# Design Specification: Open Links in New Tab Across All Editor Modes

## 1. Overview & Goals

In the Standard Notes plugin environment, markdown-notes-plus runs inside an iframe. When users click hyperlinks within the editor, default browser behavior attempts to navigate within the existing frame, destroying the plugin UI or causing frame-ancestor security errors.

This specification defines a comprehensive, secure, and intuitive link-opening experience across all modes in `markdown-notes-plus`:
1. **Writing Mode (Milkdown / ProseMirror)**: Any click on a rendered link directly opens the target in a new browser tab (`_blank`).
2. **Mindmap Mode (Markmap SVG)**: Clicking any link in a mindmap node directly opens the target in a new browser tab without folding/unfolding the node.
3. **Source Mode (CodeMirror 6)**: Clicking on a Markdown link `[text](url)` or raw URL while holding `Ctrl` (Windows/Linux) or `Cmd` (macOS) opens the target in a new browser tab.
4. **Security & Sanitization**: Prohibits dangerous protocols (`javascript:`, `vbscript:`, `data:`) and enforces `noopener,noreferrer` flags.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────┐
│                      App Container                     │
│  (Global Capture Click Handler -> openExternalLink)    │
├─────────────────┬──────────────────┬───────────────────┤
│  Writing Mode   │   Mindmap Mode   │    Source Mode    │
│ (ProseMirror    │  (Markmap SVG    │   (CodeMirror 6   │
│  handleClick)   │   Click Intercept│    Ctrl/Cmd Click)│
└────────┬────────┴────────┬─────────┴─────────┬─────────┘
         │                 │                   │
         └─────────────────┼───────────────────┘
                           ▼
               ┌───────────────────────┐
               │   openExternalLink    │
               │ (Protocol Validation  │
               │   & Window Opener)    │
               └───────────────────────┘
```

### 2.1 Core Utility: `src/utils/linkOpener.ts`

- **`isSafeExternalUrl(url: string): boolean`**:
  - Validates that the trimmed URL does not use dangerous protocols:
    - Rejects `javascript:`, `vbscript:`, `data:`.
    - Accepts standard web protocols (`http:`, `https:`, `mailto:`, `sn:`, `file:`, relative paths/anchors).
- **`openExternalLink(url: string): boolean`**:
  - Trims URL and runs `isSafeExternalUrl`.
  - If valid, calls `globalThis.open(url, "_blank", "noopener,noreferrer")` and returns `true`.
  - If invalid or empty, returns `false`.

### 2.2 Writing Mode (Milkdown / ProseMirror): `src/editor/WritingEditor.tsx`

- ProseMirror Plugin / `handleClick` hook:
  - When a click occurs on an `HTMLAnchorElement` or within a node with a `link` mark:
    - Extracts the `href` attribute.
    - Prevents default frame navigation (`event.preventDefault()`).
    - Calls `openExternalLink(href)`.
    - Returns `true` to signal ProseMirror that the event was handled.

### 2.3 Mindmap Mode (Markmap): `src/mindmap/MindMapView.tsx`

- Inside `MindMapView`:
  - Intercepts clicks on `<a>` elements in the Markmap SVG during capture phase.
  - Calls `event.preventDefault()` and `event.stopPropagation()` to prevent Markmap node toggle animations from misfiring when clicking a link.
  - Calls `openExternalLink(href)`.

### 2.4 Source Mode (CodeMirror 6): `src/editor/SourceEditor.tsx`

- CodeMirror DOM event handler `domEventHandlers.click`:
  - When `event.ctrlKey` (Windows/Linux) or `event.metaKey` (macOS) is true:
    - Determines the clicked character index (`posAtCoords`).
    - Inspects the line at that position for Markdown link patterns:
      1. Inline links: `\[([^\]]+)\]\(([^)\s]+)\)`
      2. Autolinks: `<([^>\s]+)>`
      3. Bare URLs: `https?:\/\/[^\s\)]+`
    - If the clicked position falls within the range of a valid link pattern:
      - Extracts the target URL.
      - Calls `event.preventDefault()`.
      - Calls `openExternalLink(url)`.

### 2.5 Global Defensive Capture: `src/app/App.tsx`

- At the top-level container of `App`:
  - Listens for `click` events in capture phase.
  - If target is inside an `<a href="...">` tag, verifies that default frame navigation is prevented and routed to `openExternalLink`.

---

## 3. Data Flow & Sequence

1. **User clicks link in Writing Mode**:
   - ProseMirror `handleClick` catches the click on the `<a>` element.
   - `openExternalLink(href)` validates protocol.
   - `globalThis.open(href, "_blank", "noopener,noreferrer")` opens browser tab.
   - Frame navigation is halted.

2. **User clicks link in Mindmap Mode**:
   - SVG click listener detects click on `<a>` inside SVG `foreignObject`.
   - Stops Markmap propagation and opens link via `openExternalLink(href)`.

3. **User Ctrl/Cmd+clicks link in Source Mode**:
   - CodeMirror handler detects modifier key.
   - Scans line syntax and locates URL boundary.
   - Opens link via `openExternalLink(href)`.

4. **Security Filter Failure** (e.g. `javascript:alert(1)`):
   - `isSafeExternalUrl` returns `false`.
   - `openExternalLink` returns `false` without invoking `globalThis.open`.
   - Frame navigation remains blocked by `event.preventDefault()`.

---

## 4. Testing Strategy

1. **Unit Tests (`tests/link-opener.test.ts`)**:
   - Test `isSafeExternalUrl` with valid (`http`, `https`, `mailto`, `sn`) and dangerous (`javascript:`, `vbscript:`, `data:`) URLs.
   - Test `openExternalLink` invoking `window.open` with `_blank` and `noopener,noreferrer`.
2. **Integration Tests (`tests/integration.test.ts`)**:
   - Test Source mode URL boundary detection helper across diverse markdown formats (brackets, parentheses, surrounding text).
3. **Playwright E2E Tests (`tests/e2e/specs/7_link_navigation.spec.ts`)**:
   - Test clicking a link in Writing mode triggers `window.open` with new tab.
   - Test clicking a link in Mindmap mode triggers `window.open` with new tab.
   - Test Ctrl/Cmd+click on a markdown link in Source mode triggers `window.open` with new tab.
   - Test malicious link `javascript:...` does not execute or open new tab.
