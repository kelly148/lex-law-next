import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  PHASE_CONFIG, PHASE_NAMES, OPTIONAL_PHASES, STAGE_LABELS,
  type PhaseName, type WorkflowState, type Stage,
} from "@shared/workflow";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Loader2, Clock,
  CircleDot, CircleSlash, CircleDashed, Pencil, Check, X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";
import PhaseContent from "@/components/PhaseContent";
import FactChangePanel from "@/components/FactChangePanel";

// ── State colors for sidebar dots ───────────────────────────────────
const STATE_COLORS: Record<WorkflowState, string> = {
  idle: "bg-muted-foreground/30",
  model_selection: "bg-blue-500",
  processing: "bg-blue-500 animate-pulse",
  drafting: "bg-blue-500 animate-pulse",
  awaiting_selection: "bg-amber-500",
  awaiting_attorney_review: "bg-amber-500",
  revising: "bg-blue-500 animate-pulse",
  reviewing: "bg-blue-500 animate-pulse",
  evaluating: "bg-blue-500 animate-pulse",
  awaiting_decisions: "bg-amber-500",
  regenerating: "bg-blue-500 animate-pulse",
  accepted: "bg-blue-500 animate-pulse",
  formatting: "bg-blue-500 animate-pulse",
  awaiting_format_review: "bg-amber-500",
  complete: "bg-green-500",
};

const STATE_LABELS: Record<WorkflowState, string> = {
  idle: "Not Started",
  model_selection: "Select Model",
  processing: "Processing...",
  drafting: "Drafting...",
  awaiting_selection: "Select Draft",
  awaiting_attorney_review: "Review Draft",
  revising: "Revising...",
  reviewing: "Reviewing...",
  evaluating: "Evaluating...",
  awaiting_decisions: "Review Feedback",
  regenerating: "Regenerating...",
  accepted: "Formatting...",
  formatting: "Formatting...",
  awaiting_format_review: "Review Formatting",
  complete: "Complete",
};

const ACTIVE_STATES = new Set([
  "processing", "drafting", "revising", "reviewing",
  "evaluating", "regenerating", "accepted", "formatting",
]);

// Group phases by stage
const STAGE_PHASES: Record<Stage, PhaseName[]> = {
  analysis: PHASE_NAMES.filter(n => PHASE_CONFIG[n].stage === "analysis") as unknown as PhaseName[],
  document_generation: PHASE_NAMES.filter(n => PHASE_CONFIG[n].stage === "document_generation") as unknown as PhaseName[],
};

export default function MatterPage() {
  useAuth({ redirectOnUnauthenticated: true });
  const params = useParams<{ matterId: string }>();
  const [, setLocation] = useLocation();
  const [selectedPhase, setSelectedPhase] = useState<PhaseName>("intake");
  const [showFactChange, setShowFactChange] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const renameMatter = trpc.matter.rename.useMutation({
    onSuccess: () => { matterQuery.refetch(); setEditingName(false); },
    onError: (err) => { toast.error(err.message); },
  });

  const matterQuery = trpc.matter.get.useQuery(
    { matterId: params.matterId },
    { enabled: !!params.matterId }
  );

  // Auto-poll every 3s when any phase is in an active processing state
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const hasActivePhase = matterQuery.data?.phases?.some(
      (p: { workflowState: string }) => ACTIVE_STATES.has(p.workflowState)
    );

    if (hasActivePhase) {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(() => {
          matterQuery.refetch();
        }, 3000);
      }
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [matterQuery.data]);

  if (matterQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96 col-span-3" />
        </div>
      </div>
    );
  }

  if (matterQuery.error || !matterQuery.data) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
        </Button>
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg">Matter not found</p>
        </div>
      </div>
    );
  }

  const { matter, phases } = matterQuery.data;
  const currentPhaseData = phases.find((p: { phaseName: string }) => p.phaseName === selectedPhase);
  const completedCount = phases.filter(
    (p: { workflowState: string; status: string }) =>
      p.workflowState === "complete" || p.status === "completed"
  ).length;

  return (
    <div className="container py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 text-xl font-serif font-bold text-primary w-72"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nameInput.trim()) {
                      renameMatter.mutate({ matterId: matter.matterId, matterName: nameInput.trim() });
                    } else if (e.key === "Escape") {
                      setEditingName(false);
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-green-600"
                  disabled={!nameInput.trim() || renameMatter.isPending}
                  onClick={() => renameMatter.mutate({ matterId: matter.matterId, matterName: nameInput.trim() })}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                  onClick={() => setEditingName(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="font-serif text-2xl font-bold text-primary">
                  {matter.matterName || matter.matterId}
                </h1>
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => { setNameInput(matter.matterName || ""); setEditingName(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {matter.jurisdiction} &middot; {matter.workflowPath === "full" ? "Full Workflow" : "Core Only"} &middot; {completedCount}/{phases.length} phases
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFactChange(!showFactChange)}>
          <AlertTriangle className="h-4 w-4 mr-2" />
          Fact Change
        </Button>
      </div>

      {/* Fact Change Panel */}
      {showFactChange && (
        <FactChangePanel
          matterId={params.matterId}
          phases={phases}
          onClose={() => setShowFactChange(false)}
          onCreated={() => { matterQuery.refetch(); setShowFactChange(false); }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Phase Sidebar with Stage Grouping */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Phases</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {(["analysis", "document_generation"] as Stage[]).map((stage) => (
                <div key={stage} className="mb-3 last:mb-0">
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {STAGE_LABELS[stage]}
                  </div>
                  <div className="space-y-0.5">
                    {STAGE_PHASES[stage].map((phaseName) => {
                      const phase = phases.find((p: any) => p.phaseName === phaseName);
                      if (!phase) return null;
                      const isSelected = phaseName === selectedPhase;
                      const isOptional = OPTIONAL_PHASES.includes(phaseName);
                      const ws = phase.workflowState as WorkflowState;
                      const status = phase.status as string;
                      const isWaiting = status === "waiting_on_client";
                      const isSkipped = status === "skipped";

                      return (
                        <button
                          key={phaseName}
                          onClick={() => setSelectedPhase(phaseName)}
                          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors text-sm
                            ${isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"}
                            ${isSkipped ? "opacity-50" : ""}`}
                        >
                          {/* Status dot */}
                          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            isWaiting ? "bg-amber-500" :
                            isSkipped ? "bg-muted-foreground/30" :
                            STATE_COLORS[ws]
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`truncate ${isSkipped ? "line-through" : ""}`}>
                                {PHASE_CONFIG[phaseName].label}
                              </span>
                              {isOptional && (
                                <span className="text-[10px] text-muted-foreground font-normal">(opt)</span>
                              )}
                            </div>
                            {isWaiting && (
                              <div className="flex items-center gap-1 text-amber-600 text-xs mt-0.5">
                                <Clock className="h-3 w-3" />
                                <span>Waiting on Client</span>
                              </div>
                            )}
                            {phase.isStale === 1 && (
                              <div className="flex items-center gap-1 text-amber-600 text-xs mt-0.5">
                                <AlertTriangle className="h-3 w-3" />
                                <span>Stale</span>
                              </div>
                            )}
                          </div>
                          {/* Right icon */}
                          {ws === "complete" && !isWaiting && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                          {isWaiting && <Clock className="h-4 w-4 text-amber-500 shrink-0" />}
                          {isSkipped && <CircleSlash className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
                          {ACTIVE_STATES.has(ws) && (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                          )}
                          {(ws === "awaiting_selection" || ws === "awaiting_decisions" || ws === "awaiting_attorney_review" || ws === "awaiting_format_review" || ws === "model_selection") && (
                            <CircleDot className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Phase Content */}
        <div className="lg:col-span-3">
          {currentPhaseData && (
            <PhaseContent
              matterId={params.matterId}
              phase={currentPhaseData}
              allPhases={phases}
              onRefresh={() => matterQuery.refetch()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
