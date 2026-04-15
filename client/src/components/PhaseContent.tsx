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
  Play, SkipForward, Loader2, Upload, FileText, AlertTriangle, CheckCircle2, Clock,
} from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import DraftComparison from "./DraftComparison";
import AttorneyReview from "./AttorneyReview";
import ModelSelector from "./ModelSelector";
import AttorneyDraftReview from "./AttorneyDraftReview";
import FormattingReview from "./FormattingReview";
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

export default function PhaseContent({ matterId, phase, allPhases, onRefresh }: PhaseContentProps) {
  const phaseName = phase.phaseName as PhaseName;
  const ws = phase.workflowState as WorkflowState;
  const config = PHASE_CONFIG[phaseName];
  const isOptional = OPTIONAL_PHASES.includes(phaseName);
  const [context, setContext] = useState("");
  const [modeOverride, setModeOverride] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

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
    onSuccess: (data) => {
      toast.success(`Uploaded: ${data.fileName}`);
      setUploadedFiles(prev => [...prev, data.fileName]);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadFile.mutate({
          matterId,
          phaseName: phase.phaseName,
          fileName: file.name,
          fileBase64: base64,
          contentType: file.type || "application/octet-stream",
        });
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
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
          {/* File upload for intake */}
          {phaseName === "intake" && (
            <div className="space-y-2">
              <Label>Source Materials</Label>
              <div className="flex items-center gap-2">
                <Input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="flex-1"
                />
                {uploadFile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              {uploadedFiles.length > 0 && (
                <div className="space-y-1">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="h-3 w-3" /> {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Additional Context</Label>
            <Textarea
              placeholder="Provide any additional context or instructions for this phase..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
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
            <Button
              onClick={() => startPhase.mutate({
                matterId,
                phaseName: phase.phaseName,
                context: context || undefined,
                workflowModeOverride: (modeOverride && modeOverride !== config.defaultMode)
                  ? modeOverride as any
                  : undefined,
              })}
              disabled={startPhase.isPending}
            >
              {startPhase.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
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
        sourceContent={context || undefined}
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
    const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName: phase.phaseName });
    const versions = phaseQuery.data?.versions ?? [];
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
          {/* Show the official final version content */}
          {officialVersion ? (
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

          <div className="flex gap-2">
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
