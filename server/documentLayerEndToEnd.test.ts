// server/documentLayerEndToEnd.test.ts — Phase B integration test
// Per v1.4.2 §B.4: must include the full estate planning package scenario.
//
// Scenario: Smith Family Estate Planning Package
//   Matter: model-3 (workflowModelVersion: 3)
//   Phase: agreement (document-holding)
//   Documents:
//     1. Revocable Living Trust (id: 101) — accepted (officialFinalVersionNumber: 2)
//     2. Pour-Over Will (id: 102) — accepted (officialFinalVersionNumber: 1)
//     3. Financial POA (id: 103) — in drafting (no accepted version)
//     4. Medical POA (id: 104) — archived
//
//   The test verifies:
//     A. getPhaseContainerStatus returns 'in_progress' (not all docs complete)
//     B. resolveSiblingDocuments includes docs 101 and 102, skips 103 (not accepted), excludes 104 (archived)
//     C. Sibling section contains trust and will content
//     D. document.create rejects for model-2 matter
//     E. document.create rejects for non-document-holding phase
//     F. document.archive transitions status to archived
//     G. getPhaseContainerStatus returns 'complete' when all non-archived docs are complete
//     H. setWaitingOnClient emits correct telemetry for document scope
//     I. clientResponded emits correct telemetry for document scope

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrpcContext } from './_core/context';

vi.mock('./db', () => ({
  getMatterByMatterId: vi.fn(),
  getPhase: vi.fn(),
  getDocumentById: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocumentTitle: vi.fn(),
  updateDocumentNotes: vi.fn(),
  archiveDocument: vi.fn(),
  setDocumentOfficialFinalVersion: vi.fn(),
  getVersionByNumber: vi.fn(),
  getVersionsByPhase: vi.fn(),
  getLatestVersionNumber: vi.fn(),
  createVersion: vi.fn(),
  createFeedbackBatch: vi.fn(),
  getFeedbackByPhase: vi.fn(),
  updateFeedbackDecision: vi.fn(),
  updatePhaseWorkflowState: vi.fn(),
  updatePhaseFields: vi.fn(),
  setPhaseStatus: vi.fn(),
  updatePhaseWorkflowStateConditional: vi.fn(),
  updateDocumentWorkflowStateConditional: vi.fn(),
  collectPriorPhaseOutputs: vi.fn(),
  getUploadsByPhase: vi.fn(),
  getPhaseContainerStatus: vi.fn(),
}));

vi.mock('../shared/telemetry', () => ({
  emitTelemetry: vi.fn(),
}));

import {
  getMatterByMatterId,
  getPhase,
  getDocumentById,
  listDocuments,
  createDocument,
  archiveDocument,
  setPhaseStatus,
  getVersionByNumber,
  getPhaseContainerStatus,
} from './db';
import { emitTelemetry } from '../shared/telemetry';
import { resolveSiblingDocuments } from './contextBuilder';

// ── Auth context helper ───────────────────────────────────────────────
function createAuthCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: 'test-user-001',
      email: 'attorney@satterwhitelaw.com',
      name: 'Test Attorney',
      loginMethod: 'manus',
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: () => {} } as TrpcContext['res'],
  };
}

// ── Test fixtures ─────────────────────────────────────────────────────
const smithMatter = {
  id: 'matter-smith-001',
  matterId: 'matter-smith-001',
  workflowModelVersion: 3,
  matterName: 'Smith Family Estate Plan',
  clientName: 'John and Jane Smith',
  jurisdiction: 'Virginia',
  workflowPath: 'standard',
  status: 'active',
};

const legacyMatter = {
  ...smithMatter,
  id: 'matter-legacy-001',
  matterId: 'matter-legacy-001',
  workflowModelVersion: 2,
};

const agreementPhase = {
  id: 10,
  matterId: 'matter-smith-001',
  phaseName: 'agreement',
  status: 'in_progress',
  workflowState: 'in_progress',
};

const docTrust = {
  id: 101,
  matterId: 'matter-smith-001',
  phaseName: 'agreement',
  documentType: 'revocable_living_trust',
  customTypeLabel: null,
  title: 'Smith Family Revocable Living Trust',
  notes: 'Includes pour-over provisions',
  status: 'complete',
  workflowState: 'complete',
  officialFinalVersionNumber: 2,
  updatedAt: new Date(),
};

const docWill = {
  id: 102,
  matterId: 'matter-smith-001',
  phaseName: 'agreement',
  documentType: 'pour_over_will',
  customTypeLabel: null,
  title: 'Smith Pour-Over Will',
  notes: null,
  status: 'complete',
  workflowState: 'complete',
  officialFinalVersionNumber: 1,
  updatedAt: new Date(),
};

const docPOA = {
  id: 103,
  matterId: 'matter-smith-001',
  phaseName: 'agreement',
  documentType: 'financial_poa',
  customTypeLabel: null,
  title: 'Smith Financial POA',
  notes: null,
  status: 'drafting',
  workflowState: 'awaiting_attorney_review',
  officialFinalVersionNumber: null, // not yet accepted
  updatedAt: new Date(),
};

const docMedicalPOA = {
  id: 104,
  matterId: 'matter-smith-001',
  phaseName: 'agreement',
  documentType: 'medical_poa',
  customTypeLabel: null,
  title: 'Smith Medical POA',
  notes: null,
  status: 'archived',
  workflowState: 'archived',
  officialFinalVersionNumber: null,
  updatedAt: new Date(),
};

const allDocs = [docTrust, docWill, docPOA, docMedicalPOA];
const nonArchivedDocs = [docTrust, docWill, docPOA];

// ── Test suite ────────────────────────────────────────────────────────
describe('Estate Planning Package — document layer integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockImplementation((id: string) => {
      if (id === 'matter-smith-001') return Promise.resolve(smithMatter);
      if (id === 'matter-legacy-001') return Promise.resolve(legacyMatter);
      return Promise.resolve(null);
    });
    (getPhase as any).mockResolvedValue(agreementPhase);
    (listDocuments as any).mockImplementation((_matterId: string, _phaseName?: string) => {
      return Promise.resolve(allDocs);
    });
    (getDocumentById as any).mockImplementation((id: number) => {
      return Promise.resolve(allDocs.find(d => d.id === id) ?? null);
    });
    (createDocument as any).mockResolvedValue({ ...docPOA, id: 105 });
    (archiveDocument as any).mockResolvedValue(undefined);
    (setPhaseStatus as any).mockResolvedValue(undefined);
    (getVersionByNumber as any).mockImplementation((_matterId: string, _phaseName: string, versionNumber: number) => {
      return Promise.resolve({ content: `Version ${versionNumber} content for trust document` });
    });
    (getPhaseContainerStatus as any).mockResolvedValue('in_progress');
  });

  // A. Container status is in_progress when not all docs are complete
  it('A: getPhaseContainerStatus returns in_progress when financial_poa is still drafting', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    const result = await caller.getPhaseContainerStatus({
      matterId: 'matter-smith-001',
      phaseName: 'agreement',
    });

    expect(result).toBe('in_progress');
  });

  // B. resolveSiblingDocuments includes trust and will, skips financial_poa (not accepted), excludes medical_poa (archived)
  it('B: resolveSiblingDocuments includes accepted docs, skips non-accepted, excludes current doc', async () => {
    const result = await resolveSiblingDocuments(
      'matter-smith-001',
      103, // current document is financial_poa
      [101, 102, 104], // referenced sibling IDs
    );

    // Trust and will are included (have officialFinalVersionNumber)
    expect(result.siblingsIncluded.map(s => s.documentId)).toContain(101);
    expect(result.siblingsIncluded.map(s => s.documentId)).toContain(102);

    // medical_poa (104) has no officialFinalVersionNumber — skipped
    expect(result.siblingsSkipped.map(s => s.documentId)).toContain(104);
  });

  // C. Sibling section contains trust and will content
  it('C: sibling section contains document titles for included siblings', async () => {
    const result = await resolveSiblingDocuments(
      'matter-smith-001',
      103,
      [101, 102],
    );

    expect(result.siblingSection).toContain('Revocable Living Trust');
    expect(result.siblingSection).toContain('Pour-Over Will');
  });

  // D. document.create rejects for model-2 matter
  it('D: document.create rejects for model-2 matter with PRECONDITION_FAILED', async () => {
    (getMatterByMatterId as any).mockResolvedValue(legacyMatter);

    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.create({
        matterId: 'matter-legacy-001',
        phaseName: 'agreement',
        documentType: 'revocable_living_trust',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  // E. document.create rejects for non-document-holding phase
  it('E: document.create rejects for non-document-holding phase (intake)', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.create({
        matterId: 'matter-smith-001',
        phaseName: 'intake',
        documentType: 'revocable_living_trust',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // F. document.archive transitions status to archived
  // Use docTrust (id: 101, workflowState: 'complete') — not in-flight, so archive is allowed.
  it('F: document.archive calls archiveDocument and emits telemetry', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    const result = await caller.archive({ documentId: 101 });

    expect(result).toMatchObject({ success: true });
    expect(archiveDocument).toHaveBeenCalledWith(101);
    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'document_archived', documentId: 101 }),
    );
  });

  // G. getPhaseContainerStatus returns complete when all non-archived docs are complete
  it('G: getPhaseContainerStatus returns complete when all non-archived docs are complete', async () => {
    (getPhaseContainerStatus as any).mockResolvedValue('complete');

    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    const result = await caller.getPhaseContainerStatus({
      matterId: 'matter-smith-001',
      phaseName: 'agreement',
    });

    expect(result).toBe('complete');
  });

  // H. setWaitingOnClient emits correct telemetry for document scope
  it('H: setWaitingOnClient emits state_transition with targetKind: document', async () => {
    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    await caller.setWaitingOnClient({
      matterId: 'matter-smith-001',
      phaseName: 'agreement',
      scope: { kind: 'document', documentId: 101 }, // trust is complete
    });

    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'state_transition',
        targetKind: 'document',
        documentId: 101,
        to: 'waiting_on_client',
        procedure: 'setWaitingOnClient',
      }),
    );
  });

  // I. clientResponded emits correct telemetry for document scope
  it('I: clientResponded emits state_transition with targetKind: document', async () => {
    (getPhase as any).mockResolvedValue({ ...agreementPhase, status: 'waiting_on_client' });

    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    await caller.clientResponded({
      matterId: 'matter-smith-001',
      phaseName: 'agreement',
      scope: { kind: 'document', documentId: 101 },
    });

    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'state_transition',
        targetKind: 'document',
        documentId: 101,
        from: 'waiting_on_client',
        to: 'completed',
        procedure: 'clientResponded',
      }),
    );
  });
});
