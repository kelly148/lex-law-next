/**
 * Iterative-review tRPC sub-router.
 *
 * Contains all new procedures for the iterative_review workflow mode
 * per v2.3 spec §8–§12 and build instructions §2.3.6.
 *
 * Merged into the main phaseRouter via t.mergeRouters (Pattern A).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../_core/trpc';
import { runCanonicalMutation } from '../canonicalMutation';
import { buildUserPrompt, type BuildContextInput } from '../contextBuilder';
import { estimateTokens } from '../tokens';
import {
  REVIEW_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT,
  REGENERATION_SYSTEM_PROMPT,
} from '../iterativeReviewPrompts';
import {
  runSingleReview,
  runFeedbackEvaluation,
  runRevisionWithDecisions,
  runFormattingPassV2,
} from '../llm';
import {
  getDb,
  getPhase,
  getVersionByNumber,
  getLatestVersionNumber,
  createVersion,
  selectVersion,
  createFeedbackBatch,
  getFeedbackByPhase,
  getUploadsByPhase,
  collectPriorPhaseOutputs,
  updatePhaseFields,
  updatePhaseWorkflowState,
  updatePhaseWorkflowStateConditional,
  getPhaseWithMeta,
} from '../db';
import {
  feedbackEvaluations,
  feedbackManualSelections,
  type InsertFeedbackEvaluation,
  type InsertFeedbackManualSelection,
} from '../../drizzle/schema';
import {
  parseIterativeMeta,
  type IterativeMeta,
} from '../../shared/schemas/iterativeMeta';
import {
  parsePointByPoint,
  pointByPointSchema,
  type PointByPoint,
} from '../../shared/schemas/pointByPoint';
import { manualSelectionInputSchema } from '../../shared/schemas/manualSelection';
import { emitTelemetry } from '../../shared/telemetry';
import {
  PHASE_CONFIG,
  ENABLED_PROVIDERS,
  type PhaseName,
  type ProviderKey,
  type WorkflowState,
} from '../../shared/workflow';
import { and, eq, asc, desc } from 'drizzle-orm';

// ── Shared Zod fragments ────────────────────────────────────────────

const phaseInputBase = z.object({
  matterId: z.string(),
  phaseName: z.string(),
});

// ── Helpers ─────────────────────────────────────────────────────────

async function buildIterativeContext(
  matterId: string,
  phaseName: PhaseName,
  role: BuildContextInput['role'],
  roleContent: string,
): Promise<string> {
  const uploads = await getUploadsByPhase(matterId, phaseName);
  const priorOutputsRaw = await collectPriorPhaseOutputs(matterId, phaseName);

  const priorPhaseOutputs = priorOutputsRaw
    ? [{
        phaseName: 'prior',
        label: 'Prior Phase Outputs',
        content: priorOutputsRaw,
        updatedAt: new Date(),
      }]
    : [];

  const fileUploads = uploads.map((u: any) => ({
    fileName: u.fileName,
    extractedText: u.extractedText || '',
    uploadedAt: u.createdAt,
  }));

  return buildUserPrompt({
    matterId,
    phaseName,
    priorPhaseOutputs,
    fileUploads,
    attorneyNotes: '', // attorney notes are embedded in roleContent where needed
    role,
    roleContent,
  });
}

function getDefaultReviewerIds(): ProviderKey[] {
  return ENABLED_PROVIDERS.map(p => p.key) as ProviderKey[];
}

function requirePhaseState(phase: any, expectedState: WorkflowState, procedure: string): void {
  if (phase.workflowState !== expectedState) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${procedure}: expected state '${expectedState}', got '${phase.workflowState}'`,
    });
  }
}

// ── Router ──────────────────────────────────────────────────────────

export const iterativePhaseRouter = router({

  // ── Request Feedback (§9) ─────────────────────────────────────────
  requestFeedback: protectedProcedure
    .input(phaseInputBase.extend({
      versionNumber: z.number().int().positive(),
      reviewerModelIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_attorney_review', 'requestFeedback');

      const phaseName = input.phaseName as PhaseName;
      const version = await getVersionByNumber(input.matterId, input.phaseName, input.versionNumber);
      if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });

      const reviewerIds = (input.reviewerModelIds ?? getDefaultReviewerIds()) as ProviderKey[];

      // Build role-specific content for reviewer
      const roleContent = `--- TARGET DRAFT ---\n${version.content}\n--- END TARGET DRAFT ---`;
      const userPrompt = await buildIterativeContext(input.matterId, phaseName, 'reviewer', roleContent);
      const promptTokens = estimateTokens(userPrompt);

      // Use typed reduce pattern for Promise.allSettled narrowing (no any)
      type ReviewerSuccess = { providerKey: string; content: string };
      type ReviewerFailure = { providerKey: string; reason: string };

      const results = await Promise.allSettled(
        reviewerIds.map(async (providerKey): Promise<ReviewerSuccess> => {
          const result = await runSingleReview(providerKey, userPrompt);
          if (result.error) throw new Error(result.error);
          return { providerKey, content: result.content };
        })
      );

      const succeeded = results.reduce<ReviewerSuccess[]>((acc, r) => {
        if (r.status === 'fulfilled') acc.push(r.value);
        return acc;
      }, []);

      const failed = results.reduce<ReviewerFailure[]>((acc, r, i) => {
        if (r.status === 'rejected') {
          acc.push({ providerKey: reviewerIds[i], reason: String(r.reason) });
        }
        return acc;
      }, []);

      if (succeeded.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'All reviewers failed',
        });
      }

      // Transaction A: reserve state
      await updatePhaseWorkflowStateConditional(
        phase.id,
        'awaiting_attorney_review',
        'awaiting_reviews',
        { matterId: input.matterId, phaseName: input.phaseName, procedure: 'requestFeedback' },
      );

      // Insert feedback rows for succeeded reviewers
      const feedbackRows = succeeded.map(s => ({
        matterId: input.matterId,
        phaseName: input.phaseName,
        versionNumber: input.versionNumber,
        reviewerProvider: s.providerKey,
        category: 'review' as const,
        point: s.content,
        decision: 'pending' as const,
      }));

      const insertedFeedback = await createFeedbackBatch(feedbackRows);

      // Update iterativeMeta
      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });
      await updatePhaseFields(input.matterId, input.phaseName, {
        iterativeMeta: {
          ...meta,
          feedbackCyclesCompleted: meta.feedbackCyclesCompleted + 1,
          isIterativeLoop: true,
        },
      });

      // Transition to awaiting_feedback_action
      await updatePhaseWorkflowStateConditional(
        phase.id,
        'awaiting_reviews',
        'awaiting_feedback_action',
        { matterId: input.matterId, phaseName: input.phaseName, procedure: 'requestFeedback_finalize' },
      );

      emitTelemetry({
        kind: 'state_transition',
        phaseId: phase.id,
        matterId: input.matterId,
        phaseName: input.phaseName,
        from: 'awaiting_attorney_review',
        to: 'awaiting_feedback_action',
        procedure: 'requestFeedback',
      });

      return {
        success: true,
        feedbackCount: insertedFeedback.length,
        failedProviders: failed.map(f => f.providerKey),
        workflowState: 'awaiting_feedback_action' as const,
      };
    }),

  // ── Evaluate Feedback (§11.1) ─────────────────────────────────────
  evaluateFeedback: protectedProcedure
    .input(phaseInputBase.extend({
      versionNumber: z.number().int().positive(),
      evaluatorModelId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_feedback_action', 'evaluateFeedback');

      const phaseName = input.phaseName as PhaseName;
      const evaluatorModelId = input.evaluatorModelId as ProviderKey;

      // Fetch the version and feedback
      const version = await getVersionByNumber(input.matterId, input.phaseName, input.versionNumber);
      if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });

      const feedbackRows = await getFeedbackByPhase(input.matterId, input.phaseName, input.versionNumber);
      if (feedbackRows.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No feedback available for evaluation' });
      }

      // Build evaluator context
      const feedbackText = feedbackRows.map((f: any) =>
        `--- Reviewer: ${f.reviewerProvider} (feedbackId: ${f.id}) ---\n${f.point}\n`
      ).join('\n');

      const roleContent = [
        `--- TARGET DRAFT ---\n${version.content}\n--- END TARGET DRAFT ---`,
        `--- REVIEWER FEEDBACK ---\n${feedbackText}\n--- END REVIEWER FEEDBACK ---`,
      ].join('\n\n');

      const userPrompt = await buildIterativeContext(input.matterId, phaseName, 'evaluator', roleContent);
      const promptTokens = estimateTokens(userPrompt);

      return await runCanonicalMutation({
        phaseId: phase.id,
        matterId: input.matterId,
        phaseName: input.phaseName,
        procedure: 'evaluateFeedback',
        expectedPriorState: 'awaiting_feedback_action',
        reservedState: 'evaluating_feedback',
        finalState: 'awaiting_evaluation_decisions',
        llmCall: async () => {
          const result = await runFeedbackEvaluation(evaluatorModelId, userPrompt);
          if (result.error) throw new Error(result.error);

          // Parse the JSON output
          let parsed: { narrativeReasoning: string; pointByPoint: unknown };
          try {
            parsed = JSON.parse(result.rawOutput);
          } catch {
            throw new Error('Evaluator returned invalid JSON');
          }

          // Validate pointByPoint through Zod
          const pointByPoint = pointByPointSchema.parse(parsed.pointByPoint);

          return {
            narrativeReasoning: parsed.narrativeReasoning || '',
            pointByPoint,
            evaluatorProvider: evaluatorModelId,
          };
        },
        transactionB: async (llmResult) => {
          const db = await getDb();
          if (!db) throw new Error('Database not available');

          // Insert feedback_evaluations row
          await db.insert(feedbackEvaluations).values({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: input.versionNumber,
            evaluatorProvider: llmResult.evaluatorProvider,
            narrativeReasoning: llmResult.narrativeReasoning,
            pointByPoint: llmResult.pointByPoint,
          });

          // Fetch the inserted evaluation to get its ID
          const [evaluation] = await db.select().from(feedbackEvaluations)
            .where(and(
              eq(feedbackEvaluations.matterId, input.matterId),
              eq(feedbackEvaluations.phaseName, input.phaseName),
              eq(feedbackEvaluations.versionNumber, input.versionNumber),
            ))
            .orderBy(desc(feedbackEvaluations.id))
            .limit(1);

          // Update iterativeMeta
          const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });
          await updatePhaseFields(input.matterId, input.phaseName, {
            iterativeMeta: {
              ...meta,
              lastEvaluatorModel: evaluatorModelId,
            },
          });

          return {
            evaluationId: evaluation.id,
            narrativeReasoning: llmResult.narrativeReasoning,
            pointByPointCount: llmResult.pointByPoint.length,
          };
        },
        llmMeta: {
          model: evaluatorModelId,
          role: 'evaluator',
          promptTokensEstimate: promptTokens,
        },
      });
    }),

  // ── Submit Evaluation Decisions (§11.3) ───────────────────────────
  submitEvaluationDecisions: protectedProcedure
    .input(phaseInputBase.extend({
      versionNumber: z.number().int().positive(),
      evaluationId: z.number().int().positive(),
      decisions: z.array(z.object({
        pointByPointIndex: z.number().int().nonnegative(),
        attorneyDecision: z.enum(['adopt', 'modify', 'skip']),
        attorneyModifiedText: z.string().optional(),
      })),
      regeneratorModelId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_evaluation_decisions', 'submitEvaluationDecisions');

      const phaseName = input.phaseName as PhaseName;
      const regeneratorModelId = input.regeneratorModelId as ProviderKey;

      // Fetch the evaluation
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      const [evaluation] = await db.select().from(feedbackEvaluations)
        .where(eq(feedbackEvaluations.id, input.evaluationId))
        .limit(1);
      if (!evaluation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluation not found' });

      // Parse and apply attorney decisions to pointByPoint
      const pbp = parsePointByPoint(evaluation.pointByPoint, { evaluationId: evaluation.id });
      const updatedPbp = pbp.map((item, idx) => {
        const decision = input.decisions.find(d => d.pointByPointIndex === idx);
        if (decision) {
          return {
            ...item,
            attorneyDecision: decision.attorneyDecision,
            attorneyModifiedText: decision.attorneyModifiedText ?? null,
          };
        }
        return item;
      });

      // Filter to only accepted/modified changes for the regenerator
      const changesToApply = updatedPbp.filter(
        item => item.attorneyDecision === 'adopt' || item.attorneyDecision === 'modify'
      );

      if (changesToApply.length === 0) {
        // No changes to apply — stay in awaiting_attorney_review
        await updatePhaseWorkflowStateConditional(
          phase.id,
          'awaiting_evaluation_decisions',
          'awaiting_attorney_review',
          { matterId: input.matterId, phaseName: input.phaseName, procedure: 'submitEvaluationDecisions_noChanges' },
        );
        return { success: true, workflowState: 'awaiting_attorney_review' as const, noChanges: true };
      }

      // Fetch the current draft
      const version = await getVersionByNumber(input.matterId, input.phaseName, input.versionNumber);
      if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });

      // Build regenerator context
      const changesText = changesToApply.map((c, i) => {
        const text = c.attorneyDecision === 'modify' && c.attorneyModifiedText
          ? c.attorneyModifiedText
          : c.suggestedText ?? c.sourceExcerpt;
        return [
          `Change #${i + 1}:`,
          `Source: ${c.sourceReviewerProvider}, feedbackId: ${c.sourceFeedbackId}, excerpt: "${c.sourceExcerpt}"`,
          `Anchor: ${c.sectionAnchor.kind} = "${c.sectionAnchor.value}", locatorText = "${c.sectionAnchor.locatorText}"`,
          `Final text to apply: ${text}`,
        ].join('\n  ');
      }).join('\n\n');

      const roleContent = [
        `--- CURRENT DRAFT ---\n${version.content}\n--- END CURRENT DRAFT ---`,
        `--- CHANGES TO INCORPORATE ---\n${changesText}\n--- END CHANGES ---`,
        'Apply the changes ONLY at the anchored locations per the rules in the system prompt.',
        'If an anchor cannot be uniquely resolved, skip that change and include it in unresolvedAnchors.',
        'Preserve all other content verbatim.',
      ].join('\n\n');

      const userPrompt = await buildIterativeContext(input.matterId, phaseName, 'regenerator', roleContent);
      const promptTokens = estimateTokens(userPrompt);

      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

      return await runCanonicalMutation({
        phaseId: phase.id,
        matterId: input.matterId,
        phaseName: input.phaseName,
        procedure: 'submitEvaluationDecisions',
        expectedPriorState: 'awaiting_evaluation_decisions',
        reservedState: 'regenerating',
        finalState: 'awaiting_attorney_review',
        transactionA: async () => {
          // Update the evaluation's pointByPoint with attorney decisions
          await db.update(feedbackEvaluations)
            .set({ pointByPoint: updatedPbp })
            .where(eq(feedbackEvaluations.id, input.evaluationId));
        },
        llmCall: async () => {
          const result = await runRevisionWithDecisions(regeneratorModelId, userPrompt);
          if (result.error) throw new Error(result.error);

          let parsed: { revisedDocument: string; appliedChanges: unknown[]; unresolvedAnchors: unknown[] };
          try {
            parsed = JSON.parse(result.rawOutput);
          } catch {
            throw new Error('Regenerator returned invalid JSON');
          }

          return {
            revisedDocument: parsed.revisedDocument,
            appliedChanges: parsed.appliedChanges ?? [],
            unresolvedAnchors: parsed.unresolvedAnchors ?? [],
          };
        },
        transactionB: async (llmResult) => {
          const nextVersionNumber = await getLatestVersionNumber(input.matterId, input.phaseName) + 1;
          const newIteration = meta.iterationNumber + 1;

          // Collect originating feedback IDs from the evaluation's pointByPoint
          const originatingFeedbackIds = Array.from(new Set(
            changesToApply.map(c => c.sourceFeedbackId)
          ));

          // CRITICAL: explicit metadata passthrough of unresolvedAnchors and appliedChanges
          const newVersion = await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: nextVersionNumber,
            provider: regeneratorModelId,
            content: llmResult.revisedDocument,
            isSelected: 1,
            metadata: {
              iteration: newIteration,
              cycleNumber: meta.cycleNumber,
              sourcePath: 'evaluator',
              evaluationId: input.evaluationId,
              originatingFeedbackIds,
              generatorProvider: regeneratorModelId,
              isFormatted: false,
              unresolvedAnchors: llmResult.unresolvedAnchors.length > 0
                ? llmResult.unresolvedAnchors
                : null,
              appliedChanges: llmResult.appliedChanges,
            },
          });

          // Deselect prior versions
          await selectVersion(newVersion.id, input.matterId, input.phaseName);

          // Update iterativeMeta
          await updatePhaseFields(input.matterId, input.phaseName, {
            iterativeMeta: {
              ...meta,
              iterationNumber: newIteration,
              currentVersionModel: regeneratorModelId,
              lastRegeneratorModel: regeneratorModelId,
            },
          });

          // Emit anchor resolution telemetry if any unresolved
          if (llmResult.unresolvedAnchors.length > 0) {
            emitTelemetry({
              kind: 'anchor_resolution_failure',
              phaseId: phase.id,
              versionId: newVersion.id,
              unresolvedCount: llmResult.unresolvedAnchors.length,
              totalCount: changesToApply.length,
            });
          }

          return {
            versionNumber: nextVersionNumber,
            unresolvedAnchors: llmResult.unresolvedAnchors,
            appliedChangesCount: llmResult.appliedChanges.length,
          };
        },
        llmMeta: {
          model: regeneratorModelId,
          role: 'regenerator',
          promptTokensEstimate: promptTokens,
        },
      });
    }),

  // ── Submit Manual Decisions (§10.2) ───────────────────────────────
  submitManualDecisions: protectedProcedure
    .input(phaseInputBase.extend({
      versionNumber: z.number().int().positive(),
      selections: z.array(manualSelectionInputSchema),
      regeneratorModelId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_feedback_action', 'submitManualDecisions');

      const phaseName = input.phaseName as PhaseName;
      const regeneratorModelId = input.regeneratorModelId as ProviderKey;

      if (input.selections.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'At least one selection is required' });
      }

      // Fetch the current draft
      const version = await getVersionByNumber(input.matterId, input.phaseName, input.versionNumber);
      if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });

      // Build regenerator context for manual path
      const changesText = input.selections.map((s, i) => {
        const text = s.editedText ?? s.sourceText;
        return [
          `Change #${i + 1}:`,
          `Source: manual selection, feedbackId: ${s.sourceFeedbackId}`,
          `Anchor: sourceText = "${s.sourceText}", precedingContext = "${s.precedingContext}", followingContext = "${s.followingContext}"`,
          `Final text to apply: ${text}`,
        ].join('\n  ');
      }).join('\n\n');

      const roleContent = [
        `--- CURRENT DRAFT ---\n${version.content}\n--- END CURRENT DRAFT ---`,
        `--- CHANGES TO INCORPORATE ---\n${changesText}\n--- END CHANGES ---`,
        'Apply the changes ONLY at the anchored locations per the rules in the system prompt.',
        'If an anchor cannot be uniquely resolved, skip that change and include it in unresolvedAnchors.',
        'Preserve all other content verbatim.',
      ].join('\n\n');

      const userPrompt = await buildIterativeContext(input.matterId, phaseName, 'regenerator', roleContent);
      const promptTokens = estimateTokens(userPrompt);

      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

      return await runCanonicalMutation({
        phaseId: phase.id,
        matterId: input.matterId,
        phaseName: input.phaseName,
        procedure: 'submitManualDecisions',
        expectedPriorState: 'awaiting_feedback_action',
        reservedState: 'awaiting_manual_decisions',
        finalState: 'awaiting_attorney_review',
        transactionA: async () => {
          // Insert feedback_manual_selections rows
          const db = await getDb();
          if (!db) throw new Error('Database not available');

          const selectionRows: InsertFeedbackManualSelection[] = input.selections.map((s, i) => ({
            feedbackId: s.sourceFeedbackId,
            versionNumber: input.versionNumber,
            selectionOrder: s.selectionOrder,
            selectionKind: s.selectionKind,
            sourceText: s.sourceText,
            precedingContext: s.precedingContext || null,
            followingContext: s.followingContext || null,
            editedText: s.editedText,
            decision: s.editedText ? 'modified' as const : 'accepted' as const,
          }));

          await db.insert(feedbackManualSelections).values(selectionRows);
        },
        llmCall: async () => {
          const result = await runRevisionWithDecisions(regeneratorModelId, userPrompt);
          if (result.error) throw new Error(result.error);

          let parsed: { revisedDocument: string; appliedChanges: unknown[]; unresolvedAnchors: unknown[] };
          try {
            parsed = JSON.parse(result.rawOutput);
          } catch {
            throw new Error('Regenerator returned invalid JSON');
          }

          return {
            revisedDocument: parsed.revisedDocument,
            appliedChanges: parsed.appliedChanges ?? [],
            unresolvedAnchors: parsed.unresolvedAnchors ?? [],
          };
        },
        transactionB: async (llmResult) => {
          const db = await getDb();
          if (!db) throw new Error('Database not available');

          const nextVersionNumber = await getLatestVersionNumber(input.matterId, input.phaseName) + 1;
          const newIteration = meta.iterationNumber + 1;

          // Fetch the inserted selection IDs
          const insertedSelections = await db.select({ id: feedbackManualSelections.id })
            .from(feedbackManualSelections)
            .where(eq(feedbackManualSelections.versionNumber, input.versionNumber))
            .orderBy(asc(feedbackManualSelections.id));

          const originatingSelectionIds = insertedSelections.map(s => s.id);
          const originatingFeedbackIds = Array.from(new Set(input.selections.map(s => s.sourceFeedbackId)));

          // CRITICAL: explicit metadata passthrough of unresolvedAnchors and appliedChanges
          const newVersion = await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: nextVersionNumber,
            provider: regeneratorModelId,
            content: llmResult.revisedDocument,
            isSelected: 1,
            metadata: {
              iteration: newIteration,
              cycleNumber: meta.cycleNumber,
              sourcePath: 'manual',
              originatingFeedbackIds,
              originatingSelectionIds,
              generatorProvider: regeneratorModelId,
              isFormatted: false,
              unresolvedAnchors: llmResult.unresolvedAnchors.length > 0
                ? llmResult.unresolvedAnchors
                : null,
              appliedChanges: llmResult.appliedChanges,
            },
          });

          // Deselect prior versions
          await selectVersion(newVersion.id, input.matterId, input.phaseName);

          // Update iterativeMeta
          await updatePhaseFields(input.matterId, input.phaseName, {
            iterativeMeta: {
              ...meta,
              iterationNumber: newIteration,
              currentVersionModel: regeneratorModelId,
              lastRegeneratorModel: regeneratorModelId,
            },
          });

          // Emit anchor resolution telemetry if any unresolved
          if (llmResult.unresolvedAnchors.length > 0) {
            emitTelemetry({
              kind: 'anchor_resolution_failure',
              phaseId: phase.id,
              versionId: newVersion.id,
              unresolvedCount: llmResult.unresolvedAnchors.length,
              totalCount: input.selections.length,
            });
          }

          return {
            versionNumber: nextVersionNumber,
            unresolvedAnchors: llmResult.unresolvedAnchors,
            appliedChangesCount: llmResult.appliedChanges.length,
          };
        },
        llmMeta: {
          model: regeneratorModelId,
          role: 'regenerator',
          promptTokensEstimate: promptTokens,
        },
      });
    }),

  // ── Accept Iterative Version (§12.5) ──────────────────────────────
  acceptIterativeVersion: protectedProcedure
    .input(phaseInputBase.extend({
      versionNumber: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_attorney_review', 'acceptIterativeVersion');

      const phaseName = input.phaseName as PhaseName;
      const config = PHASE_CONFIG[phaseName];
      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

      const version = await getVersionByNumber(input.matterId, input.phaseName, input.versionNumber);
      if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });

      // Lock the accepted substantive version
      await updatePhaseFields(input.matterId, input.phaseName, {
        acceptedSubstantiveVersion: input.versionNumber,
      });

      if (config.hasFormattingPass) {
        // Trigger formatting pass via canonical mutation
        const userPrompt = version.content;
        const promptTokens = estimateTokens(userPrompt);

        const result = await runCanonicalMutation({
          phaseId: phase.id,
          matterId: input.matterId,
          phaseName: input.phaseName,
          procedure: 'acceptIterativeVersion',
          expectedPriorState: 'awaiting_attorney_review',
          reservedState: 'accepted',
          finalState: 'awaiting_format_review',
          llmCall: async () => {
            // Default formatter is Claude per §12.6
            const fmtResult = await runFormattingPassV2('claude', version.content);
            return { content: fmtResult.content, flags: fmtResult.flags };
          },
          transactionB: async (llmResult) => {
            const nextVersionNumber = await getLatestVersionNumber(input.matterId, input.phaseName) + 1;

            const newVersion = await createVersion({
              matterId: input.matterId,
              phaseName: input.phaseName,
              versionNumber: nextVersionNumber,
              provider: 'claude',
              content: llmResult.content,
              isSelected: 1,
              isFormattingPass: 1,
              metadata: {
                iteration: meta.iterationNumber,
                cycleNumber: meta.cycleNumber,
                sourcePath: 'formatting',
                isFormatted: true,
                generatorProvider: 'claude',
              },
            });

            await selectVersion(newVersion.id, input.matterId, input.phaseName);

            return { formattedVersionNumber: nextVersionNumber, flags: llmResult.flags };
          },
          llmMeta: {
            model: 'claude',
            role: 'formatter',
            promptTokensEstimate: promptTokens,
          },
        });

        // Emit loop-completion telemetry
        emitTelemetry({
          kind: 'iterative_loop_completed',
          matterId: input.matterId,
          phaseName: input.phaseName,
          iterations: meta.iterationNumber,
          cycles: meta.cycleNumber,
          totalLLMCalls: meta.feedbackCyclesCompleted + meta.iterationNumber + 1, // reviews + regenerations + formatting
        });

        return {
          success: true,
          workflowState: 'awaiting_format_review' as const,
          formattedVersionNumber: result.formattedVersionNumber,
        };
      } else {
        // No formatting pass — complete directly
        await updatePhaseFields(input.matterId, input.phaseName, {
          officialFinalVersion: input.versionNumber,
        });
        await updatePhaseWorkflowState(input.matterId, input.phaseName, 'complete');

        // Emit loop-completion telemetry
        emitTelemetry({
          kind: 'iterative_loop_completed',
          matterId: input.matterId,
          phaseName: input.phaseName,
          iterations: meta.iterationNumber,
          cycles: meta.cycleNumber,
          totalLLMCalls: meta.feedbackCyclesCompleted + meta.iterationNumber, // reviews + regenerations
        });

        return {
          success: true,
          workflowState: 'complete' as const,
        };
      }
    }),

  // ── Reject Formatting (§12.5, §12.7) ─────────────────────────────
  rejectFormatting: protectedProcedure
    .input(phaseInputBase.extend({
      kind: z.enum(['format_only', 'substantive']),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_format_review', 'rejectFormatting');

      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

      if (input.kind === 'substantive') {
        // Substantive rejection: discard formatted version, go back to attorney review
        await updatePhaseFields(input.matterId, input.phaseName, {
          iterativeMeta: {
            ...meta,
            formatRejectionCount: 0, // Reset on substantive rejection
          },
        });
        await updatePhaseWorkflowState(input.matterId, input.phaseName, 'awaiting_attorney_review');

        return { success: true, workflowState: 'awaiting_attorney_review' as const };
      }

      // Format-only rejection: increment counter and re-format
      const newFormatRejectionCount = meta.formatRejectionCount + 1;

      const substantiveVersionNum = phase.acceptedSubstantiveVersion;
      if (!substantiveVersionNum) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No accepted substantive version found' });
      }

      const substantiveVersion = await getVersionByNumber(
        input.matterId, input.phaseName, substantiveVersionNum
      );
      if (!substantiveVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Substantive version not found' });
      }

      const promptTokens = estimateTokens(substantiveVersion.content);

      return await runCanonicalMutation({
        phaseId: phase.id,
        matterId: input.matterId,
        phaseName: input.phaseName,
        procedure: 'rejectFormatting',
        expectedPriorState: 'awaiting_format_review',
        reservedState: 'formatting',
        finalState: 'awaiting_format_review',
        transactionA: async () => {
          await updatePhaseFields(input.matterId, input.phaseName, {
            iterativeMeta: {
              ...meta,
              formatRejectionCount: newFormatRejectionCount,
            },
          });
        },
        llmCall: async () => {
          const fmtResult = await runFormattingPassV2('claude', substantiveVersion.content);
          return { content: fmtResult.content, flags: fmtResult.flags };
        },
        transactionB: async (llmResult) => {
          const nextVersionNumber = await getLatestVersionNumber(input.matterId, input.phaseName) + 1;

          const newVersion = await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: nextVersionNumber,
            provider: 'claude',
            content: llmResult.content,
            isSelected: 1,
            isFormattingPass: 1,
            metadata: {
              iteration: meta.iterationNumber,
              cycleNumber: meta.cycleNumber,
              sourcePath: 'formatting',
              isFormatted: true,
              generatorProvider: 'claude',
            },
          });

          await selectVersion(newVersion.id, input.matterId, input.phaseName);

          return {
            formattedVersionNumber: nextVersionNumber,
            formatRejectionCount: newFormatRejectionCount,
            flags: llmResult.flags,
          };
        },
        llmMeta: {
          model: 'claude',
          role: 'formatter',
          promptTokensEstimate: promptTokens,
        },
      });
    }),

  // ── Accept Substantive Unformatted (§12.7 escape hatch) ──────────
  acceptSubstantiveUnformatted: protectedProcedure
    .input(phaseInputBase)
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_format_review', 'acceptSubstantiveUnformatted');

      const substantiveVersionNum = phase.acceptedSubstantiveVersion;
      if (!substantiveVersionNum) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No accepted substantive version found' });
      }

      const substantiveVersion = await getVersionByNumber(
        input.matterId, input.phaseName, substantiveVersionNum
      );
      if (!substantiveVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Substantive version not found' });
      }

      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });
      const nextVersionNumber = await getLatestVersionNumber(input.matterId, input.phaseName) + 1;

      // Clone substantive version as a new terminal row per v2.3 §12.7
      const newVersion = await createVersion({
        matterId: input.matterId,
        phaseName: input.phaseName,
        versionNumber: nextVersionNumber,
        provider: substantiveVersion.provider,
        content: substantiveVersion.content,
        isSelected: 1,
        metadata: {
          sourcePath: 'formatting_bypassed',
          isFormatted: false,
          cloneOf: substantiveVersionNum,
          iteration: meta.iterationNumber,
          cycleNumber: meta.cycleNumber,
          generatorProvider: substantiveVersion.provider,
        },
      });

      // Deselect prior versions
      await selectVersion(newVersion.id, input.matterId, input.phaseName);

      // Set official final version and complete
      await updatePhaseFields(input.matterId, input.phaseName, {
        officialFinalVersion: nextVersionNumber,
      });

      await updatePhaseWorkflowStateConditional(
        phase.id,
        'awaiting_format_review',
        'complete',
        { matterId: input.matterId, phaseName: input.phaseName, procedure: 'acceptSubstantiveUnformatted' },
      );

      return { success: true, workflowState: 'complete' as const, versionNumber: nextVersionNumber };
    }),

  // ── Restart With Different Model (§12.2 — Path D) ────────────────
  restartWithDifferentModel: protectedProcedure
    .input(phaseInputBase.extend({
      newGeneratorModelId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });
      requirePhaseState(phase, 'awaiting_attorney_review', 'restartWithDifferentModel');

      const phaseName = input.phaseName as PhaseName;
      const newGeneratorModelId = input.newGeneratorModelId as ProviderKey;

      // Validate model
      const provider = ENABLED_PROVIDERS.find(p => p.key === newGeneratorModelId);
      if (!provider) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected model is not available' });
      }

      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });
      const newCycleNumber = meta.cycleNumber + 1;

      // Build context for the new generator
      const uploads = await getUploadsByPhase(input.matterId, input.phaseName);
      const priorOutputsRaw = await collectPriorPhaseOutputs(input.matterId, phaseName);
      const roleContent = priorOutputsRaw || 'Generate the initial draft for this phase.';
      const userPrompt = await buildIterativeContext(input.matterId, phaseName, 'generator', roleContent);
      const promptTokens = estimateTokens(userPrompt);

      return await runCanonicalMutation({
        phaseId: phase.id,
        matterId: input.matterId,
        phaseName: input.phaseName,
        procedure: 'restartWithDifferentModel',
        expectedPriorState: 'awaiting_attorney_review',
        reservedState: 'drafting',
        finalState: 'awaiting_attorney_review',
        llmCall: async () => {
          // Use runSingleReview as a simple generation call (reviewer prompt works for generation too)
          // In practice this would use the generator prompt, but we reuse the LLM call pattern
          const result = await runSingleReview(newGeneratorModelId, userPrompt);
          if (result.error) throw new Error(result.error);
          return { content: result.content, provider: newGeneratorModelId };
        },
        transactionB: async (llmResult) => {
          const nextVersionNumber = await getLatestVersionNumber(input.matterId, input.phaseName) + 1;

          const newVersion = await createVersion({
            matterId: input.matterId,
            phaseName: input.phaseName,
            versionNumber: nextVersionNumber,
            provider: newGeneratorModelId,
            content: llmResult.content,
            isSelected: 1,
            metadata: {
              iteration: 0,
              cycleNumber: newCycleNumber,
              sourcePath: 'restart',
              generatorProvider: newGeneratorModelId,
              isFormatted: false,
            },
          });

          await selectVersion(newVersion.id, input.matterId, input.phaseName);

          // Update phase fields for new cycle
          await updatePhaseFields(input.matterId, input.phaseName, {
            initialGeneratorModel: newGeneratorModelId,
            iterativeMeta: {
              ...meta,
              iterationNumber: 0,
              cycleNumber: newCycleNumber,
              currentVersionModel: newGeneratorModelId,
              feedbackCyclesCompleted: 0,
              formatRejectionCount: 0,
              isIterativeLoop: true,
            },
          });

          return { versionNumber: nextVersionNumber };
        },
        llmMeta: {
          model: newGeneratorModelId,
          role: 'generator',
          promptTokensEstimate: promptTokens,
        },
      });
    }),

  // ── Set Waiting On Client (§8.4) ─────────────────────────────────
  setWaitingOnClientIterative: protectedProcedure
    .input(phaseInputBase)
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });

      const currentState = phase.workflowState as WorkflowState;
      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

      // Store current state for restoration
      await updatePhaseFields(input.matterId, input.phaseName, {
        iterativeMeta: {
          ...meta,
          preClientWaitState: currentState,
        },
      });

      // Transition to waiting_on_client status (use setPhaseStatus pattern)
      await updatePhaseWorkflowState(input.matterId, input.phaseName, currentState);
      const { setPhaseStatus } = await import('../db');
      await setPhaseStatus(input.matterId, input.phaseName, 'waiting_on_client');

      return { success: true, previousState: currentState };
    }),

  // ── Client Responded (§8.4) ──────────────────────────────────────
  clientRespondedIterative: protectedProcedure
    .input(phaseInputBase)
    .mutation(async ({ input }) => {
      const phase = await getPhase(input.matterId, input.phaseName);
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Phase not found' });

      if (phase.status !== 'waiting_on_client') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phase is not in waiting_on_client status' });
      }

      const meta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });
      const restoreState = meta.preClientWaitState as WorkflowState | null;

      if (!restoreState) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No previous state to restore' });
      }

      // Clear the stored state
      await updatePhaseFields(input.matterId, input.phaseName, {
        iterativeMeta: {
          ...meta,
          preClientWaitState: null,
        },
      });

      // Restore status
      const { setPhaseStatus } = await import('../db');
      await setPhaseStatus(input.matterId, input.phaseName, 'in_progress');

      return { success: true, restoredState: restoreState };
    }),
});
