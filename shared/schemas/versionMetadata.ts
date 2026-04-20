import { z } from 'zod';
import { emitCriticalParseFailure } from '../telemetry';

export const unresolvedAnchorSchema = z.object({
  changeIndex: z.number().int().nonnegative(),
  sourceFeedbackId: z.number().int().nullable(),
  sourceExcerpt: z.string(),
  attemptedAnchor: z.union([
    z.object({
      kind: z.enum(['section_reference', 'paragraph_start', 'exact_match']),
      value: z.string(),
      locatorText: z.string(),
    }),
    z.object({
      sourceText: z.string(),
    }),
  ]),
  reason: z.enum(['not_found', 'multiple_matches', 'ambiguous']),
});

export const versionMetadataSchema = z.object({
  iteration: z.number().int().nonnegative().default(0),
  cycleNumber: z.number().int().positive().default(1),
  originatingFeedbackIds: z.array(z.number().int()).default([]),
  originatingSelectionIds: z.array(z.number().int()).default([]),
  evaluationId: z.number().int().nullable().default(null),
  sourcePath: z.enum([
    'initial', 'evaluator', 'manual', 'revision',
    'restart', 'formatting', 'formatting_bypassed',
  ]).default('initial'),
  isFormatted: z.boolean().default(false),
  generatorProvider: z.string().default('claude'),
  cloneOf: z.number().int().nullable().default(null),
  unresolvedAnchors: z.array(unresolvedAnchorSchema).nullable().default(null),
  providerLabel: z.string().optional(),
  error: z.string().optional(),
  feedback: z.unknown().optional(),
  flags: z.record(z.string(), z.unknown()).optional(),
});

export type VersionMetadata = z.infer<typeof versionMetadataSchema>;
export type UnresolvedAnchor = z.infer<typeof unresolvedAnchorSchema>;

export function parseVersionMetadata(
  raw: unknown,
  context: { versionId: number }
): VersionMetadata {
  if (raw === null || raw === undefined) {
    return versionMetadataSchema.parse({});
  }
  const result = versionMetadataSchema.safeParse(raw);
  if (!result.success) {
    console.error('CRITICAL: version metadata parse failure', {
      versionId: context.versionId,
      rawPayload: raw,
      zodError: result.error.issues,
      timestamp: new Date().toISOString(),
    });
    emitCriticalParseFailure('versionMetadata', context.versionId);
    return versionMetadataSchema.parse({});
  }
  return result.data;
}
