import { z } from 'zod';
import { isValidDocumentTypeKey } from '../documentTypeRegistry';

// Document-holding phases only. Non-document-holding phases (intake, issues, planning)
// are explicitly excluded per v2.4.2 §3.1.
export const phaseNameDocumentHoldingSchema = z.enum([
  'engagement', 'memo', 'matrix', 'agreement',
]);

export type PhaseNameDocumentHolding = z.infer<typeof phaseNameDocumentHoldingSchema>;

export const documentCreateInputSchema = z.object({
  matterId: z.string(),
  phaseName: phaseNameDocumentHoldingSchema,
  documentType: z.string().refine(
    (k) => k === 'custom' || isValidDocumentTypeKey(k),
    { message: 'Unknown document type key' }
  ),
  customTypeLabel: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().optional(),
}).refine(
  (input) => input.documentType !== 'custom' || !!input.customTypeLabel,
  { message: 'customTypeLabel is required when documentType is "custom"', path: ['customTypeLabel'] }
);

export type DocumentCreateInput = z.infer<typeof documentCreateInputSchema>;

export const documentUpdateTitleInputSchema = z.object({
  documentId: z.number().int().positive(),
  title: z.string().min(1).max(200),
});

export type DocumentUpdateTitleInput = z.infer<typeof documentUpdateTitleInputSchema>;

export const documentSetNotesInputSchema = z.object({
  documentId: z.number().int().positive(),
  notes: z.string(),
});

export type DocumentSetNotesInput = z.infer<typeof documentSetNotesInputSchema>;

export const documentArchiveInputSchema = z.object({
  documentId: z.number().int().positive(),
});

export type DocumentArchiveInput = z.infer<typeof documentArchiveInputSchema>;
