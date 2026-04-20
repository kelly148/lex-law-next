import { z } from 'zod';

export const manualSelectionInputSchema = z.object({
  sourceFeedbackId: z.number().int().positive(),
  selectionOrder: z.number().int().nonnegative(),
  selectionKind: z.enum(['paragraph', 'span']),
  sourceText: z.string().min(1),
  precedingContext: z.string().default(''),
  followingContext: z.string().default(''),
  editedText: z.string().nullable().default(null),
});

export type ManualSelectionInput = z.infer<typeof manualSelectionInputSchema>;
