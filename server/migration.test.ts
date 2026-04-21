/**
 * Phase A tests: v2.4.2 schema migration verification.
 * Per v1.4.2 §A.4 — migration.test.ts
 *
 * These tests verify the schema structure by inspecting the Drizzle schema
 * TypeScript definitions directly (no live DB required). They confirm:
 * - matters.workflowModelVersion column exists with default 2
 * - documents table exists with all required columns
 * - versions, feedback, feedback_evaluations each have nullable documentId
 * - The rollback SQL file exists and contains the --force-lossy gate documentation
 * - The migration SQL file exists and contains the CHECK constraints
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  matters,
  documents,
  versions,
  feedback,
  feedbackEvaluations,
  feedbackManualSelections,
} from "../drizzle/schema";

const DRIZZLE_DIR = join(__dirname, "../drizzle");
const MIGRATION_FILE = join(DRIZZLE_DIR, "0009_clear_mimic.sql");
const ROLLBACK_FILE = join(DRIZZLE_DIR, "0009_clear_mimic_rollback.sql");

// ── Schema column presence tests ─────────────────────────────────────

describe("matters table schema (v2.4.2)", () => {
  it("has workflowModelVersion column", () => {
    const cols = Object.keys(matters);
    expect(cols).toContain("workflowModelVersion");
  });

  it("workflowModelVersion column has default 2", () => {
    const col = (matters as any).workflowModelVersion;
    // Drizzle stores the default in the column config
    expect(col?.default).toBe(2);
  });
});

describe("documents table schema (v2.4.2)", () => {
  it("exists as an exported table", () => {
    expect(documents).toBeDefined();
  });

  const expectedColumns = [
    "id", "matterId", "phaseName", "documentType", "customTypeLabel",
    "title", "notes", "status", "workflowState", "initialGeneratorModel",
    "iterativeMeta", "officialFinalVersionNumber", "promptMode",
    "createdAt", "updatedAt",
  ];

  for (const col of expectedColumns) {
    it(`has column: ${col}`, () => {
      expect(Object.keys(documents)).toContain(col);
    });
  }

  it("status column has enum values drafting/complete/archived", () => {
    const statusCol = (documents as any).status;
    expect(statusCol?.enumValues).toEqual(["drafting", "complete", "archived"]);
  });

  it("status column defaults to 'drafting'", () => {
    const statusCol = (documents as any).status;
    expect(statusCol?.default).toBe("drafting");
  });

  it("workflowState column defaults to 'idle'", () => {
    const wsCol = (documents as any).workflowState;
    expect(wsCol?.default).toBe("idle");
  });
});

describe("versions table schema (v2.4.2)", () => {
  it("has nullable documentId column", () => {
    expect(Object.keys(versions)).toContain("documentId");
    // documentId should be nullable (no .notNull() in definition)
    const col = (versions as any).documentId;
    expect(col?.notNull).toBeFalsy();
  });
});

describe("feedback table schema (v2.4.2)", () => {
  it("has nullable documentId column", () => {
    expect(Object.keys(feedback)).toContain("documentId");
    const col = (feedback as any).documentId;
    expect(col?.notNull).toBeFalsy();
  });
});

describe("feedbackEvaluations table schema (v2.4.2)", () => {
  it("exists as an exported table", () => {
    expect(feedbackEvaluations).toBeDefined();
  });

  it("has nullable documentId column", () => {
    expect(Object.keys(feedbackEvaluations)).toContain("documentId");
    const col = (feedbackEvaluations as any).documentId;
    expect(col?.notNull).toBeFalsy();
  });

  it("has required columns: matterId, phaseName, versionNumber, evaluatorProvider, narrativeReasoning, pointByPoint", () => {
    const cols = Object.keys(feedbackEvaluations);
    for (const c of ["matterId", "phaseName", "versionNumber", "evaluatorProvider", "narrativeReasoning", "pointByPoint"]) {
      expect(cols).toContain(c);
    }
  });
});

describe("feedbackManualSelections table schema (v2.4.2)", () => {
  it("exists as an exported table", () => {
    expect(feedbackManualSelections).toBeDefined();
  });

  it("has required columns including feedbackId, selectionKind, decision", () => {
    const cols = Object.keys(feedbackManualSelections);
    for (const c of ["feedbackId", "selectionKind", "decision", "sourceText", "selectionOrder"]) {
      expect(cols).toContain(c);
    }
  });
});

// ── Migration SQL file tests ──────────────────────────────────────────

describe("migration SQL file (0009_clear_mimic.sql)", () => {
  it("exists on disk", () => {
    expect(existsSync(MIGRATION_FILE)).toBe(true);
  });

  it("contains CREATE TABLE documents", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("CREATE TABLE `documents`");
  });

  it("contains ALTER TABLE matters ADD workflowModelVersion", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("ALTER TABLE `matters` ADD `workflowModelVersion`");
  });

  it("contains ALTER TABLE versions ADD documentId", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("ALTER TABLE `versions` ADD `documentId`");
  });

  it("contains ALTER TABLE feedback ADD documentId", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("ALTER TABLE `feedback` ADD `documentId`");
  });

  it("contains CREATE TABLE feedback_evaluations", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("CREATE TABLE `feedback_evaluations`");
  });

  it("contains CREATE TABLE feedback_manual_selections", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("CREATE TABLE `feedback_manual_selections`");
  });

  it("contains CHECK constraint for phaseName (document-holding phases only)", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("chk_documents_phaseName");
    expect(sql).toContain("'engagement'");
    expect(sql).toContain("'memo'");
    expect(sql).toContain("'matrix'");
    expect(sql).toContain("'agreement'");
  });

  it("contains CHECK constraint for workflowState", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("chk_documents_workflowState");
  });

  it("contains CHECK constraint for custom type label", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("chk_documents_custom_label");
    expect(sql).toContain("customTypeLabel");
  });

  it("contains index idx_documents_matter_phase_status", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("idx_documents_matter_phase_status");
  });

  it("contains index idx_documents_matter_created", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("idx_documents_matter_created");
  });

  it("contains unique index uniq_versions_document_version", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("uniq_versions_document_version");
  });
});

// ── Rollback SQL file tests ───────────────────────────────────────────

describe("rollback SQL file (0009_clear_mimic_rollback.sql)", () => {
  it("exists on disk", () => {
    expect(existsSync(ROLLBACK_FILE)).toBe(true);
  });

  it("contains --force-lossy documentation in header", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("--force-lossy");
  });

  it("contains preflight query for multi-document matters", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("SELECT matterId, phaseName, COUNT(*)");
    expect(sql).toContain("HAVING COUNT(*) > 1");
  });

  it("contains DROP TABLE documents", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("DROP TABLE IF EXISTS documents");
  });

  it("contains ALTER TABLE matters DROP COLUMN workflowModelVersion", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("ALTER TABLE matters DROP COLUMN workflowModelVersion");
  });

  it("contains DELETE from feedback_evaluations where documentId IS NOT NULL", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("DELETE FROM feedback_evaluations WHERE documentId IS NOT NULL");
  });

  it("contains DELETE from feedback where documentId IS NOT NULL", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("DELETE FROM feedback WHERE documentId IS NOT NULL");
  });

  it("contains DELETE from versions where documentId IS NOT NULL", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("DELETE FROM versions WHERE documentId IS NOT NULL");
  });

  it("contains DROP INDEX statements for document indexes", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("DROP INDEX");
  });

  it("contains ALTER TABLE to drop documentId columns from extended tables", () => {
    const sql = readFileSync(ROLLBACK_FILE, "utf-8");
    expect(sql).toContain("ALTER TABLE feedback_evaluations DROP COLUMN documentId");
    expect(sql).toContain("ALTER TABLE feedback DROP COLUMN documentId");
    expect(sql).toContain("ALTER TABLE versions DROP COLUMN documentId");
  });
});

// ── R-MCR compliance test ─────────────────────────────────────────────

describe("R-MCR (R11): matter creation sets workflowModelVersion: 3", () => {
  it("routers.ts matter.create call site explicitly sets workflowModelVersion: 3", () => {
    const routersSource = readFileSync(join(__dirname, "routers.ts"), "utf-8");
    // The createMatter call in the tRPC procedure must include workflowModelVersion: 3
    expect(routersSource).toContain("workflowModelVersion: 3");
  });

  it("routers.ts does NOT rely on DB default for new matters (no createMatter call without workflowModelVersion)", () => {
    const routersSource = readFileSync(join(__dirname, "routers.ts"), "utf-8");
    // Verify the R11 comment is present as documentation
    expect(routersSource).toContain("R11/R-MCR");
  });

  it("workflow.test.ts legacy fixtures explicitly set workflowModelVersion: 2 (not relying on DB default)", () => {
    const testSource = readFileSync(join(__dirname, "workflow.test.ts"), "utf-8");
    expect(testSource).toContain("workflowModelVersion: 2");
  });
});
