# Markdown Notes+

> 完整功能說明手冊請見 [docs/user-guide.md](docs/user-guide.md)。

This package is a Vite-built React Standard Notes editor. The runtime entry is
`src/main.tsx`; `EditorKitBridge` is the only package-owned host transport/save,
lock, and theme notification owner and uses the pinned
`@standardnotes/editor-kit` API. The old relay implementation remains in
`src/index.ts` only for legacy Deno compatibility tests and is not mounted by
the runtime entry point; the React runtime imports only the named analysis
exports it needs.

The durable source is the exact Markdown string in `CanonicalDocument` and
Standard Notes `content.text`. Milkdown owns Writing mode, CodeMirror 6 owns
Source mode, and Markmap owns the derived SVG Mind Map. Task, outline, and map
projections are derived from the shared container-aware Markdown analysis.

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
npm ci
npm run typecheck
npm test
npm run build
node --check dist/assets/<generated-index>.js
```

`npm test` intentionally runs the existing Deno compatibility/projection
regression suite. It does not claim full browser or Standard Notes host
integration coverage.

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
   npm run dev -- --host 0.0.0.0 --port 5173
   ```
   (The server serves the editor at `/index.html` and the extension manifest at `/ext.json`).

4. **Run Appium / WebdriverIO Android E2E Suite**:
   ```bash
   npm run test:e2e:android-app
   ```
   *For physical devices over USB*, forward the port first:
   ```bash
   adb reverse tcp:5173 tcp:5173
   ```

