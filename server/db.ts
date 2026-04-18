import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
} from "../drizzle/schema";
import { PHASE_NAMES, PHASE_ORDER, PHASE_CONFIG } from "../shared/workflow";
import { ENV } from './_core/env';

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

/**
 * Collect the official final content from all completed phases before `targetPhaseName`.
 * Returns a formatted string of prior phase outputs to use as source material.
 */
export async function collectPriorPhaseOutputs(matterId: string, targetPhaseName: string): Promise<string | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all phases for this matter
  const allPhases = await db.select().from(phases)
    .where(eq(phases.matterId, matterId))
    .orderBy(asc(phases.phaseOrder));

  const parts: string[] = [];

  for (const phase of allPhases) {
    // Only include phases that come before the target and are completed
    if (phase.phaseName === targetPhaseName) break;
    if (phase.status !== "completed") continue;

    // Get the official final version for this phase
    let content: string | null = null;

    if (phase.officialFinalVersion != null) {
      // Fetch the specific official final version
      const [row] = await db.select().from(versions)
        .where(and(
          eq(versions.matterId, matterId),
          eq(versions.phaseName, phase.phaseName),
          eq(versions.versionNumber, phase.officialFinalVersion),
        )).limit(1);
      content = row?.content ?? null;
    }

    if (!content) {
      // Fallback: get the selected version
      const [row] = await db.select().from(versions)
        .where(and(
          eq(versions.matterId, matterId),
          eq(versions.phaseName, phase.phaseName),
          eq(versions.isSelected, 1),
        )).limit(1);
      content = row?.content ?? null;
    }

    if (!content) {
      // Last resort: get the highest version number
      const [row] = await db.select().from(versions)
        .where(and(
          eq(versions.matterId, matterId),
          eq(versions.phaseName, phase.phaseName),
        ))
        .orderBy(desc(versions.versionNumber))
        .limit(1);
      content = row?.content ?? null;
    }

    if (content) {
      // Use the configured display label (e.g. "Advisory Memo", "Engagement Letter")
      const config = PHASE_CONFIG[phase.phaseName as keyof typeof PHASE_CONFIG];
      const label = config?.label ?? (phase.phaseName.charAt(0).toUpperCase() + phase.phaseName.slice(1));
      parts.push(`=== ${label.toUpperCase()} ===\n${content}`);
    }
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
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
  // Deselect all for this phase
  await db.update(versions).set({ isSelected: 0 })
    .where(and(eq(versions.matterId, matterId), eq(versions.phaseName, phaseName)));
  // Select the chosen one
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
  // Mark affected phases AND all downstream phases stale
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

// ── Matter Delete / Archive Helpers ───────────────────────────────────────────

/** Hard-delete a matter and all related rows (cascade). */
export async function deleteMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete child rows first (no FK cascade in TiDB by default)
  await db.delete(uploads).where(eq(uploads.matterId, matterId));
  await db.delete(feedback).where(eq(feedback.matterId, matterId));
  await db.delete(factChanges).where(eq(factChanges.matterId, matterId));
  await db.delete(versions).where(eq(versions.matterId, matterId));
  await db.delete(phases).where(eq(phases.matterId, matterId));
  await db.delete(matters).where(eq(matters.matterId, matterId));
  return { success: true };
}

/** Soft-archive a matter (status = 'archived'). */
export async function archiveMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ status: "archived" as any }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

/** Restore an archived matter back to active. */
export async function unarchiveMatter(matterId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(matters).set({ status: "active" as any }).where(eq(matters.matterId, matterId));
  return getMatterByMatterId(matterId);
}

/** Assign (or unassign) a matter to a folder. */
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

/** Delete a folder — unassigns all matters in it first. */
export async function deleteFolder(folderId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Unassign all matters from this folder
  await db.update(matters).set({ folderId: null }).where(eq(matters.folderId, folderId));
  await db.delete(matterFolders).where(eq(matterFolders.folderId, folderId));
  return { success: true };
}
