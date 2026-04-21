import { z } from 'zod';

// ── IterativeMeta schema (v2.3, reused for documents in v2.4.2) ───────
// The shape is identical whether attached to a phase or a document.
// Per v2.4.2 §A.3.3: no new shape needed; only the context type is widened.

export const iterativeMetaSchema = z.object({
  iterationNumber: z.number().int().nonnegative().default(0),
  cycleNumber: z.number().int().nonnegative().default(0),
  currentVersionModel: z.string().optional(),
  lastReviewedVersionNumber: z.number().int().nonnegative().optional(),
  lastEvaluatedVersionNumber: z.number().int().nonnegative().optional(),
  lastAcceptedVersionNumber: z.number().int().nonnegative().optional(),
  totalFeedbackPointsAccepted: z.number().int().nonnegative().default(0),
  totalFeedbackPointsRejected: z.number().int().nonnegative().default(0),
  totalFeedbackPointsModified: z.number().int().nonnegative().default(0),
}).default({
  iterationNumber: 0,
  cycleNumber: 0,
  totalFeedbackPointsAccepted: 0,
  totalFeedbackPointsRejected: 0,
  totalFeedbackPointsModified: 0,
});

export type IterativeMeta = z.infer<typeof iterativeMetaSchema>;

// Context type widened in v2.4.2 to accept either a phase or document entity.
export type IterativeMetaContext =
  | { phaseId: number }
  | { documentId: number };

function getEntityId(context: IterativeMetaContext): number {
  return 'phaseId' in context ? context.phaseId : context.documentId;
}

function getEntityKind(context: IterativeMetaContext): 'phase' | 'document' {
  return 'phaseId' in context ? 'phase' : 'document';
}

/**
 * Safely parse raw JSON from the `iterativeMeta` column.
 * Returns defaults silently on null/undefined input.
 * Emits a critical telemetry event on malformed (non-null) input and returns defaults.
 * Works identically for phase-scoped and document-scoped entities.
 */
export function parseIterativeMeta(
  raw: unknown,
  context: IterativeMetaContext
): IterativeMeta {
  // Null or undefined: return defaults silently (no telemetry).
  if (raw === null || raw === undefined) {
    return iterativeMetaSchema.parse(undefined);
  }

  const result = iterativeMetaSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  // Malformed payload: emit critical telemetry and return defaults.
  const entityId = getEntityId(context);
  const entityKind = getEntityKind(context);
  console.error(
    JSON.stringify({
      event: 'critical_parse_failure',
      schema: 'iterativeMeta',
      entityKind,
      entityId,
      errors: result.error.issues,
      raw,
    })
  );

  return iterativeMetaSchema.parse(undefined);
}
