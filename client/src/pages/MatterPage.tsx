import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PHASE_LABELS, PHASE_NAMES, OPTIONAL_PHASES, type PhaseName, type WorkflowState } from "@shared/workflow";
import { ArrowLeft, AlertTriangle, CheckCircle2, Circle, Loader2, SkipForward, Clock } from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import PhaseContent from "@/components/PhaseContent";
import FactChangePanel from "@/components/FactChangePanel";

const STATE_COLORS: Record<WorkflowState, string> = {
  idle: "bg-muted-foreground/30",
  drafting: "bg-blue-500 animate-pulse",
  awaiting_selection: "bg-amber-500",
  reviewing: "bg-blue-500 animate-pulse",
  evaluating: "bg-blue-500 animate-pulse",
  awaiting_decisions: "bg-amber-500",
  regenerating: "bg-blue-500 animate-pulse",
  complete: "bg-green-500",
};

const STATE_LABELS: Record<WorkflowState, string> = {
  idle: "Not Started",
  drafting: "Drafting...",
  awaiting_selection: "Select Draft",
  reviewing: "Reviewing...",
  evaluating: "Evaluating...",
  awaiting_decisions: "Review Feedback",
  regenerating: "Regenerating...",
  complete: "Complete",
};

export default function MatterPage() {
  useAuth({ redirectOnUnauthenticated: true });
  const params = useParams<{ matterId: string }>();
  const [, setLocation] = useLocation();
  const [selectedPhase, setSelectedPhase] = useState<PhaseName>("intake");
  const [showFactChange, setShowFactChange] = useState(false);

  const matterQuery = trpc.matter.get.useQuery(
    { matterId: params.matterId },
    { enabled: !!params.matterId }
  );

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
  const currentPhaseData = phases.find(p => p.phaseName === selectedPhase);
  const completedCount = phases.filter(p => p.workflowState === "complete").length;

  return (
    <div className="container py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-serif text-2xl font-bold text-primary">Matter {matter.matterId}</h1>
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
        {/* Phase Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Phases</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="space-y-1">
                {phases.map((phase) => {
                  const phaseName = phase.phaseName as PhaseName;
                  const isSelected = phaseName === selectedPhase;
                  const isOptional = OPTIONAL_PHASES.includes(phaseName);
                  const ws = phase.workflowState as WorkflowState;

                  return (
                    <button
                      key={phaseName}
                      onClick={() => setSelectedPhase(phaseName)}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors text-sm
                        ${isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"}`}
                    >
                      <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATE_COLORS[ws]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{PHASE_LABELS[phaseName]}</span>
                          {isOptional && (
                            <span className="text-[10px] text-muted-foreground font-normal">(opt)</span>
                          )}
                        </div>
                        {phase.isStale === 1 && (
                          <div className="flex items-center gap-1 text-amber-600 text-xs mt-0.5">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Stale</span>
                          </div>
                        )}
                      </div>
                      {ws === "complete" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      {(ws === "drafting" || ws === "reviewing" || ws === "evaluating" || ws === "regenerating") && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                      )}
                      {(ws === "awaiting_selection" || ws === "awaiting_decisions") && (
                        <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
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
