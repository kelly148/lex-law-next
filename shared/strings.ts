/**
 * shared/strings.ts
 * Canonical user-facing string catalog per v2.3 §23.
 *
 * RULE: Internal state names (e.g. "awaiting_feedback_action") MUST NOT
 * appear in component JSX. Use these constants instead.
 */

// ── State labels (shown in badges / page headings) ──────────────────────────
export const STATE_LABELS = {
  awaiting_attorney_review: "Review draft",
  awaiting_feedback_action: "Review feedback",
  awaiting_manual_decisions: "Select changes",
  awaiting_evaluation_decisions: "Review recommendations",
  evaluating_feedback: "Evaluating feedback...",
  awaiting_reviews: "Reviewing...",
  regenerating: "Generating new version...",
} as const;

// ── Loading / transient state messages ──────────────────────────────────────
export const LOADING_LABELS = {
  reviewing: "Independent reviewers are analyzing the draft...",
  evaluatingFeedback: "Evaluating reviewer feedback...",
  regenerating: "Generating a new version based on your decisions...",
} as const;

// ── Action button labels ─────────────────────────────────────────────────────
export const BUTTON_LABELS = {
  /** phase.requestFeedback */
  getFeedback: "Get feedback",
  /** phase.evaluateFeedback — opens evaluator picker */
  getAiEvaluation: "Get AI evaluation",
  /** Manual path entry */
  pickManually: "Pick manually",
  /** phase.submitEvaluationDecisions */
  regenerateWithDecisions: "Regenerate with these decisions",
  /** phase.submitManualDecisions */
  regenerateWithSelections: "Regenerate with selected changes",
  /** phase.acceptIterativeVersion */
  acceptAndFinalize: "Accept & finalize",
  /** phase.requestRevision */
  reviseWithNotes: "Revise with my notes",
  /** phase.restartWithDifferentModel */
  startFreshWithDifferentModel: "Start fresh with different model",
  /** phase.rejectFormatting({ kind: 'format_only' }) */
  rejectFormatting: "Reject formatting",
  /** phase.rejectFormatting({ kind: 'substantive' }) */
  needsSubstantiveChange: "Needs substantive change",
  /** phase.acceptSubstantiveUnformatted */
  acceptWithoutFormatting: "Accept without formatting",
} as const;

// ── Confirmation dialog copy ─────────────────────────────────────────────────
export const CONFIRM_LABELS = {
  restartTitle: "Start fresh with different model?",
  restartBody: "Current cycle will be archived. Start new cycle?",
  restartConfirm: "Start new cycle",
  restartCancel: "Cancel",
} as const;

// ── Unresolved anchors banner ────────────────────────────────────────────────
/**
 * Returns the banner text for unresolved anchors.
 * @param unresolved Number of anchors that could not be applied.
 * @param total Total number of anchors attempted.
 */
export function unresolvedAnchorsBanner(unresolved: number, total: number): string {
  return `${unresolved} of ${total} changes could not be applied automatically.`;
}

export const UNRESOLVED_ANCHORS_LINK = "View details";

// ── Conflict / error messages ────────────────────────────────────────────────
export const ERROR_LABELS = {
  conflict: "Another operation is in progress. Please refresh.",
  networkOffline: "You appear to be offline. Please check your connection.",
  generic: "Something went wrong. Please try again.",
} as const;
