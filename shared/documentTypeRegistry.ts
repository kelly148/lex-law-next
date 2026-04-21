// ── Document Type Registry (v2.4.2) ──────────────────────────────────
// Governs UI labels and grouping only. No prompt hints per v2.4.2 §4.
// Document-type management remains code-config only; no UI for adding/editing types.

export type DocumentCategory = 'trust' | 'will' | 'poa' | 'other' | 'custom';

export interface DocumentTypeDefinition {
  readonly key: string;
  readonly displayName: string;
  readonly category: DocumentCategory;
  readonly iconKey?: string;
}

export const DOCUMENT_TYPE_REGISTRY: readonly DocumentTypeDefinition[] = [
  { key: 'revocable_living_trust',          displayName: 'Revocable Living Trust',                          category: 'trust' },
  { key: 'certification_of_trust',          displayName: 'Certification of Trust',                          category: 'trust' },
  { key: 'assignment_of_personal_property', displayName: 'Assignment of Personal Property',                 category: 'trust' },
  { key: 'pour_over_will',                  displayName: 'Pour-Over Will',                                  category: 'will' },
  { key: 'simple_will',                     displayName: 'Simple Will',                                     category: 'will' },
  { key: 'financial_poa',                   displayName: 'Durable Financial Power of Attorney',             category: 'poa' },
  { key: 'medical_poa',                     displayName: 'Medical Power of Attorney / Advance Directive',   category: 'poa' },
  { key: 'hipaa_authorization',             displayName: 'HIPAA Authorization',                             category: 'poa' },
  { key: 'engagement_letter',               displayName: 'Engagement Letter',                               category: 'other' },
  { key: 'memo',                            displayName: 'Legal Memo',                                      category: 'other' },
  { key: 'matrix',                          displayName: 'Issue Matrix',                                    category: 'other' },
  { key: 'agreement',                       displayName: 'Agreement (generic)',                             category: 'other' },
  { key: 'custom',                          displayName: 'Custom Document',                                 category: 'custom' },
];

export function getDocumentTypeDefinition(key: string): DocumentTypeDefinition | undefined {
  return DOCUMENT_TYPE_REGISTRY.find((def) => def.key === key);
}

export function isValidDocumentTypeKey(key: string): boolean {
  return DOCUMENT_TYPE_REGISTRY.some((def) => def.key === key);
}
