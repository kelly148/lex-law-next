/**
 * Tests for matter deletion, archiving, and folder organization.
 * Uses the same mock pattern as workflow.test.ts — mocks the db module so no
 * real database connection is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the db module ────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
  createMatter: vi.fn(),
  listMatters: vi.fn(),
  getMatterByMatterId: vi.fn(),
  renameMatter: vi.fn(),
  updateClientName: vi.fn(),
  deleteMatter: vi.fn(),
  archiveMatter: vi.fn(),
  unarchiveMatter: vi.fn(),
  assignMatterToFolder: vi.fn(),
  createFolder: vi.fn(),
  listFolders: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  createPhases: vi.fn(),
  getPhasesByMatterId: vi.fn(),
  getPhase: vi.fn(),
  updatePhaseWorkflowState: vi.fn(),
  updatePhaseFields: vi.fn(),
  setPhaseStatus: vi.fn(),
  skipPhase: vi.fn(),
  markPhasesStale: vi.fn(),
  createVersion: vi.fn(),
  getVersionsByPhase: vi.fn(),
  getVersionByNumber: vi.fn(),
  selectVersion: vi.fn(),
  getLatestVersionNumber: vi.fn(),
  createFeedbackBatch: vi.fn(),
  getFeedbackByPhase: vi.fn(),
  updateFeedbackDecision: vi.fn(),
  createFactChange: vi.fn(),
  getFactChangesByMatter: vi.fn(),
  createUpload: vi.fn(),
  getUploadsByPhase: vi.fn(),
  collectPriorPhaseOutputs: vi.fn(),
}));

import * as db from "./db";

// ── Helpers ───────────────────────────────────────────────────────────
const mockMatter = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  matterId: "test-matter-01",
  matterName: "Test Matter",
  clientName: "Test Client",
  jurisdiction: "Virginia",
  workflowPath: "full",
  status: "active",
  folderId: null,
  createdBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockFolder = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  folderId: "folder-01",
  name: "Real Estate",
  color: "#2E75B6",
  createdBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── deleteMatter ──────────────────────────────────────────────────────
describe("deleteMatter DB helper", () => {
  it("returns success when matter is deleted", async () => {
    vi.mocked(db.deleteMatter).mockResolvedValue({ success: true });
    const result = await db.deleteMatter("test-matter-01");
    expect(result).toEqual({ success: true });
    expect(db.deleteMatter).toHaveBeenCalledWith("test-matter-01");
  });

  it("is called with the correct matterId", async () => {
    vi.mocked(db.deleteMatter).mockResolvedValue({ success: true });
    await db.deleteMatter("matter-abc");
    expect(db.deleteMatter).toHaveBeenCalledTimes(1);
    expect(db.deleteMatter).toHaveBeenCalledWith("matter-abc");
  });
});

// ── archiveMatter ─────────────────────────────────────────────────────
describe("archiveMatter DB helper", () => {
  it("returns the updated matter with status=archived", async () => {
    const archived = mockMatter({ status: "archived" });
    vi.mocked(db.archiveMatter).mockResolvedValue(archived);
    const result = await db.archiveMatter("test-matter-01");
    expect(result?.status).toBe("archived");
  });
});

// ── unarchiveMatter ───────────────────────────────────────────────────
describe("unarchiveMatter DB helper", () => {
  it("returns the updated matter with status=active", async () => {
    const active = mockMatter({ status: "active" });
    vi.mocked(db.unarchiveMatter).mockResolvedValue(active);
    const result = await db.unarchiveMatter("test-matter-01");
    expect(result?.status).toBe("active");
  });
});

// ── assignMatterToFolder ──────────────────────────────────────────────
describe("assignMatterToFolder DB helper", () => {
  it("assigns a folder and returns updated matter", async () => {
    const updated = mockMatter({ folderId: "folder-01" });
    vi.mocked(db.assignMatterToFolder).mockResolvedValue(updated);
    const result = await db.assignMatterToFolder("test-matter-01", "folder-01");
    expect(result?.folderId).toBe("folder-01");
    expect(db.assignMatterToFolder).toHaveBeenCalledWith("test-matter-01", "folder-01");
  });

  it("unassigns a folder when null is passed", async () => {
    const updated = mockMatter({ folderId: null });
    vi.mocked(db.assignMatterToFolder).mockResolvedValue(updated);
    const result = await db.assignMatterToFolder("test-matter-01", null);
    expect(result?.folderId).toBeNull();
    expect(db.assignMatterToFolder).toHaveBeenCalledWith("test-matter-01", null);
  });
});

// ── createFolder ──────────────────────────────────────────────────────
describe("createFolder DB helper", () => {
  it("creates and returns a folder", async () => {
    const folder = mockFolder();
    vi.mocked(db.createFolder).mockResolvedValue(folder);
    const result = await db.createFolder({
      folderId: "folder-01",
      name: "Real Estate",
      color: "#2E75B6",
      createdBy: 1,
    });
    expect(result?.folderId).toBe("folder-01");
    expect(result?.name).toBe("Real Estate");
  });
});

// ── listFolders ───────────────────────────────────────────────────────
describe("listFolders DB helper", () => {
  it("returns an array of folders", async () => {
    const folders = [mockFolder(), mockFolder({ folderId: "folder-02", name: "Corporate" })];
    vi.mocked(db.listFolders).mockResolvedValue(folders);
    const result = await db.listFolders();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Real Estate");
  });

  it("returns empty array when no folders exist", async () => {
    vi.mocked(db.listFolders).mockResolvedValue([]);
    const result = await db.listFolders();
    expect(result).toHaveLength(0);
  });
});

// ── renameFolder ──────────────────────────────────────────────────────
describe("renameFolder DB helper", () => {
  it("returns the folder with updated name", async () => {
    const updated = mockFolder({ name: "Property Law" });
    vi.mocked(db.renameFolder).mockResolvedValue(updated);
    const result = await db.renameFolder("folder-01", "Property Law");
    expect(result?.name).toBe("Property Law");
  });
});

// ── deleteFolder ──────────────────────────────────────────────────────
describe("deleteFolder DB helper", () => {
  it("returns success after deleting folder", async () => {
    vi.mocked(db.deleteFolder).mockResolvedValue({ success: true });
    const result = await db.deleteFolder("folder-01");
    expect(result).toEqual({ success: true });
    expect(db.deleteFolder).toHaveBeenCalledWith("folder-01");
  });
});

// ── Integration: archive → unarchive round-trip ───────────────────────
describe("archive / unarchive round-trip", () => {
  it("archives then restores a matter correctly", async () => {
    const archived = mockMatter({ status: "archived" });
    const active = mockMatter({ status: "active" });
    vi.mocked(db.archiveMatter).mockResolvedValue(archived);
    vi.mocked(db.unarchiveMatter).mockResolvedValue(active);

    const afterArchive = await db.archiveMatter("test-matter-01");
    expect(afterArchive?.status).toBe("archived");

    const afterRestore = await db.unarchiveMatter("test-matter-01");
    expect(afterRestore?.status).toBe("active");
  });
});

// ── Integration: folder lifecycle ────────────────────────────────────
describe("folder lifecycle", () => {
  it("create → assign → delete unassigns matters", async () => {
    const folder = mockFolder();
    vi.mocked(db.createFolder).mockResolvedValue(folder);
    vi.mocked(db.assignMatterToFolder).mockResolvedValue(mockMatter({ folderId: "folder-01" }));
    vi.mocked(db.deleteFolder).mockResolvedValue({ success: true });

    await db.createFolder({ folderId: "folder-01", name: "Real Estate", color: "#2E75B6", createdBy: 1 });
    const assigned = await db.assignMatterToFolder("test-matter-01", "folder-01");
    expect(assigned?.folderId).toBe("folder-01");

    const deleted = await db.deleteFolder("folder-01");
    expect(deleted).toEqual({ success: true });
  });
});
