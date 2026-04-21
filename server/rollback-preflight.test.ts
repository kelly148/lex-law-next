/**
 * Phase A tests: rollback preflight gate logic.
 * Per v1.4.2 §A.4 — tests the --force-lossy gate behavior.
 *
 * Since there is no live DB in CI, these tests verify the preflight
 * gate logic in isolation using a pure-function implementation that
 * mirrors what a migration runner would do.
 */
import { describe, expect, it } from "vitest";

// ── Preflight gate implementation (pure function, no DB) ──────────────
// This mirrors what the migration runner must implement before executing
// the rollback SQL. In production, `rows` comes from the DB query:
//   SELECT matterId, phaseName, COUNT(*) as cnt
//   FROM documents GROUP BY matterId, phaseName HAVING COUNT(*) > 1;

interface MultiDocumentRow {
  matterId: string;
  phaseName: string;
  cnt: number;
}

function runRollbackPreflight(
  rows: MultiDocumentRow[],
  forceLossy: boolean
): { allowed: boolean; reason: string } {
  if (rows.length === 0) {
    return { allowed: true, reason: "No multi-document matters found; rollback is clean." };
  }
  if (forceLossy) {
    return {
      allowed: true,
      reason: `--force-lossy passed; proceeding despite ${rows.length} multi-document matter(s). DATA WILL BE LOST.`,
    };
  }
  return {
    allowed: false,
    reason:
      `Rollback refused: ${rows.length} matter/phase combination(s) have multiple documents. ` +
      `Pass --force-lossy to proceed (lossy), or forward-fix instead.`,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("rollback preflight gate", () => {
  it("allows rollback when no multi-document matters exist (clean case)", () => {
    const result = runRollbackPreflight([], false);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("clean");
  });

  it("allows rollback when no multi-document matters exist, even without --force-lossy", () => {
    const result = runRollbackPreflight([], false);
    expect(result.allowed).toBe(true);
  });

  it("refuses rollback when multi-document matters exist and --force-lossy is NOT passed", () => {
    const rows: MultiDocumentRow[] = [
      { matterId: "matter-abc", phaseName: "agreement", cnt: 3 },
    ];
    const result = runRollbackPreflight(rows, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("--force-lossy");
    expect(result.reason).toContain("1 matter/phase combination");
  });

  it("allows rollback when multi-document matters exist and --force-lossy IS passed", () => {
    const rows: MultiDocumentRow[] = [
      { matterId: "matter-abc", phaseName: "agreement", cnt: 3 },
      { matterId: "matter-xyz", phaseName: "memo", cnt: 2 },
    ];
    const result = runRollbackPreflight(rows, true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("--force-lossy");
    expect(result.reason).toContain("DATA WILL BE LOST");
  });

  it("reports the correct count of affected matter/phase combinations", () => {
    const rows: MultiDocumentRow[] = [
      { matterId: "m1", phaseName: "agreement", cnt: 2 },
      { matterId: "m1", phaseName: "memo", cnt: 4 },
      { matterId: "m2", phaseName: "agreement", cnt: 2 },
    ];
    const result = runRollbackPreflight(rows, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("3 matter/phase combination");
  });

  it("allows rollback with --force-lossy for any number of affected rows", () => {
    const rows: MultiDocumentRow[] = Array.from({ length: 100 }, (_, i) => ({
      matterId: `matter-${i}`,
      phaseName: "agreement",
      cnt: 5,
    }));
    const result = runRollbackPreflight(rows, true);
    expect(result.allowed).toBe(true);
  });
});
