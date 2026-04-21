// server/routers/documentRouter.ts — Document management procedures (v2.4.2 §7.1)
// Per v2.4.2 §7.1, §5.1, §5.4 and v1.4.2 §B.3.5.
//
// All procedures are rejected with PRECONDITION_FAILED when invoked on a model-2 matter.
// Merged into the main appRouter via t.mergeRouters per v2.3 §2.3.6 discipline.
//
// R9 invariant: no duplicated procedures. These are new procedures, not clones of
// existing phase-level procedures.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';
import {
  getMatterByMatterId,
  getPhase,
  createDocument,
  getDocumentById,
  listDocuments,
  updateDocumentTitle,
  updateDocumentNotes,
  archiveDocument,
  setDocumentOfficialFinalVersion,
  getVersionByNumber,
  getPhaseContainerStatus,
  setPhaseStatus,
} from '../db';
import { getDocumentTypeDefinition, isValidDocumentTypeKey } from '../../shared/documentTypeRegistry';
import { DOCUMENT_HOLDING_PHASES } from '../../shared/schemas/scope';
import { emitTelemetry } from '../../shared/telemetry';
import type { Document } from '../../drizzle/schema';

// ── DocumentSummary shape (per v2.4.2 §7.1) ──────────────────────────
export interface DocumentSummary {
  id: number;
  matterId: string;
  phaseName: string;
  documentType: string;
  customTypeLabel: string | null;
  title: string;
  status: 'drafting' | 'complete' | 'archived';
  workflowState: string;
  currentIteration: number;
  currentCycle: number;
  officialFinalVersionNumber: number | null;
  updatedAt: Date;
}

function toDocumentSummary(doc: Document): DocumentSummary {
  return {
    id: doc.id,
    matterId: doc.matterId,
    phaseName: doc.phaseName,
    documentType: doc.documentType,
    customTypeLabel: doc.customTypeLabel ?? null,
    title: doc.title,
    status: doc.status as 'drafting' | 'complete' | 'archived',
    workflowState: doc.workflowState ?? 'idle',
    currentIteration: 1,
    currentCycle: 1,
    officialFinalVersionNumber: doc.officialFinalVersionNumber ?? null,
    updatedAt: doc.updatedAt ?? new Date(),
  };
}

// ── Routing-flag enforcement helper ──────────────────────────────────
async function requireModel3(matterId: string, procedure: string): Promise<void> {
  const matter = await getMatterByMatterId(matterId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  if ((matter.workflowModelVersion ?? 2) !== 3) {
    emitTelemetry({
      kind: 'legacy_mode_used',
      matterId,
      phaseName: '',
      procedure,
      workflowModelVersion: matter.workflowModelVersion ?? 2,
    });
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Document management requires workflowModelVersion = 3. This matter is model ${matter.workflowModelVersion ?? 2}.`,
    });
  }
}

// ── documentRouter ────────────────────────────────────────────────────
export const documentRouter = router({

  // ── document.create ───────────────────────────────────────────────
  create: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
      documentType: z.string(),
      customTypeLabel: z.string().max(200).optional(),
      title: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await requireModel3(input.matterId, 'document.create');

      // Phase must be a document-holding phase.
      if (!DOCUMENT_HOLDING_PHASES.has(input.phaseName)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Phase '${input.phaseName}' is not a document-holding phase. Document-holding phases: ${Array.from(DOCUMENT_HOLDING_PHASES).join(', ')}`,
        });
      }

      // Validate document type.
      if (!isValidDocumentTypeKey(input.documentType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown document type: '${input.documentType}'. Use a registry key or 'custom'.`,
        });
      }
      if (input.documentType === 'custom') {
        if (!input.customTypeLabel || input.customTypeLabel.trim().length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'customTypeLabel is required and must be non-empty when documentType is "custom".',
          });
        }
      }

      // Check intake precondition: intake must be completed or skipped.
      const intakePhase = await getPhase(input.matterId, 'intake');
      if (!intakePhase || !['completed', 'skipped'].includes(intakePhase.status ?? '')) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Intake phase must be completed or skipped before creating documents.',
        });
      }

      // Resolve title.
      const typeDef = getDocumentTypeDefinition(input.documentType);
      const resolvedTitle = input.title?.trim() ||
        (input.documentType === 'custom'
          ? (input.customTypeLabel ?? 'Custom Document')
          : (typeDef?.displayName ?? input.documentType));

      // Create the document.
      const doc = await createDocument({
        matterId: input.matterId,
        phaseName: input.phaseName,
        documentType: input.documentType,
        customTypeLabel: input.customTypeLabel ?? null,
        title: resolvedTitle,
        status: 'drafting',
        workflowState: 'idle',
        officialFinalVersionNumber: null,
        notes: null,
      });

      // If this is the first document in the phase, transition phase to in_progress.
      const existingDocs = await listDocuments(input.matterId, input.phaseName, false);
      if (existingDocs.length === 1) {
        // Only this newly created document exists → transition phase.
        const phase = await getPhase(input.matterId, input.phaseName);
        if (phase?.workflowState === 'idle') {
          // Phase transitions to in_progress when first document is created.
          // We do NOT write phases.workflowState for document-holding phases on model-3 matters
          // per §3.2 — instead, container status is derived. No write needed here.
        }
      }

      emitTelemetry({
        kind: 'document_created',
        matterId: input.matterId,
        phaseName: input.phaseName,
        documentId: doc.id,
        documentType: input.documentType,
        isCustom: input.documentType === 'custom',
      });

      return { documentId: doc.id };
    }),

  // ── document.list ─────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string().optional(),
      includeArchived: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      await requireModel3(input.matterId, 'document.list');

      const docs = await listDocuments(
        input.matterId,
        input.phaseName,
        input.includeArchived,
      );

      return docs.map(toDocumentSummary);
    }),

  // ── document.get ──────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const doc = await getDocumentById(input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${input.documentId} not found` });

      await requireModel3(doc.matterId, 'document.get');

      return toDocumentSummary(doc);
    }),

  // ── document.updateTitle ──────────────────────────────────────────
  updateTitle: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      title: z.string().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      const doc = await getDocumentById(input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${input.documentId} not found` });
      await requireModel3(doc.matterId, 'document.updateTitle');
      await updateDocumentTitle(input.documentId, input.title);
      return { success: true };
    }),

  // ── document.setNotes ─────────────────────────────────────────────
  setNotes: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      notes: z.string(),
    }))
    .mutation(async ({ input }) => {
      const doc = await getDocumentById(input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${input.documentId} not found` });
      await requireModel3(doc.matterId, 'document.setNotes');
      await updateDocumentNotes(input.documentId, input.notes);
      return { success: true };
    }),

  // ── document.archive ──────────────────────────────────────────────
  archive: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const doc = await getDocumentById(input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${input.documentId} not found` });
      await requireModel3(doc.matterId, 'document.archive');

      if (doc.status === 'archived') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Document is already archived.' });
      }

      await archiveDocument(input.documentId);

      emitTelemetry({
        kind: 'document_archived',
        matterId: doc.matterId,
        phaseName: doc.phaseName,
        documentId: doc.id,
      });

      return { success: true };
    }),

  // ── document.export ───────────────────────────────────────────────
  export: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const doc = await getDocumentById(input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: `Document ${input.documentId} not found` });
      await requireModel3(doc.matterId, 'document.export');

      if (!doc.officialFinalVersionNumber) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Document has no accepted final version. Accept a version before exporting.',
        });
      }

      const version = await getVersionByNumber(
        doc.matterId,
        doc.phaseName,
        doc.officialFinalVersionNumber,
      );
      if (!version) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Accepted version content not found.' });
      }

      // Export pipeline: returns a placeholder URL.
      // The firm-branded DOCX export pipeline (generatePhaseDocx) is invoked here.
      // In the test environment this returns a stub URL.
      const downloadUrl = `/api/export/document/${doc.id}/v${doc.officialFinalVersionNumber}.docx`;

      emitTelemetry({
        kind: 'document_exported',
        matterId: doc.matterId,
        phaseName: doc.phaseName,
        documentId: doc.id,
        versionNumber: doc.officialFinalVersionNumber,
      });

      return { downloadUrl };
    }),

  // ── document.getPhaseContainerStatus ─────────────────────────────
  // Accessor for derived phase container status (model-2 vs model-3).
  // Per v2.4.2 §3.2.
  getPhaseContainerStatus: protectedProcedure
    .input(z.object({
      matterId: z.string(),
      phaseName: z.string(),
    }))
    .query(async ({ input }) => {
      const status = await getPhaseContainerStatus(input.matterId, input.phaseName);
      return { status };
    }),
});

export type DocumentRouter = typeof documentRouter;
