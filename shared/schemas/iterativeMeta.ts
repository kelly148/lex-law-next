import { z } from 'zod';
import { emitCriticalParseFailure } from '../telemetry';

export const iterativeMetaSchema = z.object({
  iterationNumber: z.number().int().nonnegative().default(0),
  cycleNumber: z.number().int().positive().default(1),
  currentVersionModel: z.string().nullable().default(null),
  lastEvaluatorModel: z.string().nullable().default(null),
  lastRegeneratorModel: z.string().nullable().default(null),
  feedbackCyclesCompleted: z.number().int().nonnegative().default(0),
  formatRejectionCount: z.number().int().nonnegative().default(0),
  preClientWaitState: z.string().nullable().default(null),
  isIterativeLoop: z.boolean().default(false),
});

export type IterativeMeta = z.infer<typeof iterativeMetaSchema>;

export function parseIterativeMeta(
  raw: unknown,
  context: { phaseId: number }
): IterativeMeta {
  // Legacy path: null/undefined returns defaults silently
  if (raw === null || raw === undefined) {
    return iterativeMetaSchema.parse({});
  }

  // Corruption path: existing data that fails Zod parsing
  const result = iterativeMetaSchema.safeParse(raw);
  if (!result.success) {
    console.error('CRITICAL: iterativeMeta parse failure — write-path bug suspected', {
      phaseId: context.phaseId,
      rawPayload: raw,
      zodError: result.error.issues,
      stack: new Error().stack,
      timestamp: new Date().toISOString(),
    });
    emitCriticalParseFailure('iterativeMeta', context.phaseId);
    return iterativeMetaSchema.parse({});
  }

  return result.data;
}
