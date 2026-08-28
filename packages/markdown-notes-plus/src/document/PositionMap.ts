/** A single non-overlapping replacement expressed in coordinates of the old text. */
export type TextChange = { from: number; to: number; insertedLength: number };

/** Serializable, editor-independent provenance for one text transition. */
export type TextChangeSet = {
  oldLength: number;
  newLength: number;
  changes: TextChange[];
};

/**
 * Validate and copy exact changes supplied by an editor or mutation producer.
 * Changes use old-document coordinates and must be sorted and non-overlapping.
 */
export function createTextChangeSet(oldLength: number, newLength: number, changes: readonly TextChange[]): TextChangeSet | undefined {
  if (!Number.isInteger(oldLength) || oldLength < 0 || !Number.isInteger(newLength) || newLength < 0) return undefined;
  let previousTo = 0;
  let delta = 0;
  for (const change of changes) {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || !Number.isInteger(change.insertedLength)) return undefined;
    if (change.from < previousTo || change.from < 0 || change.to < change.from || change.to > oldLength || change.insertedLength < 0) return undefined;
    previousTo = change.to;
    delta += change.insertedLength - (change.to - change.from);
  }
  if (oldLength + delta !== newLength) return undefined;
  return { oldLength, newLength, changes: changes.map((change) => ({ ...change })) };
}

/** Build the inverse map in new-document coordinates. */
export function invertTextChangeSet(changeSet: TextChangeSet): TextChangeSet {
  const changes: TextChange[] = [];
  let delta = 0;
  for (const change of changeSet.changes) {
    const from = change.from + delta;
    changes.push({ from, to: from + change.insertedLength, insertedLength: change.to - change.from });
    delta += change.insertedLength - (change.to - change.from);
  }
  return {
    oldLength: changeSet.newLength,
    newLength: changeSet.oldLength,
    changes,
  };
}

/**
 * Map a position through exact replacements. Positions inside replaced source
 * are intentionally unmappable. An insertion at a position is right-biased
 * so an anchor at a heading follows that original heading after the insert.
 */
export function mapTextPosition(changeSet: TextChangeSet, position: number): number | undefined {
  if (!Number.isInteger(position) || position < 0 || position > changeSet.oldLength) return undefined;
  let delta = 0;
  for (const change of changeSet.changes) {
    if (position < change.from) return position + delta;
    if (change.from === change.to && position === change.from) return position + delta + change.insertedLength;
    if (position < change.to) return undefined;
    delta += change.insertedLength - (change.to - change.from);
  }
  return position + delta;
}
