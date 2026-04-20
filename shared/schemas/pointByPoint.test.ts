import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePointByPoint } from "./pointByPoint";

vi.mock("../telemetry", () => ({
  emitCriticalParseFailure: vi.fn(),
  emitTelemetry: vi.fn(),
}));

import { emitCriticalParseFailure } from "../telemetry";

describe("parsePointByPoint (Phase 1 §1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valid pointByPoint array parses correctly", () => {
    const validItem = {
      sourceFeedbackId: 42,
      sourceReviewerProvider: "claude",
      sourceExcerpt: "The engagement letter should include...",
      sectionAnchor: {
        kind: "section_reference",
        value: "Section 3.1",
        locatorText: "Scope of Representation",
      },
      recommendation: "adopt",
      reasoning: "This is a standard clause for Virginia real estate.",
      suggestedText: "The scope of representation shall include...",
      attorneyDecision: null,
      attorneyModifiedText: null,
    };

    const result = parsePointByPoint([validItem], { evaluationId: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].sourceFeedbackId).toBe(42);
    expect(result[0].sectionAnchor.kind).toBe("section_reference");
    expect(result[0].recommendation).toBe("adopt");
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("malformed entry triggers critical log + empty return", () => {
    const malformed = [
      {
        sourceFeedbackId: "not_a_number", // wrong type
        sourceReviewerProvider: "claude",
        sourceExcerpt: "text",
        sectionAnchor: { kind: "section_reference", value: "S1", locatorText: "loc" },
        recommendation: "adopt",
        reasoning: "reason",
      },
    ];

    const result = parsePointByPoint(malformed, { evaluationId: 5 });
    expect(result).toEqual([]);
    expect(emitCriticalParseFailure).toHaveBeenCalledWith("pointByPoint", 5);
  });

  it("missing required field (sectionAnchor) triggers critical log", () => {
    const missingField = [
      {
        sourceFeedbackId: 1,
        sourceReviewerProvider: "gpt",
        sourceExcerpt: "text",
        // sectionAnchor is missing
        recommendation: "adopt",
        reasoning: "reason",
      },
    ];

    const result = parsePointByPoint(missingField, { evaluationId: 7 });
    expect(result).toEqual([]);
    expect(emitCriticalParseFailure).toHaveBeenCalledWith("pointByPoint", 7);
  });

  it("null input returns empty array silently", () => {
    const result = parsePointByPoint(null, { evaluationId: 1 });
    expect(result).toEqual([]);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("undefined input returns empty array silently", () => {
    const result = parsePointByPoint(undefined, { evaluationId: 1 });
    expect(result).toEqual([]);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });
});
