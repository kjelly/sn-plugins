# Multi-Device 3-Way Auto-Merge & Conflicted Copy Design

## 1. Overview & Goals

When editing notes across multiple devices (e.g., desktop, mobile, web), simultaneous edits frequently occur. Currently, `markdown-notes-plus` halts all remote synchronization whenever the editor has unsaved local edits (`dirty: true`), forcing the user to manually choose between "Keep local" and "Accept remote" even when edits are completely independent (e.g., editing different sections).

### Goals:
1. **Automate Non-Overlapping Edits (3-Way Auto-Merge)**: When remote changes arrive while local uncommitted edits exist, automatically merge changes if they do not modify the same lines or sections, without interrupting the user.
2. **Seamless Host Integration for True Conflicts (Conflicted Copy)**: When overlapping edits cannot be merged safely, retain local edits and seamlessly coordinate with Standard Notes' sync engine to generate a Conflicted Copy when saved, ensuring zero data loss.
3. **Zero External Heavy Dependencies**: Implement a clean, robust TypeScript line-based 3-way merge algorithm tailored for Markdown notes.

---

## 2. Background & Standard Notes Host Behavior

Standard Notes' core sync engine (`packages/models/src/Domain/Runtime/Deltas/Conflict.ts` and `GenericItem.ts`) provides native conflict resolution:
* **Active Editing (< 20 seconds)**: Strategy `KeepBaseDuplicateApply` preserves local content as the primary note and automatically duplicates the incoming remote content into a new note marked with `conflict_of: original_uuid`.
* **Inactive Editing (> 20 seconds)**: Strategy `DuplicateBaseKeepApply` applies the remote content to the primary note and duplicates the local snapshot into a Conflicted Copy note.

Inside the editor extension, the editor receives note content updates via `EditorKit.streamContextItem`. If the editor automatically merges non-overlapping edits and submits the merged result to the host, Standard Notes synchronizes cleanly without creating unnecessary duplicate notes. If a true conflict cannot be merged automatically, preserving local edits and submitting them allows Standard Notes to generate a Conflicted Copy as designed.

---

## 3. Architecture & Component Design

```
                     Incoming Remote Update (remote-update)
                                    │
                               Is Dirty?
                                ├───────► No ──► Initialize with Remote Text
                                │                (Update Base = Remote)
                                ▼ Yes
                 Run ThreeWayMerge(base, local, remote)
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
      [Clean Auto-Merge]                [Overlapping Conflict]
  * Apply merged text locally       * Set pendingRemote = remoteText
  * Update Base = Remote            * Display conflict banner
  * Schedule auto-save to host      * "Keep local" / "Accept remote" options
  * Show brief "Auto-merged" status
```

### 3.1. Base Snapshot Tracking (`baseText`)
- In `CanonicalDocument`, maintain `private baseText: string = ""`.
- `baseText` represents the latest known synchronized snapshot shared between local and remote.
- **Transitions**:
  - `initialize(text)`: Sets `this.baseText = text`.
  - `markSaved(text)`: Updates `this.baseText = text`.
  - `receiveRemote(text)` (Clean auto-merge): Updates `this.baseText = text` (the remote base is now incorporated).

### 3.2. 3-Way Line Merge Algorithm (`src/document/ThreeWayMerge.ts`)
A dedicated module providing pure functional 3-way diff & merge:
```typescript
export interface MergeResult {
  success: boolean;
  text?: string;
  conflicts?: Array<{ base: string[]; local: string[]; remote: string[] }>;
}

export function threeWayMerge(base: string, local: string, remote: string): MergeResult;
```

#### Merge Rules:
1. **Unchanged in both**: Keep base line.
2. **Changed only in local**: Keep local line(s).
3. **Changed only in remote**: Apply remote line(s).
4. **Identical changes in both**: Apply change cleanly without conflict.
5. **Conflicting changes in same hunk**: Return `success: false`.

### 3.3. Document Lifecycle Integration (`src/document/CanonicalDocument.ts`)
Update `receiveRemote(text: string)`:
```typescript
export type ReceiveRemoteResult = "initialized" | "merged" | "conflicted";

receiveRemote(text: string): ReceiveRemoteResult {
  if (!this.dirty) {
    this.initialize(text);
    return "initialized";
  }
  if (text === this.text) {
    this.baseText = text;
    return "initialized";
  }
  const mergeResult = threeWayMerge(this.baseText, this.text, text);
  if (mergeResult.success && mergeResult.text !== undefined) {
    this.baseText = text;
    this.applyLocal(mergeResult.text);
    return "merged";
  }
  this.state = { ...this.state, pendingRemote: text };
  this.emit();
  return "conflicted";
}
```

### 3.4. Host Bridge Coordination (`src/standardnotes/EditorKitBridge.ts`)
In `EditorKitBridge.setEditorRawText`:
- When `receiveRemote` returns `"merged"`:
  - Immediately notify the host of the local merged content via `this.scheduleSave(canonical.text)`.
  - Trigger `this.onHostChange()`.
- When `receiveRemote` returns `"conflicted"`:
  - Keep `pendingRemote` active and let the user decide.
  - Resolving with "keep-local" saves the local version to the host, letting Standard Notes manage Conflicted Copy generation if server-side timestamp conflict occurs.

---

## 4. User Interface & Experience

1. **Auto-Merge Feedback**:
   - When an auto-merge occurs while the user is typing, the status line briefly indicates `Auto-merged remote changes · Save pending` and transitions to `Edited · save pending` -> `Ready`.
   - Cursor positions and selections are preserved/adjusted gracefully.
2. **Conflict Banner**:
   - When true overlapping conflicts occur, the banner displays:
     `Another device modified the same section. Keep local edits (Standard Notes creates a Conflicted Copy if needed) or accept remote version.`
     - Button `Keep local`
     - Button `Accept remote`

---

## 5. Verification & Test Plan

1. **Unit Tests (`tests/three-way-merge.test.ts`)**:
   - Merging distinct non-overlapping sections (top, middle, bottom).
   - Concurrent additions of new list items or headings.
   - Concurrent checkbox toggles in different sections.
   - Identical simultaneous changes.
   - Overlapping edits on the same paragraph / sentence flagging conflict.
   - Preservation of newline formats (`\n` / `\r\n`).
2. **Integration Tests (`tests/integration.test.ts`)**:
   - Simulating incoming remote updates while editor is clean -> instant update.
   - Simulating incoming remote updates while editor is dirty (non-overlapping) -> automatic 3-way merge and host save trigger.
   - Simulating incoming remote updates while editor is dirty (overlapping) -> pending remote conflict banner.
   - Conflict resolution flow for both "keep-local" and "accept-remote".
3. **E2E Tests (`tests/e2e/specs/1_host_lifecycle.spec.ts`)**:
   - End-to-end multi-device sync simulation in mock host.
