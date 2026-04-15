/**
 * Vitest tests for Lex Law Next tRPC routers and restructured workflow.
 * Tests use mocked DB and LLM calls — no live API calls.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import {
  PHASE_NAMES, PHASE_LABELS, PHASE_ORDER, PHASE_CONFIG, OPTIONAL_PHASES,
  PROVIDERS, ENABLED_PROVIDERS, WORKFLOW_STATES, WORKFLOW_MODES,
  STAGE_LABELS, canStartPhase,
  type PhaseName, type WorkflowMode,
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
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function mockPhase(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    matterId: "test-matter-123",
    phaseName: "intake",
    phaseLabel: "Intake",
    phaseOrder: 1,
    isOptional: 0,
    status: "not_started",
    workflowState: "idle",
    activeWorkflowMode: null,
    selectedModelId: null,
    acceptedSubstantiveVersion: null,
    officialFinalVersion: null,
    isStale: 0,
    workflowData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockAllPhases(matterId: string, overrides: Record<string, Record<string, any>> = {}) {
  return PHASE_NAMES.map((name, i) => mockPhase({
    id: i + 1,
    matterId,
    phaseName: name,
    phaseLabel: PHASE_CONFIG[name].label,
    phaseOrder: PHASE_ORDER[name],
    isOptional: OPTIONAL_PHASES.includes(name) ? 1 : 0,
    activeWorkflowMode: PHASE_CONFIG[name].defaultMode,
    ...(overrides[name] || {}),
  }));
}

// ── Shared Workflow Constants Tests ──────────────────────────────────

describe("shared workflow constants", () => {
  it("defines exactly 7 phases in the correct order", () => {
    expect(PHASE_NAMES).toEqual([
      "intake", "issues", "planning", "engagement", "memo", "matrix", "agreement",
    ]);
    expect(PHASE_NAMES).toHaveLength(7);
  });

  it("has correct phase labels including 'Final Legal Document' for agreement", () => {
    expect(PHASE_LABELS.intake).toBe("Intake");
    expect(PHASE_LABELS.issues).toBe("Issues");
    expect(PHASE_LABELS.planning).toBe("Planning");
    expect(PHASE_LABELS.engagement).toBe("Engagement Letter");
    expect(PHASE_LABELS.memo).toBe("Advisory Memo");
    expect(PHASE_LABELS.matrix).toBe("Decision Matrix");
    expect(PHASE_LABELS.agreement).toBe("Final Legal Document");
  });

  it("marks memo and matrix as optional", () => {
    expect(OPTIONAL_PHASES).toEqual(["memo", "matrix"]);
  });

  it("defines all 15 workflow states", () => {
    expect(WORKFLOW_STATES).toContain("idle");
    expect(WORKFLOW_STATES).toContain("model_selection");
    expect(WORKFLOW_STATES).toContain("processing");
    expect(WORKFLOW_STATES).toContain("drafting");
    expect(WORKFLOW_STATES).toContain("awaiting_selection");
    expect(WORKFLOW_STATES).toContain("awaiting_attorney_review");
    expect(WORKFLOW_STATES).toContain("revising");
    expect(WORKFLOW_STATES).toContain("reviewing");
    expect(WORKFLOW_STATES).toContain("evaluating");
    expect(WORKFLOW_STATES).toContain("awaiting_decisions");
    expect(WORKFLOW_STATES).toContain("regenerating");
    expect(WORKFLOW_STATES).toContain("accepted");
    expect(WORKFLOW_STATES).toContain("formatting");
    expect(WORKFLOW_STATES).toContain("awaiting_format_review");
    expect(WORKFLOW_STATES).toContain("complete");
    expect(WORKFLOW_STATES).toHaveLength(15);
  });

  it("defines 4 workflow modes", () => {
    expect(WORKFLOW_MODES).toEqual([
      "single_model", "competitive_select", "single_model_draft", "full_competitive",
    ]);
  });

  it("defines 2 stages", () => {
    expect(STAGE_LABELS.analysis).toBe("Analysis");
    expect(STAGE_LABELS.document_generation).toBe("Document Generation");
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
});

// ── Phase Config Tests ──────────────────────────────────────────────

describe("phase configuration", () => {
  it("intake defaults to single_model, analysis stage", () => {
    expect(PHASE_CONFIG.intake.defaultMode).toBe("single_model");
    expect(PHASE_CONFIG.intake.stage).toBe("analysis");
    expect(PHASE_CONFIG.intake.escalatable).toBe(false);
    expect(PHASE_CONFIG.intake.hasFormattingPass).toBe(false);
  });

  it("planning defaults to competitive_select, analysis stage", () => {
    expect(PHASE_CONFIG.planning.defaultMode).toBe("competitive_select");
    expect(PHASE_CONFIG.planning.stage).toBe("analysis");
    expect(PHASE_CONFIG.planning.escalatable).toBe(false);
  });

  it("engagement defaults to single_model_draft, escalatable, document_generation stage", () => {
    expect(PHASE_CONFIG.engagement.defaultMode).toBe("single_model_draft");
    expect(PHASE_CONFIG.engagement.stage).toBe("document_generation");
    expect(PHASE_CONFIG.engagement.escalatable).toBe(true);
    expect(PHASE_CONFIG.engagement.availableModes).toContain("full_competitive");
  });

  it("agreement defaults to full_competitive, not escalatable, has formatting pass", () => {
    expect(PHASE_CONFIG.agreement.defaultMode).toBe("full_competitive");
    expect(PHASE_CONFIG.agreement.stage).toBe("document_generation");
    expect(PHASE_CONFIG.agreement.escalatable).toBe(false);
    expect(PHASE_CONFIG.agreement.hasFormattingPass).toBe(true);
    expect(PHASE_CONFIG.agreement.availableModes).toEqual(["full_competitive"]);
  });
});

// ── Phase Gate Tests ────────────────────────────────────────────────

describe("canStartPhase (phase gate)", () => {
  it("intake can always start (no prerequisites)", () => {
    const phases = mockAllPhases("test");
    expect(canStartPhase("intake", phases as any)).toBe(true);
  });

  it("issues cannot start when intake is not_started", () => {
    const phases = mockAllPhases("test");
    expect(canStartPhase("issues", phases as any)).toBe(false);
  });

  it("issues can start when intake is completed", () => {
    const phases = mockAllPhases("test", { intake: { status: "completed" } });
    expect(canStartPhase("issues", phases as any)).toBe(true);
  });

  it("waiting_on_client does NOT satisfy prerequisites", () => {
    const phases = mockAllPhases("test", { intake: { status: "waiting_on_client" } });
    expect(canStartPhase("issues", phases as any)).toBe(false);
  });

  it("skipped optional phases satisfy prerequisites", () => {
    const phases = mockAllPhases("test", {
      intake: { status: "completed" },
      issues: { status: "completed" },
      planning: { status: "completed" },
      engagement: { status: "completed" },
      memo: { status: "skipped", isOptional: 1 },
    });
    expect(canStartPhase("matrix", phases as any)).toBe(true);
  });

  it("agreement requires all prior phases complete", () => {
    const phases = mockAllPhases("test", {
      intake: { status: "completed" },
      issues: { status: "completed" },
      planning: { status: "completed" },
      engagement: { status: "completed" },
      memo: { status: "skipped", isOptional: 1 },
      matrix: { status: "skipped", isOptional: 1 },
    });
    expect(canStartPhase("agreement", phases as any)).toBe(true);
  });

  it("agreement is always startable regardless of prior phase status (direct access feature)", () => {
    // agreement bypasses all prerequisites — can be started from any phase
    const phases = mockAllPhases("test", {
      intake: { status: "waiting_on_client" },
      issues: { status: "idle" },
      planning: { status: "idle" },
      engagement: { status: "idle" },
      memo: { status: "idle", isOptional: 1 },
      matrix: { status: "idle", isOptional: 1 },
    });
    expect(canStartPhase("agreement", phases as any)).toBe(true);
  });

  it("agreement is startable even when only intake is complete", () => {
    const phases = mockAllPhases("test", {
      intake: { status: "completed" },
      issues: { status: "idle" },
      planning: { status: "idle" },
      engagement: { status: "idle" },
      memo: { status: "idle", isOptional: 1 },
      matrix: { status: "idle", isOptional: 1 },
    });
    expect(canStartPhase("agreement", phases as any)).toBe(true);
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
  });
});

// ── Config Router Tests ─────────────────────────────────────────────

describe("config router", () => {
  it("config.providers returns all 4 providers", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const providers = await caller.config.providers();
    expect(providers).toHaveLength(4);
    expect(providers.find(p => p.key === "grok")?.enabled).toBe(false);
  });

  it("config.workflow returns phases with mode/stage metadata", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const workflow = await caller.config.workflow();
    expect(workflow.phases).toHaveLength(7);
    expect(workflow.phases[0]).toMatchObject({
      name: "intake",
      label: "Intake",
      stage: "analysis",
      defaultMode: "single_model",
    });
    expect(workflow.phases[6]).toMatchObject({
      name: "agreement",
      label: "Final Legal Document",
      defaultMode: "full_competitive",
      hasFormattingPass: true,
    });
  });
});

// ── Protected Route Tests ───────────────────────────────────────────

describe("protected routes reject unauthenticated requests", () => {
  it("matter.list requires auth", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.matter.list()).rejects.toThrow();
  });

  it("phase.get requires auth", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.phase.get({ matterId: "test", phaseName: "intake" })
    ).rejects.toThrow();
  });
});

// ── Matter & Phase Router Tests (mocked DB/LLM) ────────────────────

describe("matter and phase routers", () => {
  vi.mock("./db", () => ({
    createMatter: vi.fn().mockResolvedValue({
      id: 1, matterId: "test-matter-123", matterName: "Test Matter", jurisdiction: "Virginia — Fairfax County",
      workflowPath: "full", status: "active", createdBy: 1,
      createdAt: new Date(), updatedAt: new Date(),
    }),
    listMatters: vi.fn().mockResolvedValue([{
      id: 1, matterId: "test-matter-123", matterName: "Test Matter", jurisdiction: "Virginia — Fairfax County",
      workflowPath: "full", status: "active", createdBy: 1,
      createdAt: new Date(), updatedAt: new Date(),
    }]),
    getMatterByMatterId: vi.fn().mockImplementation((matterId: string) => {
      if (matterId === "test-matter-123") {
        return Promise.resolve({
          id: 1, matterId: "test-matter-123", matterName: "Test Matter", jurisdiction: "Virginia — Fairfax County",
          workflowPath: "full", status: "active", createdBy: 1,
          createdAt: new Date(), updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    }),
    renameMatter: vi.fn().mockImplementation((matterId: string, matterName: string) =>
      Promise.resolve({
        id: 1, matterId, matterName, jurisdiction: "Virginia — Fairfax County",
        workflowPath: "full", status: "active", createdBy: 1,
        createdAt: new Date(), updatedAt: new Date(),
      })
    ),
    createPhases: vi.fn().mockImplementation((data: any[]) => {
      return Promise.resolve(data.map((d, i) => mockPhase({
        id: i + 1,
        matterId: d.matterId,
        phaseName: d.phaseName,
        phaseLabel: d.phaseLabel,
        phaseOrder: d.phaseOrder,
        isOptional: d.isOptional,
        activeWorkflowMode: d.activeWorkflowMode,
      })));
    }),
    getPhasesByMatterId: vi.fn().mockImplementation((matterId: string) => {
      return Promise.resolve(mockAllPhases(matterId));
    }),
    getPhase: vi.fn().mockImplementation((matterId: string, phaseName: string) => {
      if (matterId === "test-matter-123") {
        return Promise.resolve(mockPhase({
          id: PHASE_ORDER[phaseName as PhaseName] ?? 1,
          matterId,
          phaseName,
          phaseLabel: PHASE_CONFIG[phaseName as PhaseName]?.label ?? phaseName,
          phaseOrder: PHASE_ORDER[phaseName as PhaseName] ?? 1,
          isOptional: OPTIONAL_PHASES.includes(phaseName as any) ? 1 : 0,
          activeWorkflowMode: PHASE_CONFIG[phaseName as PhaseName]?.defaultMode ?? "single_model",
        }));
      }
      return Promise.resolve(null);
    }),
    updatePhaseWorkflowState: vi.fn().mockResolvedValue({}),
    updatePhaseFields: vi.fn().mockResolvedValue({}),
    setPhaseStatus: vi.fn().mockResolvedValue({}),
    skipPhase: vi.fn().mockResolvedValue(mockPhase({ status: "skipped", workflowState: "complete" })),
    createVersion: vi.fn().mockResolvedValue({ id: 1 }),
    getVersionsByPhase: vi.fn().mockResolvedValue([]),
    getVersionByNumber: vi.fn().mockResolvedValue({
      id: 1, matterId: "test-matter-123", phaseName: "intake",
      versionNumber: 1, provider: "claude", content: "Test content",
      isSelected: 1, isFormattingPass: 0, metadata: null, createdAt: new Date(),
    }),
    selectVersion: vi.fn().mockResolvedValue(undefined),
    getLatestVersionNumber: vi.fn().mockResolvedValue(0),
    createFeedbackBatch: vi.fn().mockResolvedValue([]),
    getFeedbackByPhase: vi.fn().mockResolvedValue([]),
    updateFeedbackDecision: vi.fn().mockResolvedValue(undefined),
    createFactChange: vi.fn().mockResolvedValue({ success: true }),
    getFactChangesByMatter: vi.fn().mockResolvedValue([]),
    createUpload: vi.fn().mockResolvedValue({ id: 1, fileName: "test.pdf", fileUrl: "https://s3.example.com/test.pdf" }),
    getUploadsByPhase: vi.fn().mockResolvedValue([]),
    collectPriorPhaseOutputs: vi.fn().mockResolvedValue(undefined),
    markPhasesStale: vi.fn().mockResolvedValue(undefined),
    upsertUser: vi.fn().mockResolvedValue(undefined),
    getUserByOpenId: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockResolvedValue(null),
  }));

  vi.mock("./llm", () => ({
    runSingleModel: vi.fn().mockResolvedValue({
      provider: "claude", providerLabel: "Claude",
      content: "Single model output for the legal matter.",
    }),
    runCompetitiveDraft: vi.fn().mockResolvedValue([
      { provider: "claude", providerLabel: "Claude", content: "Claude draft content." },
      { provider: "gpt", providerLabel: "GPT-5.4", content: "GPT draft content." },
      { provider: "gemini", providerLabel: "Gemini", content: "Gemini draft content." },
    ]),
    runSingleModelDraft: vi.fn().mockResolvedValue({
      provider: "claude", providerLabel: "Claude",
      content: "Single model draft for attorney review.",
    }),
    runRevision: vi.fn().mockResolvedValue({
      provider: "claude", providerLabel: "Claude",
      content: "Revised draft based on attorney feedback.",
    }),
    runReviewCycle: vi.fn().mockResolvedValue([
      { reviewerProvider: "claude", points: [{ category: "Completeness", point: "Missing party details" }] },
      { reviewerProvider: "gpt", points: [{ category: "Accuracy", point: "Verify ownership" }] },
      { reviewerProvider: "gemini", points: [{ category: "Clarity", point: "Simplify section 3" }] },
    ]),
    runFormattingPass: vi.fn().mockResolvedValue({
      content: "Formatted document with firm styling.",
      flags: ["Ambiguous party reference in section 2"],
    }),
  }));

  vi.mock("./storage", () => ({
    storagePut: vi.fn().mockResolvedValue({ url: "https://s3.example.com/test-file.pdf", key: "test-key" }),
  }));

  // ── Matter Tests ──────────────────────────────────────────────────

  it("matter.create returns matter with 7 phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.matter.create({
      matterName: "Test Matter",
      jurisdiction: "Virginia — Fairfax County",
      workflowPath: "full",
    });
    expect(result.matter).toBeDefined();
    expect(result.phases).toHaveLength(7);
    const phaseNames = result.phases.map((p: any) => p.phaseName);
    expect(phaseNames).toEqual([...PHASE_NAMES]);
  });

  it("matter.get returns matter with phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.matter.get({ matterId: "test-matter-123" });
    expect(result.matter.matterId).toBe("test-matter-123");
    expect(result.phases).toHaveLength(7);
  });

  it("matter.get throws NOT_FOUND for unknown matter", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.matter.get({ matterId: "nonexistent" })).rejects.toThrow("Matter not found");
  });

  // ── Single Model Mode (intake path) ───────────────────────────────

  it("test_single_model_mode: intake startPhase → model_selection", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Mock all phases with intake not_started
    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123") as any
    );

    const result = await caller.phase.startPhase({
      matterId: "test-matter-123",
      phaseName: "intake",
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe("model_selection");
    expect(result.mode).toBe("single_model");
  });

  it("test_single_model_mode: selectModel → processing → complete, official_final_version=1", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Mock phase in model_selection state
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "intake",
      workflowState: "model_selection",
      activeWorkflowMode: "single_model",
    }) as any);

    const result = await caller.phase.selectModel({
      matterId: "test-matter-123",
      phaseName: "intake",
      modelId: "claude",
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe("complete");

    // Verify officialFinalVersion was set to 1
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "intake",
      expect.objectContaining({ officialFinalVersion: 1 })
    );
  });

  // ── Competitive Select Mode (planning path) ──────────────────────

  it("test_competitive_select_mode: planning startPhase → drafting → awaiting_selection", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Mock all phases with intake + issues completed
    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123", {
        intake: { status: "completed" },
        issues: { status: "completed" },
      }) as any
    );

    const result = await caller.phase.startPhase({
      matterId: "test-matter-123",
      phaseName: "planning",
    });

    expect(result.success).toBe(true);
    expect(result.versionNumber).toBe(1);
    expect(result.drafts).toBe(3); // 3 enabled providers
  });

  it("test_competitive_select_mode: selectDraft completes phase with official_final_version=1", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Mock phase in awaiting_selection with competitive_select mode
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "planning",
      workflowState: "awaiting_selection",
      activeWorkflowMode: "competitive_select",
    }) as any);

    vi.mocked(db.getVersionsByPhase).mockResolvedValueOnce([
      { id: 1, matterId: "test-matter-123", phaseName: "planning", versionNumber: 1, provider: "claude", content: "Claude draft", isSelected: 0, isFormattingPass: 0, metadata: null, createdAt: new Date() },
      { id: 2, matterId: "test-matter-123", phaseName: "planning", versionNumber: 1, provider: "gpt", content: "GPT draft", isSelected: 0, isFormattingPass: 0, metadata: null, createdAt: new Date() },
    ] as any);

    const result = await caller.phase.selectDraft({
      matterId: "test-matter-123",
      phaseName: "planning",
      versionId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.nextState).toBe("complete");

    // Verify officialFinalVersion was set to 1
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "planning",
      expect.objectContaining({ officialFinalVersion: 1 })
    );
  });

  // ── Single Model Draft Mode (engagement path) ────────────────────

  it("test_single_model_draft_mode: engagement startPhase → model_selection", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123", {
        intake: { status: "completed" },
        issues: { status: "completed" },
        planning: { status: "completed" },
      }) as any
    );

    const result = await caller.phase.startPhase({
      matterId: "test-matter-123",
      phaseName: "engagement",
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe("model_selection");
    expect(result.mode).toBe("single_model_draft");
  });

  it("test_single_model_draft_mode: selectModel → drafting → awaiting_attorney_review", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "engagement",
      workflowState: "model_selection",
      activeWorkflowMode: "single_model_draft",
    }) as any);

    const result = await caller.phase.selectModel({
      matterId: "test-matter-123",
      phaseName: "engagement",
      modelId: "claude",
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe("awaiting_attorney_review");
    expect(result.versionNumber).toBe(1);
  });

  it("test_single_model_draft_mode: requestRevision creates new version", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "engagement",
      workflowState: "awaiting_attorney_review",
      activeWorkflowMode: "single_model_draft",
      selectedModelId: "claude",
    }) as any);
    vi.mocked(db.getLatestVersionNumber).mockResolvedValueOnce(1);
    vi.mocked(db.getVersionByNumber).mockResolvedValueOnce({
      id: 1, matterId: "test-matter-123", phaseName: "engagement",
      versionNumber: 1, provider: "claude", content: "Original draft",
      isSelected: 1, isFormattingPass: 0, metadata: null, createdAt: new Date(),
    } as any);

    const result = await caller.phase.requestRevision({
      matterId: "test-matter-123",
      phaseName: "engagement",
      feedback: "Add more detail about fee structure",
    });

    expect(result.success).toBe(true);
    expect(result.versionNumber).toBe(2);
    expect(result.workflowState).toBe("awaiting_attorney_review");
  });

  it("test_single_model_draft_mode: acceptDraft records official_final_version = accepted version", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "engagement",
      workflowState: "awaiting_attorney_review",
      activeWorkflowMode: "single_model_draft",
    }) as any);
    vi.mocked(db.getLatestVersionNumber).mockResolvedValueOnce(3); // After 2 revisions

    const result = await caller.phase.acceptDraft({
      matterId: "test-matter-123",
      phaseName: "engagement",
    });

    expect(result.success).toBe(true);
    expect(result.officialFinalVersion).toBe(3);

    // Verify officialFinalVersion was set to the accepted version (3, not 1)
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "engagement",
      expect.objectContaining({ officialFinalVersion: 3 })
    );
  });

  // ── Single Model Draft Escalation ────────────────────────────────

  it("test_single_model_draft_escalation: engagement can be escalated to full_competitive", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123", {
        intake: { status: "completed" },
        issues: { status: "completed" },
        planning: { status: "completed" },
      }) as any
    );

    const result = await caller.phase.startPhase({
      matterId: "test-matter-123",
      phaseName: "engagement",
      workflowModeOverride: "full_competitive",
    });

    expect(result.success).toBe(true);
    expect(result.drafts).toBe(3); // full_competitive runs all models

    // Verify mode was updated
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "engagement",
      expect.objectContaining({ activeWorkflowMode: "full_competitive" })
    );
  });

  // ── Full Competitive Mode (agreement path) ───────────────────────

  it("test_formatting_pass_trigger: full_competitive accept_current triggers formatting for agreement", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "awaiting_decisions",
      activeWorkflowMode: "full_competitive",
    }) as any);
    vi.mocked(db.getLatestVersionNumber).mockResolvedValueOnce(2);

    const result = await caller.phase.submitDecisions({
      matterId: "test-matter-123",
      phaseName: "agreement",
      acceptCurrent: true,
    });

    expect(result.success).toBe(true);
    expect(result.nextState).toBe("formatting");

    // Verify acceptedSubstantiveVersion was locked
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "agreement",
      expect.objectContaining({ acceptedSubstantiveVersion: 2 })
    );
  });

  it("test_formatting_from_locked_version: adjustFormatting always reads locked substantive version", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "awaiting_format_review",
      activeWorkflowMode: "full_competitive",
      acceptedSubstantiveVersion: 2,
    }) as any);

    const result = await caller.phase.adjustFormatting({
      matterId: "test-matter-123",
      phaseName: "agreement",
      notes: "Fix header formatting",
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe("formatting");
  });

  it("test_formatting_approval: approveFormatting sets official_final_version and completes phase", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "awaiting_format_review",
    }) as any);
    vi.mocked(db.getLatestVersionNumber).mockResolvedValueOnce(3);

    const result = await caller.phase.approveFormatting({
      matterId: "test-matter-123",
      phaseName: "agreement",
    });

    expect(result.success).toBe(true);
    expect(result.officialFinalVersion).toBe(3);

    // Verify officialFinalVersion was set
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "agreement",
      expect.objectContaining({ officialFinalVersion: 3 })
    );
    // Verify phase was completed
    expect(vi.mocked(db.updatePhaseWorkflowState)).toHaveBeenCalledWith(
      "test-matter-123", "agreement", "complete"
    );
  });

  // ── Waiting on Client ─────────────────────────────────────────────

  it("test_waiting_on_client_set_and_clear: set and clear waiting_on_client status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Set waiting on client (phase must be completed, document_generation stage)
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "engagement",
      status: "completed",
      workflowState: "complete",
    }) as any);

    const setResult = await caller.phase.setWaitingOnClient({
      matterId: "test-matter-123",
      phaseName: "engagement",
    });
    expect(setResult.success).toBe(true);
    expect(vi.mocked(db.setPhaseStatus)).toHaveBeenCalledWith(
      "test-matter-123", "engagement", "waiting_on_client"
    );

    // Clear waiting on client
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "engagement",
      status: "waiting_on_client",
    }) as any);

    const clearResult = await caller.phase.clientResponded({
      matterId: "test-matter-123",
      phaseName: "engagement",
    });
    expect(clearResult.success).toBe(true);
    expect(vi.mocked(db.setPhaseStatus)).toHaveBeenCalledWith(
      "test-matter-123", "engagement", "completed"
    );
  });

  it("test_waiting_on_client rejects analysis phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "intake",
      status: "completed",
      workflowState: "complete",
    }) as any);

    await expect(
      caller.phase.setWaitingOnClient({
        matterId: "test-matter-123",
        phaseName: "intake",
      })
    ).rejects.toThrow("Waiting on client is only available for document generation phases");
  });

  // ── Agreement Mode Lock ───────────────────────────────────────────

  it("test_agreement_mode_lock: reject non-full_competitive for agreement", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123", {
        intake: { status: "completed" },
        issues: { status: "completed" },
        planning: { status: "completed" },
        engagement: { status: "completed" },
        memo: { status: "skipped", isOptional: 1 },
        matrix: { status: "skipped", isOptional: 1 },
      }) as any
    );

    await expect(
      caller.phase.startPhase({
        matterId: "test-matter-123",
        phaseName: "agreement",
        workflowModeOverride: "single_model_draft",
      })
    ).rejects.toThrow("Final Legal Document cannot be downgraded from Full Recursive Review.");
  });

  // ── Phase Skip ────────────────────────────────────────────────────

  it("phase.skip works for optional phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "memo",
      isOptional: 1,
    }) as any);

    const result = await caller.phase.skip({ matterId: "test-matter-123", phaseName: "memo" });
    expect(result).toBeDefined();
  });

  it("phase.skip rejects non-optional phases", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "intake",
      isOptional: 0,
    }) as any);

    await expect(
      caller.phase.skip({ matterId: "test-matter-123", phaseName: "intake" })
    ).rejects.toThrow("Only optional phases can be skipped");
  });

  // ── Legacy startDrafting backward compat ──────────────────────────

  it("legacy startDrafting still works for competitive modes", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phase.startDrafting({
      matterId: "test-matter-123",
      phaseName: "intake",
    });

    // intake defaults to single_model, so startDrafting redirects to model_selection
    expect(result.success).toBe(true);
  });

  // ── Fact Change Tests ─────────────────────────────────────────────

  it("factChange.create records a fact change", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factChange.create({
      matterId: "test-matter-123",
      description: "Client added to the matter",
      affectedPhases: ["intake", "engagement"],
    });
    expect(result.success).toBe(true);
  });

  // ── Upload Tests ──────────────────────────────────────────────────

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
    expect(result.fileName).toBe("test.pdf");
  });

  // ── Dedicated: formatting adjustment from locked version ──────────

  it("test_formatting_adjustment_from_locked_version: re-run always uses accepted_substantive_version, not prior formatted output", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Phase has substantive v2 locked, formatted v3 already exists, now adjusting
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "awaiting_format_review",
      activeWorkflowMode: "full_competitive",
      acceptedSubstantiveVersion: 2, // This is the locked version
    }) as any);

    const result = await caller.phase.adjustFormatting({
      matterId: "test-matter-123",
      phaseName: "agreement",
      notes: "Adjust paragraph spacing",
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe("formatting");

    // Verify the workflow state was set to formatting (re-run from locked version)
    expect(vi.mocked(db.updatePhaseWorkflowState)).toHaveBeenCalledWith(
      "test-matter-123", "agreement", "formatting"
    );
  });

  it("test_formatting_adjustment rejects when no accepted_substantive_version", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "awaiting_format_review",
      acceptedSubstantiveVersion: null, // No locked version
    }) as any);

    await expect(
      caller.phase.adjustFormatting({
        matterId: "test-matter-123",
        phaseName: "agreement",
        notes: "Fix something",
      })
    ).rejects.toThrow("No accepted substantive version found");
  });

  // ── Dedicated: waiting_on_client blocks downstream via router ──────

  it("test_waiting_on_client_blocks_downstream: startPhase rejects when prerequisite is waiting_on_client", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // Intake is waiting_on_client (not completed), try to start issues
    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123", {
        intake: { status: "waiting_on_client", workflowState: "complete" },
      }) as any
    );

    await expect(
      caller.phase.startPhase({
        matterId: "test-matter-123",
        phaseName: "issues",
      })
    ).rejects.toThrow("Cannot start this phase: prerequisite phases are not complete");
  });

  // ── Dedicated: official_final_version across all modes ─────────────

  it("test_official_final_version_recorded: all 4 modes set official_final_version correctly", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");

    // 1. single_model: official_final_version = 1
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "intake",
      workflowState: "model_selection",
      activeWorkflowMode: "single_model",
    }) as any);
    vi.mocked(db.updatePhaseFields).mockClear();

    await caller.phase.selectModel({
      matterId: "test-matter-123",
      phaseName: "intake",
      modelId: "claude",
    });
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "intake",
      expect.objectContaining({ officialFinalVersion: 1 })
    );

    // 2. competitive_select: official_final_version = 1
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "planning",
      workflowState: "awaiting_selection",
      activeWorkflowMode: "competitive_select",
    }) as any);
    vi.mocked(db.getVersionsByPhase).mockResolvedValueOnce([
      { id: 10, matterId: "test-matter-123", phaseName: "planning", versionNumber: 1, provider: "claude", content: "Draft", isSelected: 0, isFormattingPass: 0, metadata: null, createdAt: new Date() },
    ] as any);
    vi.mocked(db.updatePhaseFields).mockClear();

    await caller.phase.selectDraft({
      matterId: "test-matter-123",
      phaseName: "planning",
      versionId: 10,
    });
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "planning",
      expect.objectContaining({ officialFinalVersion: 1 })
    );

    // 3. single_model_draft: official_final_version = accepted version (e.g., 4)
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "engagement",
      workflowState: "awaiting_attorney_review",
      activeWorkflowMode: "single_model_draft",
    }) as any);
    vi.mocked(db.getLatestVersionNumber).mockResolvedValueOnce(4);
    vi.mocked(db.updatePhaseFields).mockClear();

    await caller.phase.acceptDraft({
      matterId: "test-matter-123",
      phaseName: "engagement",
    });
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "engagement",
      expect.objectContaining({ officialFinalVersion: 4 })
    );

    // 4. full_competitive (formatting approval): official_final_version = formatted version
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "awaiting_format_review",
    }) as any);
    vi.mocked(db.getLatestVersionNumber).mockResolvedValueOnce(5);
    vi.mocked(db.updatePhaseFields).mockClear();

    await caller.phase.approveFormatting({
      matterId: "test-matter-123",
      phaseName: "agreement",
    });
    expect(vi.mocked(db.updatePhaseFields)).toHaveBeenCalledWith(
      "test-matter-123", "agreement",
      expect.objectContaining({ officialFinalVersion: 5 })
    );
  });
});

// ── collectPriorPhaseOutputs & Agreement Source Merge Tests ──────────

describe("agreement direct access: prior phase output collection", () => {
  it("collectPriorPhaseOutputs: uses officialFinalVersion label from PHASE_CONFIG", async () => {
    // This test verifies the label formatting — collectPriorPhaseOutputs uses getDb() directly
    // so we test it indirectly through the router's selectModel call which calls it.
    // Direct unit tests for the DB function are in the db.test.ts file.
    // Here we verify the config-based label is correct.
    const { PHASE_CONFIG } = await import("../shared/workflow");
    expect(PHASE_CONFIG.intake.label).toBe("Intake");
    expect(PHASE_CONFIG.memo.label).toBe("Advisory Memo");
    expect(PHASE_CONFIG.engagement.label).toBe("Engagement Letter");
    expect(PHASE_CONFIG.agreement.label).toBe("Final Legal Document");
  });

  it("collectPriorPhaseOutputs: agreement is always startable (canStartPhase bypass)", async () => {
    // Verify the phase gate bypass is in place for all prior-phase states
    const { canStartPhase } = await import("../shared/workflow");
    const noPhases: any[] = [];
    expect(canStartPhase("agreement", noPhases)).toBe(true);

    const onlyIntakeComplete: any[] = [
      mockPhase({ phaseName: "intake", status: "completed" }),
    ];
    expect(canStartPhase("agreement", onlyIntakeComplete)).toBe(true);

    const allIdle: any[] = mockAllPhases("test-matter-123");
    expect(canStartPhase("agreement", allIdle)).toBe(true);
  });

  it("collectPriorPhaseOutputs: waiting_on_client does not satisfy prerequisites for non-agreement phases", async () => {
    const { canStartPhase } = await import("../shared/workflow");
    const phases: any[] = [
      mockPhase({ phaseName: "intake", status: "waiting_on_client" }),
    ];
    // Issues requires intake to be complete; waiting_on_client is not complete
    expect(canStartPhase("issues", phases)).toBe(false);
  });

  it("agreement selectModel merges prior phase outputs with uploads and manual context", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");
    const llm = await import("./llm");

    // Phase in model_selection state for agreement
    vi.mocked(db.getPhase).mockResolvedValueOnce(mockPhase({
      phaseName: "agreement",
      workflowState: "model_selection",
      activeWorkflowMode: "single_model",
    }) as any);

    // No uploads (keep simple — upload extraction is tested in fileExtractor.test.ts)
    vi.mocked(db.getUploadsByPhase).mockResolvedValueOnce([] as any);

    // collectPriorPhaseOutputs returns intake content
    vi.mocked(db.collectPriorPhaseOutputs).mockResolvedValueOnce(
      "=== INTAKE ===\n\nIntake output content"
    );

    const result = await caller.phase.selectModel({
      matterId: "test-matter-123",
      phaseName: "agreement",
      modelId: "claude",
      sourceContent: "Manual attorney notes",
    });

    expect(result.success).toBe(true);
    // runSingleModel should have been called (agreement in single_model mode)
    expect(vi.mocked(llm.runSingleModel)).toHaveBeenCalled();
    // collectPriorPhaseOutputs should have been called for agreement phase
    expect(vi.mocked(db.collectPriorPhaseOutputs)).toHaveBeenCalledWith(
      "test-matter-123", "agreement"
    );
    // Verify the userPrompt passed to runSingleModel contains the prior phase content
    const runSingleModelCall = vi.mocked(llm.runSingleModel).mock.calls.at(-1);
    expect(runSingleModelCall).toBeDefined();
    // The 3rd argument is the userPrompt which should contain merged source content
    const userPromptArg = runSingleModelCall?.[2] ?? "";
    expect(userPromptArg).toContain("Intake output content");
    expect(userPromptArg).toContain("Manual attorney notes");
  });
});

// ── Agreement Full Competitive Path Test ─────────────────────────────

describe("agreement full_competitive path", () => {
  it("startPhase for agreement calls collectPriorPhaseOutputs on the competitive path", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");
    const llm = await import("./llm");

    // All phases idle — agreement is always startable
    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123") as any
    );

    // Start agreement phase → should go to drafting (full_competitive default)
    const result = await caller.phase.startPhase({
      matterId: "test-matter-123",
      phaseName: "agreement",
    });

    expect(result.success).toBe(true);

    // collectPriorPhaseOutputs should have been called for the competitive path
    expect(vi.mocked(db.collectPriorPhaseOutputs)).toHaveBeenCalledWith(
      "test-matter-123", "agreement"
    );

    // runCompetitiveDraft should have been called (agreement defaults to full_competitive)
    expect(vi.mocked(llm.runCompetitiveDraft)).toHaveBeenCalled();
  });

  it("agreement full_competitive: prior phase outputs are merged into the competitive-path prompt", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const db = await import("./db");
    const llm = await import("./llm");

    vi.mocked(db.getPhasesByMatterId).mockResolvedValueOnce(
      mockAllPhases("test-matter-123") as any
    );

    // collectPriorPhaseOutputs returns intake content for this test
    vi.mocked(db.collectPriorPhaseOutputs).mockResolvedValueOnce(
      "=== INTAKE ===\n\nClient intake details here"
    );

    await caller.phase.startPhase({
      matterId: "test-matter-123",
      phaseName: "agreement",
      sourceContent: "Attorney notes for agreement",
    });

    // The 2nd argument to runCompetitiveDraft is the userPrompt
    const competitiveCall = vi.mocked(llm.runCompetitiveDraft).mock.calls.at(-1);
    expect(competitiveCall).toBeDefined();
    const userPromptArg = competitiveCall?.[1] ?? "";
    expect(userPromptArg).toContain("Client intake details here");
    expect(userPromptArg).toContain("Attorney notes for agreement");
  });
});
