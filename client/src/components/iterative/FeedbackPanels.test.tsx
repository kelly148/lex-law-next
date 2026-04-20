/**
 * FeedbackPanels.test.tsx
 *
 * Tests for FeedbackPanels component and captureContext helper.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FeedbackPanels, { captureContext } from "./FeedbackPanels";
import type { FeedbackItem } from "./FeedbackPanels";

const feedbackA: FeedbackItem = {
  id: 1,
  reviewerProvider: "claude",
  content: "The indemnification clause is too broad.\n\nConsider limiting liability to direct damages.",
};

const feedbackB: FeedbackItem = {
  id: 2,
  reviewerProvider: "gpt",
  content: "Payment terms need clarification.\n\nThe notice period should be 30 days.",
};

const failedFeedback: FeedbackItem = {
  id: 3,
  reviewerProvider: "gemini",
  content: "",
  failed: true,
  failureReason: "API timeout",
};

// ── captureContext unit tests ────────────────────────────────────────────────

describe("captureContext", () => {
  it("returns empty strings when selectedText is not found", () => {
    const result = captureContext("Hello world", "not present");
    expect(result.precedingContext).toBe("");
    expect(result.followingContext).toBe("");
  });

  it("captures up to 100 chars before the selection", () => {
    const prefix = "a".repeat(150);
    const text = prefix + "TARGET" + "b".repeat(50);
    const result = captureContext(text, "TARGET");
    expect(result.precedingContext).toHaveLength(100);
    expect(result.precedingContext).toBe("a".repeat(100));
  });

  it("captures up to 100 chars after the selection", () => {
    const suffix = "b".repeat(150);
    const text = "PREFIX" + "TARGET" + suffix;
    const result = captureContext(text, "TARGET");
    expect(result.followingContext).toHaveLength(100);
    expect(result.followingContext).toBe("b".repeat(100));
  });

  it("captures full context when text is shorter than 100 chars", () => {
    const text = "Before TARGET after";
    const result = captureContext(text, "TARGET");
    expect(result.precedingContext).toBe("Before ");
    expect(result.followingContext).toBe(" after");
  });

  it("handles selection at start of string", () => {
    const result = captureContext("TARGETsuffix", "TARGET");
    expect(result.precedingContext).toBe("");
    expect(result.followingContext).toBe("suffix");
  });

  it("handles selection at end of string", () => {
    const result = captureContext("prefixTARGET", "TARGET");
    expect(result.precedingContext).toBe("prefix");
    expect(result.followingContext).toBe("");
  });
});

// ── FeedbackPanels render tests ──────────────────────────────────────────────

describe("FeedbackPanels render", () => {
  it("renders the panels container with testid", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="view"
      />,
    );
    expect(screen.getByTestId("feedback-panels")).toBeInTheDocument();
  });

  it("renders action buttons in view mode", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="view"
        onGetAiEvaluation={vi.fn()}
        onPickManually={vi.fn()}
      />,
    );
    expect(screen.getByTestId("feedback-panels-ai-eval-btn")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-panels-pick-manually-btn")).toBeInTheDocument();
  });

  it("does NOT render action buttons in select mode", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="select"
      />,
    );
    expect(screen.queryByTestId("feedback-panels-actions")).not.toBeInTheDocument();
  });

  it("calls onGetAiEvaluation when button is clicked", () => {
    const onGetAiEvaluation = vi.fn();
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="view"
        onGetAiEvaluation={onGetAiEvaluation}
      />,
    );
    fireEvent.click(screen.getByTestId("feedback-panels-ai-eval-btn"));
    expect(onGetAiEvaluation).toHaveBeenCalledOnce();
  });

  it("calls onPickManually when button is clicked", () => {
    const onPickManually = vi.fn();
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="view"
        onPickManually={onPickManually}
      />,
    );
    fireEvent.click(screen.getByTestId("feedback-panels-pick-manually-btn"));
    expect(onPickManually).toHaveBeenCalledOnce();
  });

  it("disables action buttons when disabled prop is true", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="view"
        onGetAiEvaluation={vi.fn()}
        onPickManually={vi.fn()}
        disabled={true}
      />,
    );
    expect(screen.getByTestId("feedback-panels-ai-eval-btn")).toBeDisabled();
    expect(screen.getByTestId("feedback-panels-pick-manually-btn")).toBeDisabled();
  });

  it("shows failed badge for a failed reviewer", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, failedFeedback]}
        mode="view"
      />,
    );
    expect(screen.getByTestId("reviewer-panel-failed-badge")).toBeInTheDocument();
  });

  it("shows error message for failed reviewer", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, failedFeedback]}
        mode="view"
      />,
    );
    expect(screen.getByTestId("reviewer-panel-error")).toHaveTextContent("API timeout");
  });

  it("shows retry button for failed reviewer", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, failedFeedback]}
        mode="view"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reviewer-panel-retry-btn")).toBeInTheDocument();
  });

  it("calls onRetry with feedbackId when retry is clicked", () => {
    const onRetry = vi.fn();
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, failedFeedback]}
        mode="view"
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByTestId("reviewer-panel-retry-btn"));
    expect(onRetry).toHaveBeenCalledWith(failedFeedback.id);
  });
});

describe("FeedbackPanels selection mode", () => {
  it("shows 'Click to select' badge in select mode", () => {
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA, feedbackB]}
        mode="select"
      />,
    );
    const badges = screen.getAllByTestId("reviewer-panel-select-badge");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("calls onSelectionAdded when a paragraph is clicked in select mode", () => {
    const onSelectionAdded = vi.fn();
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA]}
        mode="select"
        onSelectionAdded={onSelectionAdded}
      />,
    );
    const paragraphs = screen.getAllByTestId("feedback-paragraph");
    fireEvent.click(paragraphs[0]);
    expect(onSelectionAdded).toHaveBeenCalledOnce();
  });

  it("selection includes sourceFeedbackId, sourceText, and context fields", () => {
    const onSelectionAdded = vi.fn();
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA]}
        mode="select"
        onSelectionAdded={onSelectionAdded}
      />,
    );
    const paragraphs = screen.getAllByTestId("feedback-paragraph");
    fireEvent.click(paragraphs[0]);

    const selection = onSelectionAdded.mock.calls[0][0];
    expect(selection.sourceFeedbackId).toBe(feedbackA.id);
    expect(typeof selection.sourceText).toBe("string");
    expect(typeof selection.precedingContext).toBe("string");
    expect(typeof selection.followingContext).toBe("string");
    expect(selection.selectionKind).toBe("paragraph");
  });

  it("does NOT call onSelectionAdded in view mode", () => {
    const onSelectionAdded = vi.fn();
    render(
      <FeedbackPanels
        feedbackItems={[feedbackA]}
        mode="view"
        onSelectionAdded={onSelectionAdded}
      />,
    );
    const paragraphs = screen.getAllByTestId("feedback-paragraph");
    fireEvent.click(paragraphs[0]);
    expect(onSelectionAdded).not.toHaveBeenCalled();
  });
});
