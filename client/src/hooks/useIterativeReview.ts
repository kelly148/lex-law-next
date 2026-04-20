/**
 * useIterativeReview.ts
 *
 * Typed tRPC client hook wrappers for all iterative-review phase procedures
 * per v2.3 §16 and Phase 3 §3.3.4.
 *
 * Error-handling contract (§3.4):
 *   - CONFLICT errors → specific toast: "Another operation is in progress. Please refresh."
 *   - Generic errors → descriptive message toast
 *
 * All hooks accept a `matterId` and `phaseName` and expose:
 *   - `mutate` / `mutateAsync` — the tRPC mutation
 *   - `isPending` — loading state
 */

import { useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ERROR_LABELS } from "@shared/strings";
import type { ManualSelectionInput } from "@shared/schemas/manualSelection";
import type { PointByPointItem } from "@shared/schemas/pointByPoint";

// ─── Shared error handler ────────────────────────────────────────────────────

function handleMutationError(err: unknown): void {
  const message =
    err instanceof Error ? err.message : String(err);
  if (message.includes("CONFLICT") || message.includes("conflict")) {
    toast.error(ERROR_LABELS.conflict);
  } else if (message.includes("offline") || message.includes("network")) {
    toast.error(ERROR_LABELS.networkOffline);
  } else {
    toast.error(message || ERROR_LABELS.generic);
  }
}

// ─── Base params shared by all hooks ────────────────────────────────────────

export interface IterativeBaseParams {
  matterId: string;
  phaseName: string;
}

// ─── useRequestFeedback ──────────────────────────────────────────────────────

export interface RequestFeedbackParams extends IterativeBaseParams {
  versionNumber: number;
  reviewerModelIds?: string[];
}

export function useRequestFeedback(onSuccess?: () => void) {
  const mutation = trpc.phase.requestFeedback.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const requestFeedback = useCallback(
    (params: RequestFeedbackParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { requestFeedback, isPending: mutation.isPending };
}

// ─── useEvaluateFeedback ─────────────────────────────────────────────────────

export interface EvaluateFeedbackParams extends IterativeBaseParams {
  versionNumber: number;
  evaluatorModelId: string;
}

export function useEvaluateFeedback(onSuccess?: () => void) {
  const mutation = trpc.phase.evaluateFeedback.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const evaluateFeedback = useCallback(
    (params: EvaluateFeedbackParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { evaluateFeedback, isPending: mutation.isPending };
}

// ─── useSubmitEvaluationDecisions ────────────────────────────────────────────

export interface EvaluationDecision {
  pointByPointIndex: number;
  attorneyDecision: "adopt" | "modify" | "skip";
  attorneyModifiedText?: string;
}

export interface SubmitEvaluationDecisionsParams extends IterativeBaseParams {
  versionNumber: number;
  evaluationId: number;
  decisions: EvaluationDecision[];
  regeneratorModelId: string;
}

/**
 * Converts PointByPointItem[] (as returned by EvaluationPanel) into the
 * flat EvaluationDecision[] shape the router expects.
 */
export function pointByPointItemsToDecisions(
  items: PointByPointItem[],
): EvaluationDecision[] {
  return items.map((item, index) => ({
    pointByPointIndex: index,
    attorneyDecision: item.attorneyDecision ?? item.recommendation,
    ...(item.attorneyDecision === "modify" && item.attorneyModifiedText
      ? { attorneyModifiedText: item.attorneyModifiedText }
      : {}),
  }));
}

export function useSubmitEvaluationDecisions(onSuccess?: () => void) {
  const mutation = trpc.phase.submitEvaluationDecisions.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const submitEvaluationDecisions = useCallback(
    (params: SubmitEvaluationDecisionsParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { submitEvaluationDecisions, isPending: mutation.isPending };
}

// ─── useSubmitManualDecisions ────────────────────────────────────────────────

export interface SubmitManualDecisionsParams extends IterativeBaseParams {
  versionNumber: number;
  selections: ManualSelectionInput[];
  regeneratorModelId: string;
}

export function useSubmitManualDecisions(onSuccess?: () => void) {
  const mutation = trpc.phase.submitManualDecisions.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const submitManualDecisions = useCallback(
    (params: SubmitManualDecisionsParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { submitManualDecisions, isPending: mutation.isPending };
}

// ─── useAcceptIterativeVersion ───────────────────────────────────────────────

export interface AcceptIterativeVersionParams extends IterativeBaseParams {
  versionNumber: number;
}

export function useAcceptIterativeVersion(onSuccess?: () => void) {
  const mutation = trpc.phase.acceptIterativeVersion.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const acceptIterativeVersion = useCallback(
    (params: AcceptIterativeVersionParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { acceptIterativeVersion, isPending: mutation.isPending };
}

// ─── useRejectFormatting ─────────────────────────────────────────────────────

export interface RejectFormattingParams extends IterativeBaseParams {
  kind: "format_only" | "substantive";
}

export function useRejectFormatting(onSuccess?: () => void) {
  const mutation = trpc.phase.rejectFormatting.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const rejectFormatting = useCallback(
    (params: RejectFormattingParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { rejectFormatting, isPending: mutation.isPending };
}

// ─── useAcceptSubstantiveUnformatted ─────────────────────────────────────────

export function useAcceptSubstantiveUnformatted(onSuccess?: () => void) {
  const mutation = trpc.phase.acceptSubstantiveUnformatted.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const acceptSubstantiveUnformatted = useCallback(
    (params: IterativeBaseParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { acceptSubstantiveUnformatted, isPending: mutation.isPending };
}

// ─── useRestartWithDifferentModel ────────────────────────────────────────────

export interface RestartWithDifferentModelParams extends IterativeBaseParams {
  newGeneratorModelId: string;
}

export function useRestartWithDifferentModel(onSuccess?: () => void) {
  const mutation = trpc.phase.restartWithDifferentModel.useMutation({
    onSuccess,
    onError: handleMutationError,
  });

  const restartWithDifferentModel = useCallback(
    (params: RestartWithDifferentModelParams) => {
      return mutation.mutateAsync(params);
    },
    [mutation],
  );

  return { restartWithDifferentModel, isPending: mutation.isPending };
}

// ─── Composite hook (convenience) ────────────────────────────────────────────

/**
 * Convenience hook that bundles all iterative-review mutations for a single
 * phase. Each mutation's `isPending` is surfaced individually so callers can
 * show granular loading states.
 */
export function useIterativeReview(
  params: IterativeBaseParams,
  onSuccess?: () => void,
) {
  const { requestFeedback, isPending: isRequestingFeedback } =
    useRequestFeedback(onSuccess);
  const { evaluateFeedback, isPending: isEvaluating } =
    useEvaluateFeedback(onSuccess);
  const { submitEvaluationDecisions, isPending: isSubmittingEvaluationDecisions } =
    useSubmitEvaluationDecisions(onSuccess);
  const { submitManualDecisions, isPending: isSubmittingManualDecisions } =
    useSubmitManualDecisions(onSuccess);
  const { acceptIterativeVersion, isPending: isAccepting } =
    useAcceptIterativeVersion(onSuccess);
  const { rejectFormatting, isPending: isRejectingFormatting } =
    useRejectFormatting(onSuccess);
  const { acceptSubstantiveUnformatted, isPending: isAcceptingUnformatted } =
    useAcceptSubstantiveUnformatted(onSuccess);
  const { restartWithDifferentModel, isPending: isRestarting } =
    useRestartWithDifferentModel(onSuccess);

  const anyPending =
    isRequestingFeedback ||
    isEvaluating ||
    isSubmittingEvaluationDecisions ||
    isSubmittingManualDecisions ||
    isAccepting ||
    isRejectingFormatting ||
    isAcceptingUnformatted ||
    isRestarting;

  return {
    // Bound mutations (params pre-filled)
    requestFeedback: (
      extra: Omit<RequestFeedbackParams, keyof IterativeBaseParams>,
    ) => requestFeedback({ ...params, ...extra }),

    evaluateFeedback: (
      extra: Omit<EvaluateFeedbackParams, keyof IterativeBaseParams>,
    ) => evaluateFeedback({ ...params, ...extra }),

    submitEvaluationDecisions: (
      extra: Omit<SubmitEvaluationDecisionsParams, keyof IterativeBaseParams>,
    ) => submitEvaluationDecisions({ ...params, ...extra }),

    submitManualDecisions: (
      extra: Omit<SubmitManualDecisionsParams, keyof IterativeBaseParams>,
    ) => submitManualDecisions({ ...params, ...extra }),

    acceptIterativeVersion: (
      extra: Omit<AcceptIterativeVersionParams, keyof IterativeBaseParams>,
    ) => acceptIterativeVersion({ ...params, ...extra }),

    rejectFormatting: (
      extra: Omit<RejectFormattingParams, keyof IterativeBaseParams>,
    ) => rejectFormatting({ ...params, ...extra }),

    acceptSubstantiveUnformatted: () =>
      acceptSubstantiveUnformatted(params),

    restartWithDifferentModel: (
      extra: Omit<RestartWithDifferentModelParams, keyof IterativeBaseParams>,
    ) => restartWithDifferentModel({ ...params, ...extra }),

    // Loading states
    isRequestingFeedback,
    isEvaluating,
    isSubmittingEvaluationDecisions,
    isSubmittingManualDecisions,
    isAccepting,
    isRejectingFormatting,
    isAcceptingUnformatted,
    isRestarting,
    anyPending,
  };
}
