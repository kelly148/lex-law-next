/**
 * Phase A tests: shared/schemas/iterativeMeta.ts
 * Per v1.4.2 §A.4 — iterativeMeta.test.ts
 * Tests both the new documentId context variant and the existing phaseId variant.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { parseIterativeMeta, iterativeMetaSchema } from "../shared/schemas/iterativeMeta";

const DEFAULT_META = {
  iterationNumber: 0,
  cycleNumber: 0,
  totalFeedbackPointsAccepted: 0,
  totalFeedbackPointsRejected: 0,
  totalFeedbackPointsModified: 0,
};

describe("parseIterativeMeta — null/undefined input (silent defaults)", () => {
  it("returns default object for null with phaseId context", () => {
    const result = parseIterativeMeta(null, { phaseId: 5 });
    expect(result).toMatchObject(DEFAULT_META);
  });

  it("returns default object for undefined with phaseId context", () => {
    const result = parseIterativeMeta(undefined, { phaseId: 5 });
    expect(result).toMatchObject(DEFAULT_META);
  });

  it("returns default object for null with documentId context", () => {
    const result = parseIterativeMeta(null, { documentId: 1 });
    expect(result).toMatchObject(DEFAULT_META);
  });

  it("returns default object for undefined with documentId context", () => {
    const result = parseIterativeMeta(undefined, { documentId: 1 });
    expect(result).toMatchObject(DEFAULT_META);
  });
});

describe("parseIterativeMeta — valid payload", () => {
  it("parses a complete valid payload with phaseId context", () => {
    const payload = {
      iterationNumber: 3,
      cycleNumber: 1,
      currentVersionModel: "claude",
      lastReviewedVersionNumber: 2,
      totalFeedbackPointsAccepted: 5,
      totalFeedbackPointsRejected: 1,
      totalFeedbackPointsModified: 2,
    };
    const result = parseIterativeMeta(payload, { phaseId: 10 });
    expect(result.iterationNumber).toBe(3);
    expect(result.cycleNumber).toBe(1);
    expect(result.currentVersionModel).toBe("claude");
    expect(result.totalFeedbackPointsAccepted).toBe(5);
  });

  it("parses a complete valid payload with documentId context", () => {
    const payload = {
      iterationNumber: 2,
      cycleNumber: 1,
      currentVersionModel: "gpt",
      totalFeedbackPointsAccepted: 3,
      totalFeedbackPointsRejected: 0,
      totalFeedbackPointsModified: 1,
    };
    const result = parseIterativeMeta(payload, { documentId: 7 });
    expect(result.iterationNumber).toBe(2);
    expect(result.currentVersionModel).toBe("gpt");
  });

  it("fills in missing optional fields with defaults", () => {
    const result = parseIterativeMeta({}, { phaseId: 1 });
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(0);
    expect(result.currentVersionModel).toBeUndefined();
  });
});

describe("parseIterativeMeta — malformed payload (telemetry + defaults)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits critical_parse_failure telemetry and returns defaults for malformed payload with phaseId context", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const malformed = { iterationNumber: "not-a-number", cycleNumber: -999 };
    const result = parseIterativeMeta(malformed, { phaseId: 42 });

    // Returns defaults
    expect(result).toMatchObject(DEFAULT_META);

    // Emits telemetry
    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.event).toBe("critical_parse_failure");
    expect(logged.schema).toBe("iterativeMeta");
    expect(logged.entityKind).toBe("phase");
    expect(logged.entityId).toBe(42);
    expect(logged.errors).toBeDefined();
  });

  it("emits critical_parse_failure telemetry with entityId from documentId context", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const malformed = { iterationNumber: "bad", cycleNumber: "also-bad" };
    const result = parseIterativeMeta(malformed, { documentId: 99 });

    expect(result).toMatchObject(DEFAULT_META);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.event).toBe("critical_parse_failure");
    expect(logged.entityKind).toBe("document");
    expect(logged.entityId).toBe(99);
  });

  it("does NOT emit telemetry for null input (null is silent)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    parseIterativeMeta(null, { documentId: 1 });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("does NOT emit telemetry for undefined input (undefined is silent)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    parseIterativeMeta(undefined, { phaseId: 1 });
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("iterativeMetaSchema direct usage", () => {
  it("parses empty object with all defaults", () => {
    const result = iterativeMetaSchema.parse({});
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(0);
    expect(result.totalFeedbackPointsAccepted).toBe(0);
  });

  it("parses undefined with all defaults", () => {
    const result = iterativeMetaSchema.parse(undefined);
    expect(result).toMatchObject(DEFAULT_META);
  });
});
