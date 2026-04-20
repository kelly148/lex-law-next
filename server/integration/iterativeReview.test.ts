/**
 * Phase 4 Backend Integration Tests — Iterative Review Workflow
 *
 * 12 tests covering:
 *   T1:  Happy path full loop (requestFeedback → evaluateFeedback → submitEvaluationDecisions → acceptIterativeVersion)
 *   T2:  Manual path (requestFeedback → submitManualDecisions)
 *   T3:  Anchor failure (submitEvaluationDecisions with unresolvedAnchors → telemetry)
 *   T4:  Restart mid-loop (restartWithDifferentModel → cycleNumber=2, sourcePath='restart')
 *   T5:  Formatting circuit breaker (rejectFormatting x3 → acceptSubstantiveUnformatted)
 *   T6:  Concurrency race (Promise.all two evaluateFeedback → one CONFLICT)
 *   T7:  waiting_on_client restoration (setWaitingOnClientIterative → clientRespondedIterative)
 *   T8:  Legacy full_competitive regression (legacy_mode_used telemetry)
 *   T9:  All legacy mode regressions (single_model, single_model_draft, competitive_select)
 *   T10: Legacy data Zod defaults (iterativeMeta=NULL → no critical_parse_failure)
 *   T11: Corruption detection (malformed iterativeMeta → critical_parse_failure telemetry)
 *   T12: Token overflow (500k char file → [TRUNCATED AT LIMIT] in prompt)
 *
 * All tests use fixture-backed mocks — no live LLM calls.
 * DB is mocked via vi.mock('../db') — no live DB connections.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { appRouter } from '../routers';
import type { TrpcContext } from '../_core/context';
// ── vi.hoisted: hoist fixture file reads so they are available in vi.mock factories ──
const {
  reviewClaudeText,
  reviewOpenAIText,
  initialDraftText,
  revisedDocumentText,
  formattedDocumentText,
  restartDraftText,
  evaluationFixture,
  anchorFailureFixture,
  manualRevisedFixture,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path');
  const FIXTURES_DIR = join(__dirname, 'fixtures');
  return {
    reviewClaudeText: readFileSync(join(FIXTURES_DIR, 'fixture-review-claude.txt'), 'utf8') as string,
    reviewOpenAIText: readFileSync(join(FIXTURES_DIR, 'fixture-review-openai.txt'), 'utf8') as string,
    initialDraftText: readFileSync(join(FIXTURES_DIR, 'fixture-initial-draft.txt'), 'utf8') as string,
    revisedDocumentText: readFileSync(join(FIXTURES_DIR, 'fixture-revised-document.txt'), 'utf8') as string,
    formattedDocumentText: readFileSync(join(FIXTURES_DIR, 'fixture-formatted-document.txt'), 'utf8') as string,
    restartDraftText: readFileSync(join(FIXTURES_DIR, 'fixture-restart-draft.txt'), 'utf8') as string,
    evaluationFixture: JSON.parse(readFileSync(join(FIXTURES_DIR, 'fixture-evaluation.json'), 'utf8')) as {
      narrativeReasoning: string;
      pointByPoint: Array<{
        sourceFeedbackId: number;
        sourceReviewerProvider: string;
        sourceExcerpt: string;
        synthesizedRecommendation: string;
        severity: string;
        category: string;
        specificLocation: string;
        suggestedRevision: string;
      }>;
    },
    anchorFailureFixture: JSON.parse(readFileSync(join(FIXTURES_DIR, 'fixture-anchor-failure.json'), 'utf8')) as {
      revisedDocument: string;
      appliedChanges: Array<{ changeIndex: number; description: string }>;
      unresolvedAnchors: Array<{ anchorText: string; reason: string }>;
    },
    manualRevisedFixture: JSON.parse(readFileSync(join(FIXTURES_DIR, 'fixture-manual-revised.json'), 'utf8')) as {
      revisedDocument: string;
      appliedChanges: Array<{ changeIndex: number; description: string }>;
      unresolvedAnchors: Array<{ anchorText: string; reason: string }>;
    },
  };
});
// ── Auth context ──────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext['user']>;
function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: 'test-user-p4',
    email: 'attorney@satterwhitelaw.com',
    name: 'Test Attorney',
    loginMethod: 'manus',
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: () => {} } as TrpcContext['res'],
  };
  return { ctx };
}
// ── Phase factory ─────────────────────────────────────────────────────
function makePhase(overrides: Record<string, any> = {}) {
  return {
    id: 4,
    matterId: 'p4-matter-001',
    phaseName: 'engagement',
    phaseLabel: 'Engagement Letter',
    phaseOrder: 4,
    isOptional: 0,
    status: 'in_progress',
    workflowState: 'awaiting_attorney_review',
    activeWorkflowMode: 'iterative_review',
    selectedModelId: 'claude',
    acceptedSubstantiveVersion: null,
    officialFinalVersion: null,
    initialGeneratorModel: 'claude',
    iterativeMeta: {
      iterationNumber: 0,
      cycleNumber: 1,
      currentVersionModel: 'claude',
      lastEvaluatorModel: null,
      lastRegeneratorModel: null,
      feedbackCyclesCompleted: 0,
      formatRejectionCount: 0,
      preClientWaitState: null,
      isIterativeLoop: true,
    },
    promptMode: 'base',
    isStale: 0,
    workflowData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
// ── Shared evaluation row ─────────────────────────────────────────────
function makeEvaluationRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    matterId: 'p4-matter-001',
    phaseName: 'engagement',
    versionNumber: 1,
    evaluatorProvider: 'claude',
    narrativeReasoning: evaluationFixture.narrativeReasoning,
    pointByPoint: evaluationFixture.pointByPoint,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
// ── DB mock factory ───────────────────────────────────────────────────
/**
 * Creates a stateful DB mock that tracks workflowState, versions, and feedback.
 * Returns the mutable `state` object so tests can assert against it.
 */
async function setupStatefulMocks(initialPhaseOverrides: Record<string, any> = {}) {
  const db = await import('../db');
  const state = {
    phase: makePhase(initialPhaseOverrides),
    versionCounter: 1,
    versions: [
      {
        id: 1,
        matterId: 'p4-matter-001',
        phaseName: 'engagement',
        versionNumber: 1,
        provider: 'claude',
        content: initialDraftText,
        isSelected: 1,
        isFormattingPass: 0,
        metadata: { iteration: 0, cycleNumber: 1, sourcePath: 'initial', isFormatted: false, generatorProvider: 'claude' },
        createdAt: new Date(),
      },
    ] as Record<string, any>[],
    feedback: [] as Record<string, any>[],
    manualSelections: [] as Record<string, any>[],
    evaluations: [makeEvaluationRow()] as Record<string, any>[],
  };
  // Phase reads
  vi.mocked(db.getPhase).mockImplementation(() => Promise.resolve(state.phase as any));
  vi.mocked(db.updatePhaseWorkflowState).mockImplementation(
    (_matterId: string, _phaseName: string, newState: string) => {
      state.phase.workflowState = newState;
      return Promise.resolve(undefined as any);
    }
  );
  vi.mocked(db.updatePhaseWorkflowStateConditional).mockImplementation(
    (_phaseId: number, expectedState: string, newState: string, opts: any) => {
      if (state.phase.workflowState !== expectedState) {
        const { TRPCError } = require('@trpc/server');
        // Note: emitTelemetry is called by the real implementation
        // In the mock we just throw the CONFLICT error directly
        throw new TRPCError({
          code: 'CONFLICT',
          message: `concurrency_conflict: Phase is in state '${state.phase.workflowState}', not '${expectedState}'.`,
        });
      }
      state.phase.workflowState = newState;
      return Promise.resolve();
    }
  );
  vi.mocked(db.updatePhaseFields).mockImplementation(
    (_matterId: string, _phaseName: string, fields: Record<string, any>) => {
      Object.assign(state.phase, fields);
      return Promise.resolve(undefined as any);
    }
  );
  // Version management
  vi.mocked(db.createVersion).mockImplementation((data: any) => {
    state.versionCounter++;
    const v = {
      id: state.versionCounter,
      ...data,
      versionNumber: data.versionNumber ?? state.versionCounter,
    };
    state.versions.push(v);
    return Promise.resolve(v);
  });
  vi.mocked(db.getVersionByNumber).mockImplementation(
    (_matterId: string, _phaseName: string, versionNumber: number) => {
      const found = state.versions.find(v => v.versionNumber === versionNumber);
      return Promise.resolve(found ?? state.versions[0]);
    }
  );
  vi.mocked(db.getLatestVersionNumber).mockImplementation(() =>
    Promise.resolve(state.versionCounter)
  );
  vi.mocked(db.selectVersion).mockResolvedValue(undefined);
  // Feedback management
  vi.mocked(db.createFeedbackBatch).mockImplementation((items: any[]) => {
    const result = items.map((item, i) => {
      const fb = { id: state.feedback.length + i + 1, ...item };
      state.feedback.push(fb);
      return fb;
    });
    return Promise.resolve(result);
  });
  vi.mocked(db.getFeedbackByPhase).mockImplementation(() => {
    if (state.feedback.length > 0) return Promise.resolve(state.feedback as any);
    return Promise.resolve([
      { id: 1, matterId: 'p4-matter-001', phaseName: 'engagement', versionNumber: 1,
        reviewerProvider: 'claude', point: reviewClaudeText, decision: null },
      { id: 2, matterId: 'p4-matter-001', phaseName: 'engagement', versionNumber: 1,
        reviewerProvider: 'openai', point: reviewOpenAIText, decision: null },
    ] as any);
  });
  // getDb — chainable Drizzle-like mock
  function makeDbChain(defaultResult: any = state.evaluations): any {
    const chain: any = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'set', 'values', 'onDuplicateKeyUpdate']) {
      chain[method] = vi.fn().mockImplementation(() => chain);
    }
    chain.then = (resolve: any, reject: any) => Promise.resolve(defaultResult).then(resolve, reject);
    return chain;
  }
  vi.mocked(db.getDb).mockImplementation(() => {
    const selectChain = makeDbChain(state.evaluations);
    selectChain.limit.mockImplementation(() => Promise.resolve(state.evaluations));
    selectChain.orderBy.mockImplementation(() => ({
      limit: vi.fn().mockImplementation(() => Promise.resolve(state.evaluations)),
      then: (r: any, j: any) => Promise.resolve(state.evaluations).then(r, j),
    }));
    selectChain.where.mockImplementation(() => ({
      limit: vi.fn().mockImplementation(() => Promise.resolve(state.evaluations)),
      orderBy: vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockImplementation(() => Promise.resolve(state.evaluations)),
        then: (r: any, j: any) => Promise.resolve(state.evaluations).then(r, j),
      })),
      then: (r: any, j: any) => Promise.resolve(state.evaluations).then(r, j),
    }));
    const insertChain = {
      values: vi.fn().mockImplementation((rows: any) => {
        // Track manual selections
        if (Array.isArray(rows) && rows[0]?.feedbackId !== undefined) {
          state.manualSelections.push(...rows);
        }
        return {
          onDuplicateKeyUpdate: vi.fn().mockResolvedValue({}),
          then: (r: any, j: any) => Promise.resolve({}).then(r, j),
        };
      }),
      then: (r: any, j: any) => Promise.resolve({}).then(r, j),
    };
    return Promise.resolve({
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(insertChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
          then: (r: any, j: any) => Promise.resolve({}).then(r, j),
        }),
        then: (r: any, j: any) => Promise.resolve({}).then(r, j),
      }),
      execute: vi.fn().mockResolvedValue([[state.phase]]),
    } as any);
  });
  // Other helpers
  vi.mocked(db.getPhasesByMatterId).mockImplementation((matterId: string) =>
    Promise.resolve([state.phase] as any)
  );
  vi.mocked(db.collectPriorPhaseOutputs).mockResolvedValue(
    '=== INTAKE ===\n\nClient intake details' as any
  );
  vi.mocked(db.markPhasesStale).mockResolvedValue(undefined);
  vi.mocked(db.setPhaseStatus).mockResolvedValue({} as any);
  vi.mocked(db.getUploadsByPhase).mockResolvedValue([] as any);
  return state;
}
// ── Module-level mocks ────────────────────────────────────────────────
vi.mock('../db', () => ({
  getMatterByMatterId: vi.fn().mockResolvedValue({
    id: 1, matterId: 'p4-matter-001', matterName: 'P4 Integration Test',
    jurisdiction: 'Virginia', workflowPath: 'full', status: 'active',
    createdBy: 1, createdAt: new Date(), updatedAt: new Date(),
  }),
  listMatters: vi.fn().mockResolvedValue([]),
  renameMatter: vi.fn().mockResolvedValue({}),
  createPhases: vi.fn().mockImplementation((data: any[]) =>
    Promise.resolve(data.map((d, i) => ({ id: i + 1, ...d })))
  ),
  getPhasesByMatterId: vi.fn().mockResolvedValue([]),
  getPhase: vi.fn().mockResolvedValue(null),
  getPhaseWithMeta: vi.fn().mockResolvedValue(null),
  updatePhaseWorkflowState: vi.fn().mockResolvedValue(undefined),
  updatePhaseWorkflowStateConditional: vi.fn().mockResolvedValue(undefined),
  updatePhaseFields: vi.fn().mockResolvedValue(undefined),
  setPhaseStatus: vi.fn().mockResolvedValue({}),
  skipPhase: vi.fn().mockResolvedValue({}),
  createVersion: vi.fn().mockResolvedValue({ id: 1 }),
  getVersionsByPhase: vi.fn().mockResolvedValue([]),
  getVersionByNumber: vi.fn().mockResolvedValue(null),
  selectVersion: vi.fn().mockResolvedValue(undefined),
  getLatestVersionNumber: vi.fn().mockResolvedValue(0),
  createFeedbackBatch: vi.fn().mockResolvedValue([]),
  getFeedbackByPhase: vi.fn().mockResolvedValue([]),
  updateFeedbackDecision: vi.fn().mockResolvedValue(undefined),
  createFactChange: vi.fn().mockResolvedValue({ success: true }),
  getFactChangesByMatter: vi.fn().mockResolvedValue([]),
  createUpload: vi.fn().mockResolvedValue({ id: 1 }),
  getUploadsByPhase: vi.fn().mockResolvedValue([]),
  updateUploadExtractedText: vi.fn().mockResolvedValue(undefined),
  collectPriorPhaseOutputs: vi.fn().mockResolvedValue(''),
  markPhasesStale: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockResolvedValue(null),
  getEvaluationByVersion: vi.fn().mockResolvedValue(null),
}));
vi.mock('../llm', () => ({
  runSingleModel: vi.fn().mockResolvedValue({
    provider: 'claude', providerLabel: 'Claude',
    content: 'Single model output.',
  }),
  runCompetitiveDraft: vi.fn().mockResolvedValue([
    { provider: 'claude', providerLabel: 'Claude', content: 'Claude draft.' },
    { provider: 'gpt', providerLabel: 'GPT-5.4', content: 'GPT draft.' },
    { provider: 'gemini', providerLabel: 'Gemini', content: 'Gemini draft.' },
  ]),
  runSingleModelDraft: vi.fn().mockResolvedValue({
    provider: 'claude', providerLabel: 'Claude',
    content: initialDraftText,
  }),
  runRevision: vi.fn().mockResolvedValue({
    provider: 'claude', providerLabel: 'Claude',
    content: revisedDocumentText,
  }),
  runReviewCycle: vi.fn().mockResolvedValue([]),
  runFormattingPass: vi.fn().mockResolvedValue({
    content: formattedDocumentText, flags: [],
  }),
  runSingleReview: vi.fn().mockResolvedValue({
    provider: 'claude', content: reviewClaudeText,
  }),
  runFeedbackEvaluation: vi.fn().mockResolvedValue({
    provider: 'claude',
    rawOutput: JSON.stringify(evaluationFixture),
  }),
  runRevisionWithDecisions: vi.fn().mockResolvedValue({
    provider: 'claude',
    rawOutput: JSON.stringify({
      revisedDocument: revisedDocumentText,
      appliedChanges: [{ changeIndex: 0, description: 'Applied indemnification clause' }],
      unresolvedAnchors: [],
    }),
  }),
  runFormattingPassV2: vi.fn().mockResolvedValue({
    content: formattedDocumentText, flags: [],
  }),
  parseFormattingFlags: vi.fn().mockReturnValue([]),
}));
vi.mock('../storage', () => ({
  storagePut: vi.fn().mockResolvedValue({ url: 'https://s3.example.com/test.pdf', key: 'test-key' }),
}));
vi.mock('../contextBuilder', () => ({
  buildUserPrompt: vi.fn().mockReturnValue('Mocked user prompt for integration test'),
}));
// ── Tests ─────────────────────────────────────────────────────────────
describe('Phase 4 Integration Tests — Iterative Review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  // ── T1: Happy path full loop ────────────────────────────────────────
  it('T1: happy path full loop — requestFeedback → evaluateFeedback → submitEvaluationDecisions → acceptIterativeVersion → complete', async () => {
    const state = await setupStatefulMocks();
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const telemetry = await import('../../shared/telemetry');
    const telemetrySpy = vi.spyOn(telemetry, 'emitTelemetry');
    // Step 1: requestFeedback
    const fb = await caller.phase.requestFeedback({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
    });
    expect(fb.success).toBe(true);
    expect(fb.workflowState).toBe('awaiting_feedback_action');
    expect(fb.feedbackCount).toBeGreaterThan(0);
    // Step 2: evaluateFeedback
    const eval_ = await caller.phase.evaluateFeedback({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluatorModelId: 'claude',
    });
    expect(eval_.success).toBe(true);
    expect(eval_.workflowState).toBe('awaiting_evaluation_decisions');
    expect(eval_.evaluationId).toBeDefined();
    expect(eval_.pointByPointCount).toBeGreaterThan(0);
    // Step 3: submitEvaluationDecisions
    const decisions = await caller.phase.submitEvaluationDecisions({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluationId: eval_.evaluationId!,
      decisions: [
        { pointByPointIndex: 0, attorneyDecision: 'adopt' },
        { pointByPointIndex: 1, attorneyDecision: 'adopt' },
      ],
      regeneratorModelId: 'claude',
    });
    expect(decisions.success).toBe(true);
    expect(decisions.workflowState).toBe('awaiting_attorney_review');
    const v2Number = decisions.versionNumber!;
    expect(v2Number).toBeGreaterThan(1);
    // Step 4: acceptIterativeVersion (engagement has no formatting pass → complete)
    const accept = await caller.phase.acceptIterativeVersion({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: v2Number,
    });
    expect(accept.success).toBe(true);
    expect(accept.workflowState).toBe('complete');
    expect(state.phase.officialFinalVersion).toBe(v2Number);
    // Assert iterative_loop_completed telemetry was emitted
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'iterative_loop_completed' })
    );
  });
  // ── T2: Manual path ─────────────────────────────────────────────────
  it('T2: manual path — requestFeedback → submitManualDecisions → sourcePath=manual, feedback_manual_selections inserted', async () => {
    const state = await setupStatefulMocks();
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Step 1: requestFeedback
    const fb = await caller.phase.requestFeedback({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
    });
    expect(fb.success).toBe(true);
    expect(fb.workflowState).toBe('awaiting_feedback_action');
    // Override LLM to return manual-revised fixture
    const llm = await import('../llm');
    vi.mocked(llm.runRevisionWithDecisions).mockResolvedValueOnce({
      provider: 'claude',
      rawOutput: JSON.stringify(manualRevisedFixture),
    });
    // Step 2: submitManualDecisions
    const manual = await caller.phase.submitManualDecisions({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
      selections: [
        {
          sourceFeedbackId: 1,
          selectionOrder: 0,
          selectionKind: 'paragraph',
          sourceText: 'Our fees will be billed at standard hourly rates.',
          precedingContext: '2. FEES AND BILLING\n',
          followingContext: '\n3. CONFIDENTIALITY',
          editedText: 'Our fees will be billed at our standard hourly rates, currently ranging from $350 to $650 per hour.',
        },
        {
          sourceFeedbackId: 2,
          selectionOrder: 1,
          selectionKind: 'span',
          sourceText: 'All communications between you and the firm',
          precedingContext: '3. CONFIDENTIALITY\n',
          followingContext: ' are protected by attorney-client privilege.',
          editedText: null,
        },
      ],
      regeneratorModelId: 'claude',
    });
    expect(manual.success).toBe(true);
    expect(manual.workflowState).toBe('awaiting_attorney_review');
    // Assert a new version was created with sourcePath='manual'
    const manualVersion = state.versions.find(v => v.metadata?.sourcePath === 'manual');
    expect(manualVersion).toBeDefined();
    // Assert originatingSelectionIds is populated
    expect(manualVersion?.metadata?.originatingSelectionIds).toBeDefined();
    // Assert feedback_manual_selections rows were inserted
    expect(state.manualSelections.length).toBeGreaterThan(0);
  });
  // ── T3: Anchor failure ──────────────────────────────────────────────
  it('T3: anchor failure — submitEvaluationDecisions with unresolvedAnchors → metadata.unresolvedAnchors non-empty, anchor_resolution_failure telemetry', async () => {
    const state = await setupStatefulMocks({
      workflowState: 'awaiting_evaluation_decisions',
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const telemetry = await import('../../shared/telemetry');
    const telemetrySpy = vi.spyOn(telemetry, 'emitTelemetry');
    // Override LLM to return anchor-failure fixture
    const llm = await import('../llm');
    vi.mocked(llm.runRevisionWithDecisions).mockResolvedValueOnce({
      provider: 'claude',
      rawOutput: JSON.stringify(anchorFailureFixture),
    });
    const decisions = await caller.phase.submitEvaluationDecisions({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluationId: 1,
      decisions: [
        { pointByPointIndex: 0, attorneyDecision: 'adopt' },
        { pointByPointIndex: 2, attorneyDecision: 'adopt' },
      ],
      regeneratorModelId: 'claude',
    });
    expect(decisions.success).toBe(true);
    expect(decisions.unresolvedAnchors).toBeDefined();
    expect((decisions.unresolvedAnchors as any[]).length).toBeGreaterThan(0);
    // Assert anchor_resolution_failure telemetry was emitted
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'anchor_resolution_failure' })
    );
    // Assert the new version's metadata has unresolvedAnchors
    const newVersion = state.versions.find(v => v.versionNumber === decisions.versionNumber);
    expect(newVersion?.metadata?.unresolvedAnchors).toBeDefined();
    expect((newVersion?.metadata?.unresolvedAnchors as any[]).length).toBeGreaterThan(0);
  });
  // ── T4: Restart mid-loop ────────────────────────────────────────────
  it('T4: restart mid-loop — restartWithDifferentModel → cycleNumber=2, sourcePath=restart, prior cycle versions preserved', async () => {
    const state = await setupStatefulMocks({
      workflowState: 'awaiting_attorney_review',
      iterativeMeta: {
        iterationNumber: 1,
        cycleNumber: 1,
        currentVersionModel: 'claude',
        lastEvaluatorModel: 'claude',
        lastRegeneratorModel: 'claude',
        feedbackCyclesCompleted: 1,
        formatRejectionCount: 0,
        preClientWaitState: null,
        isIterativeLoop: true,
      },
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Override LLM to return restart draft
    const llm = await import('../llm');
    vi.mocked(llm.runSingleReview).mockResolvedValueOnce({
      provider: 'gpt',
      content: restartDraftText,
    });
    const priorVersionCount = state.versions.length;
    const restart = await caller.phase.restartWithDifferentModel({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      newGeneratorModelId: 'gpt',
    });
    expect(restart.success).toBe(true);
    expect(restart.workflowState).toBe('awaiting_attorney_review');
    // Assert cycleNumber incremented to 2
    expect(state.phase.iterativeMeta?.cycleNumber).toBe(2);
    expect(state.phase.iterativeMeta?.iterationNumber).toBe(0);
    expect(state.phase.initialGeneratorModel).toBe('gpt');
    // Assert new version has sourcePath='restart'
    const restartVersion = state.versions.find(v => v.metadata?.sourcePath === 'restart');
    expect(restartVersion).toBeDefined();
    expect(restartVersion?.metadata?.cycleNumber).toBe(2);
    // Prior cycle versions are preserved (not deleted)
    expect(state.versions.length).toBe(priorVersionCount + 1);
  });
  // ── T5: Formatting circuit breaker ──────────────────────────────────
  it('T5: formatting circuit breaker — rejectFormatting x3 → acceptSubstantiveUnformatted → formatRejectionCount=3, sourcePath=formatting_bypassed', async () => {
    // Use agreement phase (has formatting pass)
    const state = await setupStatefulMocks({
      id: 7,
      phaseName: 'agreement',
      phaseLabel: 'Final Legal Document',
      phaseOrder: 7,
      workflowState: 'awaiting_format_review',
      acceptedSubstantiveVersion: 1,
      iterativeMeta: {
        iterationNumber: 1,
        cycleNumber: 1,
        currentVersionModel: 'claude',
        lastEvaluatorModel: 'claude',
        lastRegeneratorModel: 'claude',
        feedbackCyclesCompleted: 1,
        formatRejectionCount: 0,
        preClientWaitState: null,
        isIterativeLoop: true,
      },
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Reject formatting 3 times (format_only)
    for (let i = 0; i < 3; i++) {
      const reject = await caller.phase.rejectFormatting({
        matterId: 'p4-matter-001',
        phaseName: 'agreement',
        kind: 'format_only',
      });
      expect(reject.success).toBe(true);
      expect(reject.workflowState).toBe('awaiting_format_review');
    }
    expect(state.phase.iterativeMeta?.formatRejectionCount).toBe(3);
    // Accept substantive unformatted (escape hatch)
    const accept = await caller.phase.acceptSubstantiveUnformatted({
      matterId: 'p4-matter-001',
      phaseName: 'agreement',
    });
    expect(accept.success).toBe(true);
    expect(accept.workflowState).toBe('complete');
    // Assert new version has sourcePath='formatting_bypassed'
    const bypassedVersion = state.versions.find(v => v.metadata?.sourcePath === 'formatting_bypassed');
    expect(bypassedVersion).toBeDefined();
    expect(state.phase.officialFinalVersion).toBeDefined();
  });
  // ── T6: Concurrency race ────────────────────────────────────────────
  it('T6: concurrency race — Promise.all two evaluateFeedback → one CONFLICT, no duplicate evaluation row', async () => {
    const state = await setupStatefulMocks({
      workflowState: 'awaiting_feedback_action',
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Fire two evaluateFeedback calls concurrently
    const results = await Promise.allSettled([
      caller.phase.evaluateFeedback({
        matterId: 'p4-matter-001',
        phaseName: 'engagement',
        versionNumber: 1,
        evaluatorModelId: 'claude',
      }),
      caller.phase.evaluateFeedback({
        matterId: 'p4-matter-001',
        phaseName: 'engagement',
        versionNumber: 1,
        evaluatorModelId: 'gpt',
      }),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    // Exactly one should succeed and one should fail with CONFLICT
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    // TRPCError with code CONFLICT - the mock throws with 'concurrency_conflict' in message
    const errorCode = rejectedReason?.code ?? '';
    const errorMsg = rejectedReason?.message ?? String(rejectedReason);
    expect(errorCode + ' ' + errorMsg).toMatch(/CONFLICT|conflict|concurrency/i);
    // Verify the state machine only advanced once (no duplicate state transition)
    // The successful call should have left the phase in awaiting_evaluation_decisions
    expect(state.phase.workflowState).toBe('awaiting_evaluation_decisions');
  });
  // ── T7: waiting_on_client restoration ──────────────────────────────
  it('T7: waiting_on_client — setWaitingOnClientIterative stores preClientWaitState → clientRespondedIterative restores it', async () => {
    const state = await setupStatefulMocks({
      workflowState: 'awaiting_feedback_action',
      status: 'in_progress',
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Set waiting on client
    const waitResult = await caller.phase.setWaitingOnClientIterative({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
    });
    expect(waitResult.success).toBe(true);
    expect(waitResult.previousState).toBe('awaiting_feedback_action');
    // Assert preClientWaitState was stored
    expect(state.phase.iterativeMeta?.preClientWaitState).toBe('awaiting_feedback_action');
    // Simulate waiting_on_client status
    state.phase.status = 'waiting_on_client';
    // Client responded
    const respondResult = await caller.phase.clientRespondedIterative({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
    });
    expect(respondResult.success).toBe(true);
    expect(respondResult.restoredState).toBe('awaiting_feedback_action');
    // Assert preClientWaitState was cleared
    expect(state.phase.iterativeMeta?.preClientWaitState).toBeNull();
  });
  // ── T8: Legacy full_competitive regression ──────────────────────────
  it('T8: legacy full_competitive — startPhase with workflowModeOverride=full_competitive → legacy_mode_used telemetry', async () => {
    const state = await setupStatefulMocks({
      id: 7,
      phaseName: 'agreement',
      phaseLabel: 'Final Legal Document',
      phaseOrder: 7,
      workflowState: 'idle',
      activeWorkflowMode: 'iterative_review',
      status: 'not_started',
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const telemetry = await import('../../shared/telemetry');
    const telemetrySpy = vi.spyOn(telemetry, 'emitTelemetry');
    const llm = await import('../llm');
    const result = await caller.phase.startPhase({
      matterId: 'p4-matter-001',
      phaseName: 'agreement',
      workflowModeOverride: 'full_competitive',
    });
    expect(result.success).toBe(true);
    expect(vi.mocked(llm.runCompetitiveDraft)).toHaveBeenCalled();
    // Assert legacy_mode_used telemetry was emitted
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'legacy_mode_used', mode: 'full_competitive' })
    );
  });
  // ── T9: All legacy mode regressions ────────────────────────────────
  it('T9: all legacy modes — single_model_draft, competitive_select, full_competitive each complete without error', async () => {
    const db = await import('../db');
    const { ctx } = createAuthContext();
    // Helper: add intake=completed to getPhasesByMatterId mock so canStartPhase passes
    const intakeCompleted = {
      id: 99, matterId: 'p4-matter-001', phaseName: 'intake', phaseLabel: 'Intake',
      phaseOrder: 1, status: 'completed', workflowState: 'complete',
      activeWorkflowMode: 'single_model', selectedModelId: 'claude',
      acceptedSubstantiveVersion: null, officialFinalVersion: null,
      initialGeneratorModel: 'claude', iterativeMeta: null, promptMode: 'base',
      isOptional: 0, isStale: 0, workflowData: null, createdAt: new Date(), updatedAt: new Date(),
    };
    // single_model_draft (engagement phase supports this mode)
    const state1 = await setupStatefulMocks({
      workflowState: 'idle',
      activeWorkflowMode: 'single_model_draft',
      status: 'not_started',
    });
    vi.mocked(db.getPhasesByMatterId).mockResolvedValue([intakeCompleted, state1.phase] as any);
    const caller1 = appRouter.createCaller(ctx);
    const r1 = await caller1.phase.startPhase({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      workflowModeOverride: 'single_model_draft',
    });
    expect(r1.success).toBe(true);
    // competitive_select
    const state2 = await setupStatefulMocks({
      workflowState: 'idle',
      activeWorkflowMode: 'competitive_select',
      status: 'not_started',
    });
    vi.mocked(db.getPhasesByMatterId).mockResolvedValue([intakeCompleted, state2.phase] as any);
    const caller2 = appRouter.createCaller(ctx);
    const r2 = await caller2.phase.startPhase({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      workflowModeOverride: 'competitive_select',
    });
    expect(r2.success).toBe(true);
    // full_competitive (engagement phase supports this mode)
    const state3 = await setupStatefulMocks({
      workflowState: 'idle',
      activeWorkflowMode: 'full_competitive',
      status: 'not_started',
    });
    vi.mocked(db.getPhasesByMatterId).mockResolvedValue([intakeCompleted, state3.phase] as any);
    const caller3 = appRouter.createCaller(ctx);
    const r3 = await caller3.phase.startPhase({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      workflowModeOverride: 'full_competitive',
    });
    expect(r3.success).toBe(true);
  });
  // ── T10: Legacy data Zod defaults ──────────────────────────────────
  it('T10: legacy data — iterativeMeta=NULL → parseIterativeMeta returns defaults, no critical_parse_failure telemetry', async () => {
    const telemetry = await import('../../shared/telemetry');
    const telemetrySpy = vi.spyOn(telemetry, 'emitTelemetry');
    // Import the REAL parseIterativeMeta (not mocked — it's in shared/)
    const { parseIterativeMeta } = await import('../../shared/schemas/iterativeMeta');
    // Test with null (legacy row)
    const result = parseIterativeMeta(null, { phaseId: 99 });
    // Should not throw and should return defaults
    expect(result).toBeDefined();
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(1);
    expect(result.isIterativeLoop).toBe(false);
    // No critical_parse_failure telemetry should have been emitted
    const criticalCalls = telemetrySpy.mock.calls.filter(
      call => call[0]?.kind === 'critical_parse_failure'
    );
    expect(criticalCalls.length).toBe(0);
  });
  // ── T11: Corruption detection ───────────────────────────────────────
  it('T11: corruption — malformed iterativeMeta → critical_parse_failure telemetry emitted, no throw, defaults returned', async () => {
    // Import the REAL parseIterativeMeta (not mocked — it's in shared/)
    const { parseIterativeMeta } = await import('../../shared/schemas/iterativeMeta');
    // Spy on emitCriticalParseFailure directly (same module instance used by parseIterativeMeta)
    const telemetry = await import('../../shared/telemetry');
    const criticalSpy = vi.spyOn(telemetry, 'emitCriticalParseFailure');
    // Test with corrupt data
    let result: any;
    let threw = false;
    try {
      result = parseIterativeMeta({ iterationNumber: 'not_a_number' }, { phaseId: 100 });
    } catch {
      threw = true;
    }
    // Should NOT throw
    expect(threw).toBe(false);
    // Should return defaults
    expect(result.iterationNumber).toBe(0);
    expect(result.cycleNumber).toBe(1);
    // critical_parse_failure telemetry MUST have been emitted
    expect(criticalSpy).toHaveBeenCalledWith('iterativeMeta', 100);
    criticalSpy.mockRestore();
  });
  // ── T12: Token overflow ─────────────────────────────────────────────
  it('T12: token overflow — 500k char file → [TRUNCATED AT LIMIT] marker in prompt, reviewers still produce valid output', async () => {
    const state = await setupStatefulMocks();
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Override getUploadsByPhase to return a file with 500k chars of extractedText
    const db = await import('../db');
    const bigText = 'A'.repeat(500_000);
    vi.mocked(db.getUploadsByPhase).mockResolvedValue([
      {
        id: 1,
        matterId: 'p4-matter-001',
        phaseName: 'engagement',
        fileName: 'large-intake-file.txt',
        fileUrl: 'https://s3.example.com/large-file.txt',
        fileKey: 'large-file.txt',
        mimeType: 'text/plain',
        fileSize: 500_000,
        extractedText: bigText,
        createdAt: new Date(),
      },
    ] as any);
    // Override contextBuilder to use the real buildUserPrompt (not the mock)
    // so we can verify truncation actually happens
    // Use vi.importActual to get the real implementation without circular reference
    const realContextBuilder = await vi.importActual<typeof import('../contextBuilder')>('../contextBuilder');
    const contextBuilder = await import('../contextBuilder');
    let capturedPrompt = '';
    const buildSpy = vi.spyOn(contextBuilder, 'buildUserPrompt').mockImplementation((...args: Parameters<typeof realContextBuilder.buildUserPrompt>) => {
      const result = realContextBuilder.buildUserPrompt(...args);
      capturedPrompt = result;
      return result;
    });
    const fb = await caller.phase.requestFeedback({
      matterId: 'p4-matter-001',
      phaseName: 'engagement',
      versionNumber: 1,
    });
    expect(fb.success).toBe(true);
    // Assert [TRUNCATED AT LIMIT] marker appears in the prompt
    expect(capturedPrompt).toContain('[TRUNCATED AT LIMIT');
    // Reviewers still produced valid output (feedback rows created)
    expect(fb.feedbackCount).toBeGreaterThan(0);
    // Restore mock
    buildSpy.mockRestore();
  });
});
