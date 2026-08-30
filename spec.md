# Markdown Notes+ Structural Editing Implementation Specification

## 1. Scope

### 1.1 In scope

Implement editor-local features for the currently opened Standard Notes Markdown note only:

- Heading/subtree structural editing
- Outline drag-and-drop reorder
- Outline folding
- Writing-mode heading/subtree folding
- Section focus/narrow
- List/task structural editing
- GFM table structural editing
- Smart Enter/Tab/Backspace behavior
- Current-note sparse outline
- Structural keyboard shortcuts
- Structural slash commands
- Selection-aware block/list conversion
- Document visibility cycling

### 1.2 Out of scope

Do not implement:

- Cross-note search or indexing
- Global Agenda
- Capture/inbox workflow
- Cross-note refile
- Reminder/scheduler functionality
- Task deadline/scheduled/repeat/effort/priority metadata
- Task state systems such as TODO/NEXT/WAITING
- Org Properties/Drawer syntax
- Org tag system
- Time tracking/clocking
- Org Babel/code execution
- Export/publishing system
- Table formulas/spreadsheet calculations
- New Standard Notes host permissions
- New persistent data outside the current note Markdown text, except component-local UI preferences/state where already supported

---

## 2. Global implementation constraints

### 2.1 Canonical Markdown

- `CanonicalDocument.text` remains the only durable editor content source.
- Every document-changing structural operation must produce:
  - `markdown`
  - `changed`
  - `TextChangeSet` when changed
- Structural mutations must operate on exact source ranges.
- Do not normalize unrelated Markdown.
- Do not normalize whitespace outside the mutated source ranges.
- Do not change line-ending style.
- Do not rewrite valid Markdown into an equivalent alternative representation.
- Do not automatically convert Setext headings to ATX headings.
- Do not modify fenced code, HTML blocks, table literals, or other opaque source ranges unless the command explicitly targets a supported table structure in Writing mode.
- If a requested operation cannot be proven source-safe, return `changed: false`.

### 2.2 Projection-only state

The following state must never be serialized into Markdown:

- Outline collapsed headings
- Writing collapsed headings
- Focused section
- Sparse-outline filters
- Visibility-cycle mode
- Current outline search query
- Temporary drag state

### 2.3 Lock/conflict handling

All document-changing commands must be disabled when:

- `snapshot.locked === true`
- `AppDocumentLifecycle.canApplyLocal() === false`
- A pending remote conflict blocks local mutation

Projection-only commands may remain available while locked:

- Fold/unfold
- Expand/collapse all
- Focus/exit focus
- Sparse outline filters
- Visibility cycling

### 2.4 Undo/redo

- Every structural mutation must be one logical undo step.
- A drag-and-drop move must undo as one operation.
- Promote/demote of an entire subtree must undo as one operation.
- Table row/column operations must undo as one operation.
- Projection-only commands must not enter canonical undo history.

### 2.5 Remote updates

For UI state keyed by source offsets:

- Remap anchors with `TextChangeSet` and `mapTextPosition`.
- Remove anchors that become unmappable.
- Revalidate remapped anchors against the new `analyzeMarkdown()` result.
- If a remote replacement has no usable exact change map:
  - clear collapsed source anchors
  - exit focused section
  - preserve only non-position-dependent UI state such as outline filter text

---

## 3. Markdown analysis model changes

### 3.1 Extend heading metadata

Extend heading analysis to expose syntax and full heading source extent.

```ts
export type HeadingSyntax = "atx" | "setext";

export type HeadingInfo = {
  level: number;
  text: string;
  from: number;
  to: number;
  path: string[];

  syntax: HeadingSyntax;

  // Full heading source range.
  // ATX: heading line including line terminator when present.
  // Setext: text line + underline line including terminator when present.
  headingFrom: number;
  headingTo: number;

  // ATX opening marker range only.
  // Undefined for Setext.
  markerFrom?: number;
  markerTo?: number;
};
```

### 3.2 Extend section metadata

```ts
export type SectionInfo = {
  anchor: number;
  level: number;
  text: string;
  from: number;
  to: number;
  path: string[];

  headingIndex: number;
  parentAnchor?: number;
};
```

### 3.3 Required section helpers

Add pure helpers:

```ts
export function headingIndexByAnchor(
  analysis: MarkdownAnalysis,
  anchor: number,
): number | undefined;

export function parentSection(
  analysis: MarkdownAnalysis,
  anchor: number,
): SectionInfo | undefined;

export function siblingSections(
  analysis: MarkdownAnalysis,
  anchor: number,
): SectionInfo[];

export function previousSiblingSection(
  analysis: MarkdownAnalysis,
  anchor: number,
): SectionInfo | undefined;

export function nextSiblingSection(
  analysis: MarkdownAnalysis,
  anchor: number,
): SectionInfo | undefined;

export function headingsInSection(
  analysis: MarkdownAnalysis,
  anchor: number,
): HeadingInfo[];
```

### 3.4 Sibling definition

Two sections are siblings only when:

- Their heading levels are equal.
- Their `parentAnchor` values are equal.

Top-level headings have `parentAnchor === undefined`.

---

## 4. Structural mutation module

Create:

```text
src/markdown/structuralEditing.ts
```

Export pure canonical Markdown mutations only.

```ts
export type StructuralDirection = "up" | "down";

export function moveSubtree(
  markdown: string,
  anchor: number,
  direction: StructuralDirection,
): CommandResult;

export function moveSubtreeBefore(
  markdown: string,
  sourceAnchor: number,
  targetAnchor: number,
): CommandResult;

export function moveSubtreeAfter(
  markdown: string,
  sourceAnchor: number,
  targetAnchor: number,
): CommandResult;

export function promoteHeading(
  markdown: string,
  anchor: number,
): CommandResult;

export function demoteHeading(
  markdown: string,
  anchor: number,
): CommandResult;

export function promoteSubtree(
  markdown: string,
  anchor: number,
): CommandResult;

export function demoteSubtree(
  markdown: string,
  anchor: number,
): CommandResult;

export function duplicateSubtree(
  markdown: string,
  anchor: number,
): CommandResult;
```

---

## 5. Move subtree

### 5.1 Source range

The moved range is exactly:

```ts
section.from .. section.to
```

It includes:

- Root heading
- All descendant headings
- All paragraphs/lists/tasks/code blocks/tables inside the section
- Blank lines belonging to the section
- Trailing blank lines before the next sibling/ancestor heading

### 5.2 Move up

`moveSubtree(markdown, anchor, "up")`:

- Resolve current section.
- Resolve previous sibling.
- If no previous sibling exists, return unchanged.
- Swap these two complete source ranges:
  - previous sibling subtree
  - current subtree
- Preserve all bytes inside each subtree.
- Preserve all bytes outside both subtrees.

### 5.3 Move down

`moveSubtree(markdown, anchor, "down")`:

- Resolve current section.
- Resolve next sibling.
- If no next sibling exists, return unchanged.
- Swap these two complete source ranges.
- Preserve all subtree bytes exactly.

### 5.4 Arbitrary drag reorder

`moveSubtreeBefore` and `moveSubtreeAfter`:

- Source and target must both exist.
- Source and target must be siblings.
- Source and target must not be identical.
- The target anchor must not occur inside the source subtree.
- Only same-parent reorder is supported.
- Do not automatically change heading levels during drag-and-drop.
- Dropping on a non-sibling is invalid.
- Invalid drops must not mutate Markdown.

### 5.5 ChangeSet

The result must provide a valid `TextChangeSet`.

For a swap/reorder:

- Prefer a minimal set of non-overlapping replacements.
- If a minimal map is unnecessarily complex, a single replacement covering the smallest common contiguous source range is allowed.
- The change range must not include unrelated text outside the reordered sibling group.

### 5.6 Post-move active section

After a successful move:

- Recompute the active section anchor from the new source.
- Return enough metadata from the UI command wrapper to select the moved heading in its new location.
- Do not store the old source offset as the active anchor.

---

## 6. Promote/demote heading

### 6.1 Heading-only promote

`promoteHeading`:

- Supports ATX headings only.
- Root heading level must be `2..6`.
- Remove exactly one `#` from the opening marker.
- Preserve:
  - leading indentation
  - heading text
  - closing `#` markers
  - trailing whitespace
  - line ending
- Do not modify descendant headings.

Example:

```md
### Title ###
```

becomes:

```md
## Title ###
```

### 6.2 Heading-only demote

`demoteHeading`:

- Supports ATX headings only.
- Root heading level must be `1..5`.
- Add exactly one `#` to the opening marker.
- Preserve all other source characters.
- Do not modify descendant headings.

### 6.3 Setext behavior

For Setext headings:

- `promoteHeading` returns unchanged.
- `demoteHeading` returns unchanged.
- UI command must be disabled for Setext targets.

---

## 7. Promote/demote subtree

### 7.1 Promote subtree

`promoteSubtree`:

- Resolve all headings inside the target section.
- Every heading that would be modified must be ATX.
- Root level must be greater than 1.
- Subtract one level from every heading in the subtree.
- Preserve relative heading depth.

Example:

```md
### A
#### B
##### C
```

becomes:

```md
## A
### B
#### C
```

### 7.2 Demote subtree

`demoteSubtree`:

- Resolve every heading in the subtree.
- Every heading must be ATX.
- No target heading may exceed level 6.
- Add one `#` to each opening marker.

### 7.3 Atomic rejection

If any heading in the subtree is unsupported:

- Reject the entire operation.
- Do not partially modify supported headings.

Unsupported cases include:

- Setext heading inside the target subtree
- Promote root at level 1
- Demote any subtree heading already at level 6

### 7.4 ChangeSet

- Emit one `TextChange` per modified ATX marker.
- Changes must be sorted by old-document position.
- Each change replaces only the opening ATX marker.
- Do not replace whole heading lines.

---

## 8. Duplicate subtree

`duplicateSubtree`:

- Copy the exact section source range.
- Insert the duplicate immediately after the original section.
- Do not normalize blank lines.
- The copied subtree must be byte-identical to the original.
- The newly duplicated root heading becomes the active section.
- One undo removes the complete duplicate.

---

## 9. Outline structural controls

Update the Outline panel in `App.tsx` or split it into dedicated components under:

```text
src/outline/
```

Recommended components:

```text
OutlinePanel.tsx
OutlineRow.tsx
OutlineDragState.ts
OutlineProjection.ts
```

### 9.1 Row controls

Each heading row must support:

- Fold/unfold toggle
- Move up
- Move down
- Promote subtree
- Demote subtree
- Duplicate subtree
- Focus section
- Drag handle

### 9.2 Disabled states

Move up disabled when:

- no previous sibling

Move down disabled when:

- no next sibling

Promote subtree disabled when:

- root level is 1
- any heading in subtree is Setext

Demote subtree disabled when:

- any heading in subtree is Setext
- any heading in subtree is level 6

All mutation controls disabled while note is locked or local edits cannot be applied.

### 9.3 Drag-and-drop

Use pointer/mouse drag-and-drop without external libraries unless a dependency is already present.

Required behavior:

- Drag starts only from a drag handle.
- Dragging does not mutate Markdown until drop.
- Valid drop zones:
  - before previous/next/current sibling rows
  - after previous/next/current sibling rows
- Only sibling targets are valid.
- Invalid targets do not show an active drop indicator.
- Drop commits exactly one canonical mutation.
- Escape cancels active drag.
- Dropping outside the valid outline region cancels.
- Fold state of the moved subtree is preserved after remapping when possible.

### 9.4 Keyboard accessibility

Each drag operation must also be achievable without drag:

- Move Up button
- Move Down button

Do not make drag-and-drop the only reorder mechanism.

---

## 10. Outline folding

### 10.1 State

Add App state:

```ts
const [collapsedOutlineAnchors, setCollapsedOutlineAnchors] =
  useState<Set<number>>(new Set());
```

### 10.2 Behavior

When a heading is collapsed:

- Keep the heading row visible.
- Hide all descendant heading rows.
- Do not hide following siblings.
- Preserve collapse state of hidden descendants.

When the parent is expanded:

- Restore descendant rows according to each descendant's own collapse state.

### 10.3 Anchor remapping

On canonical transitions with `changeSet`:

- Map every collapsed anchor using `mapTextPosition`.
- Keep only mapped positions that remain valid heading anchors.

On transitions without a usable map:

- clear the collapsed anchor set

### 10.4 Controls

Provide:

- Collapse current
- Expand current
- Collapse all
- Expand all

`Collapse all`:

- Collapse every heading that has at least one descendant heading.

`Expand all`:

- Clear all outline collapse state.

---

## 11. Writing-mode folding

Create:

```text
src/editor/WritingFolding.ts
```

Implement a ProseMirror plugin.

### 11.1 Required properties

Extend `WritingEditorProps`:

```ts
type WritingFoldMode = "expanded" | "collapsed" | "children";

type WritingFoldEntry = {
  headingIndex: number;
  mode: WritingFoldMode;
};

type WritingEditorProps = {
  // existing props...
  folds?: WritingFoldEntry[];
  onToggleFold?: (headingIndex: number) => void;
};
```

### 11.2 Source/ProseMirror correspondence

- Canonical `analysis.headings` order is authoritative.
- ProseMirror heading nodes are enumerated in document order.
- Folding is enabled only when:
  - Writing mode is editable
  - ProseMirror heading count equals canonical heading count
- If counts diverge:
  - do not hide content
  - do not mutate canonical state
  - folding controls may remain visible but disabled until correspondence is restored

### 11.3 Fold toggle UI

Render a fold toggle adjacent to Writing-mode heading nodes.

Do not insert characters into the document.

Toggle behavior for P0:

```text
expanded -> collapsed -> expanded
```

### 11.4 Collapsed projection

For a collapsed heading:

- Keep root heading visible.
- Hide every block after the root heading until the next heading whose level is less than or equal to the root level.
- Hidden nodes remain in the ProseMirror document.
- Hidden nodes must not be deleted or replaced.
- Hidden nodes must reappear with exact content when expanded.

### 11.5 Nested folds

- A collapsed parent overrides descendant visibility.
- Descendant fold state remains stored.
- Expanding parent reapplies descendant fold states.

### 11.6 Read-only state

Folding remains available when Writing mode is read-only because folding is projection-only.

---

## 12. Section focus/narrow

### 12.1 State

Add App state:

```ts
const [focusedSectionAnchor, setFocusedSectionAnchor] =
  useState<number | undefined>();
```

### 12.2 Entry points

Focus can be entered from:

- Outline row action
- Source current section action
- `/focus-section` slash command only when a reliable current Writing heading can be resolved
- Toolbar command when `activeSectionAnchor` exists

### 12.3 Writing projection

When focus is active:

- Resolve the focused canonical heading index.
- Pass the heading index to Writing mode.
- Writing mode shows:
  - focused root heading
  - all content in its subtree
- Hide:
  - all content before the focused root
  - all following sibling/ancestor sections outside the focused subtree

### 12.4 Outline projection

When focus is active:

- Outline shows the focused root and its descendants only.
- Show a breadcrumb above the outline:

```text
Parent / Child / Focused
```

- Provide `Exit Focus`.

### 12.5 Source mode

Source mode must always show the full canonical Markdown.

When switching to Source while focus is active:

- keep focus state
- scroll/select the focused heading
- do not hide source text

### 12.6 Exit conditions

Automatically exit focus when:

- focused anchor becomes unmappable
- focused heading no longer exists after mutation/remote replacement
- loading a different note/reset generation invalidates the anchor

### 12.7 Editing while focused

- Normal Writing edits inside the focused projection remain allowed.
- Editing must still pass existing Writing round-trip gates.
- Focus state must not alter serialized Markdown.

---

## 13. Visibility cycling

### 13.1 Per-heading cycle

P1 extends Writing folding to:

```text
expanded -> collapsed -> children -> expanded
```

### 13.2 `children` projection

For a heading in `children` mode:

Show:

- root heading
- immediate child headings only

Hide:

- body blocks directly under root
- body blocks under child headings
- grandchild and deeper headings
- all deeper descendant content

### 13.3 Whole-document visibility

Add App-level projection state:

```ts
type DocumentVisibility = "all" | "headings" | "top-level";
```

Cycle:

```text
all -> top-level -> headings -> all
```

Definitions:

- `all`: normal document
- `top-level`: show only the minimum heading level present in the note
- `headings`: show all headings, hide non-heading content

### 13.4 Persistence

Document visibility mode is ephemeral.

Do not save it into Markdown.

---

## 14. List/task structural editing

Create:

```text
src/editor/WritingListCommands.ts
```

### 14.1 Supported structures

Commands must operate on:

- Bullet list item
- Ordered list item
- GFM task list item

Nested content inside the selected list item is part of the list-item subtree.

### 14.2 Resolve target list item

If selection is collapsed:

- resolve nearest ancestor `list_item`

If selection spans multiple items:

- resolve all top-level selected list items under the same parent list
- selected items must be contiguous siblings
- nested descendants are included automatically with their parent item

If targets do not share one parent list:

- command returns false

### 14.3 Move item up

- Move selected list-item subtree before previous sibling.
- If no previous sibling, return false.
- Preserve:
  - task checked state
  - nested child lists
  - paragraph content
  - marks
  - ordered/bullet parent type
- Restore selection inside the moved item.

### 14.4 Move item down

- Move selected subtree after next sibling.
- If no next sibling, return false.
- Preserve all node content/attrs.

### 14.5 Indent

Use schema-supported list nesting.

Preferred implementation:

```ts
sinkListItem(schema.nodes.list_item)
```

Behavior:

- Indent selected/current item under previous sibling.
- If no previous sibling exists, return false.
- Preserve task attrs.

### 14.6 Outdent

Preferred implementation:

```ts
liftListItem(schema.nodes.list_item)
```

Behavior:

- Lift current/selected item one list level.
- If already at outermost list level and lift would convert it to a paragraph unexpectedly, reject unless the explicit smart-backspace behavior applies.

### 14.7 Mutation origin

Every list structural transaction must set:

```ts
WRITING_TRANSACTION_ORIGIN_META
```

with a command origin that is recognized by `WritingEditorLifecycle`.

Add command identifiers:

```ts
"move-list-item-up"
"move-list-item-down"
"indent-list-item"
"outdent-list-item"
```

These operations must remain subject to `assessWritingMutation`.

---

## 15. Writing heading structural commands

Create:

```text
src/editor/WritingHeadingCommands.ts
```

### 15.1 Scope

Writing structural keyboard commands may operate directly on ProseMirror headings only when:

- Writing is editable
- Current selection resolves to a heading
- Serializer safety gate remains satisfied

### 15.2 Resolve Writing subtree

From current heading:

- root = selected heading node
- subtree ends immediately before the next heading node whose level is less than or equal to root level
- subtree consists of top-level ProseMirror blocks in that range

### 15.3 Move up/down

- Previous/next target must be a sibling heading:
  - equal heading level
  - same logical parent based on preceding heading hierarchy
- Move the complete ProseMirror block slice.
- Dispatch one transaction.
- Preserve selection near the moved root heading.

### 15.4 Promote/demote subtree

- Change heading `level` attrs for every heading node in the subtree.
- Promote rejects root level 1.
- Demote rejects if any heading level is 6.
- Dispatch one transaction.

### 15.5 Round-trip failure

If the serializer result fails the existing Writing mutation safety check:

- trigger existing Source fallback behavior
- do not silently keep a lossy canonical result

---

## 16. Structural keyboard shortcuts

### 16.1 Activation scope

Keyboard shortcuts execute only when:

- Writing editor has focus
- editor is not composing IME text
- event is not already handled by an active popup/slash menu
- operation is valid for current structural context

Call `preventDefault()` only after confirming that the structural command will execute.

### 16.2 Shortcuts

Implement:

```text
Alt+ArrowUp
  Heading -> move subtree up
  List/task -> move item subtree up

Alt+ArrowDown
  Heading -> move subtree down
  List/task -> move item subtree down

Alt+ArrowLeft
  Heading -> promote subtree
  List/task -> outdent item

Alt+ArrowRight
  Heading -> demote subtree
  List/task -> indent item

Tab
  Heading -> toggle fold when selection is at heading context and no text insertion behavior is expected
  List/task -> indent item

Shift+Tab
  Heading -> document visibility cycle
  List/task -> outdent item
```

### 16.3 Priority

When selection is inside nested structures:

1. list/task item
2. heading
3. normal editor behavior

### 16.4 Platform handling

- Use `event.altKey` for structural Alt commands.
- Do not depend on OS-specific Meta/Ctrl equivalents.
- Preserve existing `Ctrl/Cmd+K` link behavior.

---

## 17. Smart Enter

Implement in Writing-mode key handling.

### 17.1 Bullet list

At non-empty bullet item end:

```md
- item|
```

Enter creates:

```md
- item
- |
```

### 17.2 Ordered list

At non-empty ordered item end:

```md
1. item|
```

Enter creates the next list item through the schema.

Markdown numbering style is determined by the existing serializer.

### 17.3 Task list

At non-empty task item end:

```md
- [ ] task|
```

Enter creates a new unchecked task item:

```md
- [ ] task
- [ ] |
```

The new item must not inherit `checked: true`.

### 17.4 Empty list/task item

Pressing Enter on an empty list/task item:

- exit the current list level
- produce a normal paragraph after the list
- for nested lists, first lift one level when appropriate; repeated Enter may exit the list

### 17.5 Heading

Normal Enter after a heading creates a paragraph.

Add separate structural command:

```text
Alt+Enter
```

When current selection is in a heading:

- create a new heading of the same level after the current subtree
- place cursor in the new heading

Do not use normal Enter to automatically create another heading.

---

## 18. Smart Tab / Shift+Tab

Inside a list/task:

- `Tab` -> indent current item
- `Shift+Tab` -> outdent current item

Outside a list/task:

- retain existing editor behavior unless heading-fold behavior explicitly applies

Do not insert literal tab characters into list-item paragraphs when the structural command succeeds.

---

## 19. Smart Backspace

### 19.1 Empty list item

When cursor is at the beginning of an empty outermost list item:

- convert/remove list structure
- leave an empty paragraph

For nested list item:

- outdent one level first

### 19.2 Empty task item

Same as empty list item.

Do not preserve task checkbox state when converting to a paragraph.

### 19.3 Empty heading

When cursor is at the beginning of an empty heading:

- convert heading to paragraph
- keep cursor at equivalent logical position

### 19.4 Non-empty blocks

Do not override normal Backspace for non-empty content.

---

## 20. GFM table structural editor

Create:

```text
src/editor/WritingTableCommands.ts
src/editor/WritingTableControls.tsx
```

### 20.1 Supported mode

Table structural editing is Writing-mode only.

Do not create a second Markdown table parser for Source mode.

### 20.2 Schema requirement

Use only existing Milkdown GFM schema nodes:

```text
table
table_header_row
table_header
table_row
table_cell
```

Do not add custom table node types.

Do not add custom persistent attributes unless the current GFM serializer already supports them.

### 20.3 Cell navigation

`Tab`:

- move to next cell
- header cells participate in navigation
- from last cell of last row:
  - append one body row
  - move cursor to first cell of new row

`Shift+Tab`:

- move to previous cell
- from first cell:
  - remain in first cell
  - do not leave the editor

### 20.4 Insert row above

- Resolve current table row.
- Insert a body/header-compatible row immediately before current row.
- If current row is the header row:
  - do not create a second header row
  - insert a body row after header instead, or disable "row above" for header
- New cells are empty.

### 20.5 Insert row below

- Insert same-width body row after current row.
- New cells are empty.

### 20.6 Delete row

- Header row cannot be deleted independently if that would make the table invalid.
- If deleting the only body row:
  - keep a valid empty body row if required by current serializer/schema
- Never create an invalid table node.

### 20.7 Insert column left/right

For each row:

- insert one cell at the same column index
- header row receives `table_header`
- body rows receive `table_cell`

New cells are empty.

### 20.8 Delete column

- Remove selected column from every row.
- Do not allow deletion if it would leave zero columns.
- Cursor moves to nearest remaining cell.

### 20.9 Move row up/down

- Header row remains fixed at index 0.
- Body rows may reorder among body rows only.
- Moving first body row up is a no-op.
- Moving last body row down is a no-op.

### 20.10 Move column left/right

- Reorder the same column index consistently across every row.
- Preserve each cell's node type and content.

### 20.11 Alignment

Expose:

```text
Left
Center
Right
```

Requirements:

- Use only alignment data already supported by the existing GFM table parser/serializer.
- Do not invent a parallel metadata syntax.
- Applying alignment affects the entire selected column.
- Round-trip tests must verify emitted Markdown delimiter syntax:
  - left
  - center
  - right
- If the active Milkdown schema does not expose serializer-supported alignment state, omit the alignment UI rather than storing custom data.

### 20.12 Table command provenance

Every table structural transaction must:

- set `WRITING_TRANSACTION_ORIGIN_META`
- preserve/set `WRITING_STRUCTURAL_CONTEXT_META` with `context: "table"`

The existing structural proof must remain active after:

- insert row
- delete row
- insert column
- delete column
- move row
- move column
- alignment change

---

## 21. Table controls UI

When selection is inside a table, expose a compact contextual toolbar/menu:

```text
Row
- Insert above
- Insert below
- Delete
- Move up
- Move down

Column
- Insert left
- Insert right
- Delete
- Move left
- Move right

Align
- Left
- Center
- Right
```

Requirements:

- Controls hidden outside tables.
- Controls disabled in read-only/locked mode.
- Controls must not steal editor selection before command execution.
- Use `mousedown.preventDefault()` where necessary to preserve ProseMirror selection.

---

## 22. Sparse outline

Create:

```text
src/outline/SparseOutline.ts
```

### 22.1 State

```ts
export type SparseOutlineFilter = {
  query: string;
  unfinishedTasksOnly: boolean;
};
```

### 22.2 Text query

Matching:

- case-insensitive
- heading text only
- trimmed query
- empty query matches all headings

### 22.3 Unfinished-task filter

A heading matches when its subtree contains at least one unchecked task:

```ts
task.itemStart >= section.from &&
task.itemEnd <= section.to &&
task.checked === false
```

### 22.4 Ancestor retention

For every directly matching heading:

- retain all ancestors required to show the hierarchy
- ancestors are shown even if they do not independently match

### 22.5 Descendants

Do not automatically show unmatched descendants.

### 22.6 Combination

When query and unfinished-task filter are both active:

- direct match requires both conditions

### 22.7 Interaction with folding

- Sparse filter is applied first.
- Folding is applied to the filtered tree second.
- Hidden ancestors required for hierarchy must never be removed by sparse filtering.

---

## 23. Slash commands

Extend `WritingCommandName`, `WRITING_COMMANDS`, aliases, and command handling with structural commands that are safe to expose in Writing.

Add:

```text
/fold
/focus-section
/move-section-up
/move-section-down
/promote-subtree
/demote-subtree
/move-item-up
/move-item-down
/indent-item
/outdent-item
```

Suggested aliases:

```ts
"fold": ["collapse"],
"focus-section": ["focus", "narrow"],
"move-section-up": ["section-up", "subtree-up"],
"move-section-down": ["section-down", "subtree-down"],
"promote-subtree": ["promote", "heading-left"],
"demote-subtree": ["demote", "heading-right"],
"move-item-up": ["item-up"],
"move-item-down": ["item-down"],
"indent-item": ["indent"],
"outdent-item": ["outdent"],
```

### 23.1 Context filtering

The slash menu must hide commands that cannot apply.

Examples:

- list commands visible only inside list/task context
- heading commands visible only inside heading context
- focus visible only when current heading/section can be resolved

### 23.2 Slash text consumption

- Delete `/command` text only after command validation succeeds.
- Invalid command context must not consume user text.

---

## 24. Selection-aware list conversion

Create or extend logic in:

```text
WritingCommands.ts
```

### 24.1 Supported conversions

Support:

```text
Paragraph blocks -> Bullet list
Paragraph blocks -> Ordered list
Paragraph blocks -> Task list

Bullet list -> Ordered list
Bullet list -> Task list

Ordered list -> Bullet list
Ordered list -> Task list

Task list -> Bullet list
Task list -> Ordered list
```

### 24.2 Multiple paragraphs

For selection spanning multiple paragraph blocks:

Input logical blocks:

```text
A
B
C
```

Task conversion produces three list items:

```md
- [ ] A
- [ ] B
- [ ] C
```

### 24.3 Task conversion

When converting normal list items to tasks:

- set `checked: false` for every converted item

When converting tasks to normal lists:

- remove `checked` attribute
- preserve item content and nested child lists

### 24.4 Nested list preservation

When converting parent list type:

- preserve nested child list structure
- do not flatten descendants

### 24.5 Mixed selection

If selection contains incompatible block types that cannot be safely converted:

- return false
- do not partially convert

---

## 25. Selection-aware block wrapping

### 25.1 Blockquote

Selection spanning multiple compatible blocks:

- wrap entire selected block range in one blockquote when schema permits
- preserve paragraph/list contents

### 25.2 Code block

For one selected paragraph:

- convert to code block

For multiple selected plain paragraphs:

- replace selected blocks with one code block containing their plain text separated by `\n` only if serializer behavior is proven safe

If selection includes non-plain structural blocks:

- reject instead of flattening structure

### 25.3 Undo

Each conversion is one transaction/undo step.

---

## 26. Source-mode structural actions

Source mode remains the exact canonical Markdown editor.

### 26.1 Required app-level actions

Source mode must support current-section actions through App/Outline controls:

- Move section up
- Move section down
- Promote subtree
- Demote subtree
- Duplicate subtree
- Focus section

These use canonical `structuralEditing.ts` functions.

### 26.2 Source keyboard behavior

Do not replace CodeMirror's existing:

```text
defaultKeymap
historyKeymap
indentWithTab
```

with custom structural keymaps in P0.

Source-specific Alt structural shortcuts may be added later only if they operate on exact source offsets and have dedicated tests.

---

## 27. Writing mutation origin changes

Extend command typing so structural commands can be tagged without pretending they are ordinary text input.

Preferred type:

```ts
export type WritingStructuralCommandName =
  | "move-heading-up"
  | "move-heading-down"
  | "promote-heading-subtree"
  | "demote-heading-subtree"
  | "move-list-item-up"
  | "move-list-item-down"
  | "indent-list-item"
  | "outdent-list-item"
  | "table-insert-row"
  | "table-delete-row"
  | "table-insert-column"
  | "table-delete-column"
  | "table-move-row"
  | "table-move-column"
  | "table-align-column";

export type WritingMutationOrigin =
  | "user"
  | { kind: "command"; command: WritingCommandName }
  | { kind: "structural-command"; command: WritingStructuralCommandName }
  | WritingExternalReplacement;
```

### 27.1 Safety rules

For non-table structural commands:

- result must remain inside normal Writing lexical safety rules

For table structural commands:

- require preserved `"table"` structural context
- result must still contain a valid table

### 27.2 External replacement

Do not change current external-replacement suppression semantics.

---

## 28. App integration

Refactor `App.tsx` to avoid placing all new behavior directly inside the existing component.

Recommended modules:

```text
src/app/
  App.tsx
  AppDocumentLifecycle.ts
  EditorStructuralCommands.ts

src/outline/
  OutlineIndex.ts
  OutlinePanel.tsx
  OutlineRow.tsx
  OutlineProjection.ts
  SparseOutline.ts

src/markdown/
  analysis.ts
  analysisCore.ts
  structuralEditing.ts

src/editor/
  WritingEditor.tsx
  WritingCommands.ts
  WritingHeadingCommands.ts
  WritingListCommands.ts
  WritingTableCommands.ts
  WritingTableControls.tsx
  WritingFolding.ts
```

### 28.1 App command wrapper

Create one wrapper for canonical structural commands.

Example API:

```ts
function applyStructuralMutation(
  command: (markdown: string) => CommandResult,
): boolean;
```

Behavior:

- verify local edits allowed
- execute pure mutation
- no-op if unchanged
- apply via existing `edit(...)`
- preserve returned `TextChangeSet`
- update/reconcile active/focused/collapsed anchors
- notify bridge through the existing edit path

Do not call `EditorKitBridge` directly from outline/editor command modules.

---

## 29. UI state reconciliation

On every canonical transition with a `TextChangeSet`:

Reconcile:

- `activeSectionAnchor`
- `focusedSectionAnchor`
- `collapsedOutlineAnchors`
- any canonical-anchor-backed fold state

After mapping:

- verify mapped anchor exists in `analysis.sections`
- discard invalid entries

### 29.1 Structural move special case

Because move operations may replace a range containing the original anchor:

- command result/UI wrapper must explicitly identify the moved root in the new document
- do not rely solely on `mapTextPosition` for a moved section anchor

---

## 30. Tests: pure structural mutations

Create:

```text
tests/structural-editing.test.ts
```

Required cases:

### 30.1 Move subtree

- move first sibling up -> no-op
- move last sibling down -> no-op
- move middle sibling up
- move middle sibling down
- nested subtree moves with all descendants
- sibling move does not absorb next ancestor section
- blank lines preserved
- fenced code preserved byte-for-byte
- HTML preserved byte-for-byte
- tables preserved byte-for-byte
- task states preserved
- CRLF input rejected/no-op if mutation implementation cannot preserve it exactly
- valid `TextChangeSet`

### 30.2 Promote/demote

- promote ATX heading
- demote ATX heading
- preserve closing hashes
- preserve leading 0..3 spaces
- subtree changes all descendant ATX levels
- promote level 1 rejected
- demote level 6 rejected
- Setext root rejected
- Setext descendant causes atomic subtree rejection
- valid multi-change `TextChangeSet`

### 30.3 Duplicate

- duplicates exact bytes
- duplicates nested subtree
- preserves blank lines
- valid `TextChangeSet`

---

## 31. Tests: outline projection

Create:

```text
tests/outline-projection.test.ts
```

Required cases:

- collapsed heading hides descendants only
- nested collapse state survives parent expand
- expand all
- collapse all
- anchor mapping through insertion before heading
- anchor mapping through text change after heading
- unmappable heading removes fold state
- sparse query keeps ancestors
- unfinished-task filter
- combined query + task filter
- unmatched descendants omitted

---

## 32. Tests: Writing folding/focus

Extend:

```text
tests/milkdown-boundary.test.ts
tests/integration.test.ts
```

Required cases:

- folding does not change serialized Markdown
- expanding restores exact serialized Markdown
- nested folding does not mutate document
- fold state maps through normal ProseMirror transactions
- focus hides outside blocks without changing document
- exit focus restores all blocks
- heading-count mismatch disables Writing projection hiding
- locked note can fold/focus but cannot mutate content
- remote reset clears invalid focus state

---

## 33. Tests: list structural editing

Add Writing integration cases:

- move bullet item up
- move bullet item down
- move task item with checkbox state
- move parent item with nested list
- first item up -> no-op
- last item down -> no-op
- indent item
- outdent item
- task stays task after indent/outdent
- multi-item contiguous move
- selection across different parent lists rejected
- one undo restores original structure
- serializer result passes safety gate

---

## 34. Tests: smart keys

Required Writing cases:

- Enter after bullet item creates bullet item
- Enter after ordered item creates ordered item
- Enter after unchecked task creates unchecked task
- Enter after checked task creates unchecked task
- Enter on empty list exits/lifts list
- Tab indents list item
- Shift+Tab outdents list item
- Backspace on empty list item converts/lifts
- Backspace on empty heading converts to paragraph
- Alt+Enter after heading creates same-level heading after subtree
- IME composition prevents structural shortcut handling

---

## 35. Tests: table editing

Required cases:

- Tab moves to next cell
- Shift+Tab moves to previous cell
- Tab on final cell creates body row
- insert row above/below
- delete body row
- header remains valid
- insert column left/right
- delete column
- cannot delete final remaining column
- move body row up/down
- header never moves into body
- move column left/right
- cell contents preserved during move
- alignment serializer output validated if alignment is supported
- every command keeps `"table"` structural context
- table mutation remains editable in Writing
- one undo reverses each table command

---

## 36. E2E tests

Add Playwright tests under:

```text
tests/e2e/
```

Required flows:

### 36.1 Outline drag reorder

1. Open note with three sibling sections.
2. Drag second section above first.
3. Verify outline order.
4. Switch to Source.
5. Verify exact Markdown section order.
6. Undo.
7. Verify original source restored.

### 36.2 Fold/focus

1. Open note with nested sections.
2. Collapse parent in Outline.
3. Verify descendant rows hidden.
4. Expand.
5. Focus child section.
6. Verify Writing hides unrelated sections.
7. Switch Source.
8. Verify full source remains present.
9. Exit focus.

### 36.3 List structural editing

1. Place cursor in task.
2. Alt+Down.
3. Verify task and nested child moved.
4. Alt+Right.
5. Verify indentation.
6. Undo twice.
7. Verify original Markdown.

### 36.4 Table editing

1. Insert table through existing command.
2. Navigate cells with Tab.
3. Add row.
4. Add column.
5. Move row/column.
6. Switch Source.
7. Verify valid GFM Markdown.
8. Undo sequence.
9. Verify table remains valid after every undo.

---

## 37. Required validation commands

All implementation work must pass:

```sh
npm ci
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

No feature is complete if:

- TypeScript typecheck fails
- Existing lossless tests regress
- Existing conflict/save lifecycle tests regress
- Existing source-history boundary tests regress
- Existing Milkdown boundary tests regress

---

## 38. P0 delivery order

Implement in this order:

1. Extend heading/section analysis metadata.
2. Add pure `structuralEditing.ts`.
3. Add unit tests for structural mutation.
4. Add Outline move/promote/demote/duplicate controls.
5. Add Outline drag-and-drop sibling reorder.
6. Add Outline folding.
7. Add Writing two-state folding.
8. Add section focus/narrow.
9. Add Writing list/task structural commands.
10. Add structural keyboard shortcuts for list/heading.
11. Add GFM table navigation and structural controls.
12. Add integration/E2E coverage.

---

## 39. P1 delivery order

1. Three-state per-heading visibility cycling.
2. Whole-document visibility cycling.
3. Smart Enter.
4. Smart Tab/Shift+Tab.
5. Smart Backspace.
6. Sparse Outline.
7. Structural slash commands.
8. Selection-aware list conversion.
9. Selection-aware blockquote/code conversion.
10. Additional Source-mode exact structural shortcuts only after dedicated source tests exist.

---

## 40. Completion criteria

The feature set is complete only when all of the following are true:

- Structural section operations work without rewriting unrelated Markdown.
- All document mutations return valid `TextChangeSet` values.
- Setext headings are never silently converted.
- Folding/focus/filtering never modifies canonical Markdown.
- Outline drag-and-drop is restricted to valid sibling reorder.
- List/task movement always carries nested descendants.
- Table commands never create invalid GFM table structure.
- Writing structural mutations remain protected by existing lossless/fallback behavior.
- Locked/conflicted notes cannot be structurally mutated.
- Source mode always exposes the full canonical Markdown.
- Undo/redo treats each structural command as one logical operation.
- Remote edits cannot leave stale focus/fold anchors pointing to unrelated sections.
- Existing editor save, conflict, theme, lock, source fallback, and history behavior remains unchanged.

