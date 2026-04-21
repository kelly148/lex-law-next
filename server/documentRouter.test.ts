// server/documentRouter.test.ts — Phase B tests for documentRouter
// Per v1.4.2 §B.4.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrpcContext } from './_core/context';

vi.mock('./db', () => ({
  getMatterByMatterId: vi.fn(),
  getPhase: vi.fn(),
  createDocument: vi.fn(),
  getDocumentById: vi.fn(),
  listDocuments: vi.fn(),
  updateDocumentTitle: vi.fn(),
  updateDocumentNotes: vi.fn(),
  archiveDocument: vi.fn(),
  setDocumentOfficialFinalVersion: vi.fn(),
  getVersionByNumber: vi.fn(),
  getPhaseContainerStatus: vi.fn(),
  setPhaseStatus: vi.fn(),
}));

vi.mock('../shared/telemetry', () => ({
  emitTelemetry: vi.fn(),
}));

import {
  getMatterByMatterId,
  getPhase,
  createDocument,
  getDocumentById,
  listDocuments,
  archiveDocument,
  getVersionByNumber,
  getPhaseContainerStatus,
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

const completedIntakePhase = {
  id: 1,
  matterId: 'matter-001',
  phaseName: 'intake',
  status: 'completed',
  workflowState: 'complete',
};

const mockDoc = {
  id: 42,
  matterId: 'matter-001',
  phaseName: 'agreement',
  documentType: 'revocable_living_trust',
  customTypeLabel: null,
  title: 'Smith Family Trust',
  notes: null,
  status: 'drafting',
  workflowState: 'idle',
  officialFinalVersionNumber: null,
  updatedAt: new Date(),
};

describe('documentRouter routing-flag enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockResolvedValue(model3Matter);
    (getPhase as any).mockResolvedValue(completedIntakePhase);
    (createDocument as any).mockResolvedValue({ ...mockDoc });
    (listDocuments as any).mockResolvedValue([mockDoc]);
    (getDocumentById as any).mockResolvedValue(mockDoc);
    (getPhaseContainerStatus as any).mockResolvedValue('idle');
  });

  it('rejects document.create for model-2 matter with PRECONDITION_FAILED', async () => {
    (getMatterByMatterId as any).mockResolvedValue(model2Matter);

    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.create({
        matterId: 'matter-002',
        phaseName: 'agreement',
        documentType: 'revocable_living_trust',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('rejects document.list for model-2 matter with PRECONDITION_FAILED', async () => {
    (getMatterByMatterId as any).mockResolvedValue(model2Matter);

    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.list({ matterId: 'matter-002' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('rejects document.create for non-document-holding phase', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.create({
        matterId: 'matter-001',
        phaseName: 'intake', // not a document-holding phase
        documentType: 'revocable_living_trust',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects document.create with unknown document type', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.create({
        matterId: 'matter-001',
        phaseName: 'agreement',
        documentType: 'nonexistent_type_xyz',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects document.create with custom type and no customTypeLabel', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.create({
        matterId: 'matter-001',
        phaseName: 'agreement',
        documentType: 'custom',
        // missing customTypeLabel
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('accepts document.create with custom type and customTypeLabel', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    const result = await caller.create({
      matterId: 'matter-001',
      phaseName: 'agreement',
      documentType: 'custom',
      customTypeLabel: 'Special Agreement',
    });

    expect(result.documentId).toBeDefined();
  });

  it('emits document_created telemetry on successful create', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await caller.create({
      matterId: 'matter-001',
      phaseName: 'agreement',
      documentType: 'revocable_living_trust',
    });

    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'document_created', matterId: 'matter-001' }),
    );
  });

  it('rejects document.archive for already-archived document', async () => {
    (getDocumentById as any).mockResolvedValue({ ...mockDoc, status: 'archived' });

    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.archive({ documentId: 42 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects document.export when no officialFinalVersionNumber', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    await expect(
      caller.export({ documentId: 42 }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('returns downloadUrl on successful export', async () => {
    (getDocumentById as any).mockResolvedValue({ ...mockDoc, officialFinalVersionNumber: 3 });
    (getVersionByNumber as any).mockResolvedValue({ content: 'Final content' });

    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    const result = await caller.export({ documentId: 42 });

    expect(result.downloadUrl).toContain('/api/export/document/42');
  });
});

describe('getPhaseContainerStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMatterByMatterId as any).mockResolvedValue(model3Matter);
    (getPhaseContainerStatus as any).mockResolvedValue('in_progress');
  });

  it('returns container status for a phase', async () => {
    const { documentRouter } = await import('./routers/documentRouter');
    const caller = documentRouter.createCaller(createAuthCtx());

    const result = await caller.getPhaseContainerStatus({
      matterId: 'matter-001',
      phaseName: 'agreement',
    });

    expect(result.status).toBe('in_progress');
  });
});
