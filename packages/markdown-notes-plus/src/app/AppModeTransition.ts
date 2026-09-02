export type AppMode = "writing" | "split" | "source" | "mindmap" | "kanban";

import type { WritingCapability } from "../editor/WritingEditorLifecycle.ts";

export type WritingAdmissionIdentity = {
  documentInstanceId: string;
  documentRevision: number;
  documentGeneration: number;
  writingEpoch: number;
};

export type WritingAdmissionCapability = WritingCapability | {
  kind: "unproven";
  editable: false;
  reason: string;
};

export type WritingAdmissionIntent = { actor: "user" | "system"; pendingWriting: boolean };

export type WritingAdmissionState = {
  identity: WritingAdmissionIdentity;
  capability: WritingAdmissionCapability;
  intent: WritingAdmissionIntent;
  systemSourceAdmission?: WritingAdmissionIdentity;
};

export const unprovenWritingCapability: WritingAdmissionCapability = {
  kind: "unproven",
  editable: false,
  reason: "Writing is checking whether this source can be preserved exactly.",
};

export function sameWritingAdmissionIdentity(left: WritingAdmissionIdentity, right: WritingAdmissionIdentity): boolean {
  return left.documentInstanceId === right.documentInstanceId &&
    left.documentRevision === right.documentRevision &&
    left.documentGeneration === right.documentGeneration &&
    left.writingEpoch === right.writingEpoch;
}

export function createWritingAdmissionState(identity: WritingAdmissionIdentity): WritingAdmissionState {
  return {
    identity,
    capability: unprovenWritingCapability,
    intent: { actor: "user", pendingWriting: true },
  };
}

/** A canonical/lifecycle identity change invalidates proof but preserves intent. */
export function rebaseWritingAdmission(state: WritingAdmissionState, identity: WritingAdmissionIdentity): WritingAdmissionState {
  if (sameWritingAdmissionIdentity(state.identity, identity)) return state;
  return {
    ...state,
    identity,
    capability: unprovenWritingCapability,
  };
}

export type PendingWritingEnableAttempt = {
  id: number;
  expectedCanonicalText: string;
  /** Provisional until the expected canonical transition is observed. */
  documentGeneration: number;
  committedGeneration?: number;
  expectedDocumentInstanceId?: string;
  expectedDocumentRevision?: number;
  committedDocumentInstanceId?: string;
  committedDocumentRevision?: number;
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
  documentInstanceId?: string;
  documentRevision?: number;
};

export type WritingCapabilityObservation = {
  editable: boolean;
  proofSource?: string;
  currentCanonicalText: string;
  documentGeneration: number;
  documentInstanceId?: string;
  documentRevision?: number;
};

export type WritingEnableTransition = {
  mode: "writing";
  normalizationPrompt: false;
};

/** The only transition that may enable Writing after an explicit apply/proof. */
export function writingEnableTransition(enabled: boolean): WritingEnableTransition | undefined {
  return enabled ? { mode: "writing", normalizationPrompt: false } : undefined;
}

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
  documentToken?: { instanceId: string; revision: number },
): WritingEnableAttemptState {
  if (!applied) return cancelWritingEnableAttempt(state);
  return {
    nextAttemptId: state.nextAttemptId + 1,
    pending: {
      id: state.nextAttemptId,
      expectedCanonicalText,
      documentGeneration,
      ...(documentToken ? {
        expectedDocumentInstanceId: documentToken.instanceId,
        expectedDocumentRevision: documentToken.revision,
      } : {}),
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
  if (
    state.pending.expectedDocumentInstanceId !== undefined &&
    (observation.documentInstanceId !== state.pending.expectedDocumentInstanceId ||
      observation.documentRevision !== state.pending.expectedDocumentRevision! + 1)
  ) return cancelWritingEnableAttempt(state);
  return {
    ...state,
    pending: {
      ...state.pending,
      committedGeneration: observation.documentGeneration,
      ...(observation.documentInstanceId !== undefined && observation.documentRevision !== undefined ? {
        committedDocumentInstanceId: observation.documentInstanceId,
        committedDocumentRevision: observation.documentRevision,
      } : {}),
    },
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
    observation.documentGeneration === pending.committedGeneration &&
    (pending.committedDocumentInstanceId === undefined ||
      (observation.documentInstanceId === pending.committedDocumentInstanceId && observation.documentRevision === pending.committedDocumentRevision));
  return { state: cancelWritingEnableAttempt(state), enableWriting: exactProof };
}

/** Fallback text can only be resolved by an explicit Source edit or initialize. */
export function modeAfterRequest(mode: AppMode, hasFallback: boolean): AppMode {
  return hasFallback && mode !== "source" ? "source" : mode;
}
