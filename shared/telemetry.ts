// shared/telemetry.ts — Telemetry event discriminated union (v2.3 + v2.4.2 extensions)
// v2.3 events: state_transition, llm_call_start, llm_call_complete, llm_call_failure,
//              concurrency_conflict, anchor_resolution_failure, iterative_loop_completed,
//              legacy_mode_used
// v2.4.2 additions: document_created, document_type_custom_used,
//                   sibling_reference_included, sibling_reference_skipped,
//                   document_archived, document_exported
// All v2.3 events gain optional targetKind and documentId fields.

export type TelemetryEvent =
  // ── v2.3 events (extended with targetKind + documentId) ─────────────
  | {
      kind: 'state_transition';
      matterId: string;
      phaseName: string;
      from: string;
      to: string;
      procedure: string;
      // v2.4.2 extensions — null for phase-scoped operations
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
    }
  | {
      kind: 'llm_call_start';
      matterId: string;
      phaseName: string;
      procedure: string;
      provider?: string;
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
    }
  | {
      kind: 'llm_call_complete';
      matterId: string;
      phaseName: string;
      procedure: string;
      provider?: string;
      durationMs?: number;
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
    }
  | {
      kind: 'llm_call_failure';
      matterId: string;
      phaseName: string;
      procedure: string;
      provider?: string;
      error?: string;
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
    }
  | {
      kind: 'concurrency_conflict';
      procedure: string;
      expectedState: string;
      actualState: string;
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
      matterId?: string;
      phaseName?: string;
    }
  | {
      kind: 'anchor_resolution_failure';
      matterId: string;
      phaseName: string;
      anchorId: string;
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
    }
  | {
      kind: 'iterative_loop_completed';
      matterId: string;
      phaseName: string;
      totalIterations: number;
      totalCycles: number;
      targetKind?: 'phase' | 'document';
      phaseId?: number | null;
      documentId?: number | null;
    }
  | {
      kind: 'legacy_mode_used';
      matterId: string;
      phaseName: string;
      procedure: string;
      workflowModelVersion: number;
    }
  // ── v2.4.2 new events ───────────────────────────────────────────────
  | {
      kind: 'document_created';
      matterId: string;
      documentId: number;
      phaseName: string;
      documentType: string;
      isCustom: boolean;
    }
  | {
      kind: 'document_type_custom_used';
      matterId: string;
      documentId: number;
      customTypeLabel: string;
    }
  | {
      kind: 'document_archived';
      matterId: string;
      documentId: number;
      phaseName: string;
    }
  | {
      kind: 'document_exported';
      matterId: string;
      documentId: number;
      phaseName: string;
      versionNumber: number;
    }
  | {
      kind: 'sibling_reference_included';
      matterId: string;
      documentId: number;
      siblingDocumentId: number;
      siblingDocumentType: string;
    }
  | {
      kind: 'sibling_reference_skipped';
      matterId: string;
      documentId: number;
      siblingDocumentId: number;
      reason: 'not_yet_accepted';
    };

/**
 * Emit a telemetry event. Currently logs to stderr as structured JSON.
 * In production this would be forwarded to a telemetry sink.
 */
export function emitTelemetry(event: TelemetryEvent): void {
  // Fire-and-forget: never throw, never block the caller.
  try {
    console.error(JSON.stringify({ telemetry: true, ...event, ts: Date.now() }));
  } catch {
    // Swallow serialization errors silently.
  }
}
