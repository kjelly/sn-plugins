# Markdown Notes+

> 完整功能說明手冊請見 [docs/user-guide.md](docs/user-guide.md)。
> Writing mode 的穩定性契約與回歸矩陣請見
> [docs/superpowers/plans/2026-09-16-writing-mode-stability-contract.md](docs/superpowers/plans/2026-09-16-writing-mode-stability-contract.md)。

This package is a Vite-built React Standard Notes editor. The runtime entry is
`src/main.tsx`; `EditorKitBridge` is the only package-owned host transport/save,
lock, and theme notification owner and uses the pinned
`@standardnotes/editor-kit` API. The old relay implementation remains in
`src/index.ts` only for legacy Deno compatibility tests and is not mounted by
the runtime entry point; the React runtime imports only the named analysis
exports it needs.

The durable source is the exact Markdown string in `CanonicalDocument` and
Standard Notes `content.text`. Milkdown owns Writing mode, CodeMirror 6 owns
Source mode, and Markmap owns the derived SVG Mind Map. Task, outline, map,
Kanban, and Flashcards projections are derived from the shared
container-aware Markdown analysis.

Flashcards is a read-only projection. A note exposes the mode when it contains
an exact `Q&A`, `Q & A`, `Q＆A`, `QA`, or `Questions & Answers` heading.
Complete `Q:` / `A:` pairs below those headings become study cards; answers
may contain multiline GFM Markdown. Revealing, navigation, shuffle, Known,
Again, reset, and section filters never change or save the canonical Markdown.
Study state is session-only: it may reset when leaving/reloading and is not
synchronized or scheduled with FSRS/SM-2.

```markdown
## Q&A

Q: What is a Kubernetes Pod?

A: Kubernetes 中最小的部署單位，可以包含一個或多個 container。

Q: Deployment 和 StatefulSet 的主要差異？

A:
Deployment 適合 stateless workload。

StatefulSet 提供：

- stable identity
- stable storage
- ordered deployment
```

Flashcards shortcuts are `Space` (show/hide), left/right arrows, `K` (Known),
`A` (Again), `S` (shuffle), and `R` (reset). Raw HTML is omitted, unsafe link
schemes are not clickable, and Markdown images are shown as non-fetching
placeholders.

Writing mode preserves only documents whose actual Milkdown serializer output
matches the canonical Markdown. Remote replacements are applied with a
transaction provenance tag; their normalized serializer callback is ignored,
so raw remote text remains canonical and is shown in Source mode when needed.
Explicit table, fenced-code, and divider commands establish a stable structural
editing context, and subsequent edits are accepted only while that structure
remains serializer-safe. If a user mutation cannot be proven lossless, the app
keeps the rendered input in a local Source fallback buffer and switches to
Source immediately; the canonical document and bridge are unchanged until the
user explicitly edits that Source buffer.

Completed task rows in Writing use a local hidden-row projection: the task
checkbox, delete action, and non-list content are hidden while nested lists
remain visible and actionable. The canonical Markdown is unchanged, and the
completed task remains available in the Completed panel. Save scheduling is
owned by `EditorKitBridge`; the app flushes pending edits on blur, hidden-page,
unload, and teardown. A save request
already sent to the Standard Notes host cannot be cancelled or treated as host
confirmation because the pinned EditorKit API exposes neither capability.

Current-section selection is anchored to the exact heading position from
Source or Outline mode and is reconciled through canonical edit maps. Writing
mode does not expose a live source cursor; it may follow the last Source or
Outline anchor, but does not claim live cursor tracking.

Limitations:

- The projection scanner covers the supported GFM task forms (including
  blockquotes, nested containers, fences, HTML blocks, tables, and Setext
  headings), but it is not a complete CommonMark/GFM parser. Unsupported
  Markdown remains source-only and is preserved verbatim.
- EditorKit behavior has been checked against the pinned package source and
  local build, but not against every Standard Notes Web/Desktop/mobile host.
- Host-level integration and real sync race semantics remain acceptance work.

Install the package lock and run the local checks with:

```sh
mise install
mise run deps
mise run typecheck
mise run test:unit
mise run build
mise exec -- node --check dist/assets/<generated-index>.js
```

All documented test entry points are Mise tasks; use `mise tasks ls` to list
them. `mise run test:unit` intentionally runs the existing Deno compatibility/projection
regression suite. It does not claim full browser or Standard Notes host
integration coverage.

## Standard Notes Web host E2E

The Web-host smoke test uses a real running fork of
[`standardnotes/app`](https://github.com/standardnotes/app), not the local
mock host. It installs `Markdown Notes+` from a test-only manifest, creates a
note, changes that note's type, and writes through the actual host transport.

Start Standard Notes Web in one terminal (the upstream README uses port 3001),
then run this package's test in another:

```sh
E2E_STANDARDNOTES_WEB_URL=http://127.0.0.1:3001 mise run test:e2e:standardnotes-web
```

The script builds this editor, starts its static preview at `127.0.0.1:5173`, and exposes
`/e2e/standardnotes-web.ext.json`. That manifest is generated only for this
test and points at the local editor URL; `public/ext.json` remains the Android
emulator manifest (`10.0.2.2`). The test creates an offline workspace when the
first-run **Use Offline** action is displayed. For a preconfigured account,
open the host URL in the same browser profile or set up its initial state
before running the test.

If the editor must be served from a different reachable origin (for example,
when the Standard Notes host runs in a container), set `E2E_EDITOR_ORIGIN`; the
test-only manifest and iframe assertion use that same origin.

## Android E2E Testing with Official Standard Notes APK

To run end-to-end integration tests using the official release APK of Standard Notes on an Android device or emulator:

1. **Start Android Emulator / Connect Physical Device**:
   Ensure `adb devices` lists your active Android device or emulator.

2. **Download Official Standard Notes APK**:
   ```bash
   bash scripts/download-official-sn-apk.sh
   ```

3. **Start Local Dev Server**:
   ```bash
   mise exec -- npm run dev -- --host 0.0.0.0 --port 5173
   ```
   (The server serves the editor at `/index.html` and the extension manifest at `/ext.json`).

4. **Run Appium / WebdriverIO Android E2E Suite**:
   ```bash
   mise run test:e2e:android-app
   ```
   *For physical devices over USB*, forward the port first:
   ```bash
   adb reverse tcp:5173 tcp:5173
   ```
