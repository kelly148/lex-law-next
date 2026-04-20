/**
 * Telemetry emission points for the iterative_review rebuild.
 *
 * Phase 1: functioning stub — structured console.log, spyable in tests.
 * Phase 2: observability-stack wiring added (Datadog, Sentry, custom logger, etc.).
 */

export type TelemetryEvent =
  | { kind: 'critical_parse_failure'; field: string; entityId: number }
  | { kind: 'state_transition'; phaseId: number; matterId: string; phaseName: string; from: string; to: string; procedure: string }
  | { kind: 'llm_call_start'; phaseId: number; procedure: string; model: string; role: 'generator' | 'reviewer' | 'evaluator' | 'regenerator' | 'formatter'; promptTokensEstimate: number }
  | { kind: 'llm_call_complete'; phaseId: number; procedure: string; model: string; role: string; durationMs: number; outputTokensEstimate: number }
  | { kind: 'llm_call_failure'; phaseId: number; procedure: string; model: string; role: string; errorMessage: string; errorKind: string }
  | { kind: 'concurrency_conflict'; phaseId: number; procedure: string; expectedState: string; actualState: string }
  | { kind: 'anchor_resolution_failure'; phaseId: number; versionId: number; unresolvedCount: number; totalCount: number }
  | { kind: 'legacy_mode_used'; matterId: string; phaseName: string; mode: string }
  | { kind: 'iterative_loop_completed'; matterId: string; phaseName: string; iterations: number; cycles: number; totalLLMCalls: number };

export function emitTelemetry(event: TelemetryEvent): void {
  // Phase 1: structured console log
  console.log(JSON.stringify({
    telemetry: true,
    ts: new Date().toISOString(),
    ...event,
  }));
  // Phase 2: wire observability stack here
}

export function emitCriticalParseFailure(field: string, entityId: number): void {
  emitTelemetry({
    kind: 'critical_parse_failure',
    field,
    entityId,
  });
}
