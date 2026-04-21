/**
 * shared/strings.ts
 *
 * Centralised UI string catalog per v1.3 Phase 3 discipline.
 * No internal state names in JSX — all user-facing labels live here.
 * v2.4.2 additions are marked with [v2.4.2].
 */

// ── Phase status labels (container status) ─────────────────────────────────
export const PHASE_STATUS_LABELS = {
  idle: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  skipped: "Skipped",
} as const;

// ── Document status badges [v2.4.2] ────────────────────────────────────────
export const DOCUMENT_STATUS_LABELS = {
  drafting: "Drafting",
  complete: "Complete",
  archived: "Archived",
} as const;

// ── Document type category headers [v2.4.2] ────────────────────────────────
export const DOCUMENT_CATEGORY_LABELS = {
  Trust: "Trust",
  Will: "Will",
  POA: "Power of Attorney",
  Other: "Other",
  Custom: "Custom",
} as const;

// ── Matter dashboard [v2.4.2] ──────────────────────────────────────────────
export const DASHBOARD = {
  headerTitle: "Matter Dashboard",
  phaseStripLabel: "Phases",
  overallStatusLabel: "Overall Status",
  addDocumentButton: "Add document",
  showArchivedToggle: "Show archived",
  hideArchivedToggle: "Hide archived",
  noDocumentsYet: "No documents yet",
  noDocumentsCtaButton: "Add document",
  documentCount: (n: number) => (n === 1 ? "1 document" : `${n} documents`),
} as const;

// ── Document card labels [v2.4.2] ──────────────────────────────────────────
export const DOCUMENT_CARD = {
  downloadDocxButton: "Download DOCX",
  iterationLabel: (iteration: number, cycle: number) =>
    `Iteration ${iteration}, Cycle ${cycle}`,
  formattingReviewBanner: "Formatting review pending",
  waitingOnClientBanner: "Waiting on client",
  lastUpdatedLabel: "Last updated",
} as const;

// ── Add-document modal labels [v2.4.2] ─────────────────────────────────────
export const ADD_DOCUMENT_MODAL = {
  title: "Add Document",
  typePickerLabel: "Document type",
  customLabelInputLabel: "Custom document label",
  customLabelInputPlaceholder: "e.g. Marital Property Agreement",
  customLabelRequiredError: "A label is required for custom document types.",
  customLabelTooLongError: "Label must be 200 characters or fewer.",
  titleInputLabel: "Title (optional)",
  titleInputPlaceholder: "Defaults to document type name",
  notesInputLabel: "Notes (optional)",
  notesInputPlaceholder: "Attorney-level notes for this document",
  createButton: "Create document",
  cancelButton: "Cancel",
  creatingButton: "Creating…",
} as const;

// ── Document detail view [v2.4.2] ──────────────────────────────────────────
export const DOCUMENT_DETAIL = {
  breadcrumbSeparator: "›",
  backToMatterLabel: "Back to matter",
  titleEditPlaceholder: "Document title",
  notesEditPlaceholder: "Document-level notes",
  referencePickerTitle: "Sibling references",
  referencePickerDescription:
    "Select documents to include as context for this draft. Selections reset on page reload.",
  referencePickerEmptyState: "No other documents in this matter yet.",
  referencePickerCollapseLabel: "Hide references",
  referencePickerExpandLabel: "Show references",
  downloadDocxButton: "Download DOCX",
  exportingButton: "Exporting…",
} as const;

// ── Skipped-sibling banner [v2.4.2] ────────────────────────────────────────
export const SIBLING_SKIP_BANNER = {
  message: (n: number) =>
    `${n} sibling reference${n === 1 ? "" : "s"} were skipped (not yet accepted).`,
  dismissLabel: "Dismiss",
} as const;

// ── General / shared ───────────────────────────────────────────────────────
export const GENERAL = {
  loading: "Loading…",
  error: "Something went wrong.",
  retry: "Retry",
  save: "Save",
  cancel: "Cancel",
  close: "Close",
  confirm: "Confirm",
} as const;
