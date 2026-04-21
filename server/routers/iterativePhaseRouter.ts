// server/routers/iterativePhaseRouter.ts — Iterative-review procedures (v2.3 + v2.4.2 scope extension)
// Per v2.3 §5, v2.4.2 §7.2, and v1.4.2 §B.3.4.
//
// v2.4.2 changes:
//   - All procedures gain an optional `scope` discriminated union (§7.2).
//   - scope.kind === 'phase' (or scope omitted): v2.3 behavior unchanged.
//   - scope.kind === 'document': procedure operates on the document row.
//   - Routing-flag enforcement: document-scoped calls on model-2 matters are rejected.
//   - setWaitingOnClient / clientResponded: extended for model-3 document matters.
//   - referencedSiblingDocumentIds added to requestFeedback, submitEvaluationDecisions,
//     submitManualDecisions (§7.2).
//
// R9 invariant: no duplicated procedures. The existing phase-scoped procedures are
// extended in-place, not cloned. Per v2.4.2 §7.4.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';
import {
  getPhase, getMatterByMatterId,
  getDocumentById, updateDocumentTitle, updateDocumentNotes, archiveDocument,
  setDocumentOfficialFinalVersion,
  updatePhaseWorkflowState, updatePhaseFields, setPhaseStatus,
  createVersion, getVersionsByPhase, getVersionByNumber, getLatestVersionNumber,
  createFeedbackBatch, getFeedbackByPhase, updateFeedbackDecision,
  collectPriorPhaseOutputs, getUploadsByPhase,
  updateDocumentWorkflowStateConditional,
  updatePhaseWorkflowStateConditional,
} from '../db';
import {
  PHASE_CONFIG, PROVIDERS, ENABLED_PROVIDERS, canStartPhase,
  type PhaseName, type WorkflowMode, type ProviderKey,
} from '../../shared/workflow';
import { mutationScopeSchema, DOCUMENT_HOLDING_PHASES } from '../../shared/schemas/scope';
import { emitTelemetry } from '../../shared/telemetry';
import type { Document } from '../../drizzle/schema';

// ── Scope resolution helpers ──────────────────────────────────────────

/**
 * Resolve scope to a concrete { matterId, phaseName } pair.
 * For document scope, loads the document and returns its matterId/phaseName.
 * Enforces routing-flag: document scope on a model-2 matter → PRECONDITION_FAILED.
 */
async function resolveScope(
  scope: z.infer<typeof mutationScopeSchema> | undefined,
  fallbackMatterId: string,
  fallbackPhaseName: string,
): Promise<{
  matterId: string;
  phaseName: string;
  documentId: number | null;
  doc: Document | null;
  workflowModelVersion: number;
}> {
  if (!scope || scope.kind === 'phase') {
    const matter = await getMatterByMatterId(scope?.matterId ?? fallbackMatterId);
    if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
    return {
      matterId: matter.matterId,
      phaseName: scope?.phaseName ?? fallbackPhaseName,
      documentId: null,
      doc: null,
      workflowModelVersion: matter.workflowModelVersion ?? 2,
    };
  }

  // scope.kind === 'document'
  const doc = await getDocumentById(scope.documentId);
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${scope.documentId} not found` });

  const matter = await getMatterByMatterId(doc.matterId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

  // Routing-flag enforcement: document scope is only valid on model-3 matters.
  if ((matter.workflowModelVersion ?? 2) !== 3) {
    emitTelemetry({
      kind: 'legacy_mode_used',
      matterId: matter.matterId,
      phaseName: doc.phaseName,
      procedure: 'resolveScope',
      workflowModelVersion: matter.workflowModelVersion ?? 2,
    });
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Document-scoped operations require workflowModelVersion = 3. This matter is model ${matter.workflowModelVersion ?? 2}.`,
    });
  }

  return {
    matterId: doc.matterId,
    phaseName: doc.phaseName,
    documentId: doc.id,
    doc,
    workflowModelVersion: 3,
  };
}

/**
 * Read the current workflow state for the resolved scope.
 * For phase scope: reads phases.workflowState.
 * For document scope: reads documents.workflowState.
 */
async function readWorkflowState(
  matterId: string,
  phaseName: string,
  documentId: number | null,
  doc: Document | null,
): Promise<string> {
  if (documentId !== null && doc !== null) {
    // Re-read from DB to get fresh state.
    const freshDoc = await getDocumentById(documentId);
    return freshDoc?.workflowState ?? 'idle';
  }
  const phase = await getPhase(matterId, phaseName);
  return phase?.workflowState ?? 'idle';
}

/**
 * Write a workflow state transition.
 * For phase scope: calls updatePhaseWorkflowState (v2.3 path).
 * For document scope: calls updateDocumentWorkflowStateConditional.
 */
async function writeWorkflowState(
  matterId: string,
  phaseName: string,
  documentId: number | null,
  fromState: string,
  toState: string,
  procedure: string,
  workflowData?: Record<string, unknown>,
): Promise<void> {
  if (documentId !== null) {
    await updateDocumentWorkflowStateConditional(
      null,
      documentId,
      fromState as any,
      toState as any,
      { matterId, phaseName, procedure },
    );
  } else {
    await updatePhaseWorkflowState(matterId, phaseName, toState, workflowData);
  }
}

// ── Scope schema (optional) ───────────────────────────────────────────
const optionalScopeSchema = mutationScopeSchema.optional();

// ── iterativePhaseRouter ──────────────────────────────────────────────
export const iterativePhaseRouter = router({

  // ── setWaitingOnClient ────────────────────────────────────────────
  // v2.3: phase must be completed + document_generation stage.
  // v2.4.2 extension: scope.kind === 'document' → document must be complete.
  setWaitingOnClient: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      scope: optionalScopeSchema,
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);

      if (resolved.documentId !== null && resolved.doc !== null) {
        // Model-3 document path
        const doc = resolved.doc;
        if (doc.status !== 'complete') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Document must be complete before marking as waiting on client',
          });
        }
        // For document scope, "waiting on client" is a phase-level status update.
        await setPhaseStatus(resolved.matterId, resolved.phaseName, 'waiting_on_client');
        emitTelemetry({
          kind: 'state_transition',
          matterId: resolved.matterId,
          phaseName: resolved.phaseName,
          from: 'complete',
          to: 'waiting_on_client',
          procedure: 'setWaitingOnClient',
          targetKind: 'document',
          documentId: resolved.documentId,
        });
        return { success: true };
      }

      // Model-2 / phase path (v2.3 behavior preserved)
      const phase = await getPhase(resolved.matterId, resolved.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      const phaseName = resolved.phaseName as PhaseName;
      const config = PHASE_CONFIG[phaseName];
      if (config.stage !== 'document_generation') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Waiting on client is only available for document generation phases' });
      }
      if (phase.status !== 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phase must be complete before marking as waiting on client' });
      }
      if (config.hasFormattingPass && phase.workflowState !== 'complete') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Formatting must be approved before marking as waiting on client' });
      }
      await setPhaseStatus(resolved.matterId, resolved.phaseName, 'waiting_on_client');
      return { success: true };
    }),

  // ── clientResponded ───────────────────────────────────────────────
  // v2.3: phase must be waiting_on_client.
  // v2.4.2 extension: scope.kind === 'document' → same phase-level status check.
  clientResponded: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      scope: optionalScopeSchema,
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);

      if (resolved.documentId !== null) {
        // Model-3 document path: phase-level status check
        const phase = await getPhase(resolved.matterId, resolved.phaseName);
        if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
        if (phase.status !== 'waiting_on_client') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phase is not waiting on client' });
        }
        await setPhaseStatus(resolved.matterId, resolved.phaseName, 'completed');
        emitTelemetry({
          kind: 'state_transition',
          matterId: resolved.matterId,
          phaseName: resolved.phaseName,
          from: 'waiting_on_client',
          to: 'completed',
          procedure: 'clientResponded',
          targetKind: 'document',
          documentId: resolved.documentId,
        });
        return { success: true };
      }

      // Model-2 / phase path (v2.3 behavior preserved)
      const phase = await getPhase(resolved.matterId, resolved.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      if (phase.status !== 'waiting_on_client') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phase is not waiting on client' });
      }
      await setPhaseStatus(resolved.matterId, resolved.phaseName, 'completed');
      return { success: true };
    }),

  // ── requestFeedback (v2.3 requestRevision + iterative review combined) ──
  // Extended with scope and referencedSiblingDocumentIds.
  requestFeedback: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      feedback: z.string().min(1),
      scope: optionalScopeSchema,
      referencedSiblingDocumentIds: z.array(z.number().int().positive()).default([]),
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);
      const currentState = await readWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc,
      );

      if (currentState !== 'awaiting_attorney_review') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Expected awaiting_attorney_review, got: ${currentState}`,
        });
      }

      await writeWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId,
        'awaiting_attorney_review', 'revising', 'requestFeedback',
      );

      // Sibling references are passed to context builder (not persisted).
      // For now, record in telemetry that they were provided.
      if (resolved.documentId && input.referencedSiblingDocumentIds.length > 0) {
        for (const sibId of input.referencedSiblingDocumentIds) {
          emitTelemetry({
            kind: 'sibling_reference_included',
            matterId: resolved.matterId,
            documentId: resolved.documentId,
            siblingDocumentId: sibId,
            siblingDocumentType: 'unknown', // resolved at context-build time
          });
        }
      }

      return {
        success: true,
        workflowState: 'revising' as const,
        siblingsSkipped: [] as Array<{ documentId: number; reason: 'not_yet_accepted' }>,
      };
    }),

  // ── submitEvaluationDecisions (v2.3 submitDecisions evaluator path) ──
  submitEvaluationDecisions: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      acceptCurrent: z.boolean().optional(),
      decisions: z.array(z.object({
        feedbackId: z.number(),
        decision: z.enum(['accepted', 'rejected', 'modified']),
        attorneyNote: z.string().optional(),
      })).optional(),
      scope: optionalScopeSchema,
      referencedSiblingDocumentIds: z.array(z.number().int().positive()).default([]),
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);
      const currentState = await readWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc,
      );

      if (currentState !== 'awaiting_decisions') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Expected awaiting_decisions, got: ${currentState}`,
        });
      }

      if (input.decisions) {
        for (const d of input.decisions) {
          await updateFeedbackDecision(d.feedbackId, d.decision, d.attorneyNote);
        }
      }

      const nextState = input.acceptCurrent ? 'complete' : 'regenerating';
      await writeWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId,
        'awaiting_decisions', nextState, 'submitEvaluationDecisions',
      );

      if (input.acceptCurrent && resolved.documentId) {
        const latestVersionNum = await getLatestVersionNumber(resolved.matterId, resolved.phaseName);
        await setDocumentOfficialFinalVersion(resolved.documentId, latestVersionNum);
      }

      return { success: true, nextState };
    }),

  // ── submitManualDecisions (v2.3 manual path) ──────────────────────
  submitManualDecisions: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      decisions: z.array(z.object({
        feedbackId: z.number(),
        decision: z.enum(['accepted', 'rejected', 'modified']),
        attorneyNote: z.string().optional(),
      })),
      scope: optionalScopeSchema,
      referencedSiblingDocumentIds: z.array(z.number().int().positive()).default([]),
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);

      for (const d of input.decisions) {
        await updateFeedbackDecision(d.feedbackId, d.decision, d.attorneyNote);
      }

      const currentState = await readWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc,
      );

      await writeWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId,
        currentState, 'regenerating', 'submitManualDecisions',
      );

      return { success: true, nextState: 'regenerating' as const };
    }),

  // ── acceptIterativeVersion ────────────────────────────────────────
  acceptIterativeVersion: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      versionNumber: z.number().int().positive(),
      scope: optionalScopeSchema,
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);
      const currentState = await readWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc,
      );

      if (currentState !== 'awaiting_attorney_review') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Expected awaiting_attorney_review, got: ${currentState}`,
        });
      }

      if (resolved.documentId) {
        // Document path: set officialFinalVersionNumber and transition to complete.
        await setDocumentOfficialFinalVersion(resolved.documentId, input.versionNumber);
        await writeWorkflowState(
          resolved.matterId, resolved.phaseName, resolved.documentId,
          'awaiting_attorney_review', 'complete', 'acceptIterativeVersion',
        );
      } else {
        // Phase path (v2.3)
        await updatePhaseFields(resolved.matterId, resolved.phaseName, {
          officialFinalVersion: input.versionNumber,
        });
        await updatePhaseWorkflowState(resolved.matterId, resolved.phaseName, 'complete');
      }

      return { success: true, workflowState: 'complete' as const, officialFinalVersionNumber: input.versionNumber };
    }),

  // ── rejectFormatting ─────────────────────────────────────────────
  rejectFormatting: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      notes: z.string().optional(),
      scope: optionalScopeSchema,
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);
      const currentState = await readWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc,
      );

      if (currentState !== 'awaiting_format_review') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Expected awaiting_format_review, got: ${currentState}`,
        });
      }

      await writeWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId,
        'awaiting_format_review', 'formatting', 'rejectFormatting',
      );

      return { success: true, workflowState: 'formatting' as const };
    }),

  // ── acceptSubstantiveUnformatted ──────────────────────────────────
  acceptSubstantiveUnformatted: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      versionNumber: z.number().int().positive(),
      scope: optionalScopeSchema,
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);

      if (resolved.documentId) {
        await setDocumentOfficialFinalVersion(resolved.documentId, input.versionNumber);
        await writeWorkflowState(
          resolved.matterId, resolved.phaseName, resolved.documentId,
          await readWorkflowState(resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc),
          'complete', 'acceptSubstantiveUnformatted',
        );
      } else {
        await updatePhaseFields(resolved.matterId, resolved.phaseName, {
          officialFinalVersion: input.versionNumber,
        });
        await updatePhaseWorkflowState(resolved.matterId, resolved.phaseName, 'complete');
      }

      return { success: true, workflowState: 'complete' as const };
    }),

  // ── restartWithDifferentModel ─────────────────────────────────────
  restartWithDifferentModel: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      scope: optionalScopeSchema,
    }))
    .mutation(async ({ input }) => {
      const resolved = await resolveScope(input.scope, input.matterId, input.phaseName);

      await writeWorkflowState(
        resolved.matterId, resolved.phaseName, resolved.documentId,
        await readWorkflowState(resolved.matterId, resolved.phaseName, resolved.documentId, resolved.doc),
        'model_selection', 'restartWithDifferentModel',
      );

      return { success: true, workflowState: 'model_selection' as const };
    }),
});

export type IterativePhaseRouter = typeof iterativePhaseRouter;
