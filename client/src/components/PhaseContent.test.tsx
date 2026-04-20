/**
 * PhaseContent.test.tsx
 *
 * Tests for the iterative state branches added in Phase 3 §3.3.5.
 * Verifies the Option A mode-guard pattern: same workflowState renders
 * different UI depending on activeWorkflowMode.
 *
 * These are pure rendering tests — no server calls are made.
 * tRPC calls are mocked via vi.mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ── Mock tRPC ────────────────────────────────────────────────────────────────
vi.mock("@/lib/trpc", () => ({
  trpc: {
    phase: {
      get: { useQuery: vi.fn(() => ({ data: null, isLoading: false })) },
      startPhase: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      skip: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      setWaitingOnClient: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      clientResponded: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      requestRevision: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      downloadDocx: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      // Iterative procedures (used by useIterativeReview)
      requestFeedback: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      evaluateFeedback: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      submitEvaluationDecisions: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      submitManualDecisions: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      acceptIterativeVersion: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      rejectFormatting: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      acceptSubstantiveUnformatted: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      restartWithDifferentModel: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
    },
    upload: {
      listByPhase: { useQuery: vi.fn(() => ({ data: [], isLoading: false })) },
      uploadFile: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
    feedback: {
      getEvaluation: { useQuery: vi.fn(() => ({ data: null, isLoading: false })) },
    },
    phase_iterative: {
      requestFeedback: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      evaluateFeedback: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      submitEvaluationDecisions: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      submitManualDecisions: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      acceptIterativeVersion: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      rejectFormatting: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      restartWithDifferentModel: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
      acceptSubstantiveUnformatted: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })) },
    },
    useUtils: vi.fn(() => ({
      phase: { get: { invalidate: vi.fn() } },
    })),
  },
}));

// ── Mock streamdown ──────────────────────────────────────────────────────────
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "streamdown" }, children),
  defaultRehypePlugins: {},
}));

// ── Mock rehypeParagraphIds ──────────────────────────────────────────────────
vi.mock("@/lib/rehypeParagraphIds", () => ({
  rehypeParagraphIds: () => () => {},
}));

// ── Mock child components that make their own tRPC calls ─────────────────────
vi.mock("./AttorneyDraftReview", () => ({
  default: () => React.createElement("div", { "data-testid": "attorney-draft-review" }),
}));
vi.mock("./FormattingReview", () => ({
  default: () => React.createElement("div", { "data-testid": "legacy-formatting-review" }),
}));
vi.mock("./DraftComparison", () => ({
  default: () => React.createElement("div", { "data-testid": "draft-comparison" }),
}));
vi.mock("./AttorneyReview", () => ({
  default: () => React.createElement("div", { "data-testid": "attorney-review" }),
}));
vi.mock("./ModelSelector", () => ({
  default: () => React.createElement("div", { "data-testid": "model-selector" }),
}));
vi.mock("./FileDropZone", () => ({
  default: () => React.createElement("div", { "data-testid": "file-drop-zone" }),
}));
vi.mock("./iterative/FormattingReview", () => ({
  default: () => React.createElement("div", { "data-testid": "iterative-formatting-review" }),
}));
vi.mock("./iterative/FeedbackPanels", () => ({
  default: () => React.createElement("div", { "data-testid": "feedback-panels" }),
}));
vi.mock("./iterative/SelectedChangesTray", () => ({
  default: () => React.createElement("div", { "data-testid": "selected-changes-tray" }),
}));
vi.mock("./iterative/EvaluationPanel", () => ({
  default: () => React.createElement("div", { "data-testid": "evaluation-panel" }),
}));
vi.mock("./iterative/UnresolvedAnchorsPanel", () => ({
  default: () => React.createElement("div", { "data-testid": "unresolved-anchors-panel" }),
}));
vi.mock("./iterative/IterationCounter", () => ({
  default: ({ cycleNumber, iterationNumber }: { cycleNumber: number; iterationNumber: number }) =>
    React.createElement("div", { "data-testid": "iteration-counter" }, `Cycle ${cycleNumber}, Iteration ${iterationNumber}`),
}));
vi.mock("./iterative/ModelPicker", () => ({
  default: () => React.createElement("div", { "data-testid": "model-picker" }),
  getDefaultModel: vi.fn(() => "claude"),
}));

import PhaseContent from "./PhaseContent";
import { trpc as mockTrpc } from "@/lib/trpc";

// ── Helpers ──────────────────────────────────────────────────────────────────
function makePhase(overrides: Partial<{
  workflowState: string;
  activeWorkflowMode: string;
  status: string;
  iterativeMeta: any;
}> = {}) {
  return {
    id: 1,
    matterId: "matter-1",
    phaseName: "memo",
    phaseLabel: "Memo",
    phaseOrder: 1,
    status: overrides.status ?? "in_progress",
    workflowState: overrides.workflowState ?? "idle",
    activeWorkflowMode: overrides.activeWorkflowMode ?? undefined,
    selectedModelId: null,
    acceptedSubstantiveVersion: null,
    officialFinalVersion: null,
    isOptional: 0,
    isStale: 0,
    workflowData: null,
    iterativeMeta: overrides.iterativeMeta ?? { cycleNumber: 1, iterationNumber: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function renderPhaseContent(phase: ReturnType<typeof makePhase>) {
  return render(
    React.createElement(PhaseContent, {
      matterId: "matter-1",
      phase,
      allPhases: [phase],
      onRefresh: vi.fn(),
    })
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("PhaseContent — iterative mode-guard (§3.3.5 Option A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("awaiting_attorney_review", () => {
    it("renders AttorneyDraftReview for single_model_draft mode", () => {
      const phase = makePhase({
        workflowState: "awaiting_attorney_review",
        activeWorkflowMode: "single_model_draft",
      });
      renderPhaseContent(phase);
      expect(screen.getByTestId("attorney-draft-review")).toBeDefined();
      expect(screen.queryByTestId("iteration-counter")).toBeNull();
    });

    it("renders iterative draft UI for iterative_review mode", () => {
      const phase = makePhase({
        workflowState: "awaiting_attorney_review",
        activeWorkflowMode: "iterative_review",
        iterativeMeta: { cycleNumber: 2, iterationNumber: 1, currentVersionModel: "claude" },
      });
      renderPhaseContent(phase);
      // IterationCounter should be rendered (not AttorneyDraftReview)
      expect(screen.getByTestId("iteration-counter")).toBeDefined();
      expect(screen.queryByTestId("attorney-draft-review")).toBeNull();
    });

    it("renders iterative draft UI when activeWorkflowMode is undefined (defaults to non-iterative)", () => {
      const phase = makePhase({
        workflowState: "awaiting_attorney_review",
        // activeWorkflowMode not set → undefined → non-iterative path
      });
      renderPhaseContent(phase);
      // null mode → falls through to AttorneyDraftReview
      expect(screen.getByTestId("attorney-draft-review")).toBeDefined();
    });
  });

  describe("awaiting_format_review", () => {
    it("renders legacy FormattingReview for non-iterative mode", () => {
      const phase = makePhase({
        workflowState: "awaiting_format_review",
        activeWorkflowMode: "single_model_draft",
      });
      renderPhaseContent(phase);
      expect(screen.getByTestId("legacy-formatting-review")).toBeDefined();
      expect(screen.queryByTestId("iterative-formatting-review")).toBeNull();
    });

    it("renders iterative FormattingReview for iterative_review mode (loading state)", () => {
      // When phaseQuery returns null data (default mock), IterativeFormatReviewWrapper
      // shows a loading card — but crucially it does NOT render the legacy FormattingReview.
      // This verifies the mode-guard routing is correct.
      const phase = makePhase({
        workflowState: "awaiting_format_review",
        activeWorkflowMode: "iterative_review",
        iterativeMeta: { cycleNumber: 1, iterationNumber: 2, formatRejectionCount: 0 },
      });
      renderPhaseContent(phase);
      // The iterative path renders a loading card ("Formatting in progress...")
      // not the legacy FormattingReview component
      expect(screen.queryByTestId("legacy-formatting-review")).toBeNull();
      // Iterative loading card is shown
      expect(screen.getByText(/Formatting in progress/i)).toBeDefined();
    });
  });

  describe("awaiting_feedback_action", () => {
    it("renders FeedbackPanels for iterative_review mode", () => {
      const phase = makePhase({
        workflowState: "awaiting_feedback_action",
        activeWorkflowMode: "iterative_review",
        iterativeMeta: { cycleNumber: 1, iterationNumber: 1, currentVersionModel: "claude" },
      });
      renderPhaseContent(phase);
      expect(screen.getByTestId("feedback-panels")).toBeDefined();
    });
  });

  describe("awaiting_manual_decisions", () => {
    it("renders FeedbackPanels for awaiting_manual_decisions state", () => {
      const phase = makePhase({
        workflowState: "awaiting_manual_decisions",
        activeWorkflowMode: "iterative_review",
        iterativeMeta: { cycleNumber: 1, iterationNumber: 1, currentVersionModel: "claude" },
      });
      renderPhaseContent(phase);
      expect(screen.getByTestId("feedback-panels")).toBeDefined();
    });
  });

  describe("awaiting_evaluation_decisions", () => {
    it("renders loading state when evaluation is not yet loaded", () => {
      const phase = makePhase({
        workflowState: "awaiting_evaluation_decisions",
        activeWorkflowMode: "iterative_review",
        iterativeMeta: { cycleNumber: 1, iterationNumber: 1, currentVersionModel: "claude" },
      });
      renderPhaseContent(phase);
      // evalQuery returns { data: null, isLoading: false } from mock
      // → renders "No evaluation found" message
      expect(screen.getByText(/No evaluation found/i)).toBeDefined();
    });
  });

  describe("iterative loading states", () => {
    it("renders loading spinner for awaiting_reviews", () => {
      const phase = makePhase({
        workflowState: "awaiting_reviews",
        activeWorkflowMode: "iterative_review",
      });
      renderPhaseContent(phase);
      // Should render a loading card with "Processing" badge
      expect(screen.getByText(/Processing/i)).toBeDefined();
    });

    it("renders loading spinner for evaluating_feedback", () => {
      const phase = makePhase({
        workflowState: "evaluating_feedback",
        activeWorkflowMode: "iterative_review",
      });
      renderPhaseContent(phase);
      expect(screen.getByText(/Processing/i)).toBeDefined();
    });
  });

  describe("non-iterative states are unaffected", () => {
    it("renders idle state for idle workflowState", () => {
      const phase = makePhase({ workflowState: "idle", status: "not_started" });
      renderPhaseContent(phase);
      expect(screen.getByText(/Start Phase/i)).toBeDefined();
    });

    it("renders awaiting_selection for competitive mode", () => {
      const phase = makePhase({
        workflowState: "awaiting_selection",
        activeWorkflowMode: "competitive_select",
      });
      renderPhaseContent(phase);
      expect(screen.getByTestId("draft-comparison")).toBeDefined();
    });

    it("renders awaiting_decisions for full_competitive mode", () => {
      const phase = makePhase({
        workflowState: "awaiting_decisions",
        activeWorkflowMode: "full_competitive",
      });
      renderPhaseContent(phase);
      expect(screen.getByTestId("attorney-review")).toBeDefined();
    });
  });
});
