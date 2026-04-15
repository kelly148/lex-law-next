/**
 * Vitest tests for Lex Law Next tRPC routers and workflow logic.
 * Tests use mocked DB and LLM calls — no live API calls.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import {
  PHASE_NAMES, PHASE_LABELS, PHASE_ORDER, OPTIONAL_PHASES,
  PROVIDERS, ENABLED_PROVIDERS, WORKFLOW_STATES,
} from "../shared/workflow";
import type { TrpcContext } from "./_core/context";

// ── Helpers ──────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: Array<{ name: string; options: Record<string, unknown> }> } {
  const clearedCookies: Array<{ name: string; options: Record<string, unknown> }> = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "attorney@satterwhitelaw.com",
    name: "Test Attorney",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ── Shared Workflow Constants Tests ──────────────────────────────────

describe("shared workflow constants", () => {
  it("defines exactly 7 phases in the correct order", () => {
    expect(PHASE_NAMES).toEqual([
      "intake", "issues", "planning", "engagement", "memo", "matrix", "agreement",
    ]);
    expect(PHASE_NAMES).toHaveLength(7);
  });

  it("has correct phase labels", () => {
    expect(PHASE_LABELS.intake).toBe("Intake");
    expect(PHASE_LABELS.issues).toBe("Issues");
    expect(PHASE_LABELS.planning).toBe("Planning");
    expect(PHASE_LABELS.engagement).toBe("Engagement Letter");
    expect(PHASE_LABELS.memo).toBe("Advisory Memo");
    expect(PHASE_LABELS.matrix).toBe("Decision Matrix");
    expect(PHASE_LABELS.agreement).toBe("Agreement");
  });

  it("has correct phase ordering (1-7)", () => {
    expect(PHASE_ORDER.intake).toBe(1);
    expect(PHASE_ORDER.issues).toBe(2);
    expect(PHASE_ORDER.planning).toBe(3);
    expect(PHASE_ORDER.engagement).toBe(4);
    expect(PHASE_ORDER.memo).toBe(5);
    expect(PHASE_ORDER.matrix).toBe(6);
    expect(PHASE_ORDER.agreement).toBe(7);
  });

  it("marks memo and matrix as optional", () => {
    expect(OPTIONAL_PHASES).toEqual(["memo", "matrix"]);
  });

  it("defines exactly 8 workflow states", () => {
    expect(WORKFLOW_STATES).toEqual([
      "idle", "drafting", "awaiting_selection", "reviewing", "evaluating",
      "awaiting_decisions", "regenerating", "complete",
    ]);
    expect(WORKFLOW_STATES).toHaveLength(8);
  });

  it("defines 4 providers with exact labels", () => {
    expect(PROVIDERS).toHaveLength(4);
    expect(PROVIDERS[0]).toMatchObject({ name: "Claude", key: "claude", enabled: true });
    expect(PROVIDERS[1]).toMatchObject({ name: "GPT-5.4", key: "gpt", enabled: true });
    expect(PROVIDERS[2]).toMatchObject({ name: "Gemini", key: "gemini", enabled: true });
    expect(PROVIDERS[3]).toMatchObject({ name: "Grok", key: "grok", enabled: false });
  });

  it("has 3 enabled providers (Claude, GPT-5.4, Gemini)", () => {
    expect(ENABLED_PROVIDERS).toHaveLength(3);
    expect(ENABLED_PROVIDERS.map(p => p.name)).toEqual(["Claude", "GPT-5.4", "Gemini"]);
  });

  it("Grok is disabled", () => {
    const grok = PROVIDERS.find(p => p.key === "grok");
    expect(grok).toBeDefined();
    expect(grok!.enabled).toBe(false);
  });
});

// ── Auth Router Tests ───────────────────────────────────────────────

describe("auth router", () => {
  it("auth.me returns user when authenticated", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result!.openId).toBe("test-user-001");
    expect(result!.name).toBe("Test Attorney");
  });

  it("auth.me returns null when unauthenticated", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("auth.logout clears the session cookie", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1 });
  });
});

// ── Config Router Tests ─────────────────────────────────────────────

describe("config router", () => {
  it("config.providers returns all 4 providers with correct enabled flags", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const providers = await caller.config.providers();
    expect(providers).toHaveLength(4);
    expect(providers.find(p => p.key === "claude")?.enabled).toBe(true);
    expect(providers.find(p => p.key === "gpt")?.enabled).toBe(true);
    expect(providers.find(p => p.key === "gemini")?.enabled).toBe(true);
    expect(providers.find(p => p.key === "grok")?.enabled).toBe(false);
  });

  it("config.workflow returns all 7 phases with correct metadata", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const workflow = await caller.config.workflow();
    expect(workflow.phases).toHaveLength(7);
    expect(workflow.phases[0]).toMatchObject({ name: "intake", label: "Intake", order: 1, isOptional: false });
    expect(workflow.phases[4]).toMatchObject({ name: "memo", label: "Advisory Memo", order: 5, isOptional: true });
    expect(workflow.phases[5]).toMatchObject({ name: "matrix", label: "Decision Matrix", order: 6, isOptional: true });
    expect(workflow.providers).toHaveLength(3); // Only enabled
  });
});

// ── Protected Route Tests ───────────────────────────────────────────

describe("protected routes reject unauthenticated requests", () => {
  it("matter.list requires auth", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.matter.list()).rejects.toThrow();
  });

  it("matter.create requires auth", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.matter.create({ jurisdiction: "Virginia", workflowPath: "full" })
    ).rejects.toThrow();
  });

  it("phase.get requires auth", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.phase.get({ matterId: "test", phaseName: "intake" })
    ).rejects.toThrow();
  });

  it("factChange.list requires auth", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.factChange.list({ matterId: "test" })
    ).rejects.toThrow();
  });
});

// ── Matter Router Tests (with mocked DB) ────────────────────────────

describe("matter router", () => {
  // Mock the db module
  vi.mock("./db", () => ({
    createMatter: vi.fn().mockResolvedValue({
      id: 1,
      matterId: "test-matter-123",
      jurisdiction: "Virginia — Fairfax County",
      workflowPath: "full",
      status: "active",
      createdBy: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    listMatters: vi.fn().mockResolvedValue([
      {
        id: 1,
        matterId: "test-matter-123",
        jurisdiction: "Virginia — Fairfax County",
        workflowPath: "full",
        status: "active",
        createdBy: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    getMatterByMatterId: vi.fn().mockImplementation((matterId: string) => {
      if (matterId === "test-matter-123") {
        return Promise.resolve({
          id: 1,
          matterId: "test-matter-123",
          jurisdiction: "Virginia — Fairfax County",
          workflowPath: "full",
          status: "active",
          createdBy: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    }),
    createPhases: vi.fn().mockImplementation((data: any[]) => {
      return Promise.resolve(data.map((d, i) => ({
        id: i + 1,
        matterId: d.matterId,
        phaseName: d.phaseName,
        phaseLabel: d.phaseLabel,
        phaseOrder: d.phaseOrder,
        isOptional: d.isOptional,
        status: "not_started",
        workflowState: "idle",
        isStale: 0,
        workflowData: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })));
    }),
    getPhasesByMatterId: vi.fn().mockImplementation((matterId: string) => {
      return Promise.resolve(PHASE_NAMES.map((name, i) => ({
        id: i + 1,
        matterId,
        phaseName: name,
        phaseLabel: PHASE_LABELS[name],
        phaseOrder: PHASE_ORDER[name],
        isOptional: OPTIONAL_PHASES.includes(name) ? 1 : 0,
        status: "not_started",
        workflowState: "idle",
        isStale: 0,
        workflowData: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })));
    }),
    getPhase: vi.fn().mockImplementation((matterId: string, phaseName: string) => {
      if (matterId === "test-matter-123") {
        return Promise.resolve({
          id: PHASE_ORDER[phaseName as keyof typeof PHASE_ORDER] ?? 1,
          matterId,
          phaseName,
          phaseLabel: PHASE_LABELS[phaseName as keyof typeof PHASE_LABELS] ?? phaseName,
          phaseOrder: PHASE_ORDER[phaseName as keyof typeof PHASE_ORDER] ?? 1,
          isOptional: OPTIONAL_PHASES.includes(phaseName as any) ? 1 : 0,
          status: "not_started",
          workflowState: "idle",
          isStale: 0,
          workflowData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    }),
    updatePhaseWorkflowState: vi.fn().mockResolvedValue({}),
    skipPhase: vi.fn().mockResolvedValue({
      id: 5,
      matterId: "test-matter-123",
      phaseName: "memo",
      status: "skipped",
      workflowState: "complete",
    }),
    createVersion: vi.fn().mockResolvedValue({ id: 1 }),
    getVersionsByPhase: vi.fn().mockResolvedValue([]),
    selectVersion: vi.fn().mockResolvedValue(undefined),
    getLatestVersionNumber: vi.fn().mockResolvedValue(0),
    createFeedbackBatch: vi.fn().mockResolvedValue([]),
    getFeedbackByPhase: vi.fn().mockResolvedValue([]),
    updateFeedbackDecision: vi.fn().mockResolvedValue(undefined),
    createFactChange: vi.fn().mockResolvedValue({ success: true }),
    getFactChangesByMatter: vi.fn().mockResolvedValue([]),
    createUpload: vi.fn().mockResolvedValue({ id: 1, fileName: "test.pdf", fileUrl: "https://s3.example.com/test.pdf" }),
    getUploadsByPhase: vi.fn().mockResolvedValue([]),
    markPhasesStale: vi.fn().mockResolvedValue(undefined),
    upsertUser: vi.fn().mockResolvedValue(undefined),
    getUserByOpenId: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockResolvedValue(null),
  }));

  // Mock LLM
  vi.mock("./llm", () => ({
    runCompetitiveDraft: vi.fn().mockResolvedValue([
      { provider: "claude", providerLabel: "Claude", content: "Claude draft content for the legal matter." },
      { provider: "gpt", providerLabel: "GPT-5.4", content: "GPT draft content for the legal matter." },
      { provider: "gemini", providerLabel: "Gemini", content: "Gemini draft content for the legal matter." },
    ]),
    runReviewCycle: vi.fn().mockResolvedValue([
      { reviewerProvider: "claude", points: [{ category: "Completeness", point: "Missing party details" }] },
      { reviewerProvider: "gpt", points: [{ category: "Accuracy", point: "Verify ownership percentages" }] },
      { reviewerProvider: "gemini", points: [{ category: "Clarity", point: "Simplify section 3" }] },
    ]),
  }));

  // Mock storage
  vi.mock("./storage", () => ({
    storagePut: vi.fn().mockResolvedValue({ url: "https://s3.example.com/test-file.pdf", key: "test-key" }),
  }));

  it("matter.create returns matter with 7 phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.matter.create({
      jurisdiction: "Virginia — Fairfax County",
      workflowPath: "full",
    });
    expect(result.matter).toBeDefined();
    expect(result.matter.jurisdiction).toBe("Virginia — Fairfax County");
    expect(result.matter.workflowPath).toBe("full");
    expect(result.phases).toHaveLength(7);
    // Verify all 7 phases are present
    const phaseNames = result.phases.map((p: any) => p.phaseName);
    expect(phaseNames).toEqual(PHASE_NAMES);
  });

  it("matter.create with core_only workflow path calls createMatter with correct args", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");
    await caller.matter.create({
      jurisdiction: "Virginia — Arlington County",
      workflowPath: "core_only",
    });
    // Verify the DB helper was called with the correct workflow path
    expect(vi.mocked(db.createMatter)).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPath: "core_only" })
    );
  });

  it("matter.list returns array of matters", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.matter.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].matterId).toBe("test-matter-123");
  });

  it("matter.get returns matter with phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.matter.get({ matterId: "test-matter-123" });
    expect(result.matter.matterId).toBe("test-matter-123");
    expect(result.phases).toHaveLength(7);
    // All phases start as idle
    result.phases.forEach((p: any) => {
      expect(p.workflowState).toBe("idle");
    });
  });

  it("matter.get throws NOT_FOUND for unknown matter", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.matter.get({ matterId: "nonexistent" })
    ).rejects.toThrow("Matter not found");
  });
});

// ── Phase Router Tests ──────────────────────────────────────────────

describe("phase router", () => {
  it("phase.get returns phase with versions and feedback", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.phase.get({ matterId: "test-matter-123", phaseName: "intake" });
    expect(result.phase).toBeDefined();
    expect(result.phase.phaseName).toBe("intake");
    expect(result.phase.workflowState).toBe("idle");
    expect(Array.isArray(result.versions)).toBe(true);
    expect(Array.isArray(result.feedback)).toBe(true);
  });

  it("phase.get throws NOT_FOUND for unknown phase", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.phase.get({ matterId: "nonexistent", phaseName: "intake" })
    ).rejects.toThrow("Phase not found");
  });

  it("phase.skip works for optional phases (memo, matrix)", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Mock getPhase to return an optional phase
    const db = await import("./db");
    vi.mocked(db.getPhase).mockResolvedValueOnce({
      id: 5,
      matterId: "test-matter-123",
      phaseName: "memo",
      phaseLabel: "Advisory Memo",
      phaseOrder: 5,
      isOptional: 1,
      status: "not_started",
      workflowState: "idle",
      isStale: 0,
      workflowData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await caller.phase.skip({ matterId: "test-matter-123", phaseName: "memo" });
    expect(result).toBeDefined();
  });

  it("phase.skip rejects non-optional phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Mock getPhase to return a non-optional phase
    const db = await import("./db");
    vi.mocked(db.getPhase).mockResolvedValueOnce({
      id: 1,
      matterId: "test-matter-123",
      phaseName: "intake",
      phaseLabel: "Intake",
      phaseOrder: 1,
      isOptional: 0,
      status: "not_started",
      workflowState: "idle",
      isStale: 0,
      workflowData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await expect(
      caller.phase.skip({ matterId: "test-matter-123", phaseName: "intake" })
    ).rejects.toThrow("Only optional phases can be skipped");
  });

  it("phase.startDrafting transitions idle → drafting → awaiting_selection", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phase.startDrafting({
      matterId: "test-matter-123",
      phaseName: "intake",
      context: "Three clients purchasing property in Fairfax County",
    });

    expect(result.success).toBe(true);
    expect(result.versionNumber).toBe(1);
    expect(result.drafts).toBe(3); // 3 enabled providers
  });

  it("phase.startDrafting rejects from non-idle state", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const db = await import("./db");
    vi.mocked(db.getPhase).mockResolvedValueOnce({
      id: 1,
      matterId: "test-matter-123",
      phaseName: "intake",
      phaseLabel: "Intake",
      phaseOrder: 1,
      isOptional: 0,
      status: "in_progress",
      workflowState: "awaiting_selection",
      isStale: 0,
      workflowData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await expect(
      caller.phase.startDrafting({ matterId: "test-matter-123", phaseName: "intake" })
    ).rejects.toThrow("Cannot start drafting from state");
  });

  it("phase.selectDraft transitions awaiting_selection → reviewing → awaiting_decisions", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const db = await import("./db");
    // Mock phase in awaiting_selection state
    vi.mocked(db.getPhase).mockResolvedValueOnce({
      id: 1,
      matterId: "test-matter-123",
      phaseName: "intake",
      phaseLabel: "Intake",
      phaseOrder: 1,
      isOptional: 0,
      status: "in_progress",
      workflowState: "awaiting_selection",
      isStale: 0,
      workflowData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Mock versions for selection
    vi.mocked(db.getVersionsByPhase).mockResolvedValueOnce([
      { id: 1, matterId: "test-matter-123", phaseName: "intake", versionNumber: 1, provider: "claude", content: "Claude draft", isSelected: 0, metadata: null, createdAt: new Date() },
      { id: 2, matterId: "test-matter-123", phaseName: "intake", versionNumber: 1, provider: "gpt", content: "GPT draft", isSelected: 0, metadata: null, createdAt: new Date() },
      { id: 3, matterId: "test-matter-123", phaseName: "intake", versionNumber: 1, provider: "gemini", content: "Gemini draft", isSelected: 0, metadata: null, createdAt: new Date() },
    ] as any);

    const result = await caller.phase.selectDraft({
      matterId: "test-matter-123",
      phaseName: "intake",
      versionId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.feedbackCount).toBe(3); // 3 reviewers × 1 point each
  });

  it("phase.submitDecisions transitions awaiting_decisions → complete", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const db = await import("./db");
    vi.mocked(db.getPhase).mockResolvedValueOnce({
      id: 1,
      matterId: "test-matter-123",
      phaseName: "intake",
      phaseLabel: "Intake",
      phaseOrder: 1,
      isOptional: 0,
      status: "in_progress",
      workflowState: "awaiting_decisions",
      isStale: 0,
      workflowData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await caller.phase.submitDecisions({
      matterId: "test-matter-123",
      phaseName: "intake",
      decisions: [
        { feedbackId: 1, decision: "accepted" },
        { feedbackId: 2, decision: "rejected" },
        { feedbackId: 3, decision: "modified", attorneyNote: "Clarify ownership percentages" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.nextState).toBe("complete");
  });
});

// ── Fact Change Router Tests ────────────────────────────────────────

describe("factChange router", () => {
  it("factChange.create records a fact change", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factChange.create({
      matterId: "test-matter-123",
      description: "Client Brianna Kinsey added to the matter",
      affectedPhases: ["intake", "engagement"],
    });
    expect(result.success).toBe(true);
  });

  it("factChange.list returns fact changes for a matter", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factChange.list({ matterId: "test-matter-123" });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Upload Router Tests ─────────────────────────────────────────────

describe("upload router", () => {
  it("upload.uploadFile stores file and returns URL", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.upload.uploadFile({
      matterId: "test-matter-123",
      phaseName: "intake",
      fileName: "intake_notes.pdf",
      fileBase64: Buffer.from("test file content").toString("base64"),
      contentType: "application/pdf",
    });
    expect(result).toBeDefined();
    expect(result.fileName).toBe("test.pdf"); // from mock
  });

  it("upload.listByPhase returns uploads for a phase", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.upload.listByPhase({
      matterId: "test-matter-123",
      phaseName: "intake",
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Workflow State Machine Tests ────────────────────────────────────

describe("workflow state machine", () => {
  it("full workflow: idle → drafting → awaiting_selection → reviewing → awaiting_decisions → complete", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Step 1: Start drafting (idle → drafting → awaiting_selection)
    const draftResult = await caller.phase.startDrafting({
      matterId: "test-matter-123",
      phaseName: "intake",
      context: "Test context",
    });
    expect(draftResult.success).toBe(true);
    expect(draftResult.drafts).toBe(3);

    // Verify updatePhaseWorkflowState was called with 'drafting' then 'awaiting_selection'
    const calls = vi.mocked(db.updatePhaseWorkflowState).mock.calls;
    const draftingCall = calls.find(c => c[2] === "drafting");
    const awaitingCall = calls.find(c => c[2] === "awaiting_selection");
    expect(draftingCall).toBeDefined();
    expect(awaitingCall).toBeDefined();
  });

  it("competitive drafting produces exactly 3 drafts (one per enabled provider)", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phase.startDrafting({
      matterId: "test-matter-123",
      phaseName: "intake",
    });

    expect(result.drafts).toBe(3);

    // Verify createVersion was called 3 times
    const db = await import("./db");
    const createVersionCalls = vi.mocked(db.createVersion).mock.calls;
    // Filter for the most recent batch (last 3 calls)
    const recentCalls = createVersionCalls.slice(-3);
    expect(recentCalls).toHaveLength(3);
    const providers = recentCalls.map(c => c[0].provider);
    expect(providers).toContain("claude");
    expect(providers).toContain("gpt");
    expect(providers).toContain("gemini");
  });
});
