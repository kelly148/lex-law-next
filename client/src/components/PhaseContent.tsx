import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { PHASE_LABELS, OPTIONAL_PHASES, type PhaseName, type WorkflowState } from "@shared/workflow";
import {
  Play, SkipForward, Loader2, Upload, FileText, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import DraftComparison from "./DraftComparison";
import AttorneyReview from "./AttorneyReview";

interface Phase {
  id: number;
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  phaseOrder: number;
  status: string;
  workflowState: string;
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
  const isOptional = OPTIONAL_PHASES.includes(phaseName);
  const [context, setContext] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  const startDrafting = trpc.phase.startDrafting.useMutation({
    onSuccess: () => { toast.success("Drafting started"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const skipPhase = trpc.phase.skip.useMutation({
    onSuccess: () => { toast.success("Phase skipped"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const completeManually = trpc.phase.completeManually.useMutation({
    onSuccess: () => { toast.success("Phase marked complete"); onRefresh(); },
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

  // ── Idle State ──
  if (ws === "idle") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-serif text-xl">{PHASE_LABELS[phaseName]}</CardTitle>
              <CardDescription className="mt-1">
                {isOptional ? "Optional phase — can be skipped" : "Required phase"}
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

          <div className="flex gap-2">
            <Button
              onClick={() => startDrafting.mutate({ matterId, phaseName: phase.phaseName, context: context || undefined })}
              disabled={startDrafting.isPending}
            >
              {startDrafting.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
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

  // ── Drafting / Reviewing / Evaluating / Regenerating (in-progress states) ──
  if (ws === "drafting" || ws === "reviewing" || ws === "evaluating" || ws === "regenerating") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif text-xl">{PHASE_LABELS[phaseName]}</CardTitle>
            <Badge className="bg-blue-500 text-white">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              {ws === "drafting" ? "Generating Drafts..." :
               ws === "reviewing" ? "Running Reviews..." :
               ws === "evaluating" ? "Evaluating Feedback..." :
               "Regenerating..."}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-12 text-muted-foreground">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">
              {ws === "drafting" ? "AI providers are generating competitive drafts..." :
               ws === "reviewing" ? "Independent reviewers are analyzing the draft..." :
               ws === "evaluating" ? "Evaluating reviewer feedback..." :
               "Regenerating draft with feedback..."}
            </p>
            <p className="text-sm mt-2">This may take a moment. The page will update automatically.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Awaiting Selection ──
  if (ws === "awaiting_selection") {
    return (
      <DraftComparison
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={PHASE_LABELS[phaseName]}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Awaiting Decisions ──
  if (ws === "awaiting_decisions") {
    return (
      <AttorneyReview
        matterId={matterId}
        phaseName={phase.phaseName}
        phaseLabel={PHASE_LABELS[phaseName]}
        onRefresh={onRefresh}
      />
    );
  }

  // ── Complete ──
  if (ws === "complete") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif text-xl">{PHASE_LABELS[phaseName]}</CardTitle>
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
          <p className="text-muted-foreground">This phase has been completed.</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                startDrafting.mutate({ matterId, phaseName: phase.phaseName });
              }}
              disabled={startDrafting.isPending}
            >
              {startDrafting.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Re-run Phase
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
