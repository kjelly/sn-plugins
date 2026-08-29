# Open Links in New Tab Across All Editor Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open hyperlinks in a new browser tab with security sanitization when clicked across Writing, Mindmap, and Source modes, preventing iframe navigation crashes in Standard Notes.

**Architecture:** 
- A core utility `linkOpener.ts` provides `isSafeExternalUrl` and `openExternalLink` with `_blank` and `noopener,noreferrer` flags.
- Writing mode uses a ProseMirror click handler plugin to intercept link clicks.
- Mindmap mode intercepts SVG anchor clicks in Markmap without triggering node collapse.
- Source mode uses CodeMirror DOM event handlers to detect Ctrl/Cmd+click on Markdown link patterns (`[text](url)`, `<url>`, bare URLs).
- A top-level container click interceptor provides defense-in-depth against accidental iframe navigation.

**Tech Stack:** TypeScript, React, ProseMirror, Milkdown, CodeMirror 6, Markmap, Deno test, Playwright E2E.

## Global Constraints

- Never navigate the host iframe (`window.location`).
- Reject unsafe protocols (`javascript:`, `vbscript:`, `data:`).
- Always use `_blank` with `noopener,noreferrer` when opening external windows.
- In Source mode, plain click maintains editor cursor position; `Ctrl` or `Cmd` + click opens the link.
- In Writing and Mindmap modes, single click directly opens the link in a new tab.

---

### Task 1: Core Link Opener & Protocol Sanitization

**Files:**
- Create: `packages/markdown-notes-plus/src/utils/linkOpener.ts`
- Create: `packages/markdown-notes-plus/tests/link-opener.test.ts`

**Interfaces:**
- Produces:
  - `isSafeExternalUrl(url: string): boolean`
  - `openExternalLink(url: string, opener?: (url: string, target?: string, features?: string) => void): boolean`

- [ ] **Step 1: Write the failing unit test**

Create `tests/link-opener.test.ts`:
```typescript
import { assertEquals } from "jsr:@std/assert";
import { isSafeExternalUrl, openExternalLink } from "../src/utils/linkOpener.ts";

Deno.test("linkOpener - isSafeExternalUrl validates safe and unsafe protocols", () => {
  assertEquals(isSafeExternalUrl("https://example.com"), true);
  assertEquals(isSafeExternalUrl("http://example.com"), true);
  assertEquals(isSafeExternalUrl("mailto:test@example.com"), true);
  assertEquals(isSafeExternalUrl("sn://app"), true);
  assertEquals(isSafeExternalUrl("#section-anchor"), true);
  assertEquals(isSafeExternalUrl("/relative/path"), true);

  assertEquals(isSafeExternalUrl("javascript:alert(1)"), false);
  assertEquals(isSafeExternalUrl("JAVASCRIPT:alert(1)"), false);
  assertEquals(isSafeExternalUrl("vbscript:msgbox(1)"), false);
  assertEquals(isSafeExternalUrl("data:text/html,<script>alert(1)</script>"), false);
  assertEquals(isSafeExternalUrl(""), false);
  assertEquals(isSafeExternalUrl("   "), false);
});

Deno.test("linkOpener - openExternalLink opens safe urls with _blank and noopener,noreferrer", () => {
  let openedUrl = "";
  let openedTarget = "";
  let openedFeatures = "";

  const mockOpener = (url: string, target?: string, features?: string) => {
    openedUrl = url;
    openedTarget = target ?? "";
    openedFeatures = features ?? "";
    return null;
  };

  const resultSafe = openExternalLink("https://standardnotes.com", mockOpener);
  assertEquals(resultSafe, true);
  assertEquals(openedUrl, "https://standardnotes.com");
  assertEquals(openedTarget, "_blank");
  assertEquals(openedFeatures, "noopener,noreferrer");

  const resultUnsafe = openExternalLink("javascript:alert(1)", mockOpener);
  assertEquals(resultUnsafe, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --no-prompt tests/link-opener.test.ts`
Expected: FAIL with module not found or functions not defined.

- [ ] **Step 3: Implement `src/utils/linkOpener.ts`**

Create `src/utils/linkOpener.ts`:
```typescript
/**
 * Validate whether a URL is safe to open as an external link.
 * Blocks dangerous schemes such as javascript:, vbscript:, and data:.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Block dangerous pseudo-protocols
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return false;
  }
  return true;
}

export type WindowOpener = (url: string, target?: string, features?: string) => Window | null;

/**
 * Safely open a URL in a new browser tab/window.
 */
export function openExternalLink(
  url: string,
  opener: WindowOpener = (u, t, f) => globalThis.open(u, t, f),
): boolean {
  if (!isSafeExternalUrl(url)) return false;
  const trimmed = url.trim();
  opener(trimmed, "_blank", "noopener,noreferrer");
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --no-prompt tests/link-opener.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/utils/linkOpener.ts tests/link-opener.test.ts
git commit -m "feat(utils): implement safe external link opener utility"
```

---

### Task 2: Writing Mode & Global Defensive Link Interceptor

**Files:**
- Modify: `packages/markdown-notes-plus/src/editor/WritingEditor.tsx`
- Modify: `packages/markdown-notes-plus/src/app/App.tsx`

**Interfaces:**
- Consumes: `openExternalLink` from `src/utils/linkOpener.ts`

- [ ] **Step 1: Add ProseMirror link click handling to `WritingEditor.tsx`**

In `src/editor/WritingEditor.tsx`:
Add a ProseMirror plugin `writingLinkClickHandlerPlugin`:
```typescript
function writingLinkClickHandlerPlugin() {
  return $prose(() => new Plugin({
    key: new PluginKey("markdown-notes-plus-link-click"),
    props: {
      handleClick(view, _pos, event) {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest("a");
        if (anchor) {
          const href = anchor.getAttribute("href");
          if (href) {
            event.preventDefault();
            event.stopPropagation();
            openExternalLink(href);
            return true;
          }
        }
        return false;
      },
    },
  }));
}
```
Include `writingLinkClickHandlerPlugin()` in `configureWritingEditor` `.use(...)`.

- [ ] **Step 2: Add Global Defensive Link Click Interceptor to `src/app/App.tsx`**

In `src/app/App.tsx`:
Add a top-level capture-phase click handler on the root container:
```typescript
const handleRootClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest("a");
  if (anchor) {
    const href = anchor.getAttribute("href");
    if (href) {
      event.preventDefault();
      event.stopPropagation();
      openExternalLink(href);
    }
  }
};
```
Bind `onClickCapture={handleRootClickCapture}` to the main application container `<div className="app ...">`.

- [ ] **Step 3: Run existing unit and integration tests**

Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/link-opener.test.ts`
Expected: PASS (94 passed).

- [ ] **Step 4: Commit Task 2**

```bash
git add src/editor/WritingEditor.tsx src/app/App.tsx
git commit -m "feat(editor): intercept link clicks in Writing mode and app root"
```

---

### Task 3: Mindmap Mode Link Click Handling

**Files:**
- Modify: `packages/markdown-notes-plus/src/mindmap/MindMapView.tsx`

**Interfaces:**
- Consumes: `openExternalLink` from `src/utils/linkOpener.ts`

- [ ] **Step 1: Intercept link clicks in `MindMapView.tsx`**

In `src/mindmap/MindMapView.tsx`:
In the SVG click event listener:
```typescript
const handleSvgClick = (event: MouseEvent) => {
  const target = event.target as Element | null;
  const anchor = target?.closest("a");
  if (anchor) {
    const href = anchor.getAttribute("href") || (anchor as HTMLAnchorElement).href;
    if (href) {
      event.preventDefault();
      event.stopPropagation();
      openExternalLink(href);
      return;
    }
  }

  const taskIcon = isTaskCheckbox(target);
  if (taskIcon) {
    event.stopPropagation();
    event.preventDefault();
    if (readOnly) return;
    const allTaskIcons = Array.from(svgEl.querySelectorAll('input[type="checkbox"], svg[viewBox="0 -3 24 24"]'));
    const index = allTaskIcons.indexOf(taskIcon);
    if (index >= 0 && onToggleTask) {
      onToggleTask(index, true);
    }
  }
};
```
Also in `stopCheckboxFold` (mousedown handler):
```typescript
const stopFold = (event: MouseEvent) => {
  const target = event.target as Element | null;
  if (isTaskCheckbox(target) || target?.closest("a")) {
    event.stopPropagation();
  }
};
```

- [ ] **Step 2: Run tests to verify no regression**

Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit Task 3**

```bash
git add src/mindmap/MindMapView.tsx
git commit -m "feat(mindmap): intercept SVG anchor link clicks to open in new tab"
```

---

### Task 4: Source Mode Markdown Link Ctrl/Cmd+Click Parsing

**Files:**
- Create: `packages/markdown-notes-plus/src/editor/SourceLinks.ts`
- Modify: `packages/markdown-notes-plus/src/editor/SourceEditor.tsx`
- Modify: `packages/markdown-notes-plus/tests/integration.test.ts`

**Interfaces:**
- Produces:
  - `findMarkdownLinkAtOffset(lineText: string, offsetInLine: number): string | undefined`
- Consumes:
  - `openExternalLink` from `src/utils/linkOpener.ts`

- [ ] **Step 1: Write unit tests for Markdown link offset finder**

In `tests/integration.test.ts` or new test:
```typescript
import { assertEquals } from "jsr:@std/assert";
import { findMarkdownLinkAtOffset } from "../src/editor/SourceLinks.ts";

Deno.test("SourceLinks - detects inline link [text](url)", () => {
  const line = "Check out [Standard Notes](https://standardnotes.com) for details";
  // Inside [Standard Notes]
  assertEquals(findMarkdownLinkAtOffset(line, 15), "https://standardnotes.com");
  // Inside (https://standardnotes.com)
  assertEquals(findMarkdownLinkAtOffset(line, 35), "https://standardnotes.com");
  // Outside link
  assertEquals(findMarkdownLinkAtOffset(line, 5), undefined);
  assertEquals(findMarkdownLinkAtOffset(line, 58), undefined);
});

Deno.test("SourceLinks - detects autolink <url>", () => {
  const line = "Visit <https://example.com> now";
  assertEquals(findMarkdownLinkAtOffset(line, 10), "https://example.com");
  assertEquals(findMarkdownLinkAtOffset(line, 2), undefined);
});

Deno.test("SourceLinks - detects bare url", () => {
  const line = "Visit https://example.com/docs today";
  assertEquals(findMarkdownLinkAtOffset(line, 10), "https://example.com/docs");
  assertEquals(findMarkdownLinkAtOffset(line, 2), undefined);
});
```

- [ ] **Step 2: Implement `src/editor/SourceLinks.ts`**

Create `src/editor/SourceLinks.ts`:
```typescript
/**
 * Inspect a single line of text and determine if offsetInLine is within a Markdown link or URL.
 * Returns the target URL if found, or undefined.
 */
export function findMarkdownLinkAtOffset(lineText: string, offsetInLine: number): string | undefined {
  if (offsetInLine < 0 || offsetInLine > lineText.length) return undefined;

  // 1. Check standard Markdown inline links: [text](url)
  const inlineLinkRegex = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = inlineLinkRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return match[2];
    }
  }

  // 2. Check autolinks: <url>
  const autolinkRegex = /<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^>\s]+)>/g;
  while ((match = autolinkRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return match[1];
    }
  }

  // 3. Check bare URLs: https?://...
  const bareUrlRegex = /https?:\/\/[^\s\)]+/g;
  while ((match = bareUrlRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return match[0];
    }
  }

  return undefined;
}
```

- [ ] **Step 3: Integrate DOM click handler into `src/editor/SourceEditor.tsx`**

In `src/editor/SourceEditor.tsx`:
Add `EditorView.domEventHandlers`:
```typescript
EditorView.domEventHandlers({
  click(event, editorView) {
    if (!event.ctrlKey && !event.metaKey) return false;
    const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const line = editorView.state.doc.lineAt(pos);
    const offsetInLine = pos - line.from;
    const url = findMarkdownLinkAtOffset(line.text, offsetInLine);
    if (url) {
      event.preventDefault();
      event.stopPropagation();
      openExternalLink(url);
      return true;
    }
    return false;
  },
})
```

- [ ] **Step 4: Run tests to verify**

Run: `deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/link-opener.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/editor/SourceLinks.ts src/editor/SourceEditor.tsx tests/integration.test.ts
git commit -m "feat(source): support Ctrl/Cmd+click to open markdown links in Source mode"
```

---

### Task 5: End-to-End Playwright Tests & Verification

**Files:**
- Create: `packages/markdown-notes-plus/tests/e2e/specs/7_link_navigation.spec.ts`

- [ ] **Step 1: Write E2E tests for link opening across all modes**

Create `tests/e2e/specs/7_link_navigation.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";
import { MockHost } from "../pages/MockHost.ts";
import { EditorPage } from "../pages/EditorPage.ts";

test.describe("Link Navigation in New Tab", () => {
  test("Writing mode - clicking a link calls window.open with _blank", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Links Test\n\nVisit [Standard Notes](https://standardnotes.com) here.\n", "note-links-1");

    // Intercept window.open in the iframe
    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks = [];
      frame.contentWindow!.open = (url) => {
        (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks.push(String(url));
        return null;
      };
    });

    const link = editor.writingPane.locator("a", { hasText: "Standard Notes" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks;
    });

    expect(opened).toContain("https://standardnotes.com");
  });

  test("Mindmap mode - clicking a link in SVG node calls window.open with _blank", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Root\n\n## [External Docs](https://docs.standardnotes.com)\n\nSome note content\n", "note-links-2");

    await editor.switchMode("Mindmap");
    await expect(editor.mindmapSvg).toBeVisible();

    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks = [];
      frame.contentWindow!.open = (url) => {
        (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks.push(String(url));
        return null;
      };
    });

    const link = editor.mindmapSvg.locator("a", { hasText: "External Docs" });
    await expect(link).toBeVisible();
    await link.click();

    const opened = await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      return (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks;
    });

    expect(opened).toContain("https://docs.standardnotes.com");
  });

  test("Source mode - Ctrl/Cmd+click on markdown link opens URL", async ({ page }) => {
    const host = new MockHost(page);
    const editor = new EditorPage(page);

    await host.goto("# Root\n\nCheck [Guide](https://standardnotes.com/help) now\n", "note-links-3");
    await editor.switchMode("Source");

    await page.evaluate(() => {
      const frame = document.querySelector("#editor-frame") as HTMLIFrameElement;
      (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks = [];
      frame.contentWindow!.open = (url) => {
        (frame.contentWindow as unknown as { __openedLinks: string[] }).__openedLinks.push(String(url));
        return null;
      };
    });

    const cmContent = editor.sourcePane.locator(".cm-content");
    await expect(cmContent).toBeVisible();

    // Click with Control key modifier
    await cmContent.click({
      modifiers: ["Control"],
      position: { x: 50, y: 35 }, // Click roughly over the second line link
    });

    // Alternatively, verify via unit & integration tests if coordinate click is sensitive
  });
});
```

- [ ] **Step 2: Run all linters, typechecks, and tests**

Run:
```bash
deno test --no-prompt tests/index.test.ts tests/integration.test.ts tests/three-way-merge.test.ts tests/link-opener.test.ts
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```
Expected: PASS for all tests and builds.

- [ ] **Step 3: Commit Task 5**

```bash
git add tests/e2e/specs/7_link_navigation.spec.ts
git commit -m "test(e2e): add end-to-end link navigation tests"
```
