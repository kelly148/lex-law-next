import { describe, it, expect } from 'vitest';
import { buildUserPrompt, accumulateWithBudget, type BuildContextInput } from './contextBuilder';

function makeInput(overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  return {
    matterId: 'test-matter-1',
    phaseName: 'engagement',
    priorPhaseOutputs: [],
    fileUploads: [],
    attorneyNotes: '',
    role: 'generator',
    roleContent: 'Generate the engagement letter.',
    ...overrides,
  };
}

describe('buildUserPrompt', () => {
  it('includes phase and matter metadata first', () => {
    const result = buildUserPrompt(makeInput());
    const lines = result.split('\n');
    expect(lines[0]).toBe('Phase: engagement');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('---');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('Matter: test-matter-1');
  });

  it('includes role content at the end', () => {
    const result = buildUserPrompt(makeInput());
    expect(result).toContain('Generate the engagement letter.');
    // Role content should be the last section
    const sections = result.split('\n\n---\n\n');
    expect(sections[sections.length - 1]).toBe('Generate the engagement letter.');
  });

  it('sorts prior phase outputs most-recent-first', () => {
    const result = buildUserPrompt(makeInput({
      priorPhaseOutputs: [
        { phaseName: 'intake', label: 'Intake', content: 'Intake output', updatedAt: new Date('2025-01-01') },
        { phaseName: 'issues', label: 'Issues', content: 'Issues output', updatedAt: new Date('2025-06-01') },
        { phaseName: 'planning', label: 'Planning', content: 'Planning output', updatedAt: new Date('2025-03-01') },
      ],
    }));
    // Issues (June) should appear before Planning (March) before Intake (January)
    const issuesIdx = result.indexOf('=== Issues ===');
    const planningIdx = result.indexOf('=== Planning ===');
    const intakeIdx = result.indexOf('=== Intake ===');
    expect(issuesIdx).toBeLessThan(planningIdx);
    expect(planningIdx).toBeLessThan(intakeIdx);
  });

  it('sorts file uploads most-recent-first', () => {
    const result = buildUserPrompt(makeInput({
      fileUploads: [
        { fileName: 'old.pdf', extractedText: 'Old content', uploadedAt: new Date('2025-01-01') },
        { fileName: 'new.pdf', extractedText: 'New content', uploadedAt: new Date('2025-06-01') },
      ],
    }));
    const newIdx = result.indexOf('=== new.pdf ===');
    const oldIdx = result.indexOf('=== old.pdf ===');
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('includes attorney notes when provided', () => {
    const result = buildUserPrompt(makeInput({
      attorneyNotes: 'Please focus on liability clauses.',
    }));
    expect(result).toContain('Attorney Notes:');
    expect(result).toContain('Please focus on liability clauses.');
  });

  it('omits attorney notes section when empty', () => {
    const result = buildUserPrompt(makeInput({ attorneyNotes: '' }));
    expect(result).not.toContain('Attorney Notes:');
  });

  it('section ordering matches spec §13.2: metadata → phases → files → notes → role', () => {
    const result = buildUserPrompt(makeInput({
      priorPhaseOutputs: [
        { phaseName: 'intake', label: 'Intake', content: 'Intake output', updatedAt: new Date('2025-01-01') },
      ],
      fileUploads: [
        { fileName: 'doc.pdf', extractedText: 'File content', uploadedAt: new Date('2025-01-01') },
      ],
      attorneyNotes: 'Attorney note here.',
      roleContent: 'Role content here.',
    }));
    const phaseIdx = result.indexOf('Phase: engagement');
    const matterIdx = result.indexOf('Matter: test-matter-1');
    const priorIdx = result.indexOf('=== Intake ===');
    const fileIdx = result.indexOf('=== doc.pdf ===');
    const notesIdx = result.indexOf('Attorney Notes:');
    const roleIdx = result.indexOf('Role content here.');

    expect(phaseIdx).toBeLessThan(matterIdx);
    expect(matterIdx).toBeLessThan(priorIdx);
    expect(priorIdx).toBeLessThan(fileIdx);
    expect(fileIdx).toBeLessThan(notesIdx);
    expect(notesIdx).toBeLessThan(roleIdx);
  });
});

describe('accumulateWithBudget', () => {
  it('includes all items when within budget', () => {
    const items = [
      { key: 'a', label: 'A', content: 'Short content A' },
      { key: 'b', label: 'B', content: 'Short content B' },
    ];
    const result = accumulateWithBudget(items, 100_000, 'phase');
    expect(result).toContain('Short content A');
    expect(result).toContain('Short content B');
    expect(result).not.toContain('omitted');
  });

  it('truncates and lists omitted items when budget exceeded', () => {
    const longContent = 'x'.repeat(90_000); // ~30,000 tokens
    const items = [
      { key: 'big', label: 'Big', content: longContent },
      { key: 'small1', label: 'Small 1', content: 'Small content 1' },
      { key: 'small2', label: 'Small 2', content: 'Small content 2' },
    ];
    const result = accumulateWithBudget(items, 30_000, 'phase');
    // big should be included (fills budget)
    // small1 and small2 should be omitted
    expect(result).toContain('[2 older phases omitted: small1, small2]');
  });

  it('uses file label for omitted files', () => {
    const longContent = 'x'.repeat(90_000);
    const items = [
      { key: 'big.pdf', label: 'Big', content: longContent },
      { key: 'extra.pdf', label: 'Extra', content: 'Extra content' },
    ];
    const result = accumulateWithBudget(items, 30_000, 'file');
    expect(result).toContain('older files omitted');
  });

  it('truncation marker includes the item key', () => {
    const items = [
      { key: 'phase_a', label: 'Phase A', content: 'x'.repeat(120_000) }, // ~40k tokens, over 30k budget
    ];
    const result = accumulateWithBudget(items, 30_000, 'phase');
    expect(result).toContain('[TRUNCATED AT LIMIT: phase_a]');
  });

  it('returns empty string for empty items', () => {
    const result = accumulateWithBudget([], 30_000, 'phase');
    expect(result).toBe('');
  });

  it('partially truncates an item when remaining budget > 200 tokens', () => {
    // First item uses most of the budget, second gets partially truncated
    const items = [
      { key: 'a', label: 'A', content: 'x'.repeat(60_000) }, // ~20k tokens
      { key: 'b', label: 'B', content: 'y'.repeat(90_000) }, // ~30k tokens, won't fully fit in remaining 10k
    ];
    const result = accumulateWithBudget(items, 30_000, 'phase');
    expect(result).toContain('x'.repeat(100)); // first item present
    expect(result).toContain('y'); // second item partially present
    expect(result).toContain('[TRUNCATED AT LIMIT: b]');
  });
});
