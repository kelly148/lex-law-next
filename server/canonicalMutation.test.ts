// server/canonicalMutation.test.ts — Phase B tests for runCanonicalMutation
// Per v1.4.2 §B.4.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MutationTarget, CanonicalMutationInput } from './canonicalMutation';

// ── Mock db helpers ────────────────────────────────────────────────────
vi.mock('./db', () => ({
  updatePhaseWorkflowStateConditional: vi.fn(),
  updateDocumentWorkflowStateConditional: vi.fn(),
  getPhase: vi.fn(),
  getDocumentById: vi.fn(),
}));

vi.mock('../shared/telemetry', () => ({
  emitTelemetry: vi.fn(),
}));

import {
  updatePhaseWorkflowStateConditional,
  updateDocumentWorkflowStateConditional,
  getPhase,
  getDocumentById,
} from './db';
import { emitTelemetry } from '../shared/telemetry';
import { runCanonicalMutation, resolveMutationTarget } from './canonicalMutation';

const mockPhase = {
  id: 1,
  matterId: 'matter-001',
  phaseName: 'agreement',
  workflowState: 'awaiting_attorney_review',
  status: 'in_progress',
};

const mockDocument = {
  id: 42,
  matterId: 'matter-001',
  phaseName: 'agreement',
  workflowState: 'awaiting_attorney_review',
  status: 'drafting',
  title: 'Revocable Living Trust',
  documentType: 'revocable_living_trust',
};

function makeInput<T>(
  target: MutationTarget,
  work: () => Promise<T>,
  overrides?: Partial<CanonicalMutationInput<T>>,
): CanonicalMutationInput<T> {
  return {
    target,
    procedure: 'test',
    expectedState: 'awaiting_attorney_review',
    inFlightState: 'revising',
    successState: 'complete',
    work,
    ...overrides,
  };
}

describe('runCanonicalMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPhase as any).mockResolvedValue(mockPhase);
    (getDocumentById as any).mockResolvedValue(mockDocument);
    (updatePhaseWorkflowStateConditional as any).mockResolvedValue({ success: true, rowsAffected: 1 });
    (updateDocumentWorkflowStateConditional as any).mockResolvedValue({ success: true, rowsAffected: 1 });
  });

  describe('phase target dispatch', () => {
    it('dispatches to updatePhaseWorkflowStateConditional for phase target', async () => {
      const target: MutationTarget = {
        kind: 'phase',
        phaseId: 1,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'result'));

      expect(updatePhaseWorkflowStateConditional).toHaveBeenCalled();
      expect(updateDocumentWorkflowStateConditional).not.toHaveBeenCalled();
    });

    it('passes phaseId to updatePhaseWorkflowStateConditional', async () => {
      const target: MutationTarget = {
        kind: 'phase',
        phaseId: 1,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'result'));

      expect(updatePhaseWorkflowStateConditional).toHaveBeenCalledWith(
        null,
        1,
        'awaiting_attorney_review',
        'revising',
        expect.objectContaining({ matterId: 'matter-001', phaseName: 'agreement' }),
      );
    });
  });

  describe('document target dispatch', () => {
    it('dispatches to updateDocumentWorkflowStateConditional for document target', async () => {
      const target: MutationTarget = {
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'result'));

      expect(updateDocumentWorkflowStateConditional).toHaveBeenCalled();
      expect(updatePhaseWorkflowStateConditional).not.toHaveBeenCalled();
    });

    it('passes documentId to updateDocumentWorkflowStateConditional', async () => {
      const target: MutationTarget = {
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'result'));

      expect(updateDocumentWorkflowStateConditional).toHaveBeenCalledWith(
        null,
        42,
        'awaiting_attorney_review',
        'revising',
        expect.objectContaining({ matterId: 'matter-001', phaseName: 'agreement', procedure: 'test' }),
      );
    });

    it('returns the result of the work function', async () => {
      const target: MutationTarget = {
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      const result = await runCanonicalMutation(makeInput(target, async () => ({ versionNumber: 5 })));

      expect(result).toEqual({ versionNumber: 5 });
    });
  });

  describe('telemetry', () => {
    it('emits state_transition with targetKind: phase for phase target', async () => {
      const target: MutationTarget = {
        kind: 'phase',
        phaseId: 1,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'r'));

      expect(emitTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'state_transition',
          targetKind: 'phase',
          matterId: 'matter-001',
          phaseName: 'agreement',
          from: 'awaiting_attorney_review',
          to: 'revising',
        }),
      );
    });

    it('emits state_transition with targetKind: document for document target', async () => {
      const target: MutationTarget = {
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'r'));

      expect(emitTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'state_transition',
          targetKind: 'document',
          documentId: 42,
          from: 'awaiting_attorney_review',
          to: 'revising',
        }),
      );
    });

    it('emits llm_call_start and llm_call_complete on success', async () => {
      const target: MutationTarget = {
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await runCanonicalMutation(makeInput(target, async () => 'r'));

      const calls = (emitTelemetry as any).mock.calls.map((c: any) => c[0].kind);
      expect(calls).toContain('llm_call_start');
      expect(calls).toContain('llm_call_complete');
      expect(calls).not.toContain('llm_call_failure');
    });

    it('emits llm_call_failure when work throws', async () => {
      const target: MutationTarget = {
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      };

      await expect(
        runCanonicalMutation(makeInput(target, async () => { throw new Error('LLM error'); })),
      ).rejects.toThrow('LLM error');

      expect(emitTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'llm_call_failure', error: 'LLM error' }),
      );
    });
  });

  describe('resolveMutationTarget', () => {
    it('resolves phase scope to phase target', async () => {
      const result = await resolveMutationTarget({ kind: 'phase', matterId: 'matter-001', phaseName: 'agreement' });

      expect(result).toEqual({
        kind: 'phase',
        phaseId: 1,
        matterId: 'matter-001',
        phaseName: 'agreement',
      });
    });

    it('resolves document scope to document target', async () => {
      const result = await resolveMutationTarget({ kind: 'document', documentId: 42 });

      expect(result).toEqual({
        kind: 'document',
        documentId: 42,
        matterId: 'matter-001',
        phaseName: 'agreement',
      });
    });

    it('throws NOT_FOUND when phase does not exist', async () => {
      (getPhase as any).mockResolvedValue(null);

      await expect(
        resolveMutationTarget({ kind: 'phase', matterId: 'matter-001', phaseName: 'agreement' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws NOT_FOUND when document does not exist', async () => {
      (getDocumentById as any).mockResolvedValue(null);

      await expect(
        resolveMutationTarget({ kind: 'document', documentId: 999 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
