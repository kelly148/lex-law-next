import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseIterativeMeta } from "./iterativeMeta";

// Mock the telemetry module to assert critical_parse_failure emissions
vi.mock("../telemetry", () => ({
  emitCriticalParseFailure: vi.fn(),
  emitTelemetry: vi.fn(),
}));

import { emitCriticalParseFailure } from "../telemetry";

describe("parseIterativeMeta (Phase 1 §1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseIterativeMeta(null, {phaseId: 1}) returns default object silently (no telemetry)", () => {
    const result = parseIterativeMeta(null, { phaseId: 1 });
    expect(result).toEqual({
      iterationNumber: 0,
      cycleNumber: 1,
      currentVersionModel: null,
      lastEvaluatorModel: null,
      lastRegeneratorModel: null,
      feedbackCyclesCompleted: 0,
      formatRejectionCount: 0,
      preClientWaitState: null,
      isIterativeLoop: false,
    });
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("parseIterativeMeta(undefined, {phaseId: 1}) returns default object silently", () => {
    const result = parseIterativeMeta(undefined, { phaseId: 1 });
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(1);
    expect(result.isIterativeLoop).toBe(false);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("parseIterativeMeta({}, {phaseId: 1}) returns default object silently", () => {
    const result = parseIterativeMeta({}, { phaseId: 1 });
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(1);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("parseIterativeMeta({iterationNumber: 3, cycleNumber: 2}, {phaseId: 1}) returns parsed values + defaults", () => {
    const result = parseIterativeMeta({ iterationNumber: 3, cycleNumber: 2 }, { phaseId: 1 });
    expect(result.iterationNumber).toBe(3);
    expect(result.cycleNumber).toBe(2);
    expect(result.currentVersionModel).toBeNull();
    expect(result.isIterativeLoop).toBe(false);
    expect(emitCriticalParseFailure).not.toHaveBeenCalled();
  });

  it("parseIterativeMeta({iterationNumber: 'not_a_number'}, {phaseId: 1}) returns defaults AND emits critical telemetry", () => {
    const result = parseIterativeMeta({ iterationNumber: "not_a_number" }, { phaseId: 1 });
    // Should return defaults because parse failed
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(1);
    // Must emit critical_parse_failure
    expect(emitCriticalParseFailure).toHaveBeenCalledWith("iterativeMeta", 1);
  });

  it("parseIterativeMeta({iterationNumber: -1}, {phaseId: 1}) returns defaults AND emits critical telemetry (negative int fails nonnegative)", () => {
    const result = parseIterativeMeta({ iterationNumber: -1 }, { phaseId: 1 });
    expect(result.iterationNumber).toBe(0);
    expect(emitCriticalParseFailure).toHaveBeenCalledWith("iterativeMeta", 1);
  });
});
