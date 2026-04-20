/**
 * UnresolvedAnchorsPanel.test.tsx
 *
 * Tests for UnresolvedAnchorsPanel component per §16.8.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UnresolvedAnchorsPanel from "./UnresolvedAnchorsPanel";
import type { UnresolvedAnchor } from "@shared/schemas/versionMetadata";

const sectionAnchorItem: UnresolvedAnchor = {
  changeIndex: 0,
  sourceFeedbackId: 42,
  sourceExcerpt: "The indemnification cap needs to be tied to the purchase price.",
  attemptedAnchor: {
    kind: "section_reference",
    value: "Section 4.2 (Indemnification)",
    locatorText: "4.2 Indemnification. The Seller agrees",
  },
  reason: "not_found",
};

const manualSelectionItem: UnresolvedAnchor = {
  changeIndex: 1,
  sourceFeedbackId: null,
  sourceExcerpt: "Change the liability clause.",
  attemptedAnchor: {
    sourceText: "The parties agree that liability shall be limited",
  },
  reason: "multiple_matches",
};

const ambiguousItem: UnresolvedAnchor = {
  changeIndex: 2,
  sourceFeedbackId: 7,
  sourceExcerpt: "Ambiguous reference to payment terms.",
  attemptedAnchor: {
    kind: "paragraph_start",
    value: "Payment shall be made within",
    locatorText: "Payment shall be made within thirty",
  },
  reason: "ambiguous",
};

describe("UnresolvedAnchorsPanel render", () => {
  const defaultProps = {
    unresolvedAnchors: [sectionAnchorItem],
    onAcceptPartial: vi.fn(),
    onApplyManually: vi.fn(),
    onReDecide: vi.fn(),
  };

  it("renders the panel with testid", () => {
    render(<UnresolvedAnchorsPanel {...defaultProps} />);
    expect(screen.getByTestId("unresolved-anchors-panel")).toBeInTheDocument();
  });

  it("shows singular 'change' for 1 item", () => {
    render(<UnresolvedAnchorsPanel {...defaultProps} />);
    expect(screen.getByText(/1 change could not be applied/)).toBeInTheDocument();
  });

  it("shows plural 'changes' for multiple items", () => {
    render(
      <UnresolvedAnchorsPanel
        {...defaultProps}
        unresolvedAnchors={[sectionAnchorItem, manualSelectionItem]}
      />,
    );
    expect(screen.getByText(/2 changes could not be applied/)).toBeInTheDocument();
  });

  it("renders the warning icon", () => {
    render(<UnresolvedAnchorsPanel {...defaultProps} />);
    expect(screen.getByTestId("unresolved-anchors-icon")).toBeInTheDocument();
  });

  it("renders the list of unresolved anchor items", () => {
    render(
      <UnresolvedAnchorsPanel
        {...defaultProps}
        unresolvedAnchors={[sectionAnchorItem, manualSelectionItem]}
      />,
    );
    const items = screen.getAllByTestId("unresolved-anchor-item");
    expect(items).toHaveLength(2);
  });

  it("shows 'not_found' reason badge", () => {
    render(<UnresolvedAnchorsPanel {...defaultProps} />);
    expect(screen.getByTestId("unresolved-anchor-reason")).toHaveTextContent("Not found");
  });

  it("shows 'multiple_matches' reason badge", () => {
    render(
      <UnresolvedAnchorsPanel
        {...defaultProps}
        unresolvedAnchors={[manualSelectionItem]}
      />,
    );
    expect(screen.getByTestId("unresolved-anchor-reason")).toHaveTextContent("Multiple matches");
  });

  it("shows 'ambiguous' reason badge", () => {
    render(
      <UnresolvedAnchorsPanel
        {...defaultProps}
        unresolvedAnchors={[ambiguousItem]}
      />,
    );
    expect(screen.getByTestId("unresolved-anchor-reason")).toHaveTextContent("Ambiguous");
  });

  it("shows attempted anchor label for section_reference", () => {
    render(<UnresolvedAnchorsPanel {...defaultProps} />);
    expect(screen.getByTestId("unresolved-anchor-attempted")).toHaveTextContent(
      "Section: Section 4.2 (Indemnification)",
    );
  });

  it("shows attempted anchor label for manual selection (sourceText)", () => {
    render(
      <UnresolvedAnchorsPanel
        {...defaultProps}
        unresolvedAnchors={[manualSelectionItem]}
      />,
    );
    expect(screen.getByTestId("unresolved-anchor-attempted")).toHaveTextContent(
      "Selected text:",
    );
  });

  it("shows feedback ID when sourceFeedbackId is non-null", () => {
    render(<UnresolvedAnchorsPanel {...defaultProps} />);
    expect(screen.getByText("Feedback #42")).toBeInTheDocument();
  });

  it("does NOT show feedback ID when sourceFeedbackId is null", () => {
    render(
      <UnresolvedAnchorsPanel
        {...defaultProps}
        unresolvedAnchors={[manualSelectionItem]}
      />,
    );
    expect(screen.queryByText(/Feedback #/)).not.toBeInTheDocument();
  });
});

describe("UnresolvedAnchorsPanel actions", () => {
  it("calls onAcceptPartial when Accept partial result is clicked", () => {
    const onAcceptPartial = vi.fn();
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={[sectionAnchorItem]}
        onAcceptPartial={onAcceptPartial}
        onApplyManually={vi.fn()}
        onReDecide={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("unresolved-anchors-accept-btn"));
    expect(onAcceptPartial).toHaveBeenCalledOnce();
  });

  it("calls onApplyManually with all unresolved items when Apply manually is clicked", () => {
    const onApplyManually = vi.fn();
    const items = [sectionAnchorItem, manualSelectionItem];
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={items}
        onAcceptPartial={vi.fn()}
        onApplyManually={onApplyManually}
        onReDecide={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("unresolved-anchors-apply-manually-btn"));
    expect(onApplyManually).toHaveBeenCalledWith(items);
  });

  it("calls onReDecide when Re-decide is clicked", () => {
    const onReDecide = vi.fn();
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={[sectionAnchorItem]}
        onAcceptPartial={vi.fn()}
        onApplyManually={vi.fn()}
        onReDecide={onReDecide}
      />,
    );
    fireEvent.click(screen.getByTestId("unresolved-anchors-re-decide-btn"));
    expect(onReDecide).toHaveBeenCalledOnce();
  });

  it("disables all action buttons when disabled prop is true", () => {
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={[sectionAnchorItem]}
        onAcceptPartial={vi.fn()}
        onApplyManually={vi.fn()}
        onReDecide={vi.fn()}
        disabled={true}
      />,
    );
    expect(screen.getByTestId("unresolved-anchors-accept-btn")).toBeDisabled();
    expect(screen.getByTestId("unresolved-anchors-apply-manually-btn")).toBeDisabled();
    expect(screen.getByTestId("unresolved-anchors-re-decide-btn")).toBeDisabled();
  });
});

describe("UnresolvedAnchorsPanel expand/collapse", () => {
  it("does NOT show excerpt by default", () => {
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={[sectionAnchorItem]}
        onAcceptPartial={vi.fn()}
        onApplyManually={vi.fn()}
        onReDecide={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("unresolved-anchor-excerpt")).not.toBeInTheDocument();
  });

  it("shows excerpt after clicking expand button", () => {
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={[sectionAnchorItem]}
        onAcceptPartial={vi.fn()}
        onApplyManually={vi.fn()}
        onReDecide={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("unresolved-anchor-expand-btn"));
    const excerpt = screen.getByTestId("unresolved-anchor-excerpt");
    expect(excerpt).toBeInTheDocument();
    expect(excerpt).toHaveTextContent(sectionAnchorItem.sourceExcerpt);
  });

  it("hides excerpt again after second click (toggle)", () => {
    render(
      <UnresolvedAnchorsPanel
        unresolvedAnchors={[sectionAnchorItem]}
        onAcceptPartial={vi.fn()}
        onApplyManually={vi.fn()}
        onReDecide={vi.fn()}
      />,
    );
    const btn = screen.getByTestId("unresolved-anchor-expand-btn");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByTestId("unresolved-anchor-excerpt")).not.toBeInTheDocument();
  });
});
