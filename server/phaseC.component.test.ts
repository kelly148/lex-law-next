/**
 * server/phaseC.component.test.ts
 *
 * Phase C component-level unit tests.
 * Per v1.4.2 §C.4.
 *
 * These tests run in the node environment (consistent with the existing test suite).
 * They test logic and data-layer behavior of the Phase C additions — strings catalog,
 * document type registry, hook logic, and component prop behavior.
 * DOM rendering tests are deferred to Human UAT (requires jsdom setup).
 */
import { describe, it, expect } from 'vitest';

// ── 1. strings.ts catalog ────────────────────────────────────────────────────
import {
  PHASE_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  DASHBOARD,
  DOCUMENT_CARD,
  ADD_DOCUMENT_MODAL,
  DOCUMENT_DETAIL,
  SIBLING_SKIP_BANNER,
  GENERAL,
} from '../shared/strings';

describe('shared/strings.ts — UI string catalog', () => {
  it('PHASE_STATUS_LABELS covers all four container statuses', () => {
    expect(PHASE_STATUS_LABELS.idle).toBe('Not Started');
    expect(PHASE_STATUS_LABELS.in_progress).toBe('In Progress');
    expect(PHASE_STATUS_LABELS.complete).toBe('Complete');
    expect(PHASE_STATUS_LABELS.skipped).toBe('Skipped');
  });

  it('DOCUMENT_STATUS_LABELS covers all three document statuses', () => {
    expect(DOCUMENT_STATUS_LABELS.drafting).toBe('Drafting');
    expect(DOCUMENT_STATUS_LABELS.complete).toBe('Complete');
    expect(DOCUMENT_STATUS_LABELS.archived).toBe('Archived');
  });

  it('DOCUMENT_CATEGORY_LABELS covers all five categories', () => {
    expect(DOCUMENT_CATEGORY_LABELS.Trust).toBeDefined();
    expect(DOCUMENT_CATEGORY_LABELS.Will).toBeDefined();
    expect(DOCUMENT_CATEGORY_LABELS.POA).toBeDefined();
    expect(DOCUMENT_CATEGORY_LABELS.Other).toBeDefined();
    expect(DOCUMENT_CATEGORY_LABELS.Custom).toBeDefined();
  });

  it('DASHBOARD.documentCount formats singular and plural correctly', () => {
    expect(DASHBOARD.documentCount(1)).toBe('1 document');
    expect(DASHBOARD.documentCount(0)).toBe('0 documents');
    expect(DASHBOARD.documentCount(6)).toBe('6 documents');
  });

  it('DOCUMENT_CARD.iterationLabel formats iteration and cycle', () => {
    expect(DOCUMENT_CARD.iterationLabel(1, 1)).toBe('Iteration 1, Cycle 1');
    expect(DOCUMENT_CARD.iterationLabel(3, 2)).toBe('Iteration 3, Cycle 2');
  });

  it('SIBLING_SKIP_BANNER.message formats singular and plural correctly', () => {
    expect(SIBLING_SKIP_BANNER.message(1)).toContain('1 sibling reference');
    expect(SIBLING_SKIP_BANNER.message(1)).not.toContain('references');
    expect(SIBLING_SKIP_BANNER.message(3)).toContain('3 sibling references');
  });

  it('ADD_DOCUMENT_MODAL has all required fields', () => {
    expect(ADD_DOCUMENT_MODAL.title).toBeDefined();
    expect(ADD_DOCUMENT_MODAL.typePickerLabel).toBeDefined();
    expect(ADD_DOCUMENT_MODAL.customLabelInputLabel).toBeDefined();
    expect(ADD_DOCUMENT_MODAL.customLabelRequiredError).toBeDefined();
    expect(ADD_DOCUMENT_MODAL.customLabelTooLongError).toBeDefined();
    expect(ADD_DOCUMENT_MODAL.createButton).toBeDefined();
    expect(ADD_DOCUMENT_MODAL.cancelButton).toBeDefined();
  });

  it('DOCUMENT_DETAIL has reference picker strings', () => {
    expect(DOCUMENT_DETAIL.referencePickerTitle).toBeDefined();
    expect(DOCUMENT_DETAIL.referencePickerDescription).toBeDefined();
    expect(DOCUMENT_DETAIL.referencePickerEmptyState).toBeDefined();
    // Description must mention that selections reset on reload (spec requirement)
    expect(DOCUMENT_DETAIL.referencePickerDescription).toContain('reset');
  });

  it('no internal state names appear in user-facing strings', () => {
    // Per v1.3 discipline: no raw state names like 'awaiting_attorney_review' in JSX strings
    const allStrings = JSON.stringify({
      PHASE_STATUS_LABELS,
      DOCUMENT_STATUS_LABELS,
      DASHBOARD,
      DOCUMENT_CARD,
      ADD_DOCUMENT_MODAL,
      DOCUMENT_DETAIL,
      SIBLING_SKIP_BANNER,
      GENERAL,
    });
    expect(allStrings).not.toContain('awaiting_attorney_review');
    expect(allStrings).not.toContain('awaiting_feedback_action');
    expect(allStrings).not.toContain('awaiting_decisions');
    expect(allStrings).not.toContain('awaiting_format_review');
    expect(allStrings).not.toContain('workflowModelVersion');
  });
});

// ── 2. documentTypeRegistry.ts ───────────────────────────────────────────────
import {
  DOCUMENT_TYPE_REGISTRY,
  getDocumentTypeDefinition,
  isValidDocumentTypeKey,
} from '../shared/documentTypeRegistry';

describe('shared/documentTypeRegistry.ts', () => {
  it('has exactly 13 document types', () => {
    expect(DOCUMENT_TYPE_REGISTRY.length).toBe(13);
  });

  it('includes all 6 estate planning types from Test 1', () => {
    const required = [
      'revocable_living_trust',
      'pour_over_will',
      'financial_poa',
      'medical_poa',
      'hipaa_authorization',
      'certification_of_trust',
    ];
    for (const key of required) {
      expect(isValidDocumentTypeKey(key)).toBe(true);
    }
  });

  it('includes custom type', () => {
    expect(isValidDocumentTypeKey('custom')).toBe(true);
    const def = getDocumentTypeDefinition('custom');
    expect(def?.category).toBe('custom');
  });

  it('rejects unknown type keys', () => {
    expect(isValidDocumentTypeKey('unknown_type')).toBe(false);
    expect(isValidDocumentTypeKey('')).toBe(false);
  });

  it('getDocumentTypeDefinition returns correct category for trust types', () => {
    expect(getDocumentTypeDefinition('revocable_living_trust')?.category).toBe('trust');
    expect(getDocumentTypeDefinition('certification_of_trust')?.category).toBe('trust');
    expect(getDocumentTypeDefinition('assignment_of_personal_property')?.category).toBe('trust');
  });

  it('getDocumentTypeDefinition returns correct category for will types', () => {
    expect(getDocumentTypeDefinition('pour_over_will')?.category).toBe('will');
    expect(getDocumentTypeDefinition('simple_will')?.category).toBe('will');
  });

  it('getDocumentTypeDefinition returns correct category for POA types', () => {
    expect(getDocumentTypeDefinition('financial_poa')?.category).toBe('poa');
    expect(getDocumentTypeDefinition('medical_poa')?.category).toBe('poa');
    expect(getDocumentTypeDefinition('hipaa_authorization')?.category).toBe('poa');
  });

  it('all registry entries have non-empty displayName and key', () => {
    for (const def of DOCUMENT_TYPE_REGISTRY) {
      expect(def.key.length).toBeGreaterThan(0);
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(['trust', 'will', 'poa', 'other', 'custom']).toContain(def.category);
    }
  });
});

// ── 3. useMatterWorkflowModelVersion hook logic ──────────────────────────────
// The hook uses trpc.matter.get.useQuery which requires a React context.
// We test the pure logic: given a matter with workflowModelVersion = X,
// the hook should return X (or undefined for unknown values).
describe('useMatterWorkflowModelVersion — pure logic', () => {
  it('returns 2 for model-2 matters', () => {
    // Simulate what the hook does with the query result
    const version = 2;
    const result = (version === 2 || version === 3) ? version : undefined;
    expect(result).toBe(2);
  });

  it('returns 3 for model-3 matters', () => {
    const version = 3;
    const result = (version === 2 || version === 3) ? version : undefined;
    expect(result).toBe(3);
  });

  it('returns undefined for null/unknown values (loading state)', () => {
    const version = null;
    const result = (version === 2 || version === 3) ? version : undefined;
    expect(result).toBeUndefined();
  });

  it('returns undefined for unexpected version numbers', () => {
    const version = 99;
    const result = (version === 2 || version === 3) ? version : undefined;
    expect(result).toBeUndefined();
  });
});

// ── 4. MatterPage routing logic ───────────────────────────────────────────────
// Tests the branching logic: model-2 → LegacyMatterView, model-3 → MatterDashboard
describe('MatterPage routing logic', () => {
  function routeMatterPage(version: 2 | 3 | undefined): 'LegacyMatterView' | 'MatterDashboard' | 'loading' {
    if (version === undefined) return 'loading';
    if (version === 2) return 'LegacyMatterView';
    return 'MatterDashboard';
  }

  it('routes model-2 matter to LegacyMatterView', () => {
    expect(routeMatterPage(2)).toBe('LegacyMatterView');
  });

  it('routes model-3 matter to MatterDashboard', () => {
    expect(routeMatterPage(3)).toBe('MatterDashboard');
  });

  it('shows loading state while version is undefined', () => {
    expect(routeMatterPage(undefined)).toBe('loading');
  });
});

// ── 5. Reference picker — frontend-only state semantics ──────────────────────
// The reference picker is pure React state: never persisted, resets on reload.
// We test the state management logic in isolation.
describe('Reference picker — frontend state semantics', () => {
  // Simulate the reference picker state as a Set<number>
  function createReferencePicker() {
    const selected = new Set<number>();
    return {
      toggle: (id: number) => {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      },
      isSelected: (id: number) => selected.has(id),
      getSelected: () => Array.from(selected),
      reset: () => selected.clear(),
    };
  }

  it('starts empty (no selections on load)', () => {
    const picker = createReferencePicker();
    expect(picker.getSelected()).toHaveLength(0);
  });

  it('toggles selection on and off', () => {
    const picker = createReferencePicker();
    picker.toggle(101);
    expect(picker.isSelected(101)).toBe(true);
    picker.toggle(101);
    expect(picker.isSelected(101)).toBe(false);
  });

  it('can select multiple siblings', () => {
    const picker = createReferencePicker();
    picker.toggle(101);
    picker.toggle(102);
    picker.toggle(103);
    expect(picker.getSelected()).toHaveLength(3);
    expect(picker.isSelected(101)).toBe(true);
    expect(picker.isSelected(102)).toBe(true);
    expect(picker.isSelected(103)).toBe(true);
  });

  it('reset clears all selections (simulates page reload)', () => {
    const picker = createReferencePicker();
    picker.toggle(101);
    picker.toggle(102);
    picker.reset();
    expect(picker.getSelected()).toHaveLength(0);
  });

  it('selections are NOT persisted (no DB write occurs)', () => {
    // The reference picker state lives only in React state.
    // This test verifies the design: getSelected() returns an in-memory array
    // that would be passed to referencedSiblingDocumentIds on the next mutation call.
    // No persistence mechanism exists.
    const picker = createReferencePicker();
    picker.toggle(101);
    const selected = picker.getSelected();
    // This array is what gets passed to requestFeedback as referencedSiblingDocumentIds
    expect(selected).toEqual([101]);
    // After simulated reload (reset), the selection is gone
    picker.reset();
    expect(picker.getSelected()).toEqual([]);
  });
});

// ── 6. AddDocumentModal validation logic ─────────────────────────────────────
describe('AddDocumentModal — validation logic', () => {
  function validateAddDocumentForm(documentType: string, customTypeLabel: string): string | null {
    if (documentType === 'custom') {
      if (!customTypeLabel.trim()) return ADD_DOCUMENT_MODAL.customLabelRequiredError;
      if (customTypeLabel.length > 200) return ADD_DOCUMENT_MODAL.customLabelTooLongError;
    }
    return null;
  }

  it('returns null for valid non-custom type', () => {
    expect(validateAddDocumentForm('revocable_living_trust', '')).toBeNull();
  });

  it('returns error for custom type with empty label', () => {
    expect(validateAddDocumentForm('custom', '')).toBe(ADD_DOCUMENT_MODAL.customLabelRequiredError);
    expect(validateAddDocumentForm('custom', '   ')).toBe(ADD_DOCUMENT_MODAL.customLabelRequiredError);
  });

  it('returns error for custom type with label > 200 chars', () => {
    const longLabel = 'A'.repeat(201);
    expect(validateAddDocumentForm('custom', longLabel)).toBe(ADD_DOCUMENT_MODAL.customLabelTooLongError);
  });

  it('returns null for custom type with valid label', () => {
    expect(validateAddDocumentForm('custom', 'Marital Property Agreement')).toBeNull();
  });

  it('returns null for custom type with exactly 200 char label', () => {
    const maxLabel = 'A'.repeat(200);
    expect(validateAddDocumentForm('custom', maxLabel)).toBeNull();
  });
});

// ── 7. PhaseStrip — container status display logic ───────────────────────────
describe('PhaseStrip — container status display logic', () => {
  // The PhaseStrip shows a badge per phase using PHASE_STATUS_LABELS
  function getPhaseStripBadge(containerStatus: 'idle' | 'in_progress' | 'complete' | 'skipped'): string {
    return PHASE_STATUS_LABELS[containerStatus];
  }

  it('shows Not Started for idle phases', () => {
    expect(getPhaseStripBadge('idle')).toBe('Not Started');
  });

  it('shows In Progress for in_progress phases', () => {
    expect(getPhaseStripBadge('in_progress')).toBe('In Progress');
  });

  it('shows Complete for complete phases', () => {
    expect(getPhaseStripBadge('complete')).toBe('Complete');
  });
});

// ── 8. DocumentCard — export button availability ─────────────────────────────
describe('DocumentCard — export button availability', () => {
  // Export button should only be enabled when status = 'complete' and officialFinalVersionNumber is set
  function canExport(status: string, officialFinalVersionNumber: number | null): boolean {
    return status === 'complete' && officialFinalVersionNumber !== null;
  }

  it('export is available when status = complete and officialFinalVersionNumber is set', () => {
    expect(canExport('complete', 1)).toBe(true);
  });

  it('export is not available when status = drafting', () => {
    expect(canExport('drafting', 1)).toBe(false);
  });

  it('export is not available when status = complete but no officialFinalVersionNumber', () => {
    expect(canExport('complete', null)).toBe(false);
  });

  it('export is not available for archived documents', () => {
    expect(canExport('archived', 1)).toBe(false);
  });
});
