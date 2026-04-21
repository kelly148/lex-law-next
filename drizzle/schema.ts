import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Users (Manus OAuth) ──────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Matter Folders ───────────────────────────────────────────────────
export const matterFolders = mysqlTable("matter_folders", {
  id: int("id").autoincrement().primaryKey(),
  folderId: varchar("folderId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  color: varchar("color", { length: 32 }).default("#2E75B6").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MatterFolder = typeof matterFolders.$inferSelect;
export type InsertMatterFolder = typeof matterFolders.$inferInsert;

// ── Matters ──────────────────────────────────────────────────────────
export const matters = mysqlTable("matters", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 64 }).notNull().unique(),
  matterName: varchar("matterName", { length: 512 }).notNull().default(""),
  clientName: varchar("clientName", { length: 512 }).default(""),
  jurisdiction: varchar("jurisdiction", { length: 256 }).notNull(),
  workflowPath: mysqlEnum("workflowPath", ["full", "core_only"]).default("full").notNull(),
  status: mysqlEnum("status", ["active", "completed", "archived"]).default("active").notNull(),
  folderId: varchar("folderId", { length: 64 }),
  // v2.4.2: routing flag. 2 = v2.3 phase-per-document model; 3 = v2.4.2 document-layer model.
  // DB default is 2 solely for migration backfill of pre-existing matters.
  // Every new matter creation call site MUST explicitly set workflowModelVersion: 3 (R11/R-MCR).
  workflowModelVersion: int("workflowModelVersion").notNull().default(2),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Matter = typeof matters.$inferSelect;
export type InsertMatter = typeof matters.$inferInsert;

// ── Phases ───────────────────────────────────────────────────────────
export const phases = mysqlTable("phases", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 64 }).notNull(),
  phaseName: mysqlEnum("phaseName", [
    "intake", "issues", "planning", "engagement", "memo", "matrix", "agreement",
  ]).notNull(),
  phaseLabel: varchar("phaseLabel", { length: 128 }).notNull(),
  phaseOrder: int("phaseOrder").notNull(),
  status: mysqlEnum("status", [
    "not_started", "in_progress", "completed", "skipped", "waiting_on_client",
  ]).default("not_started").notNull(),
  workflowState: mysqlEnum("workflowState", [
    "idle", "model_selection", "processing", "drafting", "awaiting_selection",
    "awaiting_attorney_review", "revising", "reviewing", "evaluating",
    "awaiting_decisions", "regenerating", "accepted", "formatting",
    "awaiting_format_review", "complete",
    // v2.3 iterative-review states added in Phase 1
    "awaiting_reviews", "awaiting_feedback_action", "evaluating_feedback",
    "awaiting_evaluation_decisions", "awaiting_manual_decisions",
  ]).default("idle").notNull(),
  // Workflow mode for this phase instance
  activeWorkflowMode: varchar("activeWorkflowMode", { length: 64 }),
  // Which model was selected (for single_model and single_model_draft)
  selectedModelId: varchar("selectedModelId", { length: 64 }),
  // Locked substantive version (for formatting pass)
  acceptedSubstantiveVersion: int("acceptedSubstantiveVersion"),
  // Final version number after all processing complete
  officialFinalVersion: int("officialFinalVersion"),
  isOptional: int("isOptional").default(0).notNull(),
  isStale: int("isStale").default(0).notNull(),
  workflowData: json("workflowData"),
  // v2.3 iterative-review fields
  initialGeneratorModel: varchar("initialGeneratorModel", { length: 50 }),
  iterativeMeta: json("iterativeMeta"),
  promptMode: varchar("promptMode", { length: 20 }).default("base"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Phase = typeof phases.$inferSelect;
export type InsertPhase = typeof phases.$inferInsert;

// ── Documents (v2.4.2 document layer) ────────────────────────────────
// One row per document within a document-holding phase of a model-3 matter.
// phaseName is constrained to document-holding phases only (engagement, memo, matrix, agreement).
// CHECK constraints are enforced at the application layer in document.create (Phase B)
// because TiDB/MySQL partial-index and CHECK support varies by version.
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 36 }).notNull().references(() => matters.id),
  phaseName: varchar("phaseName", { length: 50 }).notNull(),
  documentType: varchar("documentType", { length: 50 }).notNull(),
  customTypeLabel: varchar("customTypeLabel", { length: 200 }),
  title: varchar("title", { length: 200 }).notNull(),
  notes: text("notes"),
  status: mysqlEnum("status", ["drafting", "complete", "archived"]).notNull().default("drafting"),
  workflowState: varchar("workflowState", { length: 50 }).notNull().default("idle"),
  initialGeneratorModel: varchar("initialGeneratorModel", { length: 50 }),
  iterativeMeta: json("iterativeMeta"),
  officialFinalVersionNumber: int("officialFinalVersionNumber"),
  promptMode: varchar("promptMode", { length: 20 }).default("base"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => ({
  matterPhaseStatusIdx: index("idx_documents_matter_phase_status").on(
    table.matterId, table.phaseName, table.status
  ),
  matterCreatedIdx: index("idx_documents_matter_created").on(
    table.matterId, table.createdAt
  ),
}));

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// ── Versions (draft outputs per phase) ───────────────────────────────
export const versions = mysqlTable("versions", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 64 }).notNull(),
  phaseName: varchar("phaseName", { length: 64 }).notNull(),
  versionNumber: int("versionNumber").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  content: text("content").notNull(),
  isSelected: int("isSelected").default(0).notNull(),
  isFormattingPass: int("isFormattingPass").default(0).notNull(),
  metadata: json("metadata"),
  // v2.4.2: nullable FK to documents. Null for model-2 (legacy) rows.
  documentId: int("documentId").references(() => documents.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // Unique index on (documentId, versionNumber) for non-null documentId rows.
  // MySQL treats NULLs as distinct in unique indexes, so legacy rows (documentId IS NULL)
  // do not conflict with each other — only non-null pairs are uniqueness-enforced.
  documentVersionUniq: uniqueIndex("uniq_versions_document_version").on(
    table.documentId, table.versionNumber
  ),
  documentLatestIdx: index("idx_versions_document_latest").on(
    table.documentId, table.versionNumber
  ),
}));

export type Version = typeof versions.$inferSelect;
export type InsertVersion = typeof versions.$inferInsert;

// ── Feedback (review cycle feedback points) ──────────────────────────
export const feedback = mysqlTable("feedback", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 64 }).notNull(),
  phaseName: varchar("phaseName", { length: 64 }).notNull(),
  versionNumber: int("versionNumber").notNull(),
  reviewerProvider: varchar("reviewerProvider", { length: 64 }).notNull(),
  category: varchar("category", { length: 128 }),
  point: text("point").notNull(),
  decision: mysqlEnum("decision", ["pending", "accepted", "rejected", "modified"]).default("pending").notNull(),
  attorneyNote: text("attorneyNote"),
  // v2.4.2: nullable FK to documents. Null for model-2 (legacy) rows.
  documentId: int("documentId").references(() => documents.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  documentVersionIdx: index("idx_feedback_document_version").on(
    table.documentId, table.versionNumber
  ),
}));

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = typeof feedback.$inferInsert;

// ── Feedback Evaluations (v2.3 iterative-review evaluator output) ────
export const feedbackEvaluations = mysqlTable("feedback_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 36 }).notNull(),
  phaseName: varchar("phaseName", { length: 50 }).notNull(),
  versionNumber: int("versionNumber").notNull(),
  evaluatorProvider: varchar("evaluatorProvider", { length: 50 }).notNull(),
  narrativeReasoning: text("narrativeReasoning").notNull(),
  pointByPoint: json("pointByPoint").notNull(),
  // v2.4.2: nullable FK to documents. Null for model-2 (legacy) rows.
  documentId: int("documentId").references(() => documents.id),
  createdAt: timestamp("createdAt").defaultNow(),
}, (table) => ({
  lookupIdx: index("idx_feedback_evaluations_lookup").on(
    table.matterId, table.phaseName, table.versionNumber
  ),
  documentVersionIdx: index("idx_feedback_evaluations_document_version").on(
    table.documentId, table.versionNumber
  ),
}));

export type FeedbackEvaluation = typeof feedbackEvaluations.$inferSelect;
export type InsertFeedbackEvaluation = typeof feedbackEvaluations.$inferInsert;

// ── Feedback Manual Selections (v2.3 manual-path attorney decisions) ─
export const feedbackManualSelections = mysqlTable("feedback_manual_selections", {
  id: int("id").autoincrement().primaryKey(),
  feedbackId: int("feedbackId").notNull().references(() => feedback.id, { onDelete: "cascade" }),
  versionNumber: int("versionNumber").notNull(),
  selectionOrder: int("selectionOrder").notNull(),
  selectionKind: mysqlEnum("selectionKind", ["paragraph", "span"]).notNull(),
  sourceText: text("sourceText").notNull(),
  precedingContext: text("precedingContext"),
  followingContext: text("followingContext"),
  editedText: text("editedText"),
  decision: mysqlEnum("decision", ["accepted", "modified"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
}, (table) => ({
  feedbackIdx: index("idx_fms_feedback").on(table.feedbackId, table.selectionOrder),
  versionIdx: index("idx_fms_version").on(table.versionNumber),
}));

export type FeedbackManualSelection = typeof feedbackManualSelections.$inferSelect;
export type InsertFeedbackManualSelection = typeof feedbackManualSelections.$inferInsert;

// ── Fact Changes ─────────────────────────────────────────────────────
export const factChanges = mysqlTable("fact_changes", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 64 }).notNull(),
  description: text("description").notNull(),
  affectedPhases: json("affectedPhases").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FactChange = typeof factChanges.$inferSelect;
export type InsertFactChange = typeof factChanges.$inferInsert;

// ── Uploads (source material files) ──────────────────────────────────
export const uploads = mysqlTable("uploads", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 64 }).notNull(),
  phaseName: varchar("phaseName", { length: 64 }).notNull(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  contentType: varchar("contentType", { length: 128 }),
  fileSize: int("fileSize"),
  // Pre-extracted text content cached at upload time to avoid timeout during phase start
  extractedText: text("extractedText"),
  uploadedBy: int("uploadedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Upload = typeof uploads.$inferSelect;
export type InsertUpload = typeof uploads.$inferInsert;
