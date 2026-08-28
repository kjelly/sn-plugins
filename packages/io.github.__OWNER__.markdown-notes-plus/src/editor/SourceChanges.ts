import { createTextChangeSet, type TextChange, type TextChangeSet } from "../document/PositionMap.ts";

export type CodeMirrorChanges = {
  iterChanges(callback: (fromA: number, toA: number, fromB: number, toB: number, inserted: { length: number }) => void): void;
};

/** Adapt CodeMirror's exact multi-change description without exposing CM types to document core. */
export function sourceChangeSetFromCodeMirror(oldLength: number, newLength: number, changes: CodeMirrorChanges): TextChangeSet | undefined {
  const exact: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    exact.push({ from: fromA, to: toA, insertedLength: inserted.length });
  });
  return createTextChangeSet(oldLength, newLength, exact);
}
