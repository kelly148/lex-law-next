/**
 * Canonical two-transaction mutation pattern per spec v2.3 §15.1.
 *
 * Every mutation that triggers a long-running LLM call follows:
 *   Transaction A → LLM call (outside DB) → Transaction B
 *   with automatic failure recovery if the LLM call throws.
 */
import { emitTelemetry } from '../shared/telemetry';
import { TRPCError } from '@trpc/server';
import { updatePhaseWorkflowStateConditional } from './db';
import type { WorkflowState } from '../shared/workflow';

// ── Types ────────────────────────────────────────────────────────────

export interface CanonicalMutationInput<TLLMResult, TPersistResult> {
  phaseId: number;
  matterId: string;
  phaseName: string;
  procedure: string;
  expectedPriorState: WorkflowState;
  reservedState: WorkflowState;
  finalState: WorkflowState;
  /**
   * Transaction A: runs after the state guard succeeds.
   * Insert scaffolding rows, update derived summaries, etc.
   * Receives no transaction object — uses the shared DB connection.
   */
  transactionA?: () => Promise<void>;
  /**
   * The LLM call — runs outside any DB transaction.
   * May take 5–60 seconds.
   */
  llmCall: () => Promise<TLLMResult>;
  /**
   * Transaction B: persist LLM results and finalize.
   * Receives the LLM result. State finalization is handled by the helper.
   */
  transactionB: (llmResult: TLLMResult) => Promise<TPersistResult>;
  llmMeta: {
    model: string;
    role: 'generator' | 'reviewer' | 'evaluator' | 'regenerator' | 'formatter';
    promptTokensEstimate: number;
  };
}

// ── Main helper ──────────────────────────────────────────────────────

export async function runCanonicalMutation<TLLM, TResult>(
  input: CanonicalMutationInput<TLLM, TResult>,
): Promise<TResult> {
  const { phaseId, matterId, phaseName, procedure } = input;

  // ── Transaction A: state guard + scaffolding ──
  await updatePhaseWorkflowStateConditional(
    phaseId,
    input.expectedPriorState,
    input.reservedState,
    { matterId, phaseName, procedure },
  );
  if (input.transactionA) {
    await input.transactionA();
  }

  // ── External LLM call (outside DB transaction) ──
  const startedAt = Date.now();
  emitTelemetry({
    kind: 'llm_call_start',
    phaseId,
    procedure,
    model: input.llmMeta.model,
    role: input.llmMeta.role,
    promptTokensEstimate: input.llmMeta.promptTokensEstimate,
  });

  let llmResult: TLLM;
  try {
    llmResult = await input.llmCall();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorKind = classifyLLMError(err);

    emitTelemetry({
      kind: 'llm_call_failure',
      phaseId,
      procedure,
      model: input.llmMeta.model,
      role: input.llmMeta.role,
      errorMessage,
      errorKind,
    });

    // ── Failure recovery: revert state ──
    await updatePhaseWorkflowStateConditional(
      phaseId,
      input.reservedState,
      input.expectedPriorState,
      { matterId, phaseName, procedure: `${procedure}_recovery` },
    ).catch(() => {
      console.error('Recovery UPDATE failed — state moved out of band', {
        phaseId,
        procedure,
      });
    });

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `LLM call failed in ${procedure}: ${errorMessage}`,
      cause: err,
    });
  }

  emitTelemetry({
    kind: 'llm_call_complete',
    phaseId,
    procedure,
    model: input.llmMeta.model,
    role: input.llmMeta.role,
    durationMs: Date.now() - startedAt,
    outputTokensEstimate: 0,
  });

  // ── Transaction B: persist results + finalize state ──
  const result = await input.transactionB(llmResult);
  await updatePhaseWorkflowStateConditional(
    phaseId,
    input.reservedState,
    input.finalState,
    { matterId, phaseName, procedure: `${procedure}_finalize` },
  );

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function classifyLLMError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('rate limit')) return 'rate_limit';
  if (msg.includes('timeout')) return 'timeout';
  if (msg.includes('context') || msg.includes('token')) return 'context_overflow';
  if (msg.includes('400')) return 'bad_request';
  if (msg.includes('401') || msg.includes('403')) return 'auth_failure';
  return 'unknown';
}
