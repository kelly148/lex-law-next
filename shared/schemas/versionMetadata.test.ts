import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseVersionMetadata } from "./versionMetadata";

vi.mock("../telemetry", () => ({
  emitCriticalParseFailure: vi.fn(),
  emitTelemetry: vi.fn(),
}));

import { emitCriticalParseFailure } from "../telemetry";

describe("parseVersionMetadata (Phase 1 §1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses v2.3 shape correctly", () => {
    const v23 = {
      iteration: 2,
      cycleNumber: 3,
      originatingFeedbackIds: [10, 20],
      originatingSelectionIds: [5],
      evaluationId: 42,
      sourcePath: "evaluator",
      isFormatted: true,
      generatorProvider: "gpt",
      cloneOf: 7,
      unresolvedAnchors: [
        {
          changeIndex: 0,
          sourceFeedbackId: 10,
          sourceExcerpt: "some text",
          attemptedAnchor: {
            kind: "section_reference",
            value: "Section 3",
            locatorText: "Scope",
          },
          reason: "not_found",
        },
      ],
      providerLabel: "GPT-5.4",
    };

    const result = parseVersionMetadata(v23, { versionId: 100 });
    expect(result.iteration).toBe(2);
    expect(result.cycleNumber).toBe(3);
    expect(result.originatingFeedbackIds).toEqual([10, 20]);
    expect(result.evaluationId).toBe(42);
    expect(result.sourcePath).toBe("evaluator");
    expect(result.isFormatted).toBe(true);
    expect(result.cloneOf).toBe(7);
    expect(result.unresolvedAnchors).toHaveLength(1);
    expect(result.unresolvedAnchors![0].reason).toBe("not_found");
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("parses legacy v2.2 shape (without unresolvedAnchors, cloneOf) — returns defaults, no critical log", () => {
    const v22 = {
      iteration: 1,
      cycleNumber: 1,
      originatingFeedbackIds: [],
      originatingSelectionIds: [],
      evaluationId: null,
      sourcePath: "initial",
      isFormatted: false,
      generatorProvider: "claude",
      providerLabel: "Claude",
    };

    const result = parseVersionMetadata(v22, { versionId: 50 });
    expect(result.cloneOf).toBeNull();
    expect(result.unresolvedAnchors).toBeNull();
    expect(result.iteration).toBe(1);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("parses pre-v2.2 shape (only providerLabel, flags) — returns defaults, no critical log", () => {
    const preV22 = {
      providerLabel: "Claude 3.5 Sonnet",
      flags: { legacy: true },
    };

    const result = parseVersionMetadata(preV22, { versionId: 10 });
    expect(result.iteration).toBe(0);
    expect(result.cycleNumber).toBe(1);
    expect(result.originatingFeedbackIds).toEqual([]);
    expect(result.sourcePath).toBe("initial");
    expect(result.isFormatted).toBe(false);
    expect(result.generatorProvider).toBe("claude");
    expect(result.providerLabel).toBe("Claude 3.5 Sonnet");
    expect(result.flags).toEqual({ legacy: true });
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("null input returns default object silently", () => {
    const result = parseVersionMetadata(null, { versionId: 1 });
    expect(result.iteration).toBe(0);
    expect(result.sourcePath).toBe("initial");
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("undefined input returns default object silently", () => {
    const result = parseVersionMetadata(undefined, { versionId: 1 });
    expect(result.iteration).toBe(0);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("invalid non-null data emits critical telemetry and returns defaults", () => {
    const invalid = {
      iteration: "not_a_number",
      sourcePath: "invalid_enum_value",
    };

    const result = parseVersionMetadata(invalid, { versionId: 99 });
    expect(result.iteration).toBe(0);
    expect(result.sourcePath).toBe("initial");
    expect(emitCriticalParseFailure).toHaveBeenCalledWith("versionMetadata", 99);
  });
});
