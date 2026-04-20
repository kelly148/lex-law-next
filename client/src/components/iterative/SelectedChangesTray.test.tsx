/**
 * SelectedChangesTray.test.tsx
 *
 * Tests for SelectedChangesTray component.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SelectedChangesTray from "./SelectedChangesTray";
import type { ManualSelectionInput } from "@shared/schemas/manualSelection";

const selA: ManualSelectionInput = {
  sourceFeedbackId: 1,
  selectionOrder: 0,
  selectionKind: "paragraph",
  sourceText: "The indemnification clause is too broad.",
  precedingContext: "",
  followingContext: " Consider limiting liability.",
  editedText: null,
};

const selB: ManualSelectionInput = {
  sourceFeedbackId: 2,
  selectionOrder: 1,
  selectionKind: "span",
  sourceText: "Payment terms need clarification.",
  precedingContext: "See section 5. ",
  followingContext: " The notice period should be 30 days.",
  editedText: null,
};

const providers: Record<number, string> = {
  1: "Claude",
  2: "GPT",
};

describe("SelectedChangesTray empty state", () => {
  it("shows empty state when no selections", () => {
    render(
      <SelectedChangesTray
        selections={[]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-changes-tray-empty")).toBeInTheDocument();
  });
});

describe("SelectedChangesTray with selections", () => {
  it("renders the tray with testid", () => {
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-changes-tray")).toBeInTheDocument();
  });

  it("renders the correct number of items", () => {
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    const items = screen.getAllByTestId("selected-change-item");
    expect(items).toHaveLength(2);
  });

  it("shows provider badge for each item", () => {
    render(
      <SelectedChangesTray
        selections={[selA]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-change-provider")).toHaveTextContent("Claude");
  });

  it("shows selection kind badge", () => {
    render(
      <SelectedChangesTray
        selections={[selA]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-change-kind")).toHaveTextContent("paragraph");
  });

  it("shows source text as preview", () => {
    render(
      <SelectedChangesTray
        selections={[selA]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-change-preview")).toHaveTextContent(
      selA.sourceText,
    );
  });

  it("shows edited text as preview when editedText is set", () => {
    const edited = { ...selA, editedText: "Modified indemnification clause." };
    render(
      <SelectedChangesTray
        selections={[edited]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-change-preview")).toHaveTextContent(
      "Modified indemnification clause.",
    );
  });

  it("shows 'Edited' badge when editedText is set", () => {
    const edited = { ...selA, editedText: "Modified." };
    render(
      <SelectedChangesTray
        selections={[edited]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("selected-change-edited-badge")).toBeInTheDocument();
  });
});

describe("SelectedChangesTray actions", () => {
  it("calls onChange with item removed when Remove is clicked", () => {
    const onChange = vi.fn();
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={onChange}
      />,
    );
    const removeBtns = screen.getAllByTestId("selected-change-remove-btn");
    fireEvent.click(removeBtns[0]);
    expect(onChange).toHaveBeenCalledOnce();
    const newSelections = onChange.mock.calls[0][0] as ManualSelectionInput[];
    expect(newSelections).toHaveLength(1);
    expect(newSelections[0].sourceFeedbackId).toBe(selB.sourceFeedbackId);
  });

  it("calls onChange with items swapped when Move Up is clicked", () => {
    const onChange = vi.fn();
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={onChange}
      />,
    );
    const moveUpBtns = screen.getAllByTestId("selected-change-move-up");
    // Second item's move-up
    fireEvent.click(moveUpBtns[1]);
    expect(onChange).toHaveBeenCalledOnce();
    const newSelections = onChange.mock.calls[0][0] as ManualSelectionInput[];
    expect(newSelections[0].sourceFeedbackId).toBe(selB.sourceFeedbackId);
    expect(newSelections[1].sourceFeedbackId).toBe(selA.sourceFeedbackId);
  });

  it("calls onChange with items swapped when Move Down is clicked", () => {
    const onChange = vi.fn();
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={onChange}
      />,
    );
    const moveDownBtns = screen.getAllByTestId("selected-change-move-down");
    // First item's move-down
    fireEvent.click(moveDownBtns[0]);
    expect(onChange).toHaveBeenCalledOnce();
    const newSelections = onChange.mock.calls[0][0] as ManualSelectionInput[];
    expect(newSelections[0].sourceFeedbackId).toBe(selB.sourceFeedbackId);
    expect(newSelections[1].sourceFeedbackId).toBe(selA.sourceFeedbackId);
  });

  it("disables Move Up for first item", () => {
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    const moveUpBtns = screen.getAllByTestId("selected-change-move-up");
    expect(moveUpBtns[0]).toBeDisabled();
  });

  it("disables Move Down for last item", () => {
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    const moveDownBtns = screen.getAllByTestId("selected-change-move-down");
    expect(moveDownBtns[1]).toBeDisabled();
  });

  it("shows edit textarea when Edit button is clicked", () => {
    render(
      <SelectedChangesTray
        selections={[selA]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("selected-change-edit-btn"));
    expect(screen.getByTestId("selected-change-edit-textarea")).toBeInTheDocument();
  });

  it("calls onChange with editedText when Save is clicked", () => {
    const onChange = vi.fn();
    render(
      <SelectedChangesTray
        selections={[selA]}
        feedbackProviders={providers}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("selected-change-edit-btn"));
    const textarea = screen.getByTestId("selected-change-edit-textarea");
    fireEvent.change(textarea, { target: { value: "New edited text." } });
    fireEvent.click(screen.getByTestId("selected-change-save-edit"));
    expect(onChange).toHaveBeenCalledOnce();
    const newSelections = onChange.mock.calls[0][0] as ManualSelectionInput[];
    expect(newSelections[0].editedText).toBe("New edited text.");
  });

  it("hides textarea when Cancel is clicked", () => {
    render(
      <SelectedChangesTray
        selections={[selA]}
        feedbackProviders={providers}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("selected-change-edit-btn"));
    fireEvent.click(screen.getByTestId("selected-change-cancel-edit"));
    expect(screen.queryByTestId("selected-change-edit-textarea")).not.toBeInTheDocument();
  });

  it("disables all controls when disabled prop is true", () => {
    render(
      <SelectedChangesTray
        selections={[selA, selB]}
        feedbackProviders={providers}
        onChange={vi.fn()}
        disabled={true}
      />,
    );
    const removeBtns = screen.getAllByTestId("selected-change-remove-btn");
    removeBtns.forEach((btn) => expect(btn).toBeDisabled());
    const editBtns = screen.getAllByTestId("selected-change-edit-btn");
    editBtns.forEach((btn) => expect(btn).toBeDisabled());
  });
});
