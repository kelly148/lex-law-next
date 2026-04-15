// Canonical workflow constants shared between client and server

export const PHASE_NAMES = [
  "intake", "issues", "planning", "engagement", "memo", "matrix", "agreement",
] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export const PHASE_LABELS: Record<PhaseName, string> = {
  intake: "Intake",
  issues: "Issues",
  planning: "Planning",
  engagement: "Engagement Letter",
  memo: "Advisory Memo",
  matrix: "Decision Matrix",
  agreement: "Agreement",
};

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

export const WORKFLOW_STATES = [
  "idle", "drafting", "awaiting_selection", "reviewing", "evaluating",
  "awaiting_decisions", "regenerating", "complete",
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const PROVIDERS = [
  { name: "Claude", key: "claude", enabled: true },
  { name: "GPT-5.4", key: "gpt", enabled: true },
  { name: "Gemini", key: "gemini", enabled: true },
  { name: "Grok", key: "grok", enabled: false },
] as const;

export type ProviderKey = "claude" | "gpt" | "gemini" | "grok";

export const ENABLED_PROVIDERS = PROVIDERS.filter(p => p.enabled);
