import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
    // Phase 1: iterative_review states
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
  // Phase 1: iterative_review columns
  initialGeneratorModel: varchar("initialGeneratorModel", { length: 50 }),
  iterativeMeta: json("iterativeMeta"),
  promptMode: varchar("promptMode", { length: 20 }).default("base"),
  isOptional: int("isOptional").default(0).notNull(),
  isStale: int("isStale").default(0).notNull(),
  workflowData: json("workflowData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Phase = typeof phases.$inferSelect;
export type InsertPhase = typeof phases.$inferInsert;

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = typeof feedback.$inferInsert;

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

// ── Feedback Evaluations (iterative_review evaluator output) ────────
export const feedbackEvaluations = mysqlTable("feedback_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  matterId: varchar("matterId", { length: 36 }).notNull(),
  phaseName: varchar("phaseName", { length: 50 }).notNull(),
  versionNumber: int("versionNumber").notNull(),
  evaluatorProvider: varchar("evaluatorProvider", { length: 50 }).notNull(),
  narrativeReasoning: text("narrativeReasoning").notNull(),
  pointByPoint: json("pointByPoint").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
}, (table) => ({
  lookupIdx: index("idx_feedback_evaluations_lookup").on(
    table.matterId, table.phaseName, table.versionNumber
  ),
}));

export type FeedbackEvaluation = typeof feedbackEvaluations.$inferSelect;
export type InsertFeedbackEvaluation = typeof feedbackEvaluations.$inferInsert;

// ── Feedback Manual Selections (attorney manual text selections) ────
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
