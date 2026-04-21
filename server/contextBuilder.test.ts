// server/contextBuilder.test.ts — Phase B tests for contextBuilder
// Per v1.4.2 §B.4 and v2.4.2 §6.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOKEN_BUDGETS, TOTAL_BUDGET_TARGET } from './contextBuilder';

// ── Mock dependencies ─────────────────────────────────────────────────
vi.mock('./db', () => ({
  collectPriorPhaseOutputs: vi.fn(),
  getUploadsByPhase: vi.fn(),
  getDocumentById: vi.fn(),
  getVersionByNumber: vi.fn(),
  listDocuments: vi.fn(),
  getPhase: vi.fn(),
}));

vi.mock('../shared/telemetry', () => ({
  emitTelemetry: vi.fn(),
}));

vi.mock('./tokens', () => ({
  estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 3)),
  accumulateWithBudget: vi.fn((items: Array<{ label: string; content: string }>, budget: number) => {
    let remaining = budget * 3; // chars
    const parts: string[] = [];
    const omitted: string[] = [];
    for (const item of items) {
      const text = item.label ? `${item.label}\n${item.content}` : item.content;
      if (text.length <= remaining) {
        parts.push(text);
        remaining -= text.length;
      } else {
        // Truncate
        parts.push(text.slice(0, remaining) + `\n[TRUNCATED AT LIMIT: ${item.label || 'content'}]`);
        omitted.push(item.label);
        remaining = 0;
      }
    }
    return { accumulated: parts.join('\n'), omitted };
  }),
}));

import {
  collectPriorPhaseOutputs,
  getUploadsByPhase,
  getDocumentById,
  getVersionByNumber,
} from './db';
import { emitTelemetry } from '../shared/telemetry';
import { buildContext, resolveSiblingDocuments } from './contextBuilder';

const mockDoc1 = {
  id: 10,
  matterId: 'matter-001',
  phaseName: 'agreement',
  documentType: 'revocable_living_trust',
  customTypeLabel: null,
  title: 'Smith Family Trust',
  officialFinalVersionNumber: 2,
  status: 'complete',
};

const mockDoc2 = {
  id: 11,
  matterId: 'matter-001',
  phaseName: 'agreement',
  documentType: 'pour_over_will',
  customTypeLabel: null,
  title: 'Pour-Over Will',
  officialFinalVersionNumber: 1,
  status: 'complete',
};

const mockDocNonAccepted = {
  id: 12,
  matterId: 'matter-001',
  phaseName: 'agreement',
  documentType: 'financial_poa',
  customTypeLabel: null,
  title: 'Financial POA',
  officialFinalVersionNumber: null,
  status: 'drafting',
};

describe('TOKEN_BUDGETS', () => {
  it('has the correct v2.4.2 values', () => {
    expect(TOKEN_BUDGETS.systemPrompt).toBe(3_000);
    expect(TOKEN_BUDGETS.metadata).toBe(500);
    expect(TOKEN_BUDGETS.priorPhaseOutputs).toBe(30_000);
    expect(TOKEN_BUDGETS.fileContents).toBe(80_000);
    expect(TOKEN_BUDGETS.attorneyNotes).toBe(5_000);
    expect(TOKEN_BUDGETS.siblingDocuments).toBe(30_000);
    expect(TOKEN_BUDGETS.roleSpecific).toBe(40_000);
    expect(TOKEN_BUDGETS.safetyMargin).toBe(10_000);
  });

  it('role-specific is 40k (reduced from v2.3 50k)', () => {
    expect(TOKEN_BUDGETS.roleSpecific).toBe(40_000);
    expect(TOKEN_BUDGETS.roleSpecific).toBeLessThan(50_000);
  });

  it('sibling-document budget is 30k (new in v2.4.2)', () => {
    expect(TOKEN_BUDGETS.siblingDocuments).toBe(30_000);
  });

  it('total budget target is 198,500 (sum of individual sections)', () => {
    // Spec §6.4 states ≤200,000 but individual line items sum to 198,500.
    // The 1.5k gap is a spec table rounding error; we use the actual sum.
    expect(TOTAL_BUDGET_TARGET).toBe(198_500);
  });

  it('sum of all sections equals total budget target', () => {
    const sum = Object.values(TOKEN_BUDGETS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_BUDGET_TARGET);
  });
});

describe('resolveSiblingDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDocumentById as any).mockImplementation((id: number) => {
      if (id === 10) return Promise.resolve(mockDoc1);
      if (id === 11) return Promise.resolve(mockDoc2);
      if (id === 12) return Promise.resolve(mockDocNonAccepted);
      return Promise.resolve(null);
    });
    (getVersionByNumber as any).mockResolvedValue({ content: 'Version content here' });
  });

  it('returns empty result when no sibling IDs provided', async () => {
    const result = await resolveSiblingDocuments('matter-001', 99, []);
    expect(result.siblingSection).toBe('');
    expect(result.siblingsSkipped).toHaveLength(0);
    expect(result.siblingsIncluded).toHaveLength(0);
  });

  it('includes sibling with officialFinalVersionNumber', async () => {
    const result = await resolveSiblingDocuments('matter-001', 99, [10]);
    expect(result.siblingsIncluded).toHaveLength(1);
    expect(result.siblingsIncluded[0].documentId).toBe(10);
    expect(result.siblingsSkipped).toHaveLength(0);
  });

  it('skips sibling without officialFinalVersionNumber', async () => {
    const result = await resolveSiblingDocuments('matter-001', 99, [12]);
    expect(result.siblingsSkipped).toHaveLength(1);
    expect(result.siblingsSkipped[0].documentId).toBe(12);
    expect(result.siblingsSkipped[0].reason).toBe('not_yet_accepted');
    expect(result.siblingsIncluded).toHaveLength(0);
  });

  it('skips the current document itself if included in sibling IDs', async () => {
    // Document 10 is the current document
    const result = await resolveSiblingDocuments('matter-001', 10, [10, 11]);
    // doc 10 is current, should be excluded; doc 11 should be included
    expect(result.siblingsIncluded).toHaveLength(1);
    expect(result.siblingsIncluded[0].documentId).toBe(11);
  });

  it('emits sibling_reference_included telemetry for included siblings', async () => {
    await resolveSiblingDocuments('matter-001', 99, [10]);
    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sibling_reference_included', siblingDocumentId: 10 }),
    );
  });

  it('emits sibling_reference_skipped telemetry for skipped siblings', async () => {
    await resolveSiblingDocuments('matter-001', 99, [12]);
    expect(emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sibling_reference_skipped', siblingDocumentId: 12, reason: 'not_yet_accepted' }),
    );
  });

  it('orders siblings by category (trust before will)', async () => {
    const result = await resolveSiblingDocuments('matter-001', 99, [11, 10]); // will then trust
    // Trust (doc 10) should come before will (doc 11) in the section
    expect(result.siblingsIncluded[0].documentId).toBe(10); // trust first
    expect(result.siblingsIncluded[1].documentId).toBe(11); // will second
  });
});

describe('buildContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (collectPriorPhaseOutputs as any).mockResolvedValue('Prior phase output content');
    (getUploadsByPhase as any).mockResolvedValue([]);
    (getDocumentById as any).mockResolvedValue(mockDoc1);
    (getVersionByNumber as any).mockResolvedValue({ content: 'Accepted version content' });
  });

  it('builds context with all sections for phase-scoped call', async () => {
    const result = await buildContext({
      matterId: 'matter-001',
      phaseName: 'agreement',
      roleSpecificContent: 'Target draft content',
      systemPrompt: 'You are a legal assistant.',
      phaseNotes: 'Phase notes here',
    });

    expect(result.context).toContain('You are a legal assistant.');
    expect(result.context).toContain('matter-001');
    expect(result.context).toContain('Prior phase output content');
    expect(result.context).toContain('Phase notes here');
    expect(result.context).toContain('Target draft content');
    expect(result.siblingResult).toBeUndefined();
  });

  it('includes sibling section for document-scoped call with sibling IDs', async () => {
    const result = await buildContext({
      matterId: 'matter-001',
      phaseName: 'agreement',
      documentId: 99,
      referencedSiblingDocumentIds: [10],
      roleSpecificContent: 'Target draft',
    });

    expect(result.siblingResult).toBeDefined();
    expect(result.siblingResult?.siblingsIncluded).toHaveLength(1);
  });

  it('does not include sibling section for phase-scoped call', async () => {
    const result = await buildContext({
      matterId: 'matter-001',
      phaseName: 'agreement',
      roleSpecificContent: 'Target draft',
      referencedSiblingDocumentIds: [10], // ignored without documentId
    });

    expect(result.siblingResult).toBeUndefined();
    // Sibling section should not appear in context
    expect(result.context).not.toContain('SIBLING DOCUMENTS');
  });

  it('includes document-level notes in context', async () => {
    const result = await buildContext({
      matterId: 'matter-001',
      phaseName: 'agreement',
      documentId: 10,
      roleSpecificContent: 'Target draft',
      phaseNotes: 'Phase note',
      documentNotes: 'Document-specific note',
    });

    expect(result.context).toContain('Document-specific note');
    expect(result.context).toContain('Phase note');
  });
});
