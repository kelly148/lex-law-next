// server/canonicalMutation.ts — Canonical mutation helper (v2.3 + v2.4.2 generalization)
// Per v2.3 §15.1 and v1.4.2 §B.3.2.
//
// There is ONE runCanonicalMutation. It dispatches internally on target.kind.
// Do NOT create parallel helpers like documentCanonicalMutation. Per R4 and R9.
//
// v2.4.2 change: phaseId field replaced with target: MutationTarget.
// target.kind === 'phase' → updatePhaseWorkflowStateConditional
// target.kind === 'document' → updateDocumentWorkflowStateConditional

import { TRPCError } from '@trpc/server';
import { emitTelemetry } from '../shared/telemetry';
import {
  updatePhaseWorkflowStateConditional,
  updateDocumentWorkflowStateConditional,
  getPhase,
  getDocumentById,
} from './db';
import type { WorkflowState } from '../shared/workflow';

// ── MutationTarget ────────────────────────────────────────────────────
// Internal discriminated union. Not exported — callers use the scope schema.
export type MutationTarget =
  | { kind: 'phase'; phaseId: number; matterId: string; phaseName: string }
  | { kind: 'document'; documentId: number; matterId: string; phaseName: string };

// ── CanonicalMutationInput ────────────────────────────────────────────
export interface CanonicalMutationInput<TResult> {
  target: MutationTarget;
  procedure: string;
  /** State the entity must be in before the mutation begins. */
  expectedState: WorkflowState;
  /** Transient in-flight state set during the LLM call (Transaction A). */
  inFlightState: WorkflowState;
  /** Final state to set on success (Transaction B). */
  successState: WorkflowState;
  /** Optional workflowData to persist alongside the state (phase-scoped only; ignored for documents). */
  workflowData?: Record<string, unknown>;
  /** The async LLM work to perform between Transaction A and Transaction B. */
  work: () => Promise<TResult>;
  /** Optional callback after successful state transition to successState. */
  onSuccess?: (result: TResult) => Promise<void>;
}

/**
 * Run a canonical two-transaction mutation on either a phase or a document.
 *
 * Transaction A: assert expectedState → set inFlightState (optimistic lock).
 * Work:          call the async LLM function.
 * Transaction B: set successState on success, or revert to expectedState on failure.
 *
 * Telemetry events emitted: state_transition (×2), llm_call_start, llm_call_complete,
 * llm_call_failure, concurrency_conflict.
 *
 * Per R4 and R9: there is exactly one canonical mutation helper. It dispatches
 * internally on target.kind. Do not create parallel helpers.
 */
export async function runCanonicalMutation<TResult>(
  input: CanonicalMutationInput<TResult>,
): Promise<TResult> {
  const { target, procedure, expectedState, inFlightState, successState, workflowData, work, onSuccess } = input;

  // ── Transaction A: set in-flight state ─────────────────────────────
  await setTargetState(target, expectedState, inFlightState, procedure, workflowData);

  emitTelemetry({
    kind: 'state_transition',
    matterId: target.matterId,
    phaseName: target.phaseName,
    from: expectedState,
    to: inFlightState,
    procedure,
    targetKind: target.kind,
    phaseId: target.kind === 'phase' ? target.phaseId : null,
    documentId: target.kind === 'document' ? target.documentId : null,
  });

  emitTelemetry({
    kind: 'llm_call_start',
    matterId: target.matterId,
    phaseName: target.phaseName,
    procedure,
    targetKind: target.kind,
    phaseId: target.kind === 'phase' ? target.phaseId : null,
    documentId: target.kind === 'document' ? target.documentId : null,
  });

  const callStart = Date.now();

  // ── Work: LLM call ─────────────────────────────────────────────────
  let result: TResult;
  try {
    result = await work();
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    emitTelemetry({
      kind: 'llm_call_failure',
      matterId: target.matterId,
      phaseName: target.phaseName,
      procedure,
      error: errorMessage,
      targetKind: target.kind,
      phaseId: target.kind === 'phase' ? target.phaseId : null,
      documentId: target.kind === 'document' ? target.documentId : null,
    });

    // Revert to expectedState on failure.
    try {
      await setTargetState(target, inFlightState, expectedState, procedure);
    } catch {
      // Best-effort revert — do not mask the original error.
    }

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: errorMessage,
    });
  }

  emitTelemetry({
    kind: 'llm_call_complete',
    matterId: target.matterId,
    phaseName: target.phaseName,
    procedure,
    durationMs: Date.now() - callStart,
    targetKind: target.kind,
    phaseId: target.kind === 'phase' ? target.phaseId : null,
    documentId: target.kind === 'document' ? target.documentId : null,
  });

  // ── Transaction B: set success state ───────────────────────────────
  await setTargetState(target, inFlightState, successState, procedure, workflowData);

  emitTelemetry({
    kind: 'state_transition',
    matterId: target.matterId,
    phaseName: target.phaseName,
    from: inFlightState,
    to: successState,
    procedure,
    targetKind: target.kind,
    phaseId: target.kind === 'phase' ? target.phaseId : null,
    documentId: target.kind === 'document' ? target.documentId : null,
  });

  if (onSuccess) {
    await onSuccess(result);
  }

  return result;
}

// ── Internal dispatch ─────────────────────────────────────────────────
async function setTargetState(
  target: MutationTarget,
  expectedState: WorkflowState,
  nextState: WorkflowState,
  procedure: string,
  workflowData?: Record<string, unknown>,
): Promise<void> {
  if (target.kind === 'phase') {
    await updatePhaseWorkflowStateConditional(
      null,
      target.phaseId,
      expectedState,
      nextState,
      { matterId: target.matterId, phaseName: target.phaseName, procedure, workflowData },
    );
  } else {
    await updateDocumentWorkflowStateConditional(
      null,
      target.documentId,
      expectedState,
      nextState,
      { matterId: target.matterId, phaseName: target.phaseName, procedure },
    );
  }
}

/**
 * Resolve a MutationTarget from a scope discriminator.
 * Loads the phase row (for phase scope) or document row (for document scope)
 * and returns a fully-populated MutationTarget.
 *
 * Throws NOT_FOUND if the entity does not exist.
 */
export async function resolveMutationTarget(
  scope: { kind: 'phase'; matterId: string; phaseName: string } | { kind: 'document'; documentId: number },
  fallbackMatterId?: string,
  fallbackPhaseName?: string,
): Promise<MutationTarget> {
  if (scope.kind === 'phase') {
    const phase = await getPhase(scope.matterId, scope.phaseName);
    if (!phase) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Phase '${scope.phaseName}' not found for matter '${scope.matterId}'` });
    }
    return {
      kind: 'phase',
      phaseId: phase.id,
      matterId: scope.matterId,
      phaseName: scope.phaseName,
    };
  } else {
    const doc = await getDocumentById(scope.documentId);
    if (!doc) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${scope.documentId} not found` });
    }
    return {
      kind: 'document',
      documentId: doc.id,
      matterId: doc.matterId,
      phaseName: doc.phaseName,
    };
  }
}
