/**
 * PhaseStrip
 *
 * Horizontal strip of phase pills for the v2.4.2 MatterDashboard.
 * Shows container status for each phase (idle / in_progress / complete).
 * Clicking a pill selects that phase in the dashboard.
 *
 * Per v2.4.2 §8.2.
 */
import { PHASE_CONFIG, PHASE_NAMES, type PhaseName } from "@shared/workflow";
import { PHASE_STATUS_LABELS } from "@shared/strings";
import { CheckCircle2, Loader2, Circle } from "lucide-react";

export type PhaseContainerStatus = "idle" | "in_progress" | "complete";

interface PhaseStripProps {
  /** Map of phaseName → container status (from getPhaseContainerStatus) */
  statuses: Partial<Record<PhaseName, PhaseContainerStatus>>;
  selectedPhase: PhaseName;
  onSelectPhase: (phase: PhaseName) => void;
}

function statusIcon(status: PhaseContainerStatus) {
  if (status === "complete")
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "in_progress")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
}

function statusColor(status: PhaseContainerStatus, selected: boolean): string {
  if (selected) return "bg-primary/10 text-primary border-primary/30 font-medium";
  if (status === "complete") return "bg-green-50 text-green-700 border-green-200";
  if (status === "in_progress") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-muted/40 text-muted-foreground border-border";
}

export default function PhaseStrip({
  statuses,
  selectedPhase,
  onSelectPhase,
}: PhaseStripProps) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Phases">
      {PHASE_NAMES.map((phaseName) => {
        const status = statuses[phaseName] ?? "idle";
        const selected = phaseName === selectedPhase;
        const config = PHASE_CONFIG[phaseName];
        return (
          <button
            key={phaseName}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelectPhase(phaseName)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm
              transition-colors cursor-pointer
              ${statusColor(status, selected)}
            `}
            title={PHASE_STATUS_LABELS[status]}
          >
            {statusIcon(status)}
            <span>{config.label}</span>
          </button>
        );
      })}
    </div>
  );
}
