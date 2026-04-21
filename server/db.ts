import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  InsertMatter, matters,
  InsertPhase, phases,
  InsertVersion, versions,
  InsertFeedback, feedback,
  InsertFactChange, factChanges,
  InsertUpload, uploads,
  InsertMatterFolder, matterFolders,
  // Phase B additions
  documents, InsertDocument, Document,
  feedbackEvaluations, InsertFeedbackEvaluation,
  feedbackManualSelections, InsertFeedbackManualSelection,
} from "../drizzle/schema";
import { PHASE_NAMES, PHASE_ORDER, PHASE_CONFIG } from "../shared/workflow";
import { ENV } from './_core/env';
import { emitTelemetry } from '../shared/telemetry';
import { DOCUMENT_HOLDING_PHASES } from '../shared/schemas/scope';
import type { WorkflowState } from '../shared/workflow';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// Minimal transaction type alias for the conditional helpers.
export type DbTransaction = ReturnType<typeof drizzle>;

// ── User Helpers ─────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ── Matter Helpers ───────────────────────────────────────────────────
export async function createMatter(data: InsertMatter) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(matters).values(data);
  const [row] = await db.select().from(matters).where(eq(matters.matterId, data.matterId)).limit(1);
  return row;
}

export async function listMatters(userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(matters).orderBy(desc(matters.createdAt));
}

export async function getMatterByMatterId(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(matters).where(eq(matters.matterId, matterId)).limit(1);
  return row ?? null;
}

export async function renameMatter(matterId: string, matterName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ matterName }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

export async function updateClientName(matterId: string, clientName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ clientName }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

// ── Phase Helpers ────────────────────────────────────────────────────
export async function createPhases(data: InsertPhase[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return [];
  await db.insert(phases).values(data);
  return db.select().from(phases).where(eq(phases.matterId, data[0].matterId)).orderBy(asc(phases.phaseOrder));
}

export async function getPhasesByMatterId(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(phases).where(eq(phases.matterId, matterId)).orderBy(asc(phases.phaseOrder));
}

export async function getPhase(matterId: string, phaseName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(phases)
    .where(and(eq(phases.matterId, matterId), eq(phases.phaseName, phaseName as any)))
    .limit(1);
  return row ?? null;
}

export async function updatePhaseWorkflowState(matterId: string, phaseName: string, workflowState: string, workflowData?: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateObj: Record<string, any> = { workflowState: workflowState as any };
  if (workflowData !== undefined) updateObj.workflowData = workflowData;
  // Set status based on workflow state
  if (workflowState === "complete") updateObj.status = "completed" as any;
  else if (workflowState !== "idle") updateObj.status = "in_progress" as any;
  await db.update(phases).set(updateObj)
    .where(and(eq(phases.matterId, matterId), eq(phases.phaseName, phaseName as any)));
  return getPhase(matterId, phaseName);
}

export async function updatePhaseFields(matterId: string, phaseName: string, fields: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(phases).set(fields)
    .where(and(eq(phases.matterId, matterId), eq(phases.phaseName, phaseName as any)));
  return getPhase(matterId, phaseName);
}

export async function setPhaseStatus(matterId: string, phaseName: string, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(phases).set({ status: status as any })
    .where(and(eq(phases.matterId, matterId), eq(phases.phaseName, phaseName as any)));
  return getPhase(matterId, phaseName);
}

export async function skipPhase(matterId: string, phaseName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(phases).set({ status: "skipped" as any, workflowState: "complete" as any })
    .where(and(eq(phases.matterId, matterId), eq(phases.phaseName, phaseName as any)));
  return getPhase(matterId, phaseName);
}

export async function markPhasesStale(matterId: string, phaseNames: string[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (phaseNames.length === 0) return;
  await db.update(phases).set({ isStale: 1 })
    .where(and(eq(phases.matterId, matterId), inArray(phases.phaseName, phaseNames as any)));
}

// ── updatePhaseWorkflowStateConditional (Phase B) ─────────────────────
// Conditional (optimistic-lock) phase state update per v1.3 §1.3.5 pattern.
// Throws CONFLICT if the phase is not in expectedCurrentState.
export async function updatePhaseWorkflowStateConditional(
  _tx: DbTransaction | null,
  phaseId: number,
  expectedCurrentState: WorkflowState,
  nextState: WorkflowState,
  options: {
    matterId: string;
    phaseName: string;
    procedure: string;
    workflowData?: Record<string, unknown>;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const updateObj: Record<string, unknown> = { workflowState: nextState as any };
  if (options.workflowData !== undefined) updateObj.workflowData = options.workflowData;
  if (nextState === 'complete') updateObj.status = 'completed' as any;
  else if (nextState !== 'idle') updateObj.status = 'in_progress' as any;

  const result = await db.update(phases)
    .set(updateObj)
    .where(and(eq(phases.id, phaseId), eq(phases.workflowState, expectedCurrentState as any)));

  const affected = (result as any).rowsAffected ?? (result as any).affectedRows ?? 0;

  if (affected === 0) {
    const [current] = await db.select({ workflowState: phases.workflowState })
      .from(phases).where(eq(phases.id, phaseId)).limit(1);

    emitTelemetry({
      kind: 'concurrency_conflict',
      phaseId,
      documentId: null,
      targetKind: 'phase',
      procedure: options.procedure,
      expectedState: expectedCurrentState,
      actualState: current?.workflowState ?? 'unknown',
    });

    const { TRPCError } = await import('@trpc/server');
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Phase is in state '${current?.workflowState ?? 'unknown'}', not '${expectedCurrentState}'. Another operation may be in progress.`,
    });
  }

  emitTelemetry({
    kind: 'state_transition',
    phaseId,
    documentId: null,
    targetKind: 'phase',
    matterId: options.matterId,
    phaseName: options.phaseName,
    from: expectedCurrentState,
    to: nextState,
    procedure: options.procedure,
  });
}

// ── updateDocumentWorkflowStateConditional (Phase B) ──────────────────
// Mirrors updatePhaseWorkflowStateConditional for the documents table.
// Per v1.4.2 §B.3.3. Writes to documents.workflowState ONLY — never to phases.workflowState.
export async function updateDocumentWorkflowStateConditional(
  _tx: DbTransaction | null,
  documentId: number,
  expectedCurrentState: WorkflowState,
  nextState: WorkflowState,
  options: {
    matterId: string;
    phaseName: string;
    procedure: string;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.update(documents)
    .set({ workflowState: nextState, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.workflowState, expectedCurrentState)));

  const affected = (result as any).rowsAffected ?? (result as any).affectedRows ?? 0;

  if (affected === 0) {
    const [current] = await db.select({ workflowState: documents.workflowState })
      .from(documents).where(eq(documents.id, documentId)).limit(1);

    emitTelemetry({
      kind: 'concurrency_conflict',
      phaseId: null,
      documentId,
      targetKind: 'document',
      procedure: options.procedure,
      expectedState: expectedCurrentState,
      actualState: current?.workflowState ?? 'unknown',
    });

    const { TRPCError } = await import('@trpc/server');
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Document is in state '${current?.workflowState ?? 'unknown'}', not '${expectedCurrentState}'. Another operation may be in progress.`,
    });
  }

  emitTelemetry({
    kind: 'state_transition',
    phaseId: null,
    documentId,
    targetKind: 'document',
    matterId: options.matterId,
    phaseName: options.phaseName,
    from: expectedCurrentState,
    to: nextState,
    procedure: options.procedure,
  });
}

// ── Version Helpers ──────────────────────────────────────────────────
export async function createVersion(data: InsertVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(versions).values(data);
  const [row] = await db.select().from(versions)
    .where(and(
      eq(versions.matterId, data.matterId),
      eq(versions.phaseName, data.phaseName),
      eq(versions.versionNumber, data.versionNumber),
      eq(versions.provider, data.provider),
    )).limit(1);
  return row;
}

export async function getVersionsByPhase(matterId: string, phaseName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(versions)
    .where(and(eq(versions.matterId, matterId), eq(versions.phaseName, phaseName)))
    .orderBy(desc(versions.versionNumber), asc(versions.provider));
}

export async function getVersionByNumber(matterId: string, phaseName: string, versionNumber: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(versions)
    .where(and(
      eq(versions.matterId, matterId),
      eq(versions.phaseName, phaseName),
      eq(versions.versionNumber, versionNumber),
    )).limit(1);
  return row ?? null;
}

export async function selectVersion(versionId: number, matterId: string, phaseName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(versions).set({ isSelected: 0 })
    .where(and(eq(versions.matterId, matterId), eq(versions.phaseName, phaseName)));
  await db.update(versions).set({ isSelected: 1 }).where(eq(versions.id, versionId));
}

export async function getLatestVersionNumber(matterId: string, phaseName: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ versionNumber: versions.versionNumber }).from(versions)
    .where(and(eq(versions.matterId, matterId), eq(versions.phaseName, phaseName)))
    .orderBy(desc(versions.versionNumber)).limit(1);
  return rows.length > 0 ? rows[0].versionNumber : 0;
}

// ── Feedback Helpers ─────────────────────────────────────────────────
export async function createFeedbackBatch(data: InsertFeedback[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return [];
  await db.insert(feedback).values(data);
  return db.select().from(feedback)
    .where(and(
      eq(feedback.matterId, data[0].matterId),
      eq(feedback.phaseName, data[0].phaseName),
      eq(feedback.versionNumber, data[0].versionNumber),
    )).orderBy(asc(feedback.id));
}

export async function getFeedbackByPhase(matterId: string, phaseName: string, versionNumber?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [eq(feedback.matterId, matterId), eq(feedback.phaseName, phaseName)];
  if (versionNumber !== undefined) conditions.push(eq(feedback.versionNumber, versionNumber));
  return db.select().from(feedback).where(and(...conditions)).orderBy(asc(feedback.id));
}

export async function updateFeedbackDecision(feedbackId: number, decision: string, attorneyNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateObj: Record<string, any> = { decision: decision as any };
  if (attorneyNote !== undefined) updateObj.attorneyNote = attorneyNote;
  await db.update(feedback).set(updateObj).where(eq(feedback.id, feedbackId));
}

// ── Fact Change Helpers ──────────────────────────────────────────────
export async function createFactChange(data: InsertFactChange) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(factChanges).values(data);
  const affectedPhases = data.affectedPhases as string[];
  if (affectedPhases && affectedPhases.length > 0) {
    const earliestOrder = Math.min(...affectedPhases.map(p => PHASE_ORDER[p as keyof typeof PHASE_ORDER] ?? 99));
    const downstreamPhases = PHASE_NAMES.filter(p => PHASE_ORDER[p] >= earliestOrder);
    await markPhasesStale(data.matterId, downstreamPhases);
  }
  return { success: true };
}

export async function getFactChangesByMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(factChanges)
    .where(eq(factChanges.matterId, matterId))
    .orderBy(desc(factChanges.createdAt));
}

// ── Upload Helpers ──────────────────────────────────────────────────────
export async function createUpload(data: InsertUpload) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(uploads).values(data);
  const [row] = await db.select().from(uploads)
    .where(and(eq(uploads.matterId, data.matterId), eq(uploads.fileName, data.fileName)))
    .orderBy(desc(uploads.id)).limit(1);
  return row;
}

export async function getUploadsByPhase(matterId: string, phaseName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(uploads)
    .where(and(eq(uploads.matterId, matterId), eq(uploads.phaseName, phaseName)))
    .orderBy(desc(uploads.createdAt));
}

export async function updateUploadExtractedText(uploadId: number, extractedText: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(uploads).set({ extractedText }).where(eq(uploads.id, uploadId));
}

// ── Matter Delete / Archive Helpers ───────────────────────────────────────────
export async function deleteMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(uploads).where(eq(uploads.matterId, matterId));
  await db.delete(feedback).where(eq(feedback.matterId, matterId));
  await db.delete(factChanges).where(eq(factChanges.matterId, matterId));
  await db.delete(versions).where(eq(versions.matterId, matterId));
  await db.delete(phases).where(eq(phases.matterId, matterId));
  await db.delete(matters).where(eq(matters.matterId, matterId));
  return { success: true };
}

export async function archiveMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ status: "archived" as any }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

export async function unarchiveMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ status: "active" as any }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

export async function assignMatterToFolder(matterId: string, folderId: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ folderId: folderId ?? null }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

// ── Folder Helpers ─────────────────────────────────────────────────────────────────
export async function createFolder(data: InsertMatterFolder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(matterFolders).values(data);
  const [row] = await db.select().from(matterFolders).where(eq(matterFolders.folderId, data.folderId)).limit(1);
  return row;
}

export async function listFolders(userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(matterFolders).orderBy(asc(matterFolders.name));
}

export async function renameFolder(folderId: string, name: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matterFolders).set({ name }).where(eq(matterFolders.folderId, folderId));
  const [row] = await db.select().from(matterFolders).where(eq(matterFolders.folderId, folderId)).limit(1);
  return row ?? null;
}

export async function deleteFolder(folderId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ folderId: null }).where(eq(matters.folderId, folderId));
  await db.delete(matterFolders).where(eq(matterFolders.folderId, folderId));
  return { success: true };
}

// ── collectPriorPhaseOutputs ─────────────────────────────────────────
export async function collectPriorPhaseOutputs(matterId: string, targetPhaseName: string): Promise<string | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allPhases = await db.select().from(phases)
    .where(eq(phases.matterId, matterId))
    .orderBy(asc(phases.phaseOrder));
  const parts: string[] = [];
  for (const phase of allPhases) {
    if (phase.phaseName === targetPhaseName) break;
    if (phase.status !== "completed") continue;
    let content: string | null = null;
    if (phase.officialFinalVersion != null) {
      const [row] = await db.select().from(versions)
        .where(and(
          eq(versions.matterId, matterId),
          eq(versions.phaseName, phase.phaseName),
          eq(versions.versionNumber, phase.officialFinalVersion),
        )).limit(1);
      content = row?.content ?? null;
    }
    if (!content) {
      const [row] = await db.select().from(versions)
        .where(and(eq(versions.matterId, matterId), eq(versions.phaseName, phase.phaseName), eq(versions.isSelected, 1)))
        .limit(1);
      content = row?.content ?? null;
    }
    if (!content) {
      const [row] = await db.select().from(versions)
        .where(and(eq(versions.matterId, matterId), eq(versions.phaseName, phase.phaseName)))
        .orderBy(desc(versions.versionNumber)).limit(1);
      content = row?.content ?? null;
    }
    if (content) {
      const config = PHASE_CONFIG[phase.phaseName as keyof typeof PHASE_CONFIG];
      const label = config?.label ?? (phase.phaseName.charAt(0).toUpperCase() + phase.phaseName.slice(1));
      parts.push(`=== ${label.toUpperCase()} ===\n${content}`);
    }
  }
  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase B: Document CRUD helpers
// ═══════════════════════════════════════════════════════════════════════

export async function createDocument(data: InsertDocument): Promise<Document> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(documents).values(data);
  const [row] = await db.select().from(documents)
    .where(and(eq(documents.matterId, data.matterId), eq(documents.phaseName, data.phaseName)))
    .orderBy(desc(documents.createdAt)).limit(1);
  if (!row) throw new Error('Document insert failed');
  return row;
}

export async function getDocumentById(documentId: number): Promise<Document | null> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const [row] = await db.select().from(documents)
    .where(eq(documents.id, documentId)).limit(1);
  return row ?? null;
}

export async function listDocuments(
  matterId: string,
  phaseName?: string,
  includeArchived = false,
): Promise<Document[]> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const conditions: ReturnType<typeof eq>[] = [eq(documents.matterId, matterId)];
  if (phaseName) conditions.push(eq(documents.phaseName, phaseName));
  if (!includeArchived) conditions.push(sql`${documents.status} != 'archived'` as any);
  return db.select().from(documents)
    .where(and(...conditions))
    .orderBy(asc(documents.createdAt));
}

export async function updateDocumentTitle(documentId: number, title: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(documents).set({ title, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

export async function updateDocumentNotes(documentId: number, notes: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(documents).set({ notes, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

export async function archiveDocument(documentId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(documents).set({ status: 'archived', updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

export async function setDocumentOfficialFinalVersion(
  documentId: number,
  versionNumber: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(documents)
    .set({ officialFinalVersionNumber: versionNumber, status: 'complete', updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

// ── getPhaseContainerStatus ──────────────────────────────────────────
// Per v1.4.2 §B.3.6 and v2.4.2 §3.2.
//
// INVARIANT: This is the ONLY sanctioned way to read phase container status
// on model-3 matters. Do NOT read phases.workflowState directly for
// document-holding phases on model-3 matters anywhere in the codebase.
export type PhaseContainerStatus = 'idle' | 'in_progress' | 'complete';

export async function getPhaseContainerStatus(
  matterId: string,
  phaseName: string,
): Promise<PhaseContainerStatus> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Non-document-holding phases: always derive from phases.workflowState (v2.3 semantics).
  if (!DOCUMENT_HOLDING_PHASES.has(phaseName)) {
    const phase = await getPhase(matterId, phaseName);
    if (!phase) return 'idle';
    const ws = phase.workflowState as string;
    if (ws === 'idle' || ws === 'model_selection') return 'idle';
    if (ws === 'complete' || ws === 'skipped') return 'complete';
    return 'in_progress';
  }

  // Document-holding phase: check matter's workflowModelVersion.
  const [matter] = await db.select({ workflowModelVersion: matters.workflowModelVersion })
    .from(matters).where(eq(matters.matterId, matterId)).limit(1);

  if (!matter) return 'idle';

  // Model-2 matters: fall through to v2.3 derivation.
  if ((matter.workflowModelVersion ?? 2) === 2) {
    const phase = await getPhase(matterId, phaseName);
    if (!phase) return 'idle';
    const ws = phase.workflowState as string;
    if (ws === 'idle' || ws === 'model_selection') return 'idle';
    if (ws === 'complete' || ws === 'skipped') return 'complete';
    return 'in_progress';
  }

  // Model-3 matters: derive from documents table.
  const docs = await listDocuments(matterId, phaseName, false); // non-archived only
  if (docs.length === 0) return 'idle';
  if (docs.every(d => d.status === 'complete')) return 'complete';
  return 'in_progress';
}

// ── FeedbackEvaluation helpers ────────────────────────────────────────

export async function createFeedbackEvaluation(data: InsertFeedbackEvaluation) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(feedbackEvaluations).values(data);
  const [row] = await db.select().from(feedbackEvaluations)
    .where(and(
      eq(feedbackEvaluations.matterId, data.matterId),
      eq(feedbackEvaluations.phaseName, data.phaseName),
      eq(feedbackEvaluations.versionNumber, data.versionNumber),
      eq(feedbackEvaluations.evaluatorProvider, data.evaluatorProvider),
    )).limit(1);
  return row;
}

export async function getFeedbackEvaluationsByVersion(
  matterId: string,
  phaseName: string,
  versionNumber: number,
  documentId?: number | null,
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const conditions: ReturnType<typeof eq>[] = [
    eq(feedbackEvaluations.matterId, matterId),
    eq(feedbackEvaluations.phaseName, phaseName),
    eq(feedbackEvaluations.versionNumber, versionNumber),
  ];
  if (documentId != null) conditions.push(eq(feedbackEvaluations.documentId, documentId));
  return db.select().from(feedbackEvaluations).where(and(...conditions));
}

// ── FeedbackManualSelection helpers ──────────────────────────────────

export async function createFeedbackManualSelection(data: InsertFeedbackManualSelection) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(feedbackManualSelections).values(data);
  const [row] = await db.select().from(feedbackManualSelections)
    .where(eq(feedbackManualSelections.feedbackId, data.feedbackId))
    .orderBy(desc(feedbackManualSelections.id)).limit(1);
  return row;
}
