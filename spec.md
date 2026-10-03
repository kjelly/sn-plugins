# Q&A Flash Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Flashcards mode to Markdown Notes+ that discovers Q&A sections in the canonical Markdown note and projects each complete `Q:`/`A:` pair into an interactive flash card without rewriting the source Markdown.

**Architecture:**
- `CanonicalDocument` remains the only canonical source of note content.
- Flash cards are a derived, read-only projection, parallel to Mind Map and Kanban, not a new Markdown storage format.
- `App` performs only a cheap Q&A-heading suitability check on the normal render path.
- The full `FlashcardModel` parser, Markdown answer renderer, and `FlashcardView` are loaded only when Flashcards mode is entered.
- `FlashcardSession` owns in-memory study state such as reveal, current card, shuffle, Known, and Again. It does not persist scheduling or learning history.
- No Milkdown schema changes and no Writing-mode source conversion are required.

**Tech Stack:** TypeScript, React 18, remark 15, remark-gfm 4, existing Markdown analysis utilities, Standard Notes EditorKit bridge, Deno tests, Playwright E2E.

## Scope

### In scope

- Detect Q&A sections from Markdown headings.
- Parse `Q:`/`A:` pairs inside those sections.
- Support multiline Markdown answers.
- Support multiple Q&A sections in one note.
- Add a first-class Flashcards editor mode.
- Reveal/hide answer.
- Previous/next navigation.
- Shuffle.
- Session-only Known and Again actions.
- Section filtering when a note contains multiple Q&A sections.
- Keyboard operation.
- Mobile and E-Ink-friendly layout.
- Safe Markdown rendering for answers.
- Lazy loading and performance regression protection.
- Unit, integration, security, and E2E coverage.

### Explicitly out of scope

- FSRS or any spaced-repetition scheduling algorithm.
- SM-2.
- Due dates, ease factors, intervals, retention targets, or scheduling queues.
- Cross-device study history.
- Writing study state into Standard Notes `appData`.
- `localStorage`, IndexedDB, cookies, or another side-channel persistence mechanism.
- Rewriting Q&A blocks into a proprietary Flash Card Markdown syntax.
- A custom Milkdown Flashcard node or callout type.
- Automatic LLM card generation.
- Cloze deletion.
- Import/export to Anki.

---

## Global Constraints

### G1. Canonical Markdown must never be mutated by study actions

Entering Flashcards mode, revealing answers, shuffling cards, or pressing Known/Again must not call `CanonicalDocument.applyLocal`, `EditorKitBridge.notifyLocalChange`, or any save path.

The following invariant is mandatory:

```text
source Markdown before Flashcards session
==
source Markdown after Flashcards session
```

### G2. Flashcards are a projection, not a document format

Do not introduce syntax such as:

```markdown
[flashcard]
question = ...
answer = ...
```

Do not add a ProseMirror/Milkdown schema node.

Q&A remains ordinary portable Markdown.

### G3. No Flashcard full-document work on the normal typing path

Do not add code equivalent to:

```typescript
useMemo(() => analyzeFlashcards(snapshot.text), [snapshot.text])
```

to the `App` root.

The full parser may execute only when Flashcards mode is active or when an already-active Flashcards view receives a newer canonical document revision.

### G4. Existing performance boundaries remain intact

Do not move `remark`, `remark-gfm`, `FlashcardView`, or `FlashcardModel` into the bootstrap bridge shell or initial synchronous App path.

Writing, Source, Mind Map, Kanban, Review, and Standard Notes bridge behavior must remain unchanged when Flashcards is unused.

### G5. Study state is ephemeral

Known/Again/shuffle/reveal state exists only for the current mounted `FlashcardView` session.

Leaving Flashcards mode may discard the session.

Switching to another note must discard the session.

A canonical note replacement while Flashcards mode is active must rebuild the model from the new document generation and must never apply stale card state to a different note.

### G6. Safe rendering only

Do not use `dangerouslySetInnerHTML`.

Raw HTML from note Markdown must never be executed or inserted as HTML.

`javascript:`, `vbscript:`, and `data:` links must remain blocked using the existing link safety policy.

External images must not be fetched automatically by Flashcards mode. Render image alt text or a non-fetching placeholder instead.

### G7. Q&A detection must not misread protected Markdown

`Q:`/`A:` looking text inside fenced code, inline code that owns the marker, raw HTML blocks, or HTML comments must not create cards.

### G8. E-Ink behavior

Do not implement 3D flip animation, perspective transforms, continuous animation, or animated gradients.

Answer reveal should be an immediate state change with minimal repaint.

---

# Q&A Source Contract

## Supported Q&A section headings

A heading is a Q&A section when its normalized text matches one of:

```text
Q&A
Q & A
Q＆A
QA
Questions & Answers
```

Normalization rules:

1. Unicode NFKC normalization.
2. Trim outer whitespace.
3. Collapse internal whitespace.
4. Case-insensitive comparison.
5. Treat ASCII ampersand and full-width ampersand equivalently.

Do not match partial names such as:

```text
QA Environment
Q&A Notes Archive
Frequently Asked QA Metrics
```

unless the full normalized heading matches one of the supported aliases.

## Section ownership

A Q&A section begins at the matching heading and extends until the next heading with level less than or equal to the Q&A heading level, or EOF.

Nested headings inside the Q&A section are allowed and become part of the card section path.

Example:

```markdown
## Q&A

### Kubernetes

Q: What is a Pod?
A: The smallest deployable Kubernetes unit.

### Linux

Q: What does PID 1 do?
A: It is the first userspace process.
```

Both cards belong to the same top-level Q&A section, with category paths `Kubernetes` and `Linux` respectively.

## Question/answer markers

Recognize markers at the beginning of an eligible Markdown line:

```text
Q:
Q：
A:
A：
```

Rules:

- Marker comparison is case-insensitive.
- Allow 0 to 3 leading spaces.
- Allow whitespace between Q/A and colon.
- Full-width colon is accepted.
- Marker must be outside protected source ranges.
- A question must contain non-whitespace content after its marker, either on the marker line or continued on subsequent ordinary lines before `A:`.
- A card is emitted only after both a valid Q and a valid A are found.

## Multiline answers

The answer begins after `A:` and ends immediately before:

1. the next eligible `Q:` marker in the same Q&A section, or
2. the end of the Q&A section.

The answer may include:

- paragraphs,
- bullet/ordered lists,
- task lists,
- blockquotes,
- fenced code blocks,
- inline code,
- links,
- GFM tables,
- thematic breaks,
- nested headings.

Leading blank lines immediately after `A:` may be trimmed from the projected answer. Source ranges must still refer to the original canonical offsets.

## Malformed input behavior

- Q without A: ignore the incomplete card.
- A without a preceding Q: ignore it.
- Consecutive Q markers: the newest Q replaces the still-unanswered pending Q; do not synthesize an empty answer.
- Empty A followed by another Q: ignore the incomplete card.
- Duplicate question text is allowed; cards remain distinct by source identity.
- Parsing errors must never prevent Source/Writing modes from opening.

---

# Data Model

Create:

`packages/markdown-notes-plus/src/flashcards/FlashcardTypes.ts`

Required interfaces:

```typescript
export type FlashcardSourceRange = {
  from: number;
  to: number;
};

export type FlashcardSection = {
  id: string;
  title: string;
  headingPath: string[];
  headingLevel: number;
  sourceRange: FlashcardSourceRange;
};

export type Flashcard = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  headingPath: string[];
  question: string;
  answerMarkdown: string;
  questionRange: FlashcardSourceRange;
  answerRange: FlashcardSourceRange;
  sourceRange: FlashcardSourceRange;
};

export type FlashcardModel = {
  markdown: string;
  sections: FlashcardSection[];
  cards: Flashcard[];
};
```

Identity requirements:

- Section ID must be deterministic for a single canonical revision.
- Card ID must be unique even when two questions have identical text.
- No study persistence depends on the ID.
- Using source anchors/ranges as part of the ID is acceptable because session state is revision-scoped.

---

# Task 1: Add a Cheap Flashcard Suitability Gate

**Files:**
- Create: `packages/markdown-notes-plus/src/flashcards/FlashcardSuitability.ts`
- Create: `packages/markdown-notes-plus/tests/flashcard-suitability.test.ts`

**Goal:** Determine whether the current note is a candidate for Flashcards mode without importing remark or running a second full Markdown parse.

**Interfaces:**

```typescript
export function normalizeQaHeading(text: string): string;
export function isQaHeading(text: string): boolean;
export function isFlashcardSuitable(
  analysis: MarkdownAnalysis,
): boolean;
```

Implementation constraints:

- `isFlashcardSuitable` must consume the existing shared `MarkdownAnalysis` result.
- It may inspect `analysis.headings` only.
- It must not inspect the full Markdown text.
- It must not import `FlashcardModel`, `remark`, `remark-gfm`, React, or Milkdown.

- [ ] Add heading normalization tests.
- [ ] Cover ASCII/full-width ampersands and colons where relevant.
- [ ] Verify partial heading names do not match.
- [ ] Verify a normal note returns false.
- [ ] Verify a Q&A heading at any heading level returns true.
- [ ] Add the test file to `package.json` unit/test scripts.
- [ ] Run unit tests and typecheck.

Acceptance:

```text
normal App render cost = existing Markdown analysis + O(number of headings)
```

No Flashcard parser is loaded.

---

# Task 2: Implement the Flashcard Source Parser

**Files:**
- Create: `packages/markdown-notes-plus/src/flashcards/FlashcardTypes.ts`
- Create: `packages/markdown-notes-plus/src/flashcards/FlashcardModel.ts`
- Create: `packages/markdown-notes-plus/tests/flashcard-model.test.ts`

**Primary interface:**

```typescript
export function analyzeFlashcards(
  markdown: string,
  analysis?: MarkdownAnalysis,
): FlashcardModel;
```

**Parser design:**

1. Reuse the supplied shared `MarkdownAnalysis` when provided.
2. Locate exact Q&A heading sections from `analysis.headings`.
3. Calculate each section end from heading levels.
4. Parse only Q&A section source ranges for `Q:`/`A:` markers.
5. Build protected source ranges before accepting markers.
6. Preserve canonical UTF-16 offsets used by the rest of the editor.
7. Return source slices as `answerMarkdown`; never reserialize the note.

**Protected ranges:**

Use `remark` + `remark-gfm` only inside `FlashcardModel` and only when Flashcards mode is active.

Build excluded ranges from AST nodes that must not own `Q:`/`A:` markers:

- `code`,
- `inlineCode`,
- `html`.

Also respect canonical opaque fenced ranges from the existing Markdown structure scanner when necessary to cover malformed/edge syntax that remark cannot safely own.

Do not import `ReviewSemanticScanner` directly. Flashcards must not depend on the Review feature module.

If a small shared helper is truly required, extract only generic Markdown range logic into `src/markdown` and keep behavior covered by both existing Review tests and new Flashcard tests. Avoid a broad Review refactor.

**Required unit cases:**

- [ ] one basic Q/A pair.
- [ ] multiple cards in one Q&A section.
- [ ] multiple Q&A sections.
- [ ] Q&A section at H1/H2/H3.
- [ ] nested category headings.
- [ ] multiline answer.
- [ ] answer containing bullet list.
- [ ] answer containing ordered list.
- [ ] answer containing fenced code.
- [ ] answer containing GFM table.
- [ ] CRLF source.
- [ ] full-width `Q：` and `A：`.
- [ ] lowercase `q:`/`a:`.
- [ ] duplicate question text.
- [ ] incomplete Q without A.
- [ ] orphan A.
- [ ] empty A.
- [ ] `Q:`/`A:` text inside fenced code must not create cards.
- [ ] `Q:`/`A:` text inside HTML block/comment must not create cards.
- [ ] unrelated headings after Q&A terminate the section correctly.
- [ ] source ranges slice back to the original source exactly.
- [ ] `analyzeFlashcards` returns input Markdown unchanged.
- [ ] a note with Q&A heading but zero valid pairs returns an empty `cards` array.

**No-regression test:**

For every parser fixture:

```typescript
const model = analyzeFlashcards(source);
assertEquals(model.markdown, source);
```

No normalization is permitted.

---

# Task 3: Implement Session-Only Study State

**Files:**
- Create: `packages/markdown-notes-plus/src/flashcards/FlashcardSession.ts`
- Create: `packages/markdown-notes-plus/tests/flashcard-session.test.ts`

**Goal:** Keep study behavior pure and independent from React and Standard Notes persistence.

Recommended state:

```typescript
export type FlashcardSessionState = {
  cardIds: string[];
  currentIndex: number;
  revealed: boolean;
  knownCardIds: Set<string>;
  againCountByCardId: Map<string, number>;
};
```

Required operations:

```typescript
createFlashcardSession(cards)
revealCurrentCard(state)
hideCurrentCard(state)
nextCard(state)
previousCard(state)
markKnown(state)
markAgain(state)
shuffleSession(state, rng?)
resetSession(cards)
```

Behavior:

### Reveal

- Starts hidden.
- Reveal shows the answer.
- Moving to another card hides the answer again.

### Known

- Marks the card known for this session.
- Removes it from the active study queue.
- If cards remain, advance to the next active card.
- If none remain, session is complete.

### Again

- Increments a session-only Again count.
- Moves the current card to the end of the active queue.
- Does not write to Markdown.
- Does not calculate a future due date.
- Does not persist.

### Shuffle

- Fisher-Yates shuffle.
- No external dependency.
- Allow deterministic RNG injection for unit tests.

### Model revision changes

When the parent receives a new `FlashcardModel` for another canonical document generation/revision:

- discard the old session;
- construct a new session from the new model;
- never merge state by source offset across note identities.

- [ ] Test sequential navigation.
- [ ] Test answer hide/reset.
- [ ] Test Known removes a card.
- [ ] Test Again moves card to queue tail.
- [ ] Test completion.
- [ ] Test deterministic shuffle.
- [ ] Test empty-card session.
- [ ] Test reset with a new model.

---

# Task 4: Build a Safe Markdown Answer Renderer

**Files:**
- Create: `packages/markdown-notes-plus/src/flashcards/FlashcardMarkdown.tsx`
- Create: `packages/markdown-notes-plus/tests/flashcard-markdown.test.ts` where pure AST-to-view helpers can be tested.
- Modify: `packages/markdown-notes-plus/src/utils/linkOpener.ts` only if an existing safe helper must be exported/reused.

**Goal:** Render `answerMarkdown` as readable Markdown without loading Milkdown or executing raw HTML.

**Implementation strategy:**

- Parse the answer fragment with `remark` + `remark-gfm`.
- Convert a controlled mdast subset into React elements.
- Do not produce HTML strings.
- Do not use `dangerouslySetInnerHTML`.
- Raw `html` nodes render as escaped/plain text or an explicit `Raw HTML omitted` placeholder.
- Links use the existing external URL safety policy.
- External links open through the existing safe link opener behavior.
- Images do not create `<img>` network requests.

Minimum supported nodes:

- `root`
- `paragraph`
- `text`
- `emphasis`
- `strong`
- `delete`
- `inlineCode`
- `code`
- `blockquote`
- `heading`
- `thematicBreak`
- `list`
- `listItem`
- `link`
- `table`
- `tableRow`
- `tableCell`
- `break`

Task-list checkboxes may render as disabled checkboxes or plain symbols.

Unknown nodes must degrade to their textual children rather than throw.

**Security tests:**

- [ ] raw script HTML is not executed/rendered as HTML.
- [ ] `javascript:` link is non-clickable.
- [ ] `vbscript:` link is non-clickable.
- [ ] `data:` link is non-clickable.
- [ ] `https` link remains usable.
- [ ] image Markdown does not trigger an external image fetch.
- [ ] code fences render literal HTML/script text as code.
- [ ] renderer handles malformed Markdown without crashing.

**Rendering principle:**

Flashcards mode is for study, not a byte-identical editing surface. The renderer may present normalized visual structure, but `answerMarkdown` in `FlashcardModel` must always remain the exact canonical source slice.

---

# Task 5: Implement FlashcardView

**Files:**
- Create: `packages/markdown-notes-plus/src/flashcards/FlashcardView.tsx`
- Modify: `packages/markdown-notes-plus/src/style.css`

**Props:**

```typescript
export type FlashcardViewProps = {
  markdown: string;
  analysis: MarkdownAnalysis;
  documentIdentity: {
    instanceId: string;
    revision: number;
    generation: number;
  };
};
```

The component is read-only and receives no canonical mutation callback.

**UI layout:**

```text
Flashcards | Section: [All ▼] | Shuffle | Reset

12 / 38      Known: 9      Again: 4

+---------------------------------------+
| Question                              |
|                                       |
| What is a Kubernetes Pod?             |
|                                       |
|           Show answer                 |
+---------------------------------------+

after reveal

+---------------------------------------+
| Answer                                |
|                                       |
| rendered Markdown answer              |
+---------------------------------------+

Previous   Again   Known   Next
```

**Required behavior:**

- [ ] Build `FlashcardModel` only inside this lazy feature boundary.
- [ ] Show an empty state when there are Q&A sections but no complete cards.
- [ ] Section selector filters cards by Q&A section/category.
- [ ] Reset rebuilds session state for the selected scope.
- [ ] Shuffle affects only the current session queue.
- [ ] Reveal does not move the card.
- [ ] Known/Again follow `FlashcardSession` semantics.
- [ ] Progress is based on the active session.
- [ ] Display current card section/category path.
- [ ] No save callback exists in the component API.
- [ ] Locked notes work exactly like unlocked notes because Flashcards is read-only.

**Keyboard contract:**

- `Space`: reveal/hide answer.
- `ArrowRight`: next card.
- `ArrowLeft`: previous card.
- `K`: Known.
- `A`: Again.
- `S`: Shuffle.
- `R`: Reset session.

Ignore shortcuts when an event originates from `select`, `input`, `textarea`, button text entry, or a `contenteditable` element.

Buttons remain the authoritative mobile input path.

**Accessibility:**

- Main card region has an accessible name.
- Reveal button has `aria-expanded`.
- Progress uses `role=status` or equivalent live text without noisy per-render announcements.
- Keyboard actions have visible labels/tooltips.
- Focus ring uses theme accent variables.
- Do not depend on color alone for Known/Again state.

**E-Ink/mobile CSS:**

- No flip transition.
- No transform animation.
- Keep card background based on `--editor-bg` and `--editor-fg`.
- Use existing Standard Notes theme variables.
- Minimum tap target approximately 36 to 40 CSS px for primary study actions on compact layout.
- Avoid fixed card heights that clip large Markdown answers.
- Answer area scrolls when required.
- Preserve safe-area insets through existing `app-shell` layout.

---

# Task 6: Add Flashcards as an App Mode

**Files:**
- Modify: `packages/markdown-notes-plus/src/app/AppModeTransition.ts`
- Modify: `packages/markdown-notes-plus/src/app/App.tsx`
- Modify: `packages/markdown-notes-plus/src/navigation/NavigationPaletteModal.tsx`

## AppMode

Change:

```typescript
export type AppMode =
  | "writing"
  | "split"
  | "source"
  | "mindmap"
  | "kanban"
  | "flashcards";
```

## Lazy boundary

In `App.tsx`:

```typescript
const LazyFlashcardView = React.lazy(async () => {
  const module = await import("../flashcards/FlashcardView");
  return { default: module.FlashcardView };
});
```

Do not import `FlashcardModel` in `App.tsx`.

## Suitability

Calculate `flashcardSuitable` from the already-existing shared analysis:

```typescript
const flashcardSuitable = isFlashcardSuitable(analysis);
```

`FlashcardSuitability` must remain lightweight.

## Mode navigation

- Add Flashcards to `EditorNavigationControls` only when `flashcardSuitable` is true.
- If the note is replaced remotely while Flashcards mode is active and the new note has no Q&A heading, transition to Source or Writing using an explicit deterministic rule.
- Recommended fallback:
  - Writing when current canonical source has proven Writing capability;
  - otherwise Source.
- Do not silently mutate the source to regain Writing eligibility.

## Flashcard pane

Add a `flashcard-pane` parallel to `kanban-pane`.

It must:

- include standard sidebar toggle/navigation controls where layout permits;
- include Palette;
- show `StatusInfo`;
- mount `LazyFlashcardView`;
- not show Writing toolbar editing actions;
- not expose Undo/Redo as Flashcard study actions. Existing canonical Undo/Redo may remain in the common toolbar only if their meaning stays clear.

## Sidebar

Flashcards is a main projection mode, not a new Review tab.

The existing Outline / Review / Tasks sidebar semantics remain unchanged.

## Command palette

Add:

```text
Switch to Flashcards Mode
Study Q&A sections
Mode
```

Only expose the command when `flashcardSuitable` is true.

Update the palette subtitle for Toggle Sidebar if necessary only to reflect actual sidebar tabs; do not label Flashcards as part of Review.

- [ ] Add AppMode compile coverage.
- [ ] Verify all mode-switch exhaustiveness sites.
- [ ] Verify CSS mode class/layout.
- [ ] Verify a note without Q&A does not show Flashcards mode.
- [ ] Verify a candidate note does show it.

---

# Task 7: Integrate E2E Page Objects and Core Mode Tests

**Files:**
- Modify: `packages/markdown-notes-plus/tests/e2e/pages/EditorPage.ts`
- Modify: `packages/markdown-notes-plus/tests/e2e/specs/2_modes_and_projections.spec.ts`
- Create: `packages/markdown-notes-plus/tests/e2e/specs/18_flashcards.spec.ts`

Update `EditorMode`:

```typescript
export type EditorMode =
  | "Writing"
  | "Split"
  | "Source"
  | "Mindmap"
  | "Kanban"
  | "Flashcards";
```

Add page object locators:

- `flashcardModeButton`
- `flashcardPane`
- `flashcardView`
- `flashcardQuestion`
- `flashcardAnswer`
- `flashcardRevealButton`
- `flashcardPreviousButton`
- `flashcardNextButton`
- `flashcardKnownButton`
- `flashcardAgainButton`
- `flashcardShuffleButton`
- `flashcardResetButton`
- `flashcardSectionSelect`
- `flashcardProgress`

Update `switchMode` so Flashcards waits for `FlashcardView` readiness.

**Required E2E scenarios:**

### Basic projection

- [ ] Open note with Q&A.
- [ ] Flashcards button appears.
- [ ] Switch to Flashcards.
- [ ] First question appears.
- [ ] Answer starts hidden.
- [ ] Reveal displays Markdown answer.
- [ ] Next changes question and hides answer.

### Markdown answer

Answer fixture must include:

- bold text,
- list,
- inline code,
- fenced code,
- table,
- safe link.

Verify the rendered structure is visible and usable.

### Multiple sections

- [ ] Two Q&A sections are discovered.
- [ ] All shows cards from both.
- [ ] Section filter restricts the session.
- [ ] Reset respects selected scope.

### Session actions

- [ ] Known removes current card from active queue.
- [ ] Again returns current card later in the same session.
- [ ] Completion state appears after all cards are Known.
- [ ] Reset starts over.
- [ ] Shuffle changes order without modifying content.

### Keyboard

- [ ] Space reveals.
- [ ] K marks Known.
- [ ] A marks Again.
- [ ] arrows navigate.
- [ ] S shuffles.
- [ ] R resets.

### No-save invariant

Record host saves before entering Flashcards.

Perform:

- reveal,
- navigation,
- shuffle,
- Known,
- Again,
- reset,
- section filter.

Assert host save count is unchanged.

### Locked note

- [ ] Locked note can enter Flashcards.
- [ ] All study controls work.
- [ ] No save is attempted.

### Remote replacement

While Flashcards mode is active:

1. replace current note text with a new Q&A document;
2. verify stale cards disappear;
3. verify the session resets;
4. verify new cards are shown.

Then replace with a document without Q&A and verify deterministic mode fallback.

### Mobile layout

At compact viewport:

- [ ] no toolbar control is covered by sidebar backdrop;
- [ ] study buttons remain reachable;
- [ ] long answer scrolls;
- [ ] section selector remains usable.

---

# Task 8: Add Security Contract Coverage

**Files:**
- Modify: `packages/markdown-notes-plus/tests/e2e/specs/0_standardnotes_security_contract.spec.ts`
- Add unit tests in `flashcard-markdown.test.ts`

**Cases:**

Use answer content containing:

```markdown
A:
<script>window.__flashcardPwned = true</script>

[bad](javascript:alert(1))

![tracker](https://example.invalid/tracker.png)
```

Acceptance:

- `window.__flashcardPwned` remains unset.
- `javascript:` link cannot execute.
- no request is made to `example.invalid/tracker.png`.
- source text is unchanged.
- no additional CSP relaxation is introduced.
- no new iframe/page origin is introduced.

Do not add raw HTML rendering libraries or sanitizers simply to make raw HTML display prettier. Escaping/omission is preferable.

---

# Task 9: Protect Performance and Lazy Loading

**Files:**
- Modify only if required:
  - `packages/markdown-notes-plus/src/performance/PerfNames.ts`
  - `packages/markdown-notes-plus/src/performance/PerfTrace.ts`
  - `packages/markdown-notes-plus/tests/e2e/specs/17_editor_performance.spec.ts`
  - `packages/markdown-notes-plus/scripts/benchmark-performance.mjs`

**Required performance invariants:**

### Startup

A normal note with no Q&A must not load the FlashcardView/FlashcardModel chunk during bootstrap.

A Q&A note opened in Writing mode may expose the Flashcards button using `FlashcardSuitability`, but must not load the heavy Flashcard parser until the user enters Flashcards.

### Typing

Typing in Writing or Source must not call `analyzeFlashcards`.

No Flashcard model recomputation is allowed merely because `snapshot.text` changes while Flashcards is not active.

### Active Flashcards mode

When canonical revision changes while Flashcards is active:

- recompute once for the new revision;
- stale async/lazy results must not replace a newer model;
- the model must be associated with `document instanceId/revision/generation`.

### Optional instrumentation

If adding metrics, use:

```text
flashcard_analysis_start
flashcard_analysis_end
flashcard_analysis_ms
```

Do not log question text, answer text, heading text, URL, or any note content.

### Regression gate

Run the repository's existing formal/smoke performance suite.

Acceptance:

- no material regression to existing Writing startup/typing thresholds;
- no new Flashcard chunk in source-only/normal startup network assertions;
- Flashcard analysis is absent from normal typing traces.

---

# Task 10: Update Documentation

**Files:**
- Modify: `packages/markdown-notes-plus/README.md`
- Modify the current user guide if present under `packages/markdown-notes-plus/docs`.

Document:

## Q&A syntax

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

## Behavior

Explain:

- Q&A stays ordinary Markdown.
- Flashcards mode is generated automatically.
- Answers can contain Markdown.
- Known/Again are session-only.
- Leaving/reloading may reset study state.
- No spaced-repetition scheduling is implemented.
- No study history is synchronized across devices.
- Flashcards never changes note content.

Also document supported Q&A heading aliases and keyboard shortcuts.

---

# Task 11: Test Script and Build Integration

**Files:**
- Modify: `packages/markdown-notes-plus/package.json`

Add new unit tests to both `test` and `test:unit`:

```text
tests/flashcard-suitability.test.ts
tests/flashcard-model.test.ts
tests/flashcard-session.test.ts
tests/flashcard-markdown.test.ts
```

E2E remains discovered by Playwright through the existing suite. If a focused command is useful, optionally add:

```json
"test:e2e:flashcards": "npm run build && E2E_PROD=1 mise exec -- playwright test tests/e2e/specs/18_flashcards.spec.ts --project=chromium"
```

Do not remove or weaken any existing suite.

---

# Task 12: Final Verification Matrix

The implementation is not complete until every item below passes.

## Static

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:artifacts`

## Unit

- [ ] `npm run test:unit`
- [ ] Flashcard suitability tests.
- [ ] Flashcard model tests.
- [ ] Flashcard session tests.
- [ ] Flashcard Markdown renderer/security tests.
- [ ] Existing Review diagnostics tests.
- [ ] Existing recurring task tests.
- [ ] Existing Kanban tests.

## Integration

- [ ] `npm run test:integration`
- [ ] Writing lossless boundary remains green.
- [ ] Source history boundary remains green.

## Browser E2E

- [ ] focused Flashcards E2E.
- [ ] `npm run test:e2e:writing`
- [ ] `npm run test:e2e:sn-contract`
- [ ] `npm run test:e2e`
- [ ] Firefox release suite if required by release policy.

## Standard Notes host contracts

- [ ] `npm run test:e2e:standardnotes-web`
- [ ] `npm run test:mobile-protocol`
- [ ] Android contract/harness where available.

## Performance

- [ ] Existing performance smoke/formal gate passes.
- [ ] Flashcard parser is absent from normal typing path.
- [ ] Flashcard heavy chunk is not loaded until Flashcards mode is entered.
- [ ] No note content is added to telemetry/performance JSON.

---

# Implementation Order

Implement in this order to keep regressions isolated:

```text
1. FlashcardSuitability + tests
2. FlashcardTypes / FlashcardModel + parser tests
3. FlashcardSession + tests
4. FlashcardMarkdown safe renderer + security tests
5. FlashcardView + styles
6. AppMode / App lazy integration
7. Navigation palette integration
8. EditorPage + E2E
9. security contract
10. performance/lazy-load assertions
11. documentation
12. full verification matrix
```

Do not start with `App.tsx` UI wiring before the parser and session contracts are covered by unit tests.

---

# Definition of Done

Flash Cards is complete only when all of the following are true:

1. A note containing a supported Q&A heading automatically exposes Flashcards mode.
2. Complete `Q:`/`A:` pairs become cards without changing canonical Markdown.
3. Multiline Markdown answers render safely.
4. Code/HTML false-positive markers do not create cards.
5. Reveal, previous/next, shuffle, Known, Again, reset, filters, and keyboard controls work.
6. Known/Again are session-only and contain no scheduling semantics.
7. No FSRS, SM-2, due date, interval, ease, or retention code exists.
8. No study state is written to `appData`, `localStorage`, IndexedDB, cookies, or Markdown.
9. Study actions generate zero Standard Notes save requests.
10. Locked notes can be studied.
11. Remote note replacement cannot display stale cards from the previous revision.
12. Flashcard parser/renderer code is lazy-loaded and absent from normal typing/startup paths.
13. Existing Writing lossless, bridge, security, mobile, Review, Kanban, and performance contracts remain green.
14. The feature works with Standard Notes light/dark themes and remains usable on E-Ink displays without flip animation.
15. Documentation clearly states that Flashcards is a derived Q&A projection with session-only study state.

---

# Non-Goals for Future Agents

Do not extend this implementation opportunistically with:

- FSRS,
- SM-2,
- Anki compatibility,
- background reminders,
- persistent statistics,
- automatic question generation,
- embeddings,
- LLM calls,
- cloud APIs,
- card editing inside Flashcards mode.

Those require separate design work and must not be added as incidental scope to this plan.
