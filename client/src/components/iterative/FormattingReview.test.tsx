/**
 * FormattingReview.test.tsx (iterative)
 *
 * Tests for the iterative FormattingReview component per §16.6.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import IterativeFormattingReview from "./FormattingReview";

// Mock Streamdown to avoid markdown rendering in tests
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="streamdown-mock">{children}</div>
  ),
}));

const defaultProps = {
  formattedContent: "# Formatted Agreement\n\nThis is the formatted content.",
  formattedVersionNumber: 5,
  substantiveContent: "# Substantive Agreement\n\nThis is the substantive content.",
  substantiveVersionNumber: 4,
  formatRejectionCount: 0,
  flags: [],
  onApproveFormatting: vi.fn(),
  onRejectFormatting: vi.fn(),
  onAcceptWithoutFormatting: vi.fn(),
};

describe("IterativeFormattingReview render", () => {
  it("renders the component with testid", () => {
    render(<IterativeFormattingReview {...defaultProps} />);
    expect(screen.getByTestId("iterative-formatting-review")).toBeInTheDocument();
  });

  it("shows the formatting review badge", () => {
    render(<IterativeFormattingReview {...defaultProps} />);
    expect(screen.getByTestId("formatting-review-badge")).toBeInTheDocument();
  });

  it("renders formatted content via Streamdown", () => {
    render(<IterativeFormattingReview {...defaultProps} />);
    expect(screen.getByTestId("formatting-review-content")).toBeInTheDocument();
  });

  it("shows formatted version number badge", () => {
    render(<IterativeFormattingReview {...defaultProps} />);
    expect(screen.getByText("v5")).toBeInTheDocument();
  });

  it("shows substantive comparison section when provided", () => {
    render(<IterativeFormattingReview {...defaultProps} />);
    expect(screen.getByTestId("formatting-review-substantive")).toBeInTheDocument();
  });

  it("does NOT show flags panel when flags is empty", () => {
    render(<IterativeFormattingReview {...defaultProps} flags={[]} />);
    expect(screen.queryByTestId("formatting-review-flags")).not.toBeInTheDocument();
  });

  it("shows flags panel when flags are present", () => {
    render(
      <IterativeFormattingReview
        {...defaultProps}
        flags={["Placeholder [PARTY_A] not filled in", "Missing signature block"]}
      />,
    );
    expect(screen.getByTestId("formatting-review-flags")).toBeInTheDocument();
    const items = screen.getAllByTestId("formatting-review-flag-item");
    expect(items).toHaveLength(2);
  });
});

describe("IterativeFormattingReview actions", () => {
  it("calls onApproveFormatting when Approve button is clicked", () => {
    const onApproveFormatting = vi.fn();
    render(
      <IterativeFormattingReview
        {...defaultProps}
        onApproveFormatting={onApproveFormatting}
      />,
    );
    fireEvent.click(screen.getByTestId("formatting-review-approve-btn"));
    expect(onApproveFormatting).toHaveBeenCalledOnce();
  });

  it("calls onRejectFormatting with 'format_only' when Reject formatting is clicked", () => {
    const onRejectFormatting = vi.fn();
    render(
      <IterativeFormattingReview
        {...defaultProps}
        onRejectFormatting={onRejectFormatting}
      />,
    );
    fireEvent.click(screen.getByTestId("formatting-review-reject-format-btn"));
    expect(onRejectFormatting).toHaveBeenCalledWith("format_only");
  });

  it("calls onRejectFormatting with 'substantive' when Needs substantive change is clicked", () => {
    const onRejectFormatting = vi.fn();
    render(
      <IterativeFormattingReview
        {...defaultProps}
        onRejectFormatting={onRejectFormatting}
      />,
    );
    fireEvent.click(screen.getByTestId("formatting-review-reject-substantive-btn"));
    expect(onRejectFormatting).toHaveBeenCalledWith("substantive");
  });

  it("calls onAcceptWithoutFormatting when escape hatch is clicked", () => {
    const onAcceptWithoutFormatting = vi.fn();
    render(
      <IterativeFormattingReview
        {...defaultProps}
        onAcceptWithoutFormatting={onAcceptWithoutFormatting}
      />,
    );
    fireEvent.click(screen.getByTestId("formatting-review-accept-unformatted-btn"));
    expect(onAcceptWithoutFormatting).toHaveBeenCalledOnce();
  });

  it("disables all action buttons when disabled prop is true", () => {
    render(<IterativeFormattingReview {...defaultProps} disabled={true} />);
    expect(screen.getByTestId("formatting-review-approve-btn")).toBeDisabled();
    expect(screen.getByTestId("formatting-review-reject-format-btn")).toBeDisabled();
    expect(screen.getByTestId("formatting-review-reject-substantive-btn")).toBeDisabled();
    expect(screen.getByTestId("formatting-review-accept-unformatted-btn")).toBeDisabled();
  });
});

describe("IterativeFormattingReview escape hatch promotion", () => {
  it("does NOT show rejection count badge when formatRejectionCount is 0", () => {
    render(<IterativeFormattingReview {...defaultProps} formatRejectionCount={0} />);
    expect(screen.queryByTestId("formatting-review-rejection-count")).not.toBeInTheDocument();
  });

  it("shows rejection count badge when formatRejectionCount > 0", () => {
    render(<IterativeFormattingReview {...defaultProps} formatRejectionCount={2} />);
    const badge = screen.getByTestId("formatting-review-rejection-count");
    expect(badge).toHaveTextContent("2");
  });

  it("does NOT show promotion notice when formatRejectionCount < 3", () => {
    render(<IterativeFormattingReview {...defaultProps} formatRejectionCount={2} />);
    expect(
      screen.queryByTestId("formatting-review-escape-hatch-notice"),
    ).not.toBeInTheDocument();
  });

  it("shows promotion notice when formatRejectionCount >= 3", () => {
    render(<IterativeFormattingReview {...defaultProps} formatRejectionCount={3} />);
    expect(
      screen.getByTestId("formatting-review-escape-hatch-notice"),
    ).toBeInTheDocument();
  });

  it("shows promotion notice at formatRejectionCount = 4", () => {
    render(<IterativeFormattingReview {...defaultProps} formatRejectionCount={4} />);
    expect(
      screen.getByTestId("formatting-review-escape-hatch-notice"),
    ).toBeInTheDocument();
  });
});
