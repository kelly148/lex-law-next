// Canonical workflow constants shared between client and server

// ── Phase Names & Order ─────────────────────────────────────────────
export const PHASE_NAMES = [
  "intake", "issues", "planning", "engagement", "memo", "matrix", "agreement",
] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export const PHASE_ORDER: Record<PhaseName, number> = {
  intake: 1,
  issues: 2,
  planning: 3,
  engagement: 4,
  memo: 5,
  matrix: 6,
  agreement: 7,
};

export const OPTIONAL_PHASES: PhaseName[] = ["memo", "matrix"];

// ── Stages ──────────────────────────────────────────────────────────
export const STAGES = ["analysis", "document_generation"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  analysis: "Analysis",
  document_generation: "Document Generation",
};

// ── Workflow Modes ──────────────────────────────────────────────────
export const WORKFLOW_MODES = [
  "single_model",
  "competitive_select",
  "single_model_draft",
  "full_competitive",
] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const WORKFLOW_MODE_LABELS: Record<WorkflowMode, string> = {
  single_model: "Single Model",
  competitive_select: "Compare & Select",
  single_model_draft: "Simple Draft",
  full_competitive: "Full Recursive Review",
};

export const WORKFLOW_MODE_DESCRIPTIONS: Record<WorkflowMode, string> = {
  single_model: "One model processes the source materials. No review.",
  competitive_select: "All enabled models produce output. You select the best one.",
  single_model_draft: "One model drafts, you review and revise.",
  full_competitive: "All models draft competitively, then review and iterate.",
};

// ── Workflow States ─────────────────────────────────────────────────
export const WORKFLOW_STATES = [
  "idle",
  "model_selection",
  "processing",
  "drafting",
  "awaiting_selection",
  "awaiting_attorney_review",
  "revising",
  "reviewing",
  "evaluating",
  "awaiting_decisions",
  "regenerating",
  "accepted",
  "formatting",
  "awaiting_format_review",
  "complete",
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

// ── Phase Status ────────────────────────────────────────────────────
export const PHASE_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "skipped",
  "waiting_on_client",
] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

// ── Phase Configuration ─────────────────────────────────────────────
export interface PhaseConfig {
  name: PhaseName;
  label: string;
  stage: Stage;
  order: number;
  defaultMode: WorkflowMode;
  escalatable: boolean;
  /** Modes available when escalatable is true */
  availableModes: WorkflowMode[];
  hasFormattingPass: boolean;
  isOptional: boolean;
}

export const PHASE_CONFIG: Record<PhaseName, PhaseConfig> = {
  intake: {
    name: "intake",
    label: "Intake",
    stage: "analysis",
    order: 1,
    defaultMode: "single_model",
    escalatable: false,
    availableModes: ["single_model"],
    hasFormattingPass: false,
    isOptional: false,
  },
  issues: {
    name: "issues",
    label: "Issues",
    stage: "analysis",
    order: 2,
    defaultMode: "single_model",
    escalatable: false,
    availableModes: ["single_model"],
    hasFormattingPass: false,
    isOptional: false,
  },
  planning: {
    name: "planning",
    label: "Planning",
    stage: "analysis",
    order: 3,
    defaultMode: "competitive_select",
    escalatable: false,
    availableModes: ["competitive_select"],
    hasFormattingPass: false,
    isOptional: false,
  },
  engagement: {
    name: "engagement",
    label: "Engagement Letter",
    stage: "document_generation",
    order: 4,
    defaultMode: "single_model_draft",
    escalatable: true,
    availableModes: ["single_model_draft", "competitive_select", "full_competitive"],
    hasFormattingPass: false,
    isOptional: false,
  },
  memo: {
    name: "memo",
    label: "Advisory Memo",
    stage: "document_generation",
    order: 5,
    defaultMode: "single_model_draft",
    escalatable: true,
    availableModes: ["single_model_draft", "competitive_select", "full_competitive"],
    hasFormattingPass: false,
    isOptional: true,
  },
  matrix: {
    name: "matrix",
    label: "Decision Matrix",
    stage: "document_generation",
    order: 6,
    defaultMode: "single_model_draft",
    escalatable: true,
    availableModes: ["single_model_draft", "competitive_select", "full_competitive"],
    hasFormattingPass: false,
    isOptional: true,
  },
  agreement: {
    name: "agreement",
    label: "Final Legal Document",
    stage: "document_generation",
    order: 7,
    defaultMode: "full_competitive",
    escalatable: false,
    availableModes: ["full_competitive"],
    hasFormattingPass: true,
    isOptional: false,
  },
};

// Convenience: old PHASE_LABELS derived from PHASE_CONFIG
export const PHASE_LABELS: Record<PhaseName, string> = Object.fromEntries(
  PHASE_NAMES.map((name) => [name, PHASE_CONFIG[name].label])
) as Record<PhaseName, string>;

// ── Providers ───────────────────────────────────────────────────────
export const PROVIDERS = [
  { name: "Claude", key: "claude", model: "claude-sonnet-4-6", enabled: true },
  { name: "GPT-5.4", key: "gpt", model: "gpt-5.4", enabled: true },
  { name: "Gemini", key: "gemini", model: "gemini-2.5-pro", enabled: true },
  { name: "Grok", key: "grok", model: "grok-3", enabled: false },
] as const;

export type ProviderKey = "claude" | "gpt" | "gemini" | "grok";

export const ENABLED_PROVIDERS = PROVIDERS.filter(p => p.enabled);

// ── Phase Gate Helpers ──────────────────────────────────────────────

/**
 * Check if a phase can start based on prerequisite completion.
 * Only "completed" status satisfies prerequisites.
 * "waiting_on_client" does NOT satisfy prerequisites.
 * Skipped optional phases are treated as satisfied.
 */
export function canStartPhase(
  phaseName: PhaseName,
  allPhases: Array<{ phaseName: string; status: string; isOptional: number }>,
): boolean {
  const config = PHASE_CONFIG[phaseName];
  if (!config) return false;

  // Check all prior phases
  for (const prior of PHASE_NAMES) {
    if (PHASE_ORDER[prior] >= PHASE_ORDER[phaseName]) break;

    const priorPhase = allPhases.find(p => p.phaseName === prior);
    if (!priorPhase) return false;

    // Skipped optional phases are OK
    if (priorPhase.status === "skipped" && priorPhase.isOptional) continue;

    // Only "completed" satisfies prerequisites — NOT "waiting_on_client"
    if (priorPhase.status !== "completed") return false;
  }

  return true;
}

// ── Formatting Pass Prompt ──────────────────────────────────────────
export const FORMATTING_PASS_PROMPT = `FINAL STYLE & FORMATTING PASS — The Satterwhite Law Firm

Apply a complete AmLaw 100 professional finishing pass to the attached
document. Do not alter substantive legal content. Apply the following
firm standards:

Typography & Layout

* Body text: Times New Roman 12pt, fully justified
* Headings: Calibri bold, navy (#1F3864), with gold (#BF8F00) bottom-rule dividers
* Section numbering: consistent and sequential throughout
* Spacing: consistent before/after headings; no orphaned headings; no widows or rivers

Header / Footer

* Running header: document title or "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED" as appropriate
* Footer: The Satterwhite Law Firm, PLLC • 703-855-7380 • Page [X]
* Firm logo on cover page and letterhead where applicable

Privilege Footer Rule

* Retain privilege footer on documents staying with the client (engagement letters, trusts, wills, POAs, internal memos)
* Omit privilege footer on documents shared with third parties (deeds, gift letters, settlement documents, instruction letters, acknowledgments)

Tables

* Navy header rows, white header text, Calibri bold
* Alternating light-gray row shading on data rows
* Thin borders throughout; column widths rationalized for readability

Signature Blocks

* Preparer block: Kelly Satterwhite, Esq. | VSB No. 91049 | The Satterwhite Law Firm, PLLC | 703-855-7380
* Signature lines: clean, consistent formatting with date lines
* Entity identification correct for matter type (Satterwhite Law Firm for T&E/business; Mason Law Firm for real estate/QI)

Placeholders (templates only)

* All variable fields in [[DOUBLE BRACKET]] format with yellow highlight
* Red italic drafter notes at all decision points and optional provisions
* Fill-In Checklist at document top in red text; marked for deletion before client delivery

Final Check

* Internal consistency: defined terms used consistently throughout; cross-references accurate
* No duplicate words, stray punctuation, or formatting artifacts
* Section and exhibit references correct
* Document is execution-ready (or template-ready, as applicable)

Deliver the finished document. Flag any substantive issues, ambiguities,
or open decisions noticed during the pass — do not resolve them unilaterally.`;
