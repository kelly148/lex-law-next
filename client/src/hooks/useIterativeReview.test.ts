/**
 * useIterativeReview.test.ts
 *
 * Tests for useIterativeReview hooks per Phase 3 §3.5.
 *
 * Validates:
 *   - CONFLICT-specific toast
 *   - Generic error toast
 *   - Network error toast
 *   - pointByPointItemsToDecisions conversion utility
 *   - useIterativeReview composite hook structure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import {
  pointByPointItemsToDecisions,
  useRequestFeedback,
  useEvaluateFeedback,
  useSubmitEvaluationDecisions,
  useSubmitManualDecisions,
  useAcceptIterativeVersion,
  useRejectFormatting,
  useAcceptSubstantiveUnformatted,
  useRestartWithDifferentModel,
  useIterativeReview,
} from "./useIterativeReview";
import type { PointByPointItem } from "@shared/schemas/pointByPoint";

// ─── Mock sonner toast ───────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ─── Mock trpc ───────────────────────────────────────────────────────────────

const makeMockMutation = () => ({
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    phase: {
      requestFeedback: { useMutation: vi.fn(() => makeMockMutation()) },
      evaluateFeedback: { useMutation: vi.fn(() => makeMockMutation()) },
      submitEvaluationDecisions: { useMutation: vi.fn(() => makeMockMutation()) },
      submitManualDecisions: { useMutation: vi.fn(() => makeMockMutation()) },
      acceptIterativeVersion: { useMutation: vi.fn(() => makeMockMutation()) },
      rejectFormatting: { useMutation: vi.fn(() => makeMockMutation()) },
      acceptSubstantiveUnformatted: { useMutation: vi.fn(() => makeMockMutation()) },
      restartWithDifferentModel: { useMutation: vi.fn(() => makeMockMutation()) },
    },
  },
}));

// ─── pointByPointItemsToDecisions ────────────────────────────────────────────

const adoptItem: PointByPointItem = {
  sourceFeedbackId: 1,
  sourceReviewerProvider: "claude",
  sourceExcerpt: "The clause is too broad.",
  sectionAnchor: { kind: "section_reference", value: "§4.2", locatorText: "4.2" },
  recommendation: "adopt",
  reasoning: "Improves clarity.",
  suggestedText: null,
  attorneyDecision: "adopt",
  attorneyModifiedText: null,
};

const modifyItem: PointByPointItem = {
  sourceFeedbackId: 2,
  sourceReviewerProvider: "gpt",
  sourceExcerpt: "Payment terms need clarification.",
  sectionAnchor: { kind: "paragraph_start", value: "Payment", locatorText: "Payment shall" },
  recommendation: "modify",
  reasoning: "Suggested text improves terms.",
  suggestedText: "Payment within 30 days.",
  attorneyDecision: "modify",
  attorneyModifiedText: "Payment within 45 days.",
};

const skipItem: PointByPointItem = {
  sourceFeedbackId: 3,
  sourceReviewerProvider: "claude",
  sourceExcerpt: "Consider arbitration.",
  sectionAnchor: { kind: "exact_match", value: "disputes", locatorText: "Any disputes" },
  recommendation: "skip",
  reasoning: "Out of scope.",
  suggestedText: null,
  attorneyDecision: null,
  attorneyModifiedText: null,
};

describe("pointByPointItemsToDecisions", () => {
  it("maps adopt decision correctly", () => {
    const decisions = pointByPointItemsToDecisions([adoptItem]);
    expect(decisions[0]).toEqual({
      pointByPointIndex: 0,
      attorneyDecision: "adopt",
    });
  });

  it("maps modify decision with modified text", () => {
    const decisions = pointByPointItemsToDecisions([modifyItem]);
    expect(decisions[0]).toEqual({
      pointByPointIndex: 0,
      attorneyDecision: "modify",
      attorneyModifiedText: "Payment within 45 days.",
    });
  });

  it("falls back to recommendation when attorneyDecision is null", () => {
    const decisions = pointByPointItemsToDecisions([skipItem]);
    expect(decisions[0].attorneyDecision).toBe("skip");
  });

  it("assigns correct pointByPointIndex for each item", () => {
    const decisions = pointByPointItemsToDecisions([adoptItem, modifyItem, skipItem]);
    expect(decisions.map((d) => d.pointByPointIndex)).toEqual([0, 1, 2]);
  });

  it("does NOT include attorneyModifiedText when decision is not modify", () => {
    const decisions = pointByPointItemsToDecisions([adoptItem]);
    expect(decisions[0]).not.toHaveProperty("attorneyModifiedText");
  });

  it("returns empty array for empty input", () => {
    expect(pointByPointItemsToDecisions([])).toEqual([]);
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────
// We test the error handler by directly invoking it through the hook's onError
// callback. Since vi.mock hoists the mock, we capture the onError via
// mockImplementation inside the test.

import { trpc as trpcMock } from "@/lib/trpc";

describe("handleMutationError — CONFLICT toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows CONFLICT toast for CONFLICT error message", () => {
    let capturedOnError: ((err: unknown) => void) | undefined;
    (trpcMock.phase.requestFeedback.useMutation as ReturnType<typeof vi.fn>).mockImplementation(
      (opts: { onError?: (err: unknown) => void }) => {
        capturedOnError = opts?.onError;
        return makeMockMutation();
      },
    );
    renderHook(() => useRequestFeedback());
    capturedOnError?.(new Error("CONFLICT: another operation in progress"));
    expect(toast.error).toHaveBeenCalledWith(
      "Another operation is in progress. Please refresh.",
    );
  });

  it("shows generic toast for non-CONFLICT error", () => {
    let capturedOnError: ((err: unknown) => void) | undefined;
    (trpcMock.phase.evaluateFeedback.useMutation as ReturnType<typeof vi.fn>).mockImplementation(
      (opts: { onError?: (err: unknown) => void }) => {
        capturedOnError = opts?.onError;
        return makeMockMutation();
      },
    );
    renderHook(() => useEvaluateFeedback());
    capturedOnError?.(new Error("Something went wrong on the server"));
    expect(toast.error).toHaveBeenCalledWith("Something went wrong on the server");
  });

  it("shows network toast for network error message", () => {
    let capturedOnError: ((err: unknown) => void) | undefined;
    (trpcMock.phase.submitManualDecisions.useMutation as ReturnType<typeof vi.fn>).mockImplementation(
      (opts: { onError?: (err: unknown) => void }) => {
        capturedOnError = opts?.onError;
        return makeMockMutation();
      },
    );
    renderHook(() => useSubmitManualDecisions());
    capturedOnError?.(new Error("network error: failed to fetch"));
    expect(toast.error).toHaveBeenCalledWith(
      "You appear to be offline. Please check your connection.",
    );
  });
});

// ─── Individual hooks render ──────────────────────────────────────────────────

describe("individual hooks render without error", () => {
  it("useRequestFeedback renders", () => {
    const { result } = renderHook(() => useRequestFeedback());
    expect(typeof result.current.requestFeedback).toBe("function");
    expect(result.current.isPending).toBe(false);
  });

  it("useEvaluateFeedback renders", () => {
    const { result } = renderHook(() => useEvaluateFeedback());
    expect(typeof result.current.evaluateFeedback).toBe("function");
  });

  it("useSubmitEvaluationDecisions renders", () => {
    const { result } = renderHook(() => useSubmitEvaluationDecisions());
    expect(typeof result.current.submitEvaluationDecisions).toBe("function");
  });

  it("useSubmitManualDecisions renders", () => {
    const { result } = renderHook(() => useSubmitManualDecisions());
    expect(typeof result.current.submitManualDecisions).toBe("function");
  });

  it("useAcceptIterativeVersion renders", () => {
    const { result } = renderHook(() => useAcceptIterativeVersion());
    expect(typeof result.current.acceptIterativeVersion).toBe("function");
  });

  it("useRejectFormatting renders", () => {
    const { result } = renderHook(() => useRejectFormatting());
    expect(typeof result.current.rejectFormatting).toBe("function");
  });

  it("useAcceptSubstantiveUnformatted renders", () => {
    const { result } = renderHook(() => useAcceptSubstantiveUnformatted());
    expect(typeof result.current.acceptSubstantiveUnformatted).toBe("function");
  });

  it("useRestartWithDifferentModel renders", () => {
    const { result } = renderHook(() => useRestartWithDifferentModel());
    expect(typeof result.current.restartWithDifferentModel).toBe("function");
  });
});

// ─── Composite hook ───────────────────────────────────────────────────────────

describe("useIterativeReview composite hook", () => {
  const params = { matterId: "m1", phaseName: "agreement" };

  it("renders without error", () => {
    const { result } = renderHook(() => useIterativeReview(params));
    expect(result.current).toBeDefined();
  });

  it("exposes all mutation functions", () => {
    const { result } = renderHook(() => useIterativeReview(params));
    expect(typeof result.current.requestFeedback).toBe("function");
    expect(typeof result.current.evaluateFeedback).toBe("function");
    expect(typeof result.current.submitEvaluationDecisions).toBe("function");
    expect(typeof result.current.submitManualDecisions).toBe("function");
    expect(typeof result.current.acceptIterativeVersion).toBe("function");
    expect(typeof result.current.rejectFormatting).toBe("function");
    expect(typeof result.current.acceptSubstantiveUnformatted).toBe("function");
    expect(typeof result.current.restartWithDifferentModel).toBe("function");
  });

  it("exposes individual isPending flags", () => {
    const { result } = renderHook(() => useIterativeReview(params));
    expect(typeof result.current.isRequestingFeedback).toBe("boolean");
    expect(typeof result.current.isEvaluating).toBe("boolean");
    expect(typeof result.current.isSubmittingEvaluationDecisions).toBe("boolean");
    expect(typeof result.current.isSubmittingManualDecisions).toBe("boolean");
    expect(typeof result.current.isAccepting).toBe("boolean");
    expect(typeof result.current.isRejectingFormatting).toBe("boolean");
    expect(typeof result.current.isAcceptingUnformatted).toBe("boolean");
    expect(typeof result.current.isRestarting).toBe("boolean");
  });

  it("exposes anyPending as boolean", () => {
    const { result } = renderHook(() => useIterativeReview(params));
    expect(typeof result.current.anyPending).toBe("boolean");
    expect(result.current.anyPending).toBe(false);
  });
});
