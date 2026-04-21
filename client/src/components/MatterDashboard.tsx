/**
 * MatterDashboard
 *
 * Top-level v2.4.2 matter view for workflowModelVersion === 3 matters.
 * Renders the PhaseStrip + per-phase PhaseDocumentList.
 *
 * Per v2.4.2 §8.1–§8.3.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { PHASE_NAMES, PHASE_CONFIG, type PhaseName } from "@shared/workflow";
import { DOCUMENT_HOLDING_PHASES } from "@shared/schemas";
import { DASHBOARD } from "@shared/strings";
import PhaseStrip, { type PhaseContainerStatus } from "./PhaseStrip";
import PhaseDocumentList from "./PhaseDocumentList";

interface MatterDashboardProps {
  matterId: string;
}

export default function MatterDashboard({ matterId }: MatterDashboardProps) {
  const [, setLocation] = useLocation();
  const [selectedPhase, setSelectedPhase] = useState<PhaseName>("engagement");

  const matterQuery = trpc.matter.get.useQuery(
    { matterId },
    { enabled: Boolean(matterId) }
  );

  // Fetch container status for all document-holding phases in parallel.
  // Non-document-holding phases use phases.workflowState directly via the same endpoint.
  const containerStatusQueries = PHASE_NAMES.map((phaseName) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    trpc.document.getPhaseContainerStatus.useQuery(
      { matterId, phaseName },
      { enabled: Boolean(matterId) }
    )
  );

  if (matterQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
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

  const { matter } = matterQuery.data;

  // Build statuses map from individual queries.
  const statuses: Partial<Record<PhaseName, PhaseContainerStatus>> = {};
  PHASE_NAMES.forEach((phaseName, i) => {
    const q = containerStatusQueries[i];
    if (q.data) statuses[phaseName] = q.data as PhaseContainerStatus;
  });

  const isDocumentHolding = DOCUMENT_HOLDING_PHASES.has(selectedPhase);

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-serif text-2xl font-bold text-primary">
              {matter.matterName || matter.matterId}
            </h1>
            {matter.clientName && (
              <p className="text-sm text-muted-foreground">
                {matter.clientName}
              </p>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          {DASHBOARD.headerTitle}
        </div>
      </div>

      {/* Phase Strip */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          {DASHBOARD.phaseStripLabel}
        </p>
        <PhaseStrip
          statuses={statuses}
          selectedPhase={selectedPhase}
          onSelectPhase={setSelectedPhase}
        />
      </div>

      {/* Phase Content */}
      <div>
        {isDocumentHolding ? (
          <PhaseDocumentList
            matterId={matterId}
            phaseName={selectedPhase}
            onStatusChange={() => {
              // Refetch container status for this phase after any document change.
              const idx = PHASE_NAMES.indexOf(selectedPhase);
              if (idx >= 0) containerStatusQueries[idx].refetch();
            }}
          />
        ) : (
          // Non-document-holding phases: show a placeholder.
          // These phases (intake, issues, planning) use the v2.3 PhaseContent component.
          // In the model-3 dashboard, they are read-only summaries.
          <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium">{PHASE_CONFIG[selectedPhase].label}</p>
            <p className="mt-1">
              This phase uses the standard analysis workflow.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
