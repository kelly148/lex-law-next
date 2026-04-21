// server/iterativePhaseRouter.test.ts — Phase B tests for iterativePhaseRouter
// Per v1.4.2 §B.4. Includes the 5 required setWaitingOnClient/clientResponded model-3 tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrpcContext } from './_core/context';

vi.mock('./db', () => ({
  getMatterByMatterId: vi.fn(),
  getPhase: vi.fn(),
  getDocumentById: vi.fn(),
  updatePhaseWorkflowStateConditional: vi.fn(),
  updateDocumentWorkflowStateConditional: vi.fn(),
  updatePhaseWorkflowState: vi.fn(),
  updatePhaseFields: vi.fn(),
  setPhaseStatus: vi.fn(),
  createVersion: vi.fn(),
  getVersionsByPhase: vi.fn(),
  getVersionByNumber: vi.fn(),
  getLatestVersionNumber: vi.fn(),
  createFeedbackBatch: vi.fn(),
  getFeedbackByPhase: vi.fn(),
  updateFeedbackDecision: vi.fn(),
  collectPriorPhaseOutputs: vi.fn(),
  getUploadsByPhase: vi.fn(),
  updateDocumentTitle: vi.fn(),
  updateDocumentNotes: vi.fn(),
  archiveDocument: vi.fn(),
  setDocumentOfficialFinalVersion: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock('../shared/telemetry', () => ({
  emitTelemetry: vi.fn(),
}));

import {
  getMatterByMatterId,
  getPhase,
  getDocumentById,
  setPhaseStatus,
} from './db';
import { emitTelemetry } from '../shared/telemetry';

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

const model3Matter = {
  id: 'matter-001',
  matterId: 'matter-001',
  workflowModelVersion: 3,
  matterName: 'Smith Estate',
  clientName: 'John Smith',
  jurisdiction: 'Virginia',
  workflowPath: 'standard',
  status: 'active',
};

const model2Matter = {
  ...model3Matter,
  id: 'matter-002',
  matterId: 'matter-002',
  workflowModelVersion: 2,
};

const mockPhaseCompleted = {
  id: 1,
  matterId: 'matter-001',
  phaseName: 'agreement',
  workflowState: 'complete',
  status: 'completed',
};

const mockPhaseWaitingOnClient = {
  ...mockPhaseCompleted,
  status: 'waiting_on_client',
};

const mockDocumentComplete = {
  id: 42,
  matterId: 'matter-001',
  phaseName: 'agreement',
  documentType: 'revocable_living_trust',
  customTypeLabel: null,
  title: 'Smith Family Trust',
  notes: null,
  status: 'complete',
  workflowState: 'complete',
  officialFinalVersionNumber: 2,
};

const mockDocumentDrafting = {
  ...mockDocumentComplete,
  status: 'drafting',
  workflowState: 'awaiting_attorney_review',
  officialFinalVersionNumber: null,
};

describe('iterativePhaseRouter — routing-flag enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockResolvedValue(model3Matter);
    (getPhase as any).mockResolvedValue(mockPhaseCompleted);
    (getDocumentById as any).mockResolvedValue(mockDocumentComplete);
    (setPhaseStatus as any).mockResolvedValue(undefined);
  });

  it('rejects document-scoped call on model-2 matter with PRECONDITION_FAILED', async () => {
    (getMatterByMatterId as any).mockResolvedValue(model2Matter);
    (getDocumentById as any).mockResolvedValue({ ...mockDocumentComplete, matterId: 'matter-002' });

    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    await expect(
      caller.setWaitingOnClient({
        matterId: 'matter-002',
        phaseName: 'agreement',
        scope: { kind: 'document', documentId: 42 },
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('allows phase-scoped call on model-2 matter', async () => {
    (getMatterByMatterId as any).mockResolvedValue(model2Matter);
    (getPhase as any).mockResolvedValue({
      ...mockPhaseCompleted,
      matterId: 'matter-002',
      status: 'completed',
      workflowState: 'complete',
    });

    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    // Phase-scoped call on model-2 should not throw PRECONDITION_FAILED
    await expect(
      caller.setWaitingOnClient({
        matterId: 'matter-002',
        phaseName: 'agreement',
        scope: { kind: 'phase', matterId: 'matter-002', phaseName: 'agreement' },
      }),
    ).resolves.toBeDefined();
  });
});

// ── The 5 required setWaitingOnClient/clientResponded model-3 document tests ──
describe('iterativePhaseRouter — setWaitingOnClient model-3 document scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockResolvedValue(model3Matter);
    (getPhase as any).mockResolvedValue(mockPhaseCompleted);
    (getDocumentById as any).mockResolvedValue(mockDocumentComplete);
    (setPhaseStatus as any).mockResolvedValue(undefined);
  });

  it('T1: sets phase status to waiting_on_client for document scope', async () => {
    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    const result = await caller.setWaitingOnClient({
      matterId: 'matter-001',
      phaseName: 'agreement',
      scope: { kind: 'document', documentId: 42 },
    });

    expect(result).toMatchObject({ success: true });
    expect(setPhaseStatus).toHaveBeenCalledWith('matter-001', 'agreement', 'waiting_on_client');
  });

  it('T2: emits state_transition telemetry with targetKind: document', async () => {
    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    await caller.setWaitingOnClient({
      matterId: 'matter-001',
      phaseName: 'agreement',
      scope: { kind: 'document', documentId: 42 },
    });

    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'state_transition',
        targetKind: 'document',
        documentId: 42,
        to: 'waiting_on_client',
        procedure: 'setWaitingOnClient',
      }),
    );
  });

  it('T3: rejects when document status is not complete', async () => {
    (getDocumentById as any).mockResolvedValue(mockDocumentDrafting);

    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    await expect(
      caller.setWaitingOnClient({
        matterId: 'matter-001',
        phaseName: 'agreement',
        scope: { kind: 'document', documentId: 42 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('iterativePhaseRouter — clientResponded model-3 document scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockResolvedValue(model3Matter);
    (getPhase as any).mockResolvedValue(mockPhaseWaitingOnClient);
    (getDocumentById as any).mockResolvedValue(mockDocumentComplete);
    (setPhaseStatus as any).mockResolvedValue(undefined);
  });

  it('T4: transitions phase from waiting_on_client to completed for document scope', async () => {
    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    const result = await caller.clientResponded({
      matterId: 'matter-001',
      phaseName: 'agreement',
      scope: { kind: 'document', documentId: 42 },
    });

    expect(result).toMatchObject({ success: true });
    expect(setPhaseStatus).toHaveBeenCalledWith('matter-001', 'agreement', 'completed');
  });

  it('T5: emits state_transition telemetry with targetKind: document on clientResponded', async () => {
    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    await caller.clientResponded({
      matterId: 'matter-001',
      phaseName: 'agreement',
      scope: { kind: 'document', documentId: 42 },
    });

    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'state_transition',
        targetKind: 'document',
        documentId: 42,
        from: 'waiting_on_client',
        to: 'completed',
        procedure: 'clientResponded',
      }),
    );
  });
});

describe('iterativePhaseRouter — referencedSiblingDocumentIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockResolvedValue(model3Matter);
    (getDocumentById as any).mockResolvedValue(mockDocumentDrafting);
    (getPhase as any).mockResolvedValue(mockPhaseCompleted);
  });

  it('accepts referencedSiblingDocumentIds in requestFeedback for document scope', async () => {
    const { iterativePhaseRouter } = await import('./routers/iterativePhaseRouter');
    const caller = iterativePhaseRouter.createCaller(createAuthCtx());

    // requestFeedback with document scope and sibling IDs should not throw a schema error
    try {
      await caller.requestFeedback({
        matterId: 'matter-001',
        phaseName: 'agreement',
        feedback: 'Please revise section 3.',
        scope: { kind: 'document', documentId: 42 },
        referencedSiblingDocumentIds: [10, 11],
      });
    } catch (e: any) {
      // Should not throw a ZodError (schema validation error)
      expect(e.code).not.toBe('BAD_REQUEST');
    }
  });
});
