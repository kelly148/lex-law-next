/**
 * Context builder for iterative_review LLM calls.
 *
 * Assembles the full user prompt per v2.3 §13 ordering and budget-based truncation.
 * Most-recent-first sorting ensures the most relevant context is preserved.
 */

import { estimateTokens, truncateToTokenBudget } from './tokens';
import type { PhaseName } from '../shared/workflow';

const BUDGETS = {
  priorPhases: 30_000,
  files: 80_000,
  attorneyNotes: 5_000,
  roleSpecific: 50_000,
} as const;

export interface BuildContextInput {
  matterId: string;
  phaseName: PhaseName;
  priorPhaseOutputs: Array<{ phaseName: string; label: string; content: string; updatedAt: Date }>;
  fileUploads: Array<{ fileName: string; extractedText: string; uploadedAt: Date }>;
  attorneyNotes: string;
  role: 'generator' | 'reviewer' | 'evaluator' | 'regenerator' | 'formatter';
  roleContent: string;
}

export function buildUserPrompt(input: BuildContextInput): string {
  const sections: string[] = [];

  // Section 1: Phase + matter metadata
  sections.push(`Phase: ${input.phaseName}`);
  sections.push(`Matter: ${input.matterId}`);

  // Section 2: Prior phase outputs (most-recent-first)
  const sortedPhases = [...input.priorPhaseOutputs].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );
  const priorPhaseText = accumulateWithBudget(
    sortedPhases.map(p => ({
      key: p.phaseName,
      label: p.label,
      content: `=== ${p.label} ===\n${p.content}`,
    })),
    BUDGETS.priorPhases,
    'phase'
  );
  if (priorPhaseText) sections.push(priorPhaseText);

  // Section 3: Extracted file contents (most-recent-first)
  const sortedFiles = [...input.fileUploads].sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
  );
  const filesText = accumulateWithBudget(
    sortedFiles.map(f => ({
      key: f.fileName,
      label: f.fileName,
      content: `=== ${f.fileName} ===\n${f.extractedText}`,
    })),
    BUDGETS.files,
    'file'
  );
  if (filesText) sections.push(filesText);

  // Section 4: Attorney notes
  if (input.attorneyNotes) {
    sections.push(`Attorney Notes:\n${truncateToTokenBudget(input.attorneyNotes, BUDGETS.attorneyNotes)}`);
  }

  // Section 5: Role-specific content
  sections.push(truncateToTokenBudget(input.roleContent, BUDGETS.roleSpecific));

  return sections.join('\n\n---\n\n');
}

export function accumulateWithBudget(
  items: Array<{ key: string; label: string; content: string }>,
  budget: number,
  itemKind: 'phase' | 'file'
): string {
  const accumulated: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  let truncatedAtIndex = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemTokens = estimateTokens(item.content);
    if (used + itemTokens <= budget) {
      accumulated.push(item.content);
      used += itemTokens;
    } else {
      const remaining = budget - used;
      if (remaining > 200) {
        accumulated.push(truncateToTokenBudget(
          item.content,
          remaining,
          `[TRUNCATED AT LIMIT: ${item.key}]`
        ));
        used = budget;
        truncatedAtIndex = i;
      }
      // Everything from this index on is omitted (including this one if too small to truncate usefully)
      const start = truncatedAtIndex === i ? i + 1 : i;
      for (let j = start; j < items.length; j++) {
        omitted.push(items[j].key);
      }
      break;
    }
  }

  if (omitted.length > 0) {
    const label = itemKind === 'phase' ? 'older phases' : 'older files';
    accumulated.push(`[${omitted.length} ${label} omitted: ${omitted.join(', ')}]`);
  }

  return accumulated.join('\n\n');
}
