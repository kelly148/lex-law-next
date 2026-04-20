import { describe, it, expect } from "vitest";
import { canStartPhase } from "../shared/workflow";

/**
 * Phase 1 §1.5 — canStartPhase gate tests per v2.3 §6.
 *
 * New rules:
 * - intake: always true
 * - agreement: always true (preserved exception)
 * - all others: require only intake completed or skipped
 * - waiting_on_client does NOT satisfy prerequisite
 */
describe("canStartPhase (v2.3 §6 gate rules)", () => {
  const makePhases = (overrides: Array<{ phaseName: string; status: string }>) =>
    overrides.map(p => ({ ...p, isOptional: 0 }));

  it("canStartPhase('intake', anyPhases) returns true", () => {
    expect(canStartPhase("intake", [])).toBe(true);
    expect(canStartPhase("intake", makePhases([{ phaseName: "intake", status: "not_started" }]))).toBe(true);
  });

  it("canStartPhase('agreement', anyPhases) returns true (preserved exception)", () => {
    expect(canStartPhase("agreement", [])).toBe(true);
    expect(canStartPhase("agreement", makePhases([{ phaseName: "intake", status: "not_started" }]))).toBe(true);
  });

  it("canStartPhase('engagement', [{intake: not_started}]) returns false", () => {
    expect(canStartPhase("engagement", makePhases([
      { phaseName: "intake", status: "not_started" },
    ]))).toBe(false);
  });

  it("canStartPhase('engagement', [{intake: completed}]) returns true", () => {
    expect(canStartPhase("engagement", makePhases([
      { phaseName: "intake", status: "completed" },
    ]))).toBe(true);
  });

  it("canStartPhase('engagement', [{intake: skipped}]) returns true", () => {
    expect(canStartPhase("engagement", makePhases([
      { phaseName: "intake", status: "skipped" },
    ]))).toBe(true);
  });

  it("canStartPhase('memo', [{intake: completed}]) returns true regardless of issues status", () => {
    expect(canStartPhase("memo", makePhases([
      { phaseName: "intake", status: "completed" },
      { phaseName: "issues", status: "not_started" },
    ]))).toBe(true);
  });

  it("canStartPhase('agreement', [{intake: completed}]) returns true regardless of any other phase status", () => {
    expect(canStartPhase("agreement", makePhases([
      { phaseName: "intake", status: "completed" },
      { phaseName: "issues", status: "not_started" },
      { phaseName: "planning", status: "not_started" },
      { phaseName: "engagement", status: "not_started" },
      { phaseName: "memo", status: "not_started" },
      { phaseName: "matrix", status: "not_started" },
    ]))).toBe(true);
  });

  it("canStartPhase('planning', [{intake: waiting_on_client}]) returns false", () => {
    expect(canStartPhase("planning", makePhases([
      { phaseName: "intake", status: "waiting_on_client" },
    ]))).toBe(false);
  });
});
