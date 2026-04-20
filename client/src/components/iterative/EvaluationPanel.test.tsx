/**
 * EvaluationPanel.test.tsx
 *
 * Tests for EvaluationPanel component per §16.5.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EvaluationPanel from "./EvaluationPanel";
import type { PointByPointItem } from "@shared/schemas/pointByPoint";

// Mock AnchorDisplay to avoid scroll dependency in tests
vi.mock("./AnchorDisplay", () => ({
  default: ({ anchor }: { anchor: { value: string } }) => (
    <div data-testid="anchor-display-mock">{anchor.value}</div>
  ),
}));

// Mock ModelPicker
vi.mock("./ModelPicker", () => ({
  default: ({
    value,
    onChange,
    disabled,
    label,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    label?: string;
  }) => (
    <div data-testid="model-picker-mock">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        data-testid="model-picker-select"
      >
        <option value="claude">Claude</option>
        <option value="gpt">GPT</option>
      </select>
    </div>
  ),
}));

const adoptItem: PointByPointItem = {
  sourceFeedbackId: 1,
  sourceReviewerProvider: "claude",
  sourceExcerpt: "The indemnification clause is too broad.",
  sectionAnchor: {
    kind: "section_reference",
    value: "Section 4.2",
    locatorText: "4.2 Indemnification",
  },
  recommendation: "adopt",
  reasoning: "This change improves clarity and limits liability appropriately.",
  suggestedText: null,
  attorneyDecision: null,
  attorneyModifiedText: null,
};

const modifyItem: PointByPointItem = {
  sourceFeedbackId: 2,
  sourceReviewerProvider: "gpt",
  sourceExcerpt: "Payment terms need clarification.",
  sectionAnchor: {
    kind: "paragraph_start",
    value: "Payment terms paragraph",
    locatorText: "Payment shall be made within",
  },
  recommendation: "modify",
  reasoning: "The suggested text improves the payment terms.",
  suggestedText: "Payment shall be made within 30 days of invoice.",
  attorneyDecision: null,
  attorneyModifiedText: null,
};

const skipItem: PointByPointItem = {
  sourceFeedbackId: 3,
  sourceReviewerProvider: "claude",
  sourceExcerpt: "Consider adding arbitration clause.",
  sectionAnchor: {
    kind: "exact_match",
    value: "dispute resolution",
    locatorText: "Any disputes arising",
  },
  recommendation: "skip",
  reasoning: "This change is out of scope for this agreement.",
  suggestedText: null,
  attorneyDecision: null,
  attorneyModifiedText: null,
};

const defaultProps = {
  narrativeReasoning: "Overall the draft is well-structured but needs improvements.",
  items: [adoptItem, modifyItem],
  currentVersionModel: "claude",
  onSubmit: vi.fn(),
};

describe("EvaluationPanel render", () => {
  it("renders the panel with testid", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.getByTestId("evaluation-panel")).toBeInTheDocument();
  });

  it("renders the narrative reasoning card", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.getByTestId("evaluation-narrative")).toBeInTheDocument();
  });

  it("does NOT show narrative text by default (collapsed)", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.queryByTestId("evaluation-narrative-text")).not.toBeInTheDocument();
  });

  it("shows narrative text after clicking toggle", () => {
    render(<EvaluationPanel {...defaultProps} />);
    fireEvent.click(screen.getByTestId("evaluation-narrative-toggle"));
    expect(screen.getByTestId("evaluation-narrative-text")).toHaveTextContent(
      defaultProps.narrativeReasoning,
    );
  });

  it("renders the correct number of point-by-point items", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const items = screen.getAllByTestId("evaluation-item");
    expect(items).toHaveLength(2);
  });

  it("shows provider badge for each item", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const providers = screen.getAllByTestId("evaluation-item-provider");
    expect(providers[0]).toHaveTextContent("claude");
    expect(providers[1]).toHaveTextContent("gpt");
  });

  it("shows recommendation badge for each item", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const recs = screen.getAllByTestId("evaluation-item-recommendation");
    expect(recs[0]).toHaveTextContent("ADOPT");
    expect(recs[1]).toHaveTextContent("MODIFY");
  });

  it("shows source excerpt for each item", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const excerpts = screen.getAllByTestId("evaluation-item-excerpt");
    expect(excerpts[0]).toHaveTextContent(adoptItem.sourceExcerpt);
  });

  it("shows suggested text for modify items", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.getByTestId("evaluation-item-suggested-text")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation-item-suggested-text")).toHaveTextContent(
      modifyItem.suggestedText!,
    );
  });

  it("shows anchor display for each item", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const anchors = screen.getAllByTestId("anchor-display-mock");
    expect(anchors).toHaveLength(2);
  });

  it("shows the model picker in the footer", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.getByTestId("model-picker-mock")).toBeInTheDocument();
  });

  it("shows the submit button", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.getByTestId("evaluation-submit-btn")).toBeInTheDocument();
  });

  it("disables submit button when not all items have decisions", () => {
    render(<EvaluationPanel {...defaultProps} />);
    expect(screen.getByTestId("evaluation-submit-btn")).toBeDisabled();
  });
});

describe("EvaluationPanel decisions", () => {
  it("shows decision badge when Accept is clicked", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const acceptBtns = screen.getAllByTestId("evaluation-item-accept-btn");
    fireEvent.click(acceptBtns[0]);
    const badges = screen.getAllByTestId("evaluation-item-decision-badge");
    expect(badges[0]).toHaveTextContent("Accepted");
  });

  it("enables submit button when all items have decisions", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const acceptBtns = screen.getAllByTestId("evaluation-item-accept-btn");
    fireEvent.click(acceptBtns[0]);
    fireEvent.click(acceptBtns[1]);
    expect(screen.getByTestId("evaluation-submit-btn")).not.toBeDisabled();
  });

  it("shows Override: Adopt button for non-adopt recommendations", () => {
    render(<EvaluationPanel items={[modifyItem, skipItem]} narrativeReasoning="" currentVersionModel="claude" onSubmit={vi.fn()} />);
    const overrideAdoptBtns = screen.getAllByTestId("evaluation-item-override-adopt-btn");
    expect(overrideAdoptBtns.length).toBeGreaterThan(0);
  });

  it("does NOT show Override: Adopt button for adopt recommendations", () => {
    render(<EvaluationPanel items={[adoptItem]} narrativeReasoning="" currentVersionModel="claude" onSubmit={vi.fn()} />);
    expect(screen.queryByTestId("evaluation-item-override-adopt-btn")).not.toBeInTheDocument();
  });

  it("shows Override: Skip button for non-skip recommendations", () => {
    render(<EvaluationPanel items={[adoptItem]} narrativeReasoning="" currentVersionModel="claude" onSubmit={vi.fn()} />);
    expect(screen.getByTestId("evaluation-item-override-skip-btn")).toBeInTheDocument();
  });

  it("shows modify textarea when Override: Modify is clicked", () => {
    render(<EvaluationPanel {...defaultProps} />);
    const modifyBtns = screen.getAllByTestId("evaluation-item-override-modify-btn");
    fireEvent.click(modifyBtns[0]);
    expect(screen.getAllByTestId("evaluation-item-modify-textarea").length).toBeGreaterThan(0);
  });

  it("calls onSubmit with decisions and model when submit is clicked", () => {
    const onSubmit = vi.fn();
    render(<EvaluationPanel {...defaultProps} onSubmit={onSubmit} />);
    const acceptBtns = screen.getAllByTestId("evaluation-item-accept-btn");
    fireEvent.click(acceptBtns[0]);
    fireEvent.click(acceptBtns[1]);
    fireEvent.click(screen.getByTestId("evaluation-submit-btn"));
    expect(onSubmit).toHaveBeenCalledOnce();
    const [decisions, model] = onSubmit.mock.calls[0];
    expect(Array.isArray(decisions)).toBe(true);
    expect(typeof model).toBe("string");
  });

  it("disables all decision buttons when disabled prop is true", () => {
    render(<EvaluationPanel {...defaultProps} disabled={true} />);
    const acceptBtns = screen.getAllByTestId("evaluation-item-accept-btn");
    acceptBtns.forEach((btn) => expect(btn).toBeDisabled());
  });
});
