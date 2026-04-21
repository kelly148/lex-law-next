// server/contextBuilder.ts — Context assembly for all LLM calls (v2.3 + v2.4.2 extensions)
// Per v2.3 §13 and v2.4.2 §6.
//
// v2.4.2 changes:
//   1. New sibling-document section (§6.2) inserted at position 6 in context ordering.
//   2. Token budget reallocation: role-specific content reduced from 50k → 40k;
//      sibling-document section gets 30k budget.
//   3. Context ordering extended per §6.3 (7 sections, up from 6).
//   4. Document-level notes added to attorney notes section.
//
// v2.3 budgets (preserved):
//   System prompt: 3,000 | Metadata: 500 | Prior phase outputs: 30,000
//   File contents: 80,000 | Attorney notes: 5,000 | Safety margin: 10,000
//
// v2.4.2 budget change:
//   Role-specific content: 50,000 → 40,000 (10k reallocated to sibling section)
//   Sibling documents: 0 → 30,000 (new)
//   Total target: ≤ 200,000 (up from 180,000 due to sibling addition)

import { accumulateWithBudget, estimateTokens } from './tokens';
import {
  getDocumentById,
  listDocuments,
  getVersionByNumber,
  collectPriorPhaseOutputs,
  getUploadsByPhase,
  getPhase,
} from './db';
import { getDocumentTypeDefinition } from '../shared/documentTypeRegistry';
import { emitTelemetry } from '../shared/telemetry';
import type { Document } from '../drizzle/schema';

// ── Token budgets ─────────────────────────────────────────────────────
export const TOKEN_BUDGETS = {
  systemPrompt: 3_000,
  metadata: 500,
  priorPhaseOutputs: 30_000,
  fileContents: 80_000,
  attorneyNotes: 5_000,
  siblingDocuments: 30_000,   // v2.4.2 new section
  roleSpecific: 40_000,       // v2.3 was 50,000; 10k reallocated to sibling section
  safetyMargin: 10_000,
} as const;

// NOTE: The spec §6.4 table states ≤200,000 total, but the individual line items sum to
// 198,500 (3k+0.5k+30k+80k+5k+30k+40k+10k). The 1.5k gap is a spec table rounding error.
// We use the actual sum of TOKEN_BUDGETS as the authoritative target.
export const TOTAL_BUDGET_TARGET = 198_500;

// ── Category ordering for sibling documents (§6.3) ───────────────────
const CATEGORY_ORDER: Record<string, number> = {
  trust: 0,
  will: 1,
  poa: 2,
  other: 3,
  custom: 4,
};

function siblingCategoryOrder(doc: Document): number {
  const def = getDocumentTypeDefinition(doc.documentType);
  return CATEGORY_ORDER[def?.category ?? 'custom'] ?? 4;
}

// ── Sibling document resolution result ───────────────────────────────
export interface SiblingResolutionResult {
  /** Formatted sibling context string (may be empty string if all skipped). */
  siblingSection: string;
  /** Documents that were skipped because they had no officialFinalVersionNumber. */
  siblingsSkipped: Array<{ documentId: number; reason: 'not_yet_accepted' }>;
  /** Documents that were included. */
  siblingsIncluded: Array<{ documentId: number; documentType: string }>;
}

/**
 * Resolve sibling document references for a drafting call.
 * Per v2.4.2 §6.2 and §6.3.
 *
 * - Silently skips siblings with no officialFinalVersionNumber.
 * - Orders included siblings by category (trust → will → POA → other → custom),
 *   then by document creation order within category.
 * - Applies the 30k token budget using the same accumulate-and-omit pattern.
 * - Emits sibling_reference_included / sibling_reference_skipped telemetry.
 */
export async function resolveSiblingDocuments(
  matterId: string,
  currentDocumentId: number,
  referencedSiblingDocumentIds: number[],
): Promise<SiblingResolutionResult> {
  if (referencedSiblingDocumentIds.length === 0) {
    return { siblingSection: '', siblingsSkipped: [], siblingsIncluded: [] };
  }

  const siblingsSkipped: Array<{ documentId: number; reason: 'not_yet_accepted' }> = [];
  const candidateDocs: Array<{ doc: Document; content: string }> = [];

  // Load each referenced sibling in parallel.
  const loaded = await Promise.all(
    referencedSiblingDocumentIds.map(id => getDocumentById(id)),
  );

  for (const doc of loaded) {
    if (!doc || doc.id === currentDocumentId) continue;

    if (!doc.officialFinalVersionNumber) {
      siblingsSkipped.push({ documentId: doc.id, reason: 'not_yet_accepted' });
      emitTelemetry({
        kind: 'sibling_reference_skipped',
        matterId,
        documentId: currentDocumentId,
        siblingDocumentId: doc.id,
        reason: 'not_yet_accepted',
      });
      continue;
    }

    // Load the accepted version content.
    const version = await getVersionByNumber(
      doc.matterId,
      doc.phaseName,
      doc.officialFinalVersionNumber,
    );
    if (!version?.content) {
      siblingsSkipped.push({ documentId: doc.id, reason: 'not_yet_accepted' });
      continue;
    }

    candidateDocs.push({ doc, content: version.content });
  }

  // Sort by category order, then by creation order (id ascending).
  candidateDocs.sort((a, b) => {
    const catDiff = siblingCategoryOrder(a.doc) - siblingCategoryOrder(b.doc);
    if (catDiff !== 0) return catDiff;
    return a.doc.id - b.doc.id;
  });

  // Apply token budget.
  const items = candidateDocs.map(({ doc, content }) => {
    const typeDef = getDocumentTypeDefinition(doc.documentType);
    const typeLabel = doc.documentType === 'custom'
      ? (doc.customTypeLabel ?? 'Custom Document')
      : (typeDef?.displayName ?? doc.documentType);
    return {
      label: `--- SIBLING DOCUMENT: ${doc.title} (${typeLabel}) ---`,
      content,
      doc,
    };
  });

  const { accumulated, omitted } = accumulateWithBudget(
    items,
    TOKEN_BUDGETS.siblingDocuments,
  );

  const siblingsIncluded: Array<{ documentId: number; documentType: string }> = [];
  for (const item of items) {
    if (!omitted.includes(item.label)) {
      siblingsIncluded.push({ documentId: item.doc.id, documentType: item.doc.documentType });
      emitTelemetry({
        kind: 'sibling_reference_included',
        matterId,
        documentId: currentDocumentId,
        siblingDocumentId: item.doc.id,
        siblingDocumentType: item.doc.documentType,
      });
    }
  }

  return {
    siblingSection: accumulated,
    siblingsSkipped,
    siblingsIncluded,
  };
}

// ── Main context builder ──────────────────────────────────────────────

export interface BuildContextInput {
  matterId: string;
  phaseName: string;
  /** Present for document-scoped calls (model-3); absent for phase-scoped calls (model-2). */
  documentId?: number;
  /** Sibling document IDs to include (model-3 only; ignored for model-2). */
  referencedSiblingDocumentIds?: number[];
  /** Role-specific content (target draft, feedback, decisions, etc.). */
  roleSpecificContent: string;
  /** Attorney notes at the matter/phase level. */
  phaseNotes?: string;
  /** Attorney notes at the document level (v2.4.2 only). */
  documentNotes?: string;
  /** System prompt for this role. */
  systemPrompt?: string;
  /** Additional metadata string (document type, title, etc.). */
  extraMetadata?: string;
}

export interface BuildContextResult {
  /** The assembled context string to send to the LLM. */
  context: string;
  /** Sibling resolution result (only populated for document-scoped calls). */
  siblingResult?: SiblingResolutionResult;
  /** Whether any section was truncated. */
  truncated: boolean;
}

/**
 * Build the full LLM context for a drafting, review, evaluation, or regeneration call.
 * Per v2.4.2 §6.3 context ordering (7 sections).
 *
 * Section order:
 *   1. System prompt
 *   2. Phase + matter metadata
 *   3. Prior phase outputs (intake, issues, planning)
 *   4. Extracted file contents
 *   5. Attorney notes (matter-level, phase-level, document-level)
 *   6. Referenced sibling documents [v2.4.2 new]
 *   7. Role-specific content
 */
export async function buildContext(input: BuildContextInput): Promise<BuildContextResult> {
  const {
    matterId,
    phaseName,
    documentId,
    referencedSiblingDocumentIds = [],
    roleSpecificContent,
    phaseNotes,
    documentNotes,
    systemPrompt,
    extraMetadata,
  } = input;

  const sections: string[] = [];
  let truncated = false;

  // ── Section 1: System prompt ─────────────────────────────────────
  if (systemPrompt) {
    const { accumulated, truncated: t } = accumulateWithBudget(
      [{ label: '', content: systemPrompt }],
      TOKEN_BUDGETS.systemPrompt,
    );
    sections.push(accumulated);
    if (t) truncated = true;
  }

  // ── Section 2: Phase + matter metadata ───────────────────────────
  const metaParts = [`Matter: ${matterId}`, `Phase: ${phaseName}`];
  if (extraMetadata) metaParts.push(extraMetadata);
  const metaStr = metaParts.join('\n');
  sections.push(metaStr.slice(0, TOKEN_BUDGETS.metadata * 3)); // 3 chars/token

  // ── Section 3: Prior phase outputs ───────────────────────────────
  const priorOutputs = await collectPriorPhaseOutputs(matterId, phaseName);
  if (priorOutputs) {
    const { accumulated, truncated: t } = accumulateWithBudget(
      [{ label: '=== PRIOR PHASE OUTPUTS ===', content: priorOutputs }],
      TOKEN_BUDGETS.priorPhaseOutputs,
    );
    sections.push(accumulated);
    if (t) truncated = true;
  }

  // ── Section 4: Extracted file contents ───────────────────────────
  const uploads = await getUploadsByPhase(matterId, phaseName);
  if (uploads.length > 0) {
    const fileItems = uploads
      .filter(u => u.extractedText)
      .map(u => ({ label: `--- FILE: ${u.fileName} ---`, content: u.extractedText! }));
    if (fileItems.length > 0) {
      const { accumulated, truncated: t } = accumulateWithBudget(
        fileItems,
        TOKEN_BUDGETS.fileContents,
      );
      sections.push(accumulated);
      if (t) truncated = true;
    }
  }

  // ── Section 5: Attorney notes ─────────────────────────────────────
  const noteParts: string[] = [];
  if (phaseNotes) noteParts.push(`Phase notes: ${phaseNotes}`);
  if (documentNotes) noteParts.push(`Document notes: ${documentNotes}`);
  if (noteParts.length > 0) {
    const { accumulated, truncated: t } = accumulateWithBudget(
      [{ label: '=== ATTORNEY NOTES ===', content: noteParts.join('\n') }],
      TOKEN_BUDGETS.attorneyNotes,
    );
    sections.push(accumulated);
    if (t) truncated = true;
  }

  // ── Section 6: Referenced sibling documents [v2.4.2] ─────────────
  let siblingResult: SiblingResolutionResult | undefined;
  if (documentId && referencedSiblingDocumentIds.length > 0) {
    siblingResult = await resolveSiblingDocuments(
      matterId,
      documentId,
      referencedSiblingDocumentIds,
    );
    if (siblingResult.siblingSection) {
      sections.push(`=== SIBLING DOCUMENTS ===\n${siblingResult.siblingSection}`);
    }
  }

  // ── Section 7: Role-specific content ─────────────────────────────
  const { accumulated: roleAccumulated, truncated: roleT } = accumulateWithBudget(
    [{ label: '=== TARGET CONTENT ===', content: roleSpecificContent }],
    TOKEN_BUDGETS.roleSpecific,
  );
  sections.push(roleAccumulated);
  if (roleT) truncated = true;

  return {
    context: sections.filter(Boolean).join('\n\n---\n\n'),
    siblingResult,
    truncated,
  };
}
