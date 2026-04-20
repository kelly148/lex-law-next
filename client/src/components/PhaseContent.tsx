import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import {
  PHASE_CONFIG, OPTIONAL_PHASES, WORKFLOW_MODE_LABELS, WORKFLOW_MODE_DESCRIPTIONS,
  type PhaseName, type WorkflowState, type WorkflowMode, type ProviderKey, type PhaseConfig,
} from "@shared/workflow";
import {
  Play, SkipForward, Loader2, AlertTriangle, CheckCircle2, Clock, Download,
} from "lucide-react";
import { useState, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import DraftComparison from "./DraftComparison";
import AttorneyReview from "./AttorneyReview";
import ModelSelector from "./ModelSelector";
import AttorneyDraftReview from "./AttorneyDraftReview";
import FormattingReview from "./FormattingReview";
import FileDropZone from "./FileDropZone";
import { Streamdown, defaultRehypePlugins } from "streamdown";
// ── Iterative components ────────────────────────────────────────────
import IterationCounter from "./iterative/IterationCounter";
import UnresolvedAnchorsPanel from "./iterative/UnresolvedAnchorsPanel";
import FeedbackPanels, { type FeedbackItem } from "./iterative/FeedbackPanels";
import SelectedChangesTray from "./iterative/SelectedChangesTray";
import EvaluationPanel from "./iterative/EvaluationPanel";
import IterativeFormattingReview from "./iterative/FormattingReview";
import ModelPicker, { getDefaultModel } from "./iterative/ModelPicker";
import { useIterativeReview, pointByPointItemsToDecisions } from "@/hooks/useIterativeReview";
import { rehypeParagraphIds } from "@/lib/rehypeParagraphIds";
import {
  STATE_LABELS, LOADING_LABELS, BUTTON_LABELS, CONFIRM_LABELS,
  unresolvedAnchorsBanner, UNRESOLVED_ANCHORS_LINK,
} from "@shared/strings";
import { parseIterativeMeta } from "@shared/schemas/iterativeMeta";
import { parseVersionMetadata, type UnresolvedAnchor } from "@shared/schemas/versionMetadata";
import { parsePointByPoint, type PointByPointItem } from "@shared/schemas/pointByPoint";
import type { ManualSelectionInput } from "@shared/schemas/manualSelection";

interface Phase {
  id: number;
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  phaseOrder: number;
  status: string;
  workflowState: string;
  activeWorkflowMode?: string | null;
  selectedModelId?: string | null;
  acceptedSubstantiveVersion?: number | null;
  officialFinalVersion?: number | null;
  isOptional: number;
  isStale: number;
  workflowData: any;
  iterativeMeta?: any;
  createdAt: Date;
  updatedAt: Date;
}

interface PhaseContentProps {
  matterId: string;
  phase: Phase;
  allPhases: Phase[];
  onRefresh: () => void;
}

// ── Download DOCX Button ─────────────────────────────────────────────
function DownloadDocxButton({ matterId, phaseName, phaseLabel }: { matterId: string; phaseName: string; phaseLabel: string }) {
  const downloadDocx = trpc.phase.downloadDocx.useMutation({
    onSuccess: (data) => {
      // Trigger browser download from base64
      const byteChars = atob(data.base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${data.fileName}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Button
      variant="outline"
      onClick={() => downloadDocx.mutate({ matterId, phaseName })}
      disabled={downloadDocx.isPending}
    >
      {downloadDocx.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      Download Word
    </Button>
  );
}

// ── Iterative loading spinner ────────────────────────────────────────
function IterativeLoadingCard({ label, message }: { label: string; message: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-serif text-xl">{label}</CardTitle>
          <Badge className="bg-blue-500 text-white">
            <Loader2 className="h-3 w-3 animate-spin mr-1" /> Processing
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <p className="text-lg font-medium">{message}</p>
          <p className="text-sm mt-2">This may take a moment. The page will update automatically.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Iterative draft review (awaiting_attorney_review in iterative_review mode) ──
function IterativeDraftReview({
  matterId,
  phase,
  config,
  onRefresh,
}: {
  matterId: string;
  phase: Phase;
  config: PhaseConfig;
  onRefresh: () => void;
}) {
  const phaseName = phase.phaseName;
  const iterativeMeta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

  // Fetch the latest version for this phase
  const phaseQuery = trpc.phase.get.useQuery(
    { matterId, phaseName },
    { refetchInterval: false }
  );
  const versions = phaseQuery.data?.versions ?? [];
  const latestVersion = versions.reduce(
    (best: any, v: any) => (!best || v.versionNumber > best.versionNumber ? v : best),
    null as any
  );
  const versionMeta = latestVersion
    ? parseVersionMetadata(latestVersion.metadata, { versionId: latestVersion.id })
    : null;
  const unresolvedAnchors: UnresolvedAnchor[] = versionMeta?.unresolvedAnchors ?? [];

  // Draft container ref for anchor scroll
  const draftContainerRef = useRef<HTMLDivElement>(null);

  // Stable rehypePlugins list
  const rehypePlugins = useMemo(
    () => [...Object.values(defaultRehypePlugins), rehypeParagraphIds] as any,
    []
  );

  // Iterative mutations
  const iterative = useIterativeReview(
    { matterId, phaseName },
    onRefresh
  );

  // Revision notes state
  const [revisionNotes, setRevisionNotes] = useState("");
  const [showRevisionInput, setShowRevisionInput] = useState(false);

  // Restart model picker state
  const [restartModel, setRestartModel] = useState<ProviderKey | "">("");
  const [showUnresolvedPanel, setShowUnresolvedPanel] = useState(false);

  const currentVersionModel = (iterativeMeta.currentVersionModel ?? "") as ProviderKey | "";
  const versionNumber = latestVersion?.versionNumber ?? 1;

  const handleRequestFeedback = useCallback(() => {
    iterative.requestFeedback({ versionNumber });
  }, [iterative, versionNumber]);

  const handleRevise = useCallback(() => {
    if (!revisionNotes.trim()) {
      toast.error("Please enter revision notes.");
      return;
    }
    // Use the existing requestRevision procedure (single_model_draft path)
    // For iterative mode we use requestFeedback; revision notes go as context
    // The spec §16.2 shows "Revise with my notes" triggers requestRevision
    trpc.phase.requestRevision.useMutation;
    // We call via trpc directly — handled by the inline mutation below
  }, [revisionNotes]);

  // requestRevision is a separate mutation (not in useIterativeReview)
  const requestRevision = trpc.phase.requestRevision.useMutation({
    onSuccess: () => { toast.success("Revision requested"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  if (phaseQuery.isLoading) {
    return <IterativeLoadingCard label={config.label} message="Loading draft..." />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{STATE_LABELS.awaiting_attorney_review}</Badge>
            <IterationCounter
              cycleNumber={iterativeMeta.cycleNumber}
              iterationNumber={iterativeMeta.iterationNumber}
            />
          </div>
        </div>

        {/* Unresolved anchors banner */}
        {unresolvedAnchors.length > 0 && !showUnresolvedPanel && (
          <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">
              {unresolvedAnchorsBanner(unresolvedAnchors.length, unresolvedAnchors.length)}
            </span>
            <Button
              variant="link"
              size="sm"
              className="text-amber-700 p-0 h-auto"
              onClick={() => setShowUnresolvedPanel(true)}
            >
              {UNRESOLVED_ANCHORS_LINK}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Unresolved anchors detail panel */}
        {showUnresolvedPanel && unresolvedAnchors.length > 0 && (
          <UnresolvedAnchorsPanel
            unresolvedAnchors={unresolvedAnchors}
            onAcceptPartial={() => setShowUnresolvedPanel(false)}
            onApplyManually={() => {
              setShowUnresolvedPanel(false);
              toast.info("Apply manually: use revision notes below to address unresolved changes.");
              setShowRevisionInput(true);
            }}
            onReDecide={() => setShowUnresolvedPanel(false)}
            disabled={iterative.anyPending}
          />
        )}

        {/* Draft content */}
        {latestVersion ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                Version {latestVersion.versionNumber} · {latestVersion.provider}
              </p>
            </div>
            <ScrollArea className="h-[400px] rounded-lg border p-4">
              <div ref={draftContainerRef} className="prose prose-sm max-w-none">
                <Streamdown rehypePlugins={rehypePlugins}>
                  {latestVersion.content}
                </Streamdown>
              </div>
            </ScrollArea>
          </div>
        ) : (
          <p className="text-muted-foreground">No draft available yet.</p>
        )}

        {/* Revision notes input (shown on demand) */}
        {showRevisionInput && (
          <div className="space-y-2">
            <Label htmlFor="revision-notes">Revision notes</Label>
            <Textarea
              id="revision-notes"
              placeholder="Describe the changes you want..."
              value={revisionNotes}
              onChange={(e) => setRevisionNotes(e.target.value)}
              rows={4}
              disabled={requestRevision.isPending || iterative.anyPending}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  requestRevision.mutate({ matterId, phaseName, feedback: revisionNotes })
                }
                disabled={!revisionNotes.trim() || requestRevision.isPending || iterative.anyPending}
              >
                {requestRevision.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit revision
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setShowRevisionInput(false); setRevisionNotes(""); }}
                disabled={requestRevision.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Primary actions */}
        <div className="flex gap-2 flex-wrap pt-2">
          <Button
            onClick={handleRequestFeedback}
            disabled={iterative.anyPending || !latestVersion}
          >
            {iterative.isRequestingFeedback && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {BUTTON_LABELS.getFeedback}
          </Button>

          {!showRevisionInput && (
            <Button
              variant="outline"
              onClick={() => setShowRevisionInput(true)}
              disabled={iterative.anyPending}
            >
              {BUTTON_LABELS.reviseWithNotes}
            </Button>
          )}

          {/* Restart with different model — confirm dialog */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={iterative.anyPending}
              >
                {BUTTON_LABELS.startFreshWithDifferentModel}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{CONFIRM_LABELS.restartTitle}</AlertDialogTitle>
                <AlertDialogDescription>{CONFIRM_LABELS.restartBody}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2">
                <ModelPicker
                  context="restart"
                  currentVersionModel={currentVersionModel as ProviderKey | undefined}
                  value={restartModel}
                  onChange={setRestartModel}
                  label="New model"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{CONFIRM_LABELS.restartCancel}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!restartModel) { toast.error("Please select a model."); return; }
                    iterative.restartWithDifferentModel({ newGeneratorModelId: restartModel });
                  }}
                  disabled={!restartModel || iterative.isRestarting}
                >
                  {iterative.isRestarting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {CONFIRM_LABELS.restartConfirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Iterative feedback action (awaiting_feedback_action) ─────────────
function IterativeFeedbackAction({
  matterId,
  phase,
  config,
  onRefresh,
}: {
  matterId: string;
  phase: Phase;
  config: PhaseConfig;
  onRefresh: () => void;
}) {
  const phaseName = phase.phaseName;
  const iterativeMeta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

  const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName }, { refetchInterval: false });
  const versions = phaseQuery.data?.versions ?? [];
  const latestVersion = versions.reduce(
    (best: any, v: any) => (!best || v.versionNumber > best.versionNumber ? v : best),
    null as any
  );
  const rawFeedback = phaseQuery.data?.feedback ?? [];

  const iterative = useIterativeReview({ matterId, phaseName }, onRefresh);

  // Manual selection state
  const [mode, setMode] = useState<"view" | "select">("view");
  const [selections, setSelections] = useState<ManualSelectionInput[]>([]);

  // Evaluator model picker state
  const [evaluatorModel, setEvaluatorModel] = useState<ProviderKey | "">(
    () => getDefaultModel("evaluator", (iterativeMeta.currentVersionModel ?? undefined) as ProviderKey | undefined)
  );

  const versionNumber = latestVersion?.versionNumber ?? 1;

  // Map raw feedback rows to FeedbackItem shape
  const feedbackItems: FeedbackItem[] = useMemo(() => {
    // Group by reviewerProvider, concatenate points
    const grouped: Record<string, { id: number; provider: string; points: string[] }> = {};
    for (const row of rawFeedback as any[]) {
      const key = row.reviewerProvider;
      if (!grouped[key]) grouped[key] = { id: row.id, provider: key, points: [] };
      grouped[key].points.push(row.point);
    }
    return Object.values(grouped).map((g) => ({
      id: g.id,
      reviewerProvider: g.provider,
      content: g.points.join("\n\n"),
    }));
  }, [rawFeedback]);

  // feedbackId → provider map for SelectedChangesTray
  const feedbackProviders: Record<number, string> = useMemo(() => {
    const map: Record<number, string> = {};
    for (const row of rawFeedback as any[]) {
      map[row.id] = row.reviewerProvider;
    }
    return map;
  }, [rawFeedback]);

  const handleGetAiEvaluation = useCallback(() => {
    if (!evaluatorModel) { toast.error("Please select an evaluator model."); return; }
    iterative.evaluateFeedback({ versionNumber, evaluatorModelId: evaluatorModel });
  }, [iterative, versionNumber, evaluatorModel]);

  const handlePickManually = useCallback(() => {
    setMode("select");
  }, []);

  const handleSelectionAdded = useCallback((sel: ManualSelectionInput) => {
    setSelections((prev) => [...prev, { ...sel, selectionOrder: prev.length }]);
  }, []);

  const handleSubmitManual = useCallback(() => {
    if (selections.length === 0) { toast.error("No changes selected."); return; }
    iterative.submitManualDecisions({ versionNumber, selections, regeneratorModelId: (iterativeMeta.currentVersionModel ?? "claude") as string });
  }, [iterative, versionNumber, selections]);

  if (phaseQuery.isLoading) {
    return <IterativeLoadingCard label={config.label} message="Loading feedback..." />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{STATE_LABELS.awaiting_feedback_action}</Badge>
            <IterationCounter
              cycleNumber={iterativeMeta.cycleNumber}
              iterationNumber={iterativeMeta.iterationNumber}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Evaluator model picker (shown in view mode above action buttons) */}
        {mode === "view" && (
          <div className="max-w-xs">
            <ModelPicker
              context="evaluator"
              currentVersionModel={(iterativeMeta.currentVersionModel ?? undefined) as ProviderKey | undefined}
              value={evaluatorModel}
              onChange={setEvaluatorModel}
              label="Evaluator model"
              disabled={iterative.anyPending}
            />
          </div>
        )}

        <FeedbackPanels
          feedbackItems={feedbackItems}
          mode={mode}
          onGetAiEvaluation={handleGetAiEvaluation}
          onPickManually={handlePickManually}
          onSelectionAdded={handleSelectionAdded}
          disabled={iterative.anyPending}
        />

        {/* Manual selection tray (select mode) */}
        {mode === "select" && (
          <div className="space-y-3">
            <SelectedChangesTray
              selections={selections}
              feedbackProviders={feedbackProviders}
              onChange={setSelections}
              disabled={iterative.anyPending}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleSubmitManual}
                disabled={selections.length === 0 || iterative.anyPending}
              >
                {iterative.isSubmittingManualDecisions && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                {BUTTON_LABELS.regenerateWithSelections}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setMode("view"); setSelections([]); }}
                disabled={iterative.anyPending}
              >
                Back
              </Button>
            </div>
          </div>
        )}

        {/* AI evaluation loading indicator */}
        {iterative.isEvaluating && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{LOADING_LABELS.evaluatingFeedback}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Iterative evaluation decisions (awaiting_evaluation_decisions) ───
function IterativeEvaluationDecisions({
  matterId,
  phase,
  config,
  onRefresh,
}: {
  matterId: string;
  phase: Phase;
  config: PhaseConfig;
  onRefresh: () => void;
}) {
  const phaseName = phase.phaseName;
  const iterativeMeta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

  const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName }, { refetchInterval: false });
  const versions = phaseQuery.data?.versions ?? [];
  const latestVersion = versions.reduce(
    (best: any, v: any) => (!best || v.versionNumber > best.versionNumber ? v : best),
    null as any
  );
  const versionNumber = latestVersion?.versionNumber ?? 1;

  // Fetch evaluation for this version
  const evalQuery = trpc.feedback.getEvaluation.useQuery(
    { matterId, phaseName, versionNumber },
    { enabled: !!latestVersion }
  );

  const iterative = useIterativeReview({ matterId, phaseName }, onRefresh);

  // Draft container ref for anchor scroll
  const draftContainerRef = useRef<HTMLDivElement>(null);

  const rehypePlugins = useMemo(
    () => [...Object.values(defaultRehypePlugins), rehypeParagraphIds] as any,
    []
  );

  const evaluation = evalQuery.data;
  const pointByPoint: PointByPointItem[] = evaluation
    ? parsePointByPoint(evaluation.pointByPoint, { evaluationId: evaluation.id })
    : [];

    const handleSubmit = useCallback(
    (decisions: PointByPointItem[], regeneratorModel: string) => {
      iterative.submitEvaluationDecisions({
        versionNumber,
        evaluationId: evaluation!.id,
        decisions: pointByPointItemsToDecisions(decisions),
        regeneratorModelId: regeneratorModel,
      });
    },
    [iterative, evaluation, versionNumber]
  );

  if (phaseQuery.isLoading || evalQuery.isLoading) {
    return <IterativeLoadingCard label={config.label} message="Loading evaluation..." />;
  }

  if (!evaluation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No evaluation found for this version.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{STATE_LABELS.awaiting_evaluation_decisions}</Badge>
            <IterationCounter
              cycleNumber={iterativeMeta.cycleNumber}
              iterationNumber={iterativeMeta.iterationNumber}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Draft preview (collapsible reference) */}
        {latestVersion && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
              View draft (v{latestVersion.versionNumber})
            </summary>
            <ScrollArea className="h-[300px] rounded-lg border p-4 mt-2">
              <div ref={draftContainerRef} className="prose prose-sm max-w-none">
                <Streamdown rehypePlugins={rehypePlugins}>
                  {latestVersion.content}
                </Streamdown>
              </div>
            </ScrollArea>
          </details>
        )}

        <EvaluationPanel
          narrativeReasoning={evaluation.narrativeReasoning}
          items={pointByPoint}
          currentVersionModel={
            (iterativeMeta.currentVersionModel ?? evaluation.evaluatorProvider) as string
          }
          draftContainerRef={draftContainerRef as React.RefObject<Element | null>}
          onSubmit={handleSubmit}
          disabled={iterative.anyPending}
        />

        {iterative.isSubmittingEvaluationDecisions && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{LOADING_LABELS.regenerating}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Iterative format review (awaiting_format_review in iterative_review mode) ──
function IterativeFormatReviewWrapper({
  matterId,
  phase,
  config,
  onRefresh,
}: {
  matterId: string;
  phase: Phase;
  config: PhaseConfig;
  onRefresh: () => void;
}) {
  const phaseName = phase.phaseName;
  const iterativeMeta = parseIterativeMeta(phase.iterativeMeta, { phaseId: phase.id });

  const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName }, { refetchInterval: false });
  const versions = phaseQuery.data?.versions ?? [];

  // Find the formatted version (latest formatting pass) and the substantive version
  const formattedVersion = versions.find((v: any) => v.isFormattingPass === 1 && v.versionNumber === Math.max(...versions.filter((x: any) => x.isFormattingPass === 1).map((x: any) => x.versionNumber)));
  const substantiveVersion = phase.acceptedSubstantiveVersion
    ? versions.find((v: any) => v.versionNumber === phase.acceptedSubstantiveVersion)
    : null;

  const iterative = useIterativeReview({ matterId, phaseName }, onRefresh);

  if (phaseQuery.isLoading) {
    return <IterativeLoadingCard label={config.label} message="Loading formatted draft..." />;
  }

  if (!formattedVersion) {
    return <IterativeLoadingCard label={config.label} message="Formatting in progress..." />;
  }

  // Flags from version metadata
  const versionMeta = parseVersionMetadata(formattedVersion.metadata, { versionId: formattedVersion.id });
  const flags = versionMeta.flags ? Object.keys(versionMeta.flags) : undefined;

  return (
    <IterativeFormattingReview
      formattedContent={formattedVersion.content}
      formattedVersionNumber={formattedVersion.versionNumber}
      substantiveContent={substantiveVersion?.content}
      substantiveVersionNumber={substantiveVersion?.versionNumber}
      formatRejectionCount={iterativeMeta.formatRejectionCount}
      flags={flags}
      onApproveFormatting={() =>
        iterative.acceptIterativeVersion({ versionNumber: formattedVersion.versionNumber })
      }
      onRejectFormatting={(kind) => iterative.rejectFormatting({ kind })}
      onAcceptWithoutFormatting={() => iterative.acceptSubstantiveUnformatted()}
      disabled={iterative.anyPending}
    />
  );
}

export default function PhaseContent({ matterId, phase, allPhases, onRefresh }: PhaseContentProps) {
  const phaseName = phase.phaseName as PhaseName;
  const ws = phase.workflowState as WorkflowState;
  const config = PHASE_CONFIG[phaseName];
  const isOptional = OPTIONAL_PHASES.includes(phaseName);
  const isIterativeMode = phase.activeWorkflowMode === "iterative_review";

  const [context, setContext] = useState("");
  const [modeOverride, setModeOverride] = useState<string>("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploadingAndStarting, setIsUploadingAndStarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFilesChange = useCallback((files: File[]) => setPendingFiles(files), []);

  // ── All hooks must be called unconditionally ──────────────────────
  // This query is used in the "complete" state but must be at the top level
  const phaseDetailQuery = trpc.phase.get.useQuery(
    { matterId, phaseName: phase.phaseName },
    { enabled: ws === "complete" }
  );

  // Fetch uploaded files for this phase
  const uploadsQuery = trpc.upload.listByPhase.useQuery(
    { matterId, phaseName: phase.phaseName },
    { enabled: ws === "idle" || ws === "complete" }
  );

  const startPhase = trpc.phase.startPhase.useMutation({
    onSuccess: (data) => {
      if ("workflowState" in data && data.workflowState === "model_selection") {
        toast.success("Select a model to proceed");
      } else {
        toast.success("Phase started");
      }
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const skipPhase = trpc.phase.skip.useMutation({
    onSuccess: () => { toast.success("Phase skipped"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const setWaitingOnClient = trpc.phase.setWaitingOnClient.useMutation({
    onSuccess: () => { toast.success("Marked as waiting on client"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const clientResponded = trpc.phase.clientResponded.useMutation({
    onSuccess: () => { toast.success("Client response recorded"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const uploadFile = trpc.upload.uploadFile.useMutation({
    onError: (err) => toast.error(err.message),
  });

  // Upload a single File object and return a promise
  const uploadSingleFile = (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadFile.mutate(
          {
            matterId,
            phaseName: phase.phaseName,
            fileName: file.name,
            fileBase64: base64,
            contentType: file.type || "application/octet-stream",
            fileSize: file.size,
          },
          { onSuccess: () => resolve(), onError: (e) => reject(e) }
        );
      };
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  // Only pass manual context text typed by the attorney.
  // The server independently fetches and extracts uploaded files from the DB
  // via buildSourceContentFromUploads() in selectModel / startCompetitiveDraft.
  const getManualContext = (): string | undefined => {
    return context.trim() || undefined;
  };

  // ── Waiting on Client ──
  if (phase.status === "waiting_on_client") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
            <Badge className="bg-amber-500 text-white">
              <Clock className="h-3 w-3 mr-1" /> Waiting on Client
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            This document has been sent to the client. Mark as responded when the client has reviewed and provided feedback.
          </p>
          <Button
            onClick={() => clientResponded.mutate({ matterId, phaseName: phase.phaseName })}
            disabled={clientResponded.isPending}
          >
            {clientResponded.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Client Has Responded
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Idle State ──
  if (ws === "idle") {
    const existingUploads = (uploadsQuery.data ?? []) as Array<{ id: number; fileName: string; fileUrl: string; fileSize?: number | null }>;
    const hasSources = pendingFiles.length > 0 || existingUploads.length > 0;

    const handleStartPhase = async () => {
      setIsUploadingAndStarting(true);
      try {
        // 1. Upload all pending files sequentially
        for (const file of pendingFiles) {
          await uploadSingleFile(file);
        }
        // 2. Then start the phase
        await startPhase.mutateAsync({
          matterId,
          phaseName: phase.phaseName,
          context: context || undefined,
          sourceContent: getManualContext(),
          workflowModeOverride: (modeOverride && modeOverride !== config.defaultMode)
            ? modeOverride as any
            : undefined,
        });
      } catch (e: any) {
        toast.error(e?.message || "Failed to start phase");
      } finally {
        setIsUploadingAndStarting(false);
      }
    };

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
              <CardDescription className="mt-1">
                {isOptional ? "Optional phase — can be skipped" : "Required phase"}
                {" · "}Default: {WORKFLOW_MODE_LABELS[config.defaultMode]}
              </CardDescription>
            </div>
            <Badge variant="secondary">Not Started</Badge>
          </div>
          {phase.isStale === 1 && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">This phase is stale due to a fact change. Consider re-running.</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prior phase context notice — shown for all phases that have at least one prior phase */}
          {(() => {
            const currentOrder = allPhases.find(p => p.phaseName === phaseName)?.phaseOrder ?? 0;
            const completedPriors = allPhases.filter(
              (p) => p.phaseOrder < currentOrder && p.status === "completed"
            );
            const incompletePriors = allPhases.filter(
              (p) => p.phaseOrder < currentOrder && p.status !== "completed" && p.status !== "skipped"
            );
            if (currentOrder === 0 || (completedPriors.length === 0 && incompletePriors.length === 0)) return null;
            return (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                {completedPriors.length > 0 && (
                  <p>
                    <span className="font-medium">Prior context available:</span>{" "}
                    {completedPriors.map(p => p.phaseLabel ?? p.phaseName).join(", ")} will be used as source material.
                  </p>
                )}
                {incompletePriors.length > 0 && (
                  <p className="mt-1 text-amber-700">
                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                    Incomplete prior phases: {incompletePriors.map(p => p.phaseLabel ?? p.phaseName).join(", ")}.
                  </p>
                )}
              </div>
            );
          })()}

          {/* File upload */}
          <div className="space-y-2">
            <Label>Source documents (optional)</Label>
            <FileDropZone
              onFilesChange={handleFilesChange}
              existingFiles={uploadsQuery.data as any ?? []}
            />
          </div>

          {/* Context / instructions */}
          <div className="space-y-2">
            <Label htmlFor="context">Additional context (optional)</Label>
            <Textarea
              id="context"
              placeholder="Any specific instructions or context for this phase..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
            />
          </div>

          {/* Mode override */}
          {config.availableModes && config.availableModes.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="mode-override">Workflow mode</Label>
              <Select
                value={modeOverride || config.defaultMode}
                onValueChange={setModeOverride}
              >
                <SelectTrigger id="mode-override">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.availableModes.map((mode: WorkflowMode) => (
                    <SelectItem key={mode} value={mode}>
                      {WORKFLOW_MODE_LABELS[mode]}
                      {mode === config.defaultMode ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(modeOverride || config.defaultMode) && (
                <p className="text-xs text-muted-foreground">
                  {WORKFLOW_MODE_DESCRIPTIONS[modeOverride as WorkflowMode || config.defaultMode]}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={handleStartPhase}
              disabled={isUploadingAndStarting || startPhase.isPending}
            >
              {(isUploadingAndStarting || startPhase.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start Phase
            </Button>
            {isOptional && (
              <Button
                variant="outline"
                onClick={() => skipPhase.mutate({ matterId, phaseName: phase.phaseName })}
                disabled={skipPhase.isPending}
              >
                {skipPhase.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <SkipForward className="h-4 w-4 mr-2" />}
                Skip Phase
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Model Selection ──
  if (ws === "model_selection") {
    return (
      <ModelSelector
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={config.label}
        sourceContent={getManualContext()}
        context={context || undefined}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Processing / Drafting / Revising / Reviewing / Evaluating / Regenerating ──
  if (["processing", "drafting", "revising", "reviewing", "evaluating", "regenerating"].includes(ws)) {
    const labels: Record<string, string> = {
      processing: "Processing source materials...",
      drafting: "AI providers are generating drafts...",
      revising: "Revising draft based on your feedback...",
      reviewing: "Independent reviewers are analyzing the draft...",
      evaluating: "Evaluating reviewer feedback...",
      regenerating: "Regenerating draft with feedback...",
    };
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
            <Badge className="bg-blue-500 text-white">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              {ws.charAt(0).toUpperCase() + ws.slice(1)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-12 text-muted-foreground">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">{labels[ws] ?? "Processing..."}</p>
            <p className="text-sm mt-2">This may take a moment. The page will update automatically.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Iterative: awaiting_reviews (loading spinner) ──
  if (ws === "awaiting_reviews") {
    return (
      <IterativeLoadingCard
        label={config.label}
        message={LOADING_LABELS.reviewing}
      />
    );
  }

  // ── Iterative: evaluating_feedback (loading spinner) ──
  if (ws === "evaluating_feedback") {
    return (
      <IterativeLoadingCard
        label={config.label}
        message={LOADING_LABELS.evaluatingFeedback}
      />
    );
  }

  // ── Iterative: regenerating (loading spinner) ──
  // Note: the existing "regenerating" state is handled above in the combined block.
  // The iterative workflow uses the same "regenerating" state key.

  // ── Awaiting Selection (competitive_select / full_competitive) ──
  if (ws === "awaiting_selection") {
    return (
      <DraftComparison
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={config.label}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Awaiting Attorney Review ──
  // Option A: mode-guard — iterative_review gets the new UI; single_model_draft keeps AttorneyDraftReview
  if (ws === "awaiting_attorney_review") {
    if (isIterativeMode) {
      return (
        <IterativeDraftReview
          matterId={matterId}
          phase={phase}
          config={config}
          onRefresh={onRefresh}
        />
      );
    }
    return (
      <AttorneyDraftReview
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={config.label}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Awaiting Feedback Action (iterative_review only) ──
  if (ws === "awaiting_feedback_action") {
    return (
      <IterativeFeedbackAction
        matterId={matterId}
        phase={phase}
        config={config}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Awaiting Manual Decisions (iterative_review only) ──
  // Note: this state is entered after "Pick manually" — FeedbackPanels in select mode
  // is rendered within IterativeFeedbackAction above. If the page refreshes while in
  // awaiting_manual_decisions, we show the same component (it will re-enter select mode).
  if (ws === "awaiting_manual_decisions") {
    return (
      <IterativeFeedbackAction
        matterId={matterId}
        phase={phase}
        config={config}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Awaiting Evaluation Decisions (iterative_review only) ──
  if (ws === "awaiting_evaluation_decisions") {
    return (
      <IterativeEvaluationDecisions
        matterId={matterId}
        phase={phase}
        config={config}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Awaiting Decisions (full_competitive review cycle) ──
  if (ws === "awaiting_decisions") {
    return (
      <AttorneyReview
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={config.label}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Accepted / Formatting (formatting pass in progress) ──
  if (ws === "accepted" || ws === "formatting") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
            <Badge className="bg-blue-500 text-white">
              <Loader2 className="h-3 w-3 animate-spin mr-1" /> Applying Formatting
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-12 text-muted-foreground">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Claude is applying firm formatting standards...</p>
            <p className="text-sm mt-2">Substantive content is locked. Only formatting and presentation are being adjusted.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Awaiting Format Review ──
  // Option A: mode-guard — iterative_review gets the new iterative FormattingReview
  if (ws === "awaiting_format_review") {
    if (isIterativeMode) {
      return (
        <IterativeFormatReviewWrapper
          matterId={matterId}
          phase={phase}
          config={config}
          onRefresh={onRefresh}
        />
      );
    }
    return (
      <FormattingReview
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={config.label}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Complete ──
  if (ws === "complete") {
    // phaseDetailQuery is already declared at the top (unconditionally)
    const versions = phaseDetailQuery.data?.versions ?? [];
    const officialVersion = phase.officialFinalVersion
      ? versions.find((v: any) => v.versionNumber === phase.officialFinalVersion)
      : versions.find((v: any) => v.isSelected === 1) ?? versions[0];

    const isDocGenPhase = config.stage === "document_generation";
    const canWaitOnClient = isDocGenPhase && phase.status === "completed";

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif text-xl">{config.label}</CardTitle>
            <Badge className="bg-green-500 text-white">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
            </Badge>
          </div>
          {phase.isStale === 1 && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">This phase is stale. Consider re-running with updated facts.</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {phaseDetailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading phase content...</span>
            </div>
          ) : officialVersion ? (
            <ScrollArea className="h-[350px] rounded-lg border p-4">
              <div className="prose prose-sm max-w-none">
                <Streamdown>{officialVersion.content}</Streamdown>
              </div>
            </ScrollArea>
          ) : (
            <p className="text-muted-foreground">This phase has been completed.</p>
          )}

          {phase.officialFinalVersion && (
            <p className="text-xs text-muted-foreground">
              Official version: v{phase.officialFinalVersion}
              {officialVersion?.isFormattingPass === 1 && " (formatted)"}
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            {phase.officialFinalVersion && (
              <DownloadDocxButton matterId={matterId} phaseName={phase.phaseName} phaseLabel={config.label} />
            )}
            {canWaitOnClient && (
              <Button
                variant="outline"
                onClick={() => setWaitingOnClient.mutate({ matterId, phaseName: phase.phaseName })}
                disabled={setWaitingOnClient.isPending}
              >
                {setWaitingOnClient.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Clock className="h-4 w-4 mr-2" />}
                Mark Waiting on Client
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
