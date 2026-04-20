/**
 * IterationCounter.test.tsx
 *
 * Tests for IterationCounter component and formatIterationLabel helper.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import IterationCounter, { formatIterationLabel } from "./IterationCounter";

// ── formatIterationLabel unit tests ─────────────────────────────────────────

describe("formatIterationLabel", () => {
  it("formats cycle 1 iteration 0 correctly", () => {
    expect(formatIterationLabel(1, 0)).toBe("Cycle 1, Iteration 0");
  });

  it("formats cycle 1 iteration 3 correctly", () => {
    expect(formatIterationLabel(1, 3)).toBe("Cycle 1, Iteration 3");
  });

  it("formats cycle 2 iteration 1 correctly (restart scenario)", () => {
    expect(formatIterationLabel(2, 1)).toBe("Cycle 2, Iteration 1");
  });

  it("formats high cycle and iteration numbers correctly", () => {
    expect(formatIterationLabel(5, 12)).toBe("Cycle 5, Iteration 12");
  });
});

// ── IterationCounter render tests ───────────────────────────────────────────

describe("IterationCounter render", () => {
  it("renders the badge with correct text for cycle 1", () => {
    render(<IterationCounter cycleNumber={1} iterationNumber={3} />);
    const badge = screen.getByTestId("iteration-counter-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Cycle 1, Iteration 3");
  });

  it("renders the container with testid", () => {
    render(<IterationCounter cycleNumber={1} iterationNumber={0} />);
    expect(screen.getByTestId("iteration-counter")).toBeInTheDocument();
  });

  it("does NOT show restart note when cycle is 1", () => {
    render(<IterationCounter cycleNumber={1} iterationNumber={2} />);
    expect(
      screen.queryByTestId("iteration-counter-restart-note"),
    ).not.toBeInTheDocument();
  });

  it("shows restart note when cycle > 1", () => {
    render(<IterationCounter cycleNumber={2} iterationNumber={1} />);
    const note = screen.getByTestId("iteration-counter-restart-note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent("(restarted)");
  });

  it("shows restart note for cycle 3", () => {
    render(<IterationCounter cycleNumber={3} iterationNumber={0} />);
    expect(screen.getByTestId("iteration-counter-restart-note")).toBeInTheDocument();
  });

  it("does NOT show call count when callCount prop is omitted", () => {
    render(<IterationCounter cycleNumber={1} iterationNumber={1} />);
    expect(
      screen.queryByTestId("iteration-counter-call-count"),
    ).not.toBeInTheDocument();
  });

  it("shows call count when callCount prop is provided", () => {
    render(
      <IterationCounter cycleNumber={1} iterationNumber={2} callCount={7} />,
    );
    const callCountEl = screen.getByTestId("iteration-counter-call-count");
    expect(callCountEl).toBeInTheDocument();
    expect(callCountEl).toHaveTextContent("7 calls");
  });

  it("uses singular 'call' when callCount is 1", () => {
    render(
      <IterationCounter cycleNumber={1} iterationNumber={1} callCount={1} />,
    );
    const callCountEl = screen.getByTestId("iteration-counter-call-count");
    expect(callCountEl).toHaveTextContent("1 call");
  });

  it("shows call count 0 when explicitly passed", () => {
    render(
      <IterationCounter cycleNumber={1} iterationNumber={0} callCount={0} />,
    );
    const callCountEl = screen.getByTestId("iteration-counter-call-count");
    expect(callCountEl).toHaveTextContent("0 calls");
  });

  it("applies custom className to container", () => {
    render(
      <IterationCounter
        cycleNumber={1}
        iterationNumber={1}
        className="my-custom-class"
      />,
    );
    const container = screen.getByTestId("iteration-counter");
    expect(container.className).toContain("my-custom-class");
  });
});
