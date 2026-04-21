// shared/schemas/scope.ts — Scope discriminator for iterative-review procedures (v2.4.2)
// Per v2.4.2 §7.2 and v1.4.2 §B.3.1.
import { z } from 'zod';
import { phaseNameDocumentHoldingSchema } from './documentInput';

// Phase name union covers ALL v2.3 phases (not just document-holding ones),
// because scope.kind === 'phase' must still work for intake/issues/planning
// on every matter, regardless of workflowModelVersion.
export const phaseNameSchema = z.enum([
  'intake', 'issues', 'planning',
  'engagement', 'memo', 'matrix', 'agreement',
]);
export type ScopePhaseName = z.infer<typeof phaseNameSchema>;

// Document-holding phases — used for routing-flag enforcement.
export const DOCUMENT_HOLDING_PHASES: ReadonlySet<string> = new Set([
  'engagement', 'memo', 'matrix', 'agreement',
]);

export const mutationScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phase'),
    matterId: z.string(),
    phaseName: phaseNameSchema,
  }),
  z.object({
    kind: z.literal('document'),
    documentId: z.number().int().positive(),
  }),
]);

export type MutationScope = z.infer<typeof mutationScopeSchema>;

// Re-export phaseNameDocumentHoldingSchema for convenience.
export { phaseNameDocumentHoldingSchema };
