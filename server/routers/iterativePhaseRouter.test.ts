/**
 * Step 8: Backend integration test for the iterative_review workflow.
 *
 * Tests a full loop via tRPC caller with mocked DB and LLM responses:
 *   startPhase → selectModel → requestFeedback → evaluateFeedback →
 *   submitEvaluationDecisions → acceptIterativeVersion
 *
 * Also includes regression tests for single_model_draft and full_competitive.
 *
 * Pattern: vi.mock factory sets defaults; per-test overrides use
 *   `const db = await import('../db'); vi.mocked(db.fn).mockImplementation(...)`
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { appRouter } from '../routers';
import {
  PHASE_NAMES, PHASE_ORDER, PHASE_CONFIG, OPTIONAL_PHASES,
  type PhaseName,
} from '../../shared/workflow';
import type { TrpcContext } from '../_core/context';

// ── Helpers ──────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext['user']>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: 'test-user-001',
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

/** Valid pointByPoint data matching the actual Zod schema (pointByPointItemSchema) */
function makeValidPointByPoint() {
  return [
    {
      sourceFeedbackId: 1,
      sourceReviewerProvider: 'gpt',
      sourceExcerpt: 'Consider adding indemnification clause',
      sectionAnchor: {
        kind: 'section_reference' as const,
        value: 'Section 4',
        locatorText: 'Section 4 - Liability',
      },
      recommendation: 'adopt' as const,
      reasoning: 'Important for client protection',
      suggestedText: 'Add indemnification clause per standard practice',
      attorneyDecision: null,
      attorneyModifiedText: null,
    },
    {
      sourceFeedbackId: 2,
      sourceReviewerProvider: 'gemini',
      sourceExcerpt: 'Fee structure needs clarification',
      sectionAnchor: {
        kind: 'paragraph_start' as const,
        value: 'Section 2',
        locatorText: 'Section 2 - Fees and Billing',
      },
      recommendation: 'modify' as const,
      reasoning: 'Fee structure is adequate but could be clearer',
      suggestedText: 'Clarify hourly rate vs flat fee distinction',
      attorneyDecision: null,
      attorneyModifiedText: null,
    },
  ];
}

function mockPhase(overrides: Record<string, any> = {}) {
  return {
    id: 4,
    matterId: 'test-matter-iter',
    phaseName: 'engagement',
    phaseLabel: 'Engagement Letter',
    phaseOrder: 4,
    isOptional: 0,
    status: 'not_started',
    workflowState: 'idle',
    activeWorkflowMode: 'iterative_review',
    selectedModelId: null,
    acceptedSubstantiveVersion: null,
    officialFinalVersion: null,
    initialGeneratorModel: null,
    iterativeMeta: null,
    promptMode: 'base',
    isStale: 0,
    workflowData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockAllPhases(matterId: string) {
  return PHASE_NAMES.map((name, i) => ({
    id: i + 1,
    matterId,
    phaseName: name,
    phaseLabel: PHASE_CONFIG[name].label,
    phaseOrder: PHASE_ORDER[name],
    isOptional: OPTIONAL_PHASES.includes(name) ? 1 : 0,
    activeWorkflowMode: PHASE_CONFIG[name].defaultMode,
    status: i < 3 ? 'completed' : 'not_started',
    workflowState: i < 3 ? 'complete' : 'idle',
    selectedModelId: null,
    acceptedSubstantiveVersion: null,
    officialFinalVersion: null,
    initialGeneratorModel: null,
    iterativeMeta: null,
    promptMode: 'base',
    isStale: 0,
    workflowData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../db', () => ({
  createMatter: vi.fn().mockResolvedValue({
    id: 1, matterId: 'test-matter-iter', matterName: 'Iterative Test',
    jurisdiction: 'Virginia', workflowPath: 'full', status: 'active',
    createdBy: 1, createdAt: new Date(), updatedAt: new Date(),
  }),
  listMatters: vi.fn().mockResolvedValue([]),
  getMatterByMatterId: vi.fn().mockResolvedValue({
    id: 1, matterId: 'test-matter-iter', matterName: 'Iterative Test',
    jurisdiction: 'Virginia', workflowPath: 'full', status: 'active',
    createdBy: 1, createdAt: new Date(), updatedAt: new Date(),
  }),
  renameMatter: vi.fn().mockResolvedValue({}),
  createPhases: vi.fn().mockImplementation((data: any[]) =>
    Promise.resolve(data.map((d, i) => ({ id: i + 1, ...d })))
  ),
  getPhasesByMatterId: vi.fn().mockImplementation((matterId: string) =>
    Promise.resolve(mockAllPhases(matterId))
  ),
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
  collectPriorPhaseOutputs: vi.fn().mockResolvedValue(
    '=== INTAKE ===\n\nClient intake details\n\n---\n\n=== ISSUES ===\n\nLegal issues identified'
  ),
  markPhasesStale: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock('../llm', () => ({
  runSingleModel: vi.fn().mockResolvedValue({
    provider: 'claude', providerLabel: 'Claude',
    content: 'Single model output for the legal matter.',
  }),
  runCompetitiveDraft: vi.fn().mockResolvedValue([
    { provider: 'claude', providerLabel: 'Claude', content: 'Claude draft content.' },
    { provider: 'gpt', providerLabel: 'GPT-5.4', content: 'GPT draft content.' },
    { provider: 'gemini', providerLabel: 'Gemini', content: 'Gemini draft content.' },
  ]),
  runSingleModelDraft: vi.fn().mockResolvedValue({
    provider: 'claude', providerLabel: 'Claude',
    content: 'Initial draft content for engagement letter.',
  }),
  runRevision: vi.fn().mockResolvedValue({
    provider: 'claude', providerLabel: 'Claude',
    content: 'Revised draft based on attorney feedback.',
  }),
  runReviewCycle: vi.fn().mockResolvedValue([]),
  runFormattingPass: vi.fn().mockResolvedValue({
    content: 'Formatted document with firm styling.',
    flags: [],
  }),
  // Phase 2 LLM functions
  runSingleReview: vi.fn().mockResolvedValue({
    provider: 'gpt', content: 'Review: Consider adding indemnification clause.',
  }),
  runFeedbackEvaluation: vi.fn().mockResolvedValue({
    provider: 'claude',
    rawOutput: JSON.stringify({
      narrativeReasoning: 'Overall the draft is solid but needs two key improvements.',
      pointByPoint: makeValidPointByPoint(),
    }),
  }),
  runRevisionWithDecisions: vi.fn().mockResolvedValue({
    provider: 'claude',
    rawOutput: JSON.stringify({
      revisedDocument: 'Revised engagement letter with indemnification clause and clarified fees.',
      appliedChanges: [
        { anchorLocation: 'Section 4', changeDescription: 'Added indemnification clause' },
        { anchorLocation: 'Section 2', changeDescription: 'Clarified fee structure' },
      ],
      unresolvedAnchors: [],
    }),
  }),
  runFormattingPassV2: vi.fn().mockResolvedValue({
    content: 'Formatted engagement letter with professional styling.',
    flags: [],
  }),
  parseFormattingFlags: vi.fn().mockReturnValue([]),
}));

vi.mock('../storage', () => ({
  storagePut: vi.fn().mockResolvedValue({ url: 'https://s3.example.com/test.pdf', key: 'test-key' }),
}));

vi.mock('../contextBuilder', () => ({
  buildUserPrompt: vi.fn().mockReturnValue('Mocked user prompt for engagement letter'),
}));

// ── Stateful mock rebinder ───────────────────────────────────────────

/**
 * Sets up stateful DB mocks that track workflowState, versions, and feedback
 * across multiple procedure calls within a single test.
 *
 * Must be called AFTER vi.clearAllMocks() in beforeEach.
 */
async function rebindStatefulMocks(initialPhase: Record<string, any> = {}) {
  const db = await import('../db');

  // Mutable state
  const state = {
    phase: mockPhase(initialPhase),
    versionCounter: 0,
    versions: [] as Record<string, any>[],
    feedback: [] as Record<string, any>[],
  };

  // Phase reads return current mutable state
  vi.mocked(db.getPhase).mockImplementation(() =>
    Promise.resolve({ ...state.phase })
  );
  vi.mocked(db.getPhaseWithMeta).mockImplementation(() =>
    Promise.resolve({ ...state.phase })
  );

  // State transitions mutate the shared state
  vi.mocked(db.updatePhaseWorkflowState).mockImplementation(
    (_matterId: string, _phaseName: string, newState: string) => {
      state.phase.workflowState = newState;
      return Promise.resolve(undefined as any);
    }
  );
  vi.mocked(db.updatePhaseWorkflowStateConditional).mockImplementation(
    (_phaseId: number, expectedState: string, newState: string, _options: any) => {
      if (state.phase.workflowState !== expectedState) {
        const { TRPCError } = require('@trpc/server');
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Phase is in state '${state.phase.workflowState}', not '${expectedState}'.`,
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
    const v = { id: state.versionCounter, ...data, versionNumber: data.versionNumber ?? state.versionCounter };
    state.versions.push(v);
    return Promise.resolve(v);
  });
  vi.mocked(db.getVersionByNumber).mockImplementation(
    (_matterId: string, _phaseName: string, versionNumber: number) => {
      const found = state.versions.find(v => v.versionNumber === versionNumber);
      if (found) return Promise.resolve(found);
      // Default version for tests that don't create one first
      return Promise.resolve({
        id: 1, matterId: 'test-matter-iter', phaseName: 'engagement',
        versionNumber: 1, provider: 'claude', content: 'Initial draft content for engagement letter.',
        isSelected: 1, isFormattingPass: 0, metadata: null, createdAt: new Date(),
      });
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
    if (state.feedback.length > 0) return Promise.resolve(state.feedback);
    return Promise.resolve([
      { id: 1, matterId: 'test-matter-iter', phaseName: 'engagement', versionNumber: 1,
        reviewerProvider: 'gpt', point: 'Consider adding indemnification clause', decision: null },
      { id: 2, matterId: 'test-matter-iter', phaseName: 'engagement', versionNumber: 1,
        reviewerProvider: 'gemini', point: 'Fee structure needs clarification', decision: null },
    ]);
  });

  // getDb mock — returns a chainable Drizzle-like object for select/insert/update
  const evaluationRow = {
    id: 1,
    matterId: 'test-matter-iter',
    phaseName: 'engagement',
    versionNumber: 1,
    evaluatorProvider: 'claude',
    pointByPoint: makeValidPointByPoint(),
    narrativeReasoning: 'Overall the draft is solid but needs two key improvements.',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Build a chainable mock that handles any method chain ending in a promise
  function makeChain(defaultResult: any = [evaluationRow]): any {
    const chain: any = {};
    const methods = ['from', 'where', 'orderBy', 'limit', 'set', 'values', 'onDuplicateKeyUpdate'];
    for (const method of methods) {
      chain[method] = vi.fn().mockImplementation(() => chain);
    }
    // Make the chain itself thenable so `await db.update(...).set(...).where(...)` resolves
    chain.then = (resolve: any, reject: any) => Promise.resolve(defaultResult).then(resolve, reject);
    return chain;
  }

  vi.mocked(db.getDb).mockImplementation(() => {
    const selectChain = makeChain([evaluationRow]);
    // Override limit to resolve with the evaluation row array
    selectChain.limit.mockImplementation(() => Promise.resolve([evaluationRow]));
    // Override orderBy to return a chain where limit resolves
    selectChain.orderBy.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue([evaluationRow]),
      then: (r: any, j: any) => Promise.resolve([evaluationRow]).then(r, j),
    }));
    // Override where to return a chain with both limit and orderBy
    selectChain.where.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue([evaluationRow]),
      orderBy: vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockResolvedValue([evaluationRow]),
        then: (r: any, j: any) => Promise.resolve([evaluationRow]).then(r, j),
      })),
      then: (r: any, j: any) => Promise.resolve([evaluationRow]).then(r, j),
    }));

    return Promise.resolve({
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onDuplicateKeyUpdate: vi.fn().mockResolvedValue({}),
          then: (r: any, j: any) => Promise.resolve({}).then(r, j),
        }),
        then: (r: any, j: any) => Promise.resolve({}).then(r, j),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
          then: (r: any, j: any) => Promise.resolve({}).then(r, j),
        }),
        then: (r: any, j: any) => Promise.resolve({}).then(r, j),
      }),
    } as any);
  });

  // Other mocks
  vi.mocked(db.getPhasesByMatterId).mockImplementation((matterId: string) =>
    Promise.resolve(mockAllPhases(matterId) as any)
  );
  vi.mocked(db.collectPriorPhaseOutputs).mockResolvedValue(
    '=== INTAKE ===\n\nClient intake details' as any
  );
  vi.mocked(db.markPhasesStale).mockResolvedValue(undefined);

  return state;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('iterative_review full loop integration test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('step 1: startPhase with iterative_review defaults to model_selection', async () => {
    const state = await rebindStatefulMocks();
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phase.startPhase({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('model_selection');
    expect(result.mode).toBe('iterative_review');
    expect(state.phase.iterativeMeta).toBeDefined();
    expect(state.phase.iterativeMeta.isIterativeLoop).toBe(true);
    expect(state.phase.iterativeMeta.iterationNumber).toBe(0);
  });

  it('step 2: selectModel generates initial draft and transitions to awaiting_attorney_review', async () => {
    const state = await rebindStatefulMocks({
      workflowState: 'model_selection',
      iterativeMeta: {
        iterationNumber: 0, cycleNumber: 1, currentVersionModel: null,
        lastEvaluatorModel: null, lastRegeneratorModel: null,
        feedbackCyclesCompleted: 0, formatRejectionCount: 0,
        preClientWaitState: null, isIterativeLoop: true,
      },
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phase.selectModel({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      modelId: 'claude',
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('awaiting_attorney_review');
    expect(result.versionNumber).toBe(1);
    expect(state.phase.selectedModelId).toBe('claude');
    expect(state.phase.initialGeneratorModel).toBe('claude');
    expect(state.phase.iterativeMeta.currentVersionModel).toBe('claude');
    expect(state.phase.iterativeMeta.iterationNumber).toBe(1);
  });

  it('step 3: requestFeedback triggers reviewer LLM calls and transitions to awaiting_feedback_action', async () => {
    await rebindStatefulMocks({
      workflowState: 'awaiting_attorney_review',
      iterativeMeta: {
        iterationNumber: 1, cycleNumber: 1, currentVersionModel: 'claude',
        lastEvaluatorModel: null, lastRegeneratorModel: null,
        feedbackCyclesCompleted: 0, formatRejectionCount: 0,
        preClientWaitState: null, isIterativeLoop: true,
      },
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const llm = await import('../llm');

    const result = await caller.phase.requestFeedback({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 1,
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('awaiting_feedback_action');
    expect(vi.mocked(llm.runSingleReview)).toHaveBeenCalled();
    expect(result.feedbackCount).toBeGreaterThan(0);
  });

  it('step 4: evaluateFeedback triggers evaluator LLM call and transitions to awaiting_evaluation_decisions', async () => {
    await rebindStatefulMocks({
      workflowState: 'awaiting_feedback_action',
      iterativeMeta: {
        iterationNumber: 1, cycleNumber: 1, currentVersionModel: 'claude',
        lastEvaluatorModel: null, lastRegeneratorModel: null,
        feedbackCyclesCompleted: 1, formatRejectionCount: 0,
        preClientWaitState: null, isIterativeLoop: true,
      },
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const llm = await import('../llm');

    const result = await caller.phase.evaluateFeedback({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluatorModelId: 'claude',
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('awaiting_evaluation_decisions');
    expect(vi.mocked(llm.runFeedbackEvaluation)).toHaveBeenCalled();
    expect(result.evaluationId).toBeDefined();
    expect(result.pointByPointCount).toBe(2);
  });

  it('step 5: submitEvaluationDecisions triggers regenerator and creates new version', async () => {
    await rebindStatefulMocks({
      workflowState: 'awaiting_evaluation_decisions',
      iterativeMeta: {
        iterationNumber: 1, cycleNumber: 1, currentVersionModel: 'claude',
        lastEvaluatorModel: 'claude', lastRegeneratorModel: null,
        feedbackCyclesCompleted: 1, formatRejectionCount: 0,
        preClientWaitState: null, isIterativeLoop: true,
      },
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const llm = await import('../llm');

    const result = await caller.phase.submitEvaluationDecisions({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluationId: 1,
      decisions: [
        { pointByPointIndex: 0, attorneyDecision: 'adopt' },
        { pointByPointIndex: 1, attorneyDecision: 'modify', attorneyModifiedText: 'Flat fee of $5,000 for all services' },
      ],
      regeneratorModelId: 'claude',
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('awaiting_attorney_review');
    expect(vi.mocked(llm.runRevisionWithDecisions)).toHaveBeenCalled();
    expect(result.versionNumber).toBeGreaterThanOrEqual(1);
    expect(result.appliedChangesCount).toBeDefined();
    expect(result.unresolvedAnchors).toBeDefined();
  });

  it('step 6: acceptIterativeVersion on engagement (no formatting pass) completes directly', async () => {
    const state = await rebindStatefulMocks({
      workflowState: 'awaiting_attorney_review',
      iterativeMeta: {
        iterationNumber: 2, cycleNumber: 1, currentVersionModel: 'claude',
        lastEvaluatorModel: 'claude', lastRegeneratorModel: 'claude',
        feedbackCyclesCompleted: 1, formatRejectionCount: 0,
        preClientWaitState: null, isIterativeLoop: true,
      },
    });
    // Pre-create version 2 so acceptIterativeVersion can find it
    state.versionCounter = 2;
    state.versions.push({
      id: 2, matterId: 'test-matter-iter', phaseName: 'engagement',
      versionNumber: 2, provider: 'claude',
      content: 'Revised engagement letter with improvements.',
      isSelected: 1, isFormattingPass: 0, metadata: null, createdAt: new Date(),
    });

    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.phase.acceptIterativeVersion({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 2,
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('complete');
    expect(state.phase.acceptedSubstantiveVersion).toBe(2);
    expect(state.phase.officialFinalVersion).toBe(2);
  });

  it('step 6b: acceptIterativeVersion on agreement (has formatting pass) triggers formatting', async () => {
    const state = await rebindStatefulMocks({
      id: 7,
      phaseName: 'agreement',
      phaseLabel: 'Final Legal Document',
      phaseOrder: 7,
      activeWorkflowMode: 'iterative_review',
      workflowState: 'awaiting_attorney_review',
      iterativeMeta: {
        iterationNumber: 2, cycleNumber: 1, currentVersionModel: 'claude',
        lastEvaluatorModel: 'claude', lastRegeneratorModel: 'claude',
        feedbackCyclesCompleted: 1, formatRejectionCount: 0,
        preClientWaitState: null, isIterativeLoop: true,
      },
    });
    state.versionCounter = 2;
    state.versions.push({
      id: 2, matterId: 'test-matter-iter', phaseName: 'agreement',
      versionNumber: 2, provider: 'claude',
      content: 'Final legal document content.',
      isSelected: 1, isFormattingPass: 0, metadata: null, createdAt: new Date(),
    });

    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const llm = await import('../llm');

    const result = await caller.phase.acceptIterativeVersion({
      matterId: 'test-matter-iter',
      phaseName: 'agreement',
      versionNumber: 2,
    });

    expect(result.success).toBe(true);
    expect(result.workflowState).toBe('awaiting_format_review');
    expect(state.phase.acceptedSubstantiveVersion).toBe(2);
    expect(vi.mocked(llm.runFormattingPassV2)).toHaveBeenCalled();
    expect(result.formattedVersionNumber).toBeDefined();
  });

  it('full loop: startPhase → selectModel → requestFeedback → evaluateFeedback → submitDecisions → accept (end-to-end)', async () => {
    const state = await rebindStatefulMocks();
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Step 1: startPhase
    const start = await caller.phase.startPhase({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
    });
    expect(start.success).toBe(true);
    expect(start.mode).toBe('iterative_review');
    expect(state.phase.workflowState).toBe('model_selection');

    // Step 2: selectModel
    const select = await caller.phase.selectModel({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      modelId: 'claude',
    });
    expect(select.success).toBe(true);
    expect(state.phase.workflowState).toBe('awaiting_attorney_review');

    // Step 3: requestFeedback
    const feedback = await caller.phase.requestFeedback({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 1,
    });
    expect(feedback.success).toBe(true);
    expect(state.phase.workflowState).toBe('awaiting_feedback_action');

    // Step 4: evaluateFeedback
    const evaluation = await caller.phase.evaluateFeedback({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluatorModelId: 'claude',
    });
    expect(evaluation.success).toBe(true);
    expect(state.phase.workflowState).toBe('awaiting_evaluation_decisions');

    // Step 5: submitEvaluationDecisions
    const decisions = await caller.phase.submitEvaluationDecisions({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: 1,
      evaluationId: evaluation.evaluationId!,
      decisions: [
        { pointByPointIndex: 0, attorneyDecision: 'adopt' },
        { pointByPointIndex: 1, attorneyDecision: 'skip' },
      ],
      regeneratorModelId: 'claude',
    });
    expect(decisions.success).toBe(true);
    expect(state.phase.workflowState).toBe('awaiting_attorney_review');

    // Step 6: acceptIterativeVersion (engagement → no formatting → complete)
    const accept = await caller.phase.acceptIterativeVersion({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      versionNumber: decisions.versionNumber!,
    });
    expect(accept.success).toBe(true);
    expect(accept.workflowState).toBe('complete');
  });
});

// ── Regression: single_model_draft still works ──────────────────────

describe('regression: single_model_draft still works', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startPhase with single_model_draft override → model_selection → selectModel → awaiting_attorney_review', async () => {
    await rebindStatefulMocks({ activeWorkflowMode: 'single_model_draft' });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const start = await caller.phase.startPhase({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      workflowModeOverride: 'single_model_draft',
    });
    expect(start.success).toBe(true);
    expect(start.workflowState).toBe('model_selection');

    const select = await caller.phase.selectModel({
      matterId: 'test-matter-iter',
      phaseName: 'engagement',
      modelId: 'claude',
    });
    expect(select.success).toBe(true);
    expect(select.workflowState).toBe('awaiting_attorney_review');
  });
});

// ── Regression: full_competitive still works ────────────────────────

describe('regression: full_competitive still works', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agreement with full_competitive override → startCompetitiveDraft', async () => {
    await rebindStatefulMocks({
      id: 7,
      phaseName: 'agreement',
      phaseLabel: 'Final Legal Document',
      phaseOrder: 7,
      activeWorkflowMode: 'iterative_review',
    });
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const llm = await import('../llm');

    const result = await caller.phase.startPhase({
      matterId: 'test-matter-iter',
      phaseName: 'agreement',
      workflowModeOverride: 'full_competitive',
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(llm.runCompetitiveDraft)).toHaveBeenCalled();
  });
});
