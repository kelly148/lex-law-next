/**
 * Tests for the canonical two-transaction mutation pattern (spec §15.1).
 * All tests use mocked DB and LLM calls — no live providers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// Mock the DB helper
vi.mock('./db', () => ({
  updatePhaseWorkflowStateConditional: vi.fn(),
}));

// Mock telemetry
vi.mock('../shared/telemetry', () => ({
  emitTelemetry: vi.fn(),
}));

import { runCanonicalMutation, classifyLLMError } from './canonicalMutation';
import { updatePhaseWorkflowStateConditional } from './db';
import { emitTelemetry } from '../shared/telemetry';

const mockedStateUpdate = vi.mocked(updatePhaseWorkflowStateConditional);
const mockedTelemetry = vi.mocked(emitTelemetry);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    phaseId: 42,
    matterId: 'matter-1',
    phaseName: 'engagement',
    procedure: 'requestFeedback',
    expectedPriorState: 'awaiting_attorney_review' as const,
    reservedState: 'awaiting_reviews' as const,
    finalState: 'awaiting_feedback_action' as const,
    llmCall: vi.fn().mockResolvedValue({ content: 'LLM output' }),
    transactionB: vi.fn().mockResolvedValue({ success: true }),
    llmMeta: {
      model: 'claude',
      role: 'reviewer' as const,
      promptTokensEstimate: 5000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedStateUpdate.mockResolvedValue(undefined);
});

// ── Happy Path ──────────────────────────────────────────────────────

describe('runCanonicalMutation — happy path', () => {
  it('executes Transaction A → LLM → Transaction B → state finalize in order', async () => {
    const callOrder: string[] = [];

    const input = baseInput({
      transactionA: vi.fn().mockImplementation(async () => {
        callOrder.push('txnA');
      }),
      llmCall: vi.fn().mockImplementation(async () => {
        callOrder.push('llm');
        return { content: 'result' };
      }),
      transactionB: vi.fn().mockImplementation(async () => {
        callOrder.push('txnB');
        return { saved: true };
      }),
    });

    const result = await runCanonicalMutation(input);

    expect(result).toEqual({ saved: true });
    expect(callOrder).toEqual(['txnA', 'llm', 'txnB']);

    // State guard called first (reserve), then finalize
    expect(mockedStateUpdate).toHaveBeenCalledTimes(2);
    expect(mockedStateUpdate).toHaveBeenNthCalledWith(
      1,
      42,
      'awaiting_attorney_review',
      'awaiting_reviews',
      { matterId: 'matter-1', phaseName: 'engagement', procedure: 'requestFeedback' },
    );
    expect(mockedStateUpdate).toHaveBeenNthCalledWith(
      2,
      42,
      'awaiting_reviews',
      'awaiting_feedback_action',
      { matterId: 'matter-1', phaseName: 'engagement', procedure: 'requestFeedback_finalize' },
    );
  });

  it('returns the result from transactionB', async () => {
    const input = baseInput({
      transactionB: vi.fn().mockResolvedValue({ versionNumber: 3, content: 'revised' }),
    });

    const result = await runCanonicalMutation(input);
    expect(result).toEqual({ versionNumber: 3, content: 'revised' });
  });

  it('skips transactionA when not provided', async () => {
    const input = baseInput();
    // No transactionA
    delete (input as Record<string, unknown>).transactionA;

    await runCanonicalMutation(input);

    // Should still succeed — state guard + llm + txnB + finalize
    expect(mockedStateUpdate).toHaveBeenCalledTimes(2);
    expect(input.llmCall).toHaveBeenCalledOnce();
    expect(input.transactionB).toHaveBeenCalledOnce();
  });
});

// ── LLM Error Recovery ──────────────────────────────────────────────

describe('runCanonicalMutation — LLM error recovery', () => {
  it('reverts state to prior state when LLM call fails', async () => {
    const input = baseInput({
      llmCall: vi.fn().mockRejectedValue(new Error('rate limit exceeded')),
    });

    await expect(runCanonicalMutation(input)).rejects.toThrow(TRPCError);

    // State guard (reserve) + recovery (revert)
    expect(mockedStateUpdate).toHaveBeenCalledTimes(2);
    expect(mockedStateUpdate).toHaveBeenNthCalledWith(
      2,
      42,
      'awaiting_reviews', // reserved state
      'awaiting_attorney_review', // back to prior
      { matterId: 'matter-1', phaseName: 'engagement', procedure: 'requestFeedback_recovery' },
    );
  });

  it('throws TRPCError with INTERNAL_SERVER_ERROR code on LLM failure', async () => {
    const input = baseInput({
      llmCall: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    try {
      await runCanonicalMutation(input);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('INTERNAL_SERVER_ERROR');
      expect((err as TRPCError).message).toContain('timeout');
      expect((err as TRPCError).message).toContain('requestFeedback');
    }
  });

  it('does not call transactionB when LLM fails', async () => {
    const txnB = vi.fn();
    const input = baseInput({
      llmCall: vi.fn().mockRejectedValue(new Error('fail')),
      transactionB: txnB,
    });

    await expect(runCanonicalMutation(input)).rejects.toThrow();
    expect(txnB).not.toHaveBeenCalled();
  });

  it('logs error but does not throw when recovery UPDATE itself fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockedStateUpdate
      .mockResolvedValueOnce(undefined) // Transaction A state guard succeeds
      .mockRejectedValueOnce(new Error('DB down')); // Recovery fails

    const input = baseInput({
      llmCall: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    });

    // Should still throw the LLM error, not the recovery error
    await expect(runCanonicalMutation(input)).rejects.toThrow('LLM timeout');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Recovery UPDATE failed — state moved out of band',
      expect.objectContaining({ phaseId: 42 }),
    );

    consoleErrorSpy.mockRestore();
  });
});

// ── Concurrency ─────────────────────────────────────────────────────

describe('runCanonicalMutation — concurrency', () => {
  it('second concurrent call fails at state guard (CONFLICT)', async () => {
    // First call succeeds at state guard
    mockedStateUpdate
      .mockResolvedValueOnce(undefined) // Call 1 reserves
      .mockRejectedValueOnce(
        new TRPCError({
          code: 'CONFLICT',
          message: "Phase is in state 'awaiting_reviews', not 'awaiting_attorney_review'",
        }),
      ); // Call 2 fails at reserve

    const input1 = baseInput();
    const input2 = baseInput();

    const [result1, result2] = await Promise.allSettled([
      runCanonicalMutation(input1),
      runCanonicalMutation(input2),
    ]);

    // Exactly one succeeds
    const fulfilled = [result1, result2].reduce<Array<PromiseSettledResult<unknown>>>(
      (acc, r) => {
        if (r.status === 'fulfilled') acc.push(r);
        return acc;
      },
      [],
    );
    const rejected = [result1, result2].reduce<Array<PromiseSettledResult<unknown>>>(
      (acc, r) => {
        if (r.status === 'rejected') acc.push(r);
        return acc;
      },
      [],
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failedResult = rejected[0] as PromiseRejectedResult;
    expect(failedResult.reason).toBeInstanceOf(TRPCError);
    expect((failedResult.reason as TRPCError).code).toBe('CONFLICT');
  });
});

// ── Telemetry ───────────────────────────────────────────────────────

describe('runCanonicalMutation — telemetry', () => {
  it('emits llm_call_start and llm_call_complete on success', async () => {
    const input = baseInput();
    await runCanonicalMutation(input);

    const kinds = mockedTelemetry.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('llm_call_start');
    expect(kinds).toContain('llm_call_complete');
    expect(kinds).not.toContain('llm_call_failure');
  });

  it('emits llm_call_start and llm_call_failure on LLM error', async () => {
    const input = baseInput({
      llmCall: vi.fn().mockRejectedValue(new Error('rate limit')),
    });

    await expect(runCanonicalMutation(input)).rejects.toThrow();

    const kinds = mockedTelemetry.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('llm_call_start');
    expect(kinds).toContain('llm_call_failure');
    expect(kinds).not.toContain('llm_call_complete');
  });

  it('includes model and role in telemetry events', async () => {
    const input = baseInput();
    await runCanonicalMutation(input);

    const startEvent = mockedTelemetry.mock.calls.find((c) => c[0].kind === 'llm_call_start');
    expect(startEvent).toBeDefined();
    expect(startEvent![0]).toMatchObject({
      model: 'claude',
      role: 'reviewer',
      promptTokensEstimate: 5000,
    });
  });

  it('includes durationMs in llm_call_complete event', async () => {
    const input = baseInput({
      llmCall: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'ok' }), 10)),
      ),
    });

    await runCanonicalMutation(input);

    const completeEvent = mockedTelemetry.mock.calls.find(
      (c) => c[0].kind === 'llm_call_complete',
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent![0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── classifyLLMError ────────────────────────────────────────────────

describe('classifyLLMError', () => {
  it('classifies rate limit errors', () => {
    expect(classifyLLMError(new Error('rate limit exceeded'))).toBe('rate_limit');
  });

  it('classifies timeout errors', () => {
    expect(classifyLLMError(new Error('Request timeout'))).toBe('timeout');
  });

  it('classifies context overflow errors', () => {
    expect(classifyLLMError(new Error('context length exceeded'))).toBe('context_overflow');
    expect(classifyLLMError(new Error('too many tokens'))).toBe('context_overflow');
  });

  it('classifies auth errors', () => {
    expect(classifyLLMError(new Error('401 Unauthorized'))).toBe('auth_failure');
    expect(classifyLLMError(new Error('403 Forbidden'))).toBe('auth_failure');
  });

  it('classifies bad request errors', () => {
    expect(classifyLLMError(new Error('400 Bad Request'))).toBe('bad_request');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyLLMError(new Error('something weird'))).toBe('unknown');
    expect(classifyLLMError('not an error object')).toBe('unknown');
  });
});
