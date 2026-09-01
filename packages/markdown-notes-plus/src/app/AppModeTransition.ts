export type AppMode = "writing" | "split" | "source" | "mindmap" | "kanban";

export type PendingWritingEnableAttempt = {
  id: number;
  expectedCanonicalText: string;
  /** Provisional until the expected canonical transition is observed. */
  documentGeneration: number;
  committedGeneration?: number;
};

export type WritingEnableAttemptState = {
  nextAttemptId: number;
  pending?: PendingWritingEnableAttempt;
};

export type WritingCanonicalObservation = {
  previousCanonicalText: string;
  currentCanonicalText: string;
  documentGeneration: number;
  initialized: boolean;
};

export type WritingCapabilityObservation = {
  editable: boolean;
  proofSource?: string;
  currentCanonicalText: string;
  documentGeneration: number;
};

export function createWritingEnableAttemptState(): WritingEnableAttemptState {
  return { nextAttemptId: 1 };
}

function cancelWritingEnableAttempt(state: WritingEnableAttemptState): WritingEnableAttemptState {
  return state.pending === undefined ? state : { ...state, pending: undefined };
}

/** Arm before the explicit canonical mutation; a failed mutation cancels it. */
export function armWritingEnableAttempt(
  state: WritingEnableAttemptState,
  expectedCanonicalText: string,
  documentGeneration: number,
  applied: boolean,
): WritingEnableAttemptState {
  if (!applied) return cancelWritingEnableAttempt(state);
  return {
    nextAttemptId: state.nextAttemptId + 1,
    pending: {
      id: state.nextAttemptId,
      expectedCanonicalText,
      documentGeneration,
    },
  };
}

/**
 * Accept exactly one non-initializing transition into the expected target and
 * capture the generation emitted by that transition for the capability proof.
 */
export function observeWritingCanonical(
  state: WritingEnableAttemptState,
  observation: WritingCanonicalObservation,
): WritingEnableAttemptState {
  if (state.pending === undefined) return state;
  if (
    observation.initialized ||
    state.pending.committedGeneration !== undefined ||
    observation.previousCanonicalText === observation.currentCanonicalText ||
    observation.currentCanonicalText !== state.pending.expectedCanonicalText
  ) return cancelWritingEnableAttempt(state);
  return {
    ...state,
    pending: { ...state.pending, committedGeneration: observation.documentGeneration },
  };
}

/** Consume an attempt on the first capability callback; only an exact proof can enable Writing. */
export function observeWritingCapability(
  state: WritingEnableAttemptState,
  observation: WritingCapabilityObservation,
): { state: WritingEnableAttemptState; enableWriting: boolean } {
  const pending = state.pending;
  if (pending === undefined) return { state, enableWriting: false };

  const exactProof = observation.editable &&
    pending.committedGeneration !== undefined &&
    observation.proofSource === pending.expectedCanonicalText &&
    observation.currentCanonicalText === pending.expectedCanonicalText &&
    observation.proofSource === observation.currentCanonicalText &&
    observation.documentGeneration === pending.committedGeneration;
  return { state: cancelWritingEnableAttempt(state), enableWriting: exactProof };
}

/** Fallback text can only be resolved by an explicit Source edit or initialize. */
export function modeAfterRequest(mode: AppMode, hasFallback: boolean): AppMode {
  return hasFallback && mode !== "source" ? "source" : mode;
}
