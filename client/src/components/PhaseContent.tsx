import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import {
  PHASE_CONFIG, OPTIONAL_PHASES, WORKFLOW_MODE_LABELS, WORKFLOW_MODE_DESCRIPTIONS,
  type PhaseName, type WorkflowState, type WorkflowMode,
} from "@shared/workflow";
import {
  Play, SkipForward, Loader2, AlertTriangle, CheckCircle2, Clock, Download,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import DraftComparison from "./DraftComparison";
import AttorneyReview from "./AttorneyReview";
import ModelSelector from "./ModelSelector";
import AttorneyDraftReview from "./AttorneyDraftReview";
import FormattingReview from "./FormattingReview";
import FileDropZone from "./FileDropZone";
import { Streamdown } from "streamdown";

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

export default function PhaseContent({ matterId, phase, allPhases, onRefresh }: PhaseContentProps) {
  const phaseName = phase.phaseName as PhaseName;
  const ws = phase.workflowState as WorkflowState;
  const config = PHASE_CONFIG[phaseName];
  const isOptional = OPTIONAL_PHASES.includes(phaseName);
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
          {/* Prior phase context notice for Final Legal Document */}
          {phaseName === "agreement" && (() => {
            const completedPriors = allPhases.filter(
              (p) => p.phaseName !== "agreement" && p.status === "completed"
            );
            const incompletePriors = allPhases.filter(
              (p) => p.phaseName !== "agreement" && p.status !== "completed" && p.status !== "skipped"
            );
            return (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-blue-800 font-medium text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Final Legal Document — Direct Access
                </div>
                {completedPriors.length > 0 ? (
                  <p className="text-sm text-blue-700">
                    The following completed phase outputs will be automatically included as source material:
                    {" "}<span className="font-medium">{completedPriors.map(p => PHASE_CONFIG[p.phaseName as PhaseName]?.label ?? p.phaseName).join(", ")}</span>.
                  </p>
                ) : (
                  <p className="text-sm text-blue-700">
                    No prior phases are complete yet. You may upload source documents below or proceed directly.
                  </p>
                )}
                {incompletePriors.length > 0 && (
                  <p className="text-xs text-blue-600">
                    Not included (not yet complete): {incompletePriors.map(p => PHASE_CONFIG[p.phaseName as PhaseName]?.label ?? p.phaseName).join(", ")}.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Source Materials — FileDropZone for ALL phases */}
          <div className="space-y-2">
            <Label>Source Materials</Label>
            <FileDropZone
              onFilesChange={handleFilesChange}
              existingFiles={existingUploads.map(u => ({
                id: u.id,
                fileName: u.fileName,
                fileUrl: u.fileUrl,
                fileSize: u.fileSize ?? undefined,
              }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Additional Context / Attorney Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Textarea
              placeholder="Enter any additional context, attorney notes, or specific instructions for this phase. This text will be included in the AI prompt alongside any uploaded documents."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              className="resize-y"
            />
          </div>

          {/* Mode selector for escalatable document generation phases */}
          {config.escalatable && config.availableModes.length > 1 && (
            <div className="space-y-2">
              <Label>Workflow Mode</Label>
              <Select
                value={modeOverride || config.defaultMode}
                onValueChange={setModeOverride}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.availableModes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      <div>
                        <span className="font-medium">{WORKFLOW_MODE_LABELS[mode]}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {WORKFLOW_MODE_DESCRIPTIONS[mode]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-2">
            {isUploadingAndStarting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading files and starting phase...
              </div>
            ) : (
              <>
                <Button
                  onClick={handleStartPhase}
                  disabled={isUploadingAndStarting || startPhase.isPending}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Start Phase
                </Button>
                {isOptional && (
                  <Button
                    variant="outline"
                    onClick={() => skipPhase.mutate({ matterId, phaseName: phase.phaseName })}
                    disabled={skipPhase.isPending}
                  >
                    <SkipForward className="h-4 w-4 mr-2" /> Skip
                  </Button>
                )}
              </>
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

  // ── Awaiting Attorney Review (single_model_draft) ──
  if (ws === "awaiting_attorney_review") {
    return (
      <AttorneyDraftReview
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={config.label}
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
  if (ws === "awaiting_format_review") {
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
