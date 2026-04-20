/**
 * IterationCounter.tsx
 *
 * Displays the current cycle and iteration number per v2.3 §16.2.
 *
 * - Format: "Cycle N, Iteration M"
 * - cycle > 1 indicates a restart has occurred (shown with a visual cue)
 * - Optionally shows cumulative call count (§19 risk mitigation)
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface IterationCounterProps {
  /** Current cycle number (≥1). Cycle > 1 means a restart occurred. */
  cycleNumber: number;
  /** Current iteration number within the cycle (≥0). 0 = initial draft. */
  iterationNumber: number;
  /**
   * Optional cumulative LLM call count shown for cost transparency (§19).
   * Omit to hide the call count.
   */
  callCount?: number;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Formats the iteration label.
 * iterationNumber = 0 means the initial draft has been generated but no
 * review loop has started yet; we display it as "Iteration 0" to be
 * consistent with the data model.
 */
export function formatIterationLabel(
  cycleNumber: number,
  iterationNumber: number,
): string {
  return `Cycle ${cycleNumber}, Iteration ${iterationNumber}`;
}

export default function IterationCounter({
  cycleNumber,
  iterationNumber,
  callCount,
  className,
}: IterationCounterProps) {
  const isRestarted = cycleNumber > 1;

  return (
    <div
      className={cn("flex items-center gap-2 text-sm", className)}
      data-testid="iteration-counter"
    >
      <Badge
        variant={isRestarted ? "secondary" : "outline"}
        className="font-mono text-xs"
        data-testid="iteration-counter-badge"
      >
        {formatIterationLabel(cycleNumber, iterationNumber)}
      </Badge>

      {isRestarted && (
        <span
          className="text-xs text-muted-foreground"
          data-testid="iteration-counter-restart-note"
        >
          (restarted)
        </span>
      )}

      {callCount !== undefined && (
        <span
          className="text-xs text-muted-foreground"
          data-testid="iteration-counter-call-count"
        >
          {callCount} {callCount === 1 ? "call" : "calls"}
        </span>
      )}
    </div>
  );
}
