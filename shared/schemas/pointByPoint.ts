import { z } from 'zod';
import { emitCriticalParseFailure } from '../telemetry';

export const sectionAnchorSchema = z.object({
  kind: z.enum(['section_reference', 'paragraph_start', 'exact_match']),
  value: z.string(),
  locatorText: z.string(),
});

export const pointByPointItemSchema = z.object({
  sourceFeedbackId: z.number().int(),
  sourceReviewerProvider: z.string(),
  sourceExcerpt: z.string(),
  sectionAnchor: sectionAnchorSchema,
  recommendation: z.enum(['adopt', 'modify', 'skip']),
  reasoning: z.string(),
  suggestedText: z.string().nullable().default(null),
  attorneyDecision: z.enum(['adopt', 'modify', 'skip']).nullable().default(null),
  attorneyModifiedText: z.string().nullable().default(null),
});

export const pointByPointSchema = z.array(pointByPointItemSchema);

export type SectionAnchor = z.infer<typeof sectionAnchorSchema>;
export type PointByPointItem = z.infer<typeof pointByPointItemSchema>;
export type PointByPoint = z.infer<typeof pointByPointSchema>;

export function parsePointByPoint(
  raw: unknown,
  context: { evaluationId: number }
): PointByPoint {
  if (raw === null || raw === undefined) return [];
  const result = pointByPointSchema.safeParse(raw);
  if (!result.success) {
    console.error('CRITICAL: pointByPoint parse failure', {
      evaluationId: context.evaluationId,
      rawPayload: raw,
      zodError: result.error.issues,
      timestamp: new Date().toISOString(),
    });
    emitCriticalParseFailure('pointByPoint', context.evaluationId);
    return [];
  }
  return result.data;
}
